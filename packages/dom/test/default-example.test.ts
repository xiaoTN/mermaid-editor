// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { DEFAULT_EXAMPLE } from '../../../apps/playground/src/defaultExample'
import { MermaidWysiwygEditor, type FlowchartOp } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from '../src/correlate'
import { MermaidCanvasView, t } from '../src'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0

beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
  vi.stubGlobal('CSS', { escape: (text: string) => text.replace(/[^\w-]/g, value => `\\${value}`) })
  // jsdom 不测量 SVG 文字，提供尺寸后仍使用真实 Mermaid 排版和渲染。
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() {
    return (this.textContent ?? '').length * 8
  } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
})

afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
  vi.unstubAllGlobals()
})

async function checkCanvas(editor: MermaidWysiwygEditor) {
  const { svg } = await mermaid.render(`default-example-${serial++}`, editor.code)
  const host = document.createElement('div'); host.innerHTML = svg
  const correlation = correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!)
  expect(correlation.failed).toEqual([])
  expect(host.querySelector('[data-mw-ambiguous]')).toBeNull()
  expect(correlation.edges.size).toBe(editor.result.flowchart!.edges.length)
  const graph = editor.result.flowchart!
  // 分组连线会让分组 ID 出现在节点索引里，但画布上只渲染对应的分组。
  for (const node of graph.nodes.filter(node => !graph.subgraphs.some(group => group.id === node.id))) {
    expect(correlation.nodes.has(node.entityId), node.entityId).toBe(true)
  }
  for (const group of graph.subgraphs) expect(correlation.nodes.has(group.entityId), group.entityId).toBe(true)
  return host
}

it('默认示例覆盖画布菜单的八种形状、线型、嵌套分组和分组连线，所有元素都可定位', async () => {
  const editor = new MermaidWysiwygEditor({ code: DEFAULT_EXAMPLE })
  const graph = editor.result.flowchart!
  expect(new Set(graph.nodes.map(node => node.shape))).toEqual(new Set([
    'rect', 'round', 'stadium', 'diamond', 'hexagon', 'circle', 'cylinder', 'subroutine',
  ]))
  expect(new Set(graph.edges.map(edge => edge.seg.line))).toEqual(new Set(['solid', 'dotted', 'thick']))
  expect(new Set(graph.edges.map(edge => edge.seg.arrowEnd))).toEqual(new Set(['arrow', 'open', 'circle', 'cross']))
  expect(graph.subgraphs.find(group => group.id === 'fulfillment')?.parent).toBe('payment')
  expect(graph.edges.some(edge => edge.source === 'intake' && edge.target === 'payment')).toBe(true)
  const host = await checkCanvas(editor)
  expect(host.querySelector('[data-mw-entity="node:B"]')?.textContent).toContain('双击这里改字')
})

it('默认示例的改字、样式、端点和跨组移动可以继续渲染，并一次撤销恢复源码', async () => {
  const operations: FlowchartOp[] = [
    { type: 'renameNode', id: 'B', label: '修改后的订单<br/>保留换行' },
    { type: 'setNodeShape', id: 'B', shape: 'hexagon' },
    { type: 'setNodeColor', id: 'B', prop: 'fill', value: '#f97316' },
    { type: 'moveNodeToSubgraph', id: 'I', subgraph: 'fulfillment' },
    { type: 'renameSubgraph', id: 'fulfillment', title: '修改后的履约分组' },
    { type: 'addSubgraph', title: '练习归组', nodeIds: ['I', 'J'] },
    { type: 'ungroup', id: 'fulfillment' },
    { type: 'duplicateNode', id: 'B' },
    { type: 'deleteNode', id: 'J' },
    { type: 'connect', source: 'A', target: 'J' },
  ]
  for (const operation of operations) {
    const editor = new MermaidWysiwygEditor({ code: DEFAULT_EXAMPLE })
    expect(editor.dispatch(operation)?.edits.length, operation.type).toBeGreaterThan(0)
    await checkCanvas(editor)
    editor.undo(); expect(editor.code).toBe(DEFAULT_EXAMPLE)
  }
  const editor = new MermaidWysiwygEditor({ code: DEFAULT_EXAMPLE })
  const edgeId = editor.result.flowchart!.edges.find(edge => edge.source === 'C' && edge.target === 'E')!.entityId
  for (const operation of [
    { type: 'setEdgeLabel', edgeId, label: '修改后的连线文字' },
    { type: 'setEdgeStyle', edgeId, line: 'dotted', arrowEnd: 'arrow' },
    { type: 'retargetEdge', edgeId, end: 'target', nodeId: 'J' },
    { type: 'deleteEdge', edgeId },
  ] satisfies FlowchartOp[]) {
    expect(editor.dispatch(operation)?.edits.length, operation.type).toBeGreaterThan(0)
    await checkCanvas(editor)
    editor.undo(); expect(editor.code).toBe(DEFAULT_EXAMPLE)
  }
})

it('真实 Mermaid 拖动分支时先显示新布局，松手后才回写源码并支持一次撤销', async () => {
  const code = 'flowchart TD\n A[入口]\n B[乙]\n C[丙]\n A --> B\n A --> C\n'
  const editor = new MermaidWysiwygEditor({ code })
  const host = document.createElement('div'); document.body.append(host)
  const bounds = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const match = /translate\(([-\d.]+)[, ]+([-\d.]+)\)/.exec(this.getAttribute('transform') ?? '')
    const x = match ? Number(match[1]) : 0, y = match ? Number(match[2]) : 0
    return { left: x - 20, right: x + 20, top: y - 10, bottom: y + 10,
      x: x - 20, y: y - 10, width: 40, height: 20, toJSON() {} }
  })
  const view = new MermaidCanvasView({ editor, container: host, mermaid, debounceMs: 10000 })
  const pointer = (target: EventTarget, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
  }
  try {
    await view.render()
    const source = host.querySelector<SVGGElement>('[data-mw-entity="node:C"]')!
    const peer = host.querySelector<SVGGElement>('[data-mw-entity="node:B"]')!
    const from = source.getBoundingClientRect(), to = peer.getBoundingClientRect()
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('svg') })
    pointer(source, 'pointerdown', from.x + 20, from.y + 10)
    pointer(document, 'pointermove', to.x - 10, to.y + 10)
    await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.mw-drag-preview')?.dataset.state).toBe('ready'))
    expect(host.querySelector('.mw-drag-preview')?.textContent).toContain(t('preview.ready'))
    expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
    pointer(document, 'pointerup', to.x - 10, to.y + 10)
    expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
    await view.render(); expect(view.renderError).toBeNull()
    editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
    await view.render()
    // 拖放产生的同一轮 click 会被拦截；下一次真实点击发生在下一个事件循环。
    await new Promise(resolve => setTimeout(resolve, 0))
    editor.setSelection(['node:C'], 'canvas')
    const earlier = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('ui.orderEarlier')}"]`)!
    const enterMenu = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    earlier.dispatchEvent(enterMenu)
    expect(enterMenu.defaultPrevented).toBe(false)
    earlier.click()
    await vi.waitFor(() => {
      const panel = host.querySelector<HTMLElement>('.mw-drag-preview')!
      expect(panel.hidden).toBe(false)
      expect(panel.dataset.state).toBe('ready')
    })
    const apply = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!
    const enterApply = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    apply.dispatchEvent(enterApply)
    expect(enterApply.defaultPrevented).toBe(false)
    expect(host.querySelector('[contenteditable="true"]')).toBeNull()
    apply.click()
    expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
    editor.undo(); expect(editor.code).toBe(code)
  } finally {
    view.destroy(); host.remove(); bounds.mockRestore(); Reflect.deleteProperty(document, 'elementFromPoint')
  }
})
