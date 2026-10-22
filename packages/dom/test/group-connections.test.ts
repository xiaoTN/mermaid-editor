// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, setLocale, t, type MermaidLike } from '../src'

const CODE = 'flowchart TD\n  A[起点] --> Z[终点]\n  subgraph first[第一组]\n    B[乙]\n  end\n  subgraph second[第二组]\n    C[丙]\n  end\n'
const fake: MermaidLike = {
  initialize() {}, async parse() {},
  async render(_id, code) {
    const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
    const nodes = (parent: string | null) => graph.nodes.filter(node => node.subgraph === parent && !graph.subgraphs.some(group => group.id === node.id))
      .map(node => `<g class="node" id="fixture-flowchart-${node.id}-0"><rect width="40" height="20"/><text>${node.label}</text></g>`).join('')
    return { svg: `<svg id="fixture" xmlns="http://www.w3.org/2000/svg"><g>${nodes(null)}${graph.subgraphs.map(group =>
      `<g class="cluster" id="fixture-${group.id}"><rect width="100" height="100"/><g class="cluster-label"><text>${group.title}</text></g>${nodes(group.id)}</g>`).join('')}</g><g class="edgePaths">${graph.edges.map(edge =>
      `<path id="fixture-L_${edge.source}_${edge.target}_0" data-id="L_${edge.source}_${edge.target}_0" d="M0 0L100 100"/>`).join('')}</g></svg>` }
  },
}
let editor: MermaidWysiwygEditor, host: HTMLElement, view: MermaidCanvasView
const entity = (id: string) => host.querySelector(`[data-mw-entity="${id}"]`)!
const pointer = (el: EventTarget, type: string, altKey = false) => el.dispatchEvent(new MouseEvent(type, {
  bubbles: true, button: 0, clientX: 90, clientY: 30, altKey,
}))
const aim = (target: Element | null) => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  pointer(document, 'pointermove')
}
beforeEach(async () => {
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  editor = new MermaidWysiwygEditor({ code: CODE })
  host = document.createElement('div'); document.body.append(host)
  view = new MermaidCanvasView({ editor, container: host, mermaid: fake, debounceMs: 10000 })
  await view.render()
})
afterEach(() => {
  view.destroy(); host.remove(); vi.unstubAllGlobals(); setLocale('zh-CN')
  Reflect.deleteProperty(document, 'elementFromPoint')
})

describe.each(['zh-CN', 'en'] as const)('%s 分组连线手势', locale => {
  beforeEach(() => setLocale(locale))
  it.each([
    ['node:A', 'subgraph:first', 'rect'],
    ['subgraph:first', 'node:A', 'text'],
    ['subgraph:first', 'subgraph:second', '.cluster-label text'],
  ])('从 %s 的圆点拖到 %s 的 %s 可直接连线', (source, target, selector) => {
    pointer(entity(source).querySelector('rect')!, 'pointerover')
    expect(host.querySelectorAll('.mw-ports button')).toHaveLength(4)
    pointer(host.querySelector('.mw-ports button')!, 'pointerdown')
    const targetEl = entity(target)
    aim(targetEl.querySelector(selector))
    expect(targetEl.classList.contains('mw-connect-target')).toBe(true)
    if (target === 'subgraph:second') expect(host.querySelector('.mw-connect-hint')?.textContent).toBe(t('drag.dropOn', { name: '第二组' }))
    pointer(document, 'pointerup')
    expect(editor.result.flowchart!.edges.some(edge => edge.source === source.split(':')[1] && edge.target === target.split(':')[1])).toBe(true)
    expect(host.querySelector('.mw-new-node-menu')).toBeNull()
    expect(targetEl.classList.contains('mw-connect-target')).toBe(false)
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  })

  it.each(['source', 'target'] as const)('拖动现有箭头的%s端点可连接分组', end => {
    pointer(entity('edge:A->Z#0'), 'click')
    pointer(host.querySelector(`[data-end="${end}"]`)!, 'pointerdown')
    aim(entity('subgraph:second').querySelector('.cluster-label text'))
    pointer(document, 'pointerup')
    expect(editor.result.flowchart!.edges.some(edge => edge.source === (end === 'source' ? 'second' : 'A') && edge.target === (end === 'target' ? 'second' : 'Z'))).toBe(true)
    editor.undo(); expect(editor.code).toBe(CODE)
  })

  it('命中分组内部节点时仍连接该节点，而非外层分组', () => {
    pointer(entity('node:A'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown')
    aim(entity('node:B').querySelector('text'))
    expect(entity('node:B').classList.contains('mw-connect-target')).toBe(true)
    expect(entity('subgraph:first').classList.contains('mw-connect-target')).toBe(false)
    pointer(document, 'pointerup')
    expect(editor.result.flowchart!.edges.some(edge => edge.source === 'A' && edge.target === 'B')).toBe(true)
  })

  it.each([false, true])('连接工具或 Alt 拖动也允许分组作为起终点，Alt=%s', alt => {
    if (!alt) view.setTool('connect')
    pointer(entity('subgraph:first').querySelector('.cluster-label')!, 'pointerdown', alt)
    aim(entity('subgraph:second').querySelector('rect'))
    pointer(host.querySelector('svg')!, 'pointerup', alt)
    expect(editor.result.flowchart!.edges.some(edge => edge.source === 'first' && edge.target === 'second')).toBe(true)
    editor.undo(); expect(editor.code).toBe(CODE)
  })

  it('重复连线和分组内部循环会提示原因，取消拖动不会改图', async () => {
    pointer(entity('node:B'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown')
    aim(entity('subgraph:first').querySelector('rect')); pointer(document, 'pointerup')
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    expect(host.querySelector('.mw-toast')?.textContent).toBe(t('toast.groupCycle'))
    pointer(entity('subgraph:first'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown')
    aim(entity('subgraph:second')); pointer(document, 'pointercancel')
    expect(editor.code).toBe(CODE)
    editor.dispatch({ type: 'connect', source: 'first', target: 'second' }); await view.render()
    const connected = editor.code
    pointer(entity('subgraph:first'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown')
    aim(entity('subgraph:second')); pointer(document, 'pointerup')
    expect(editor.code).toBe(connected)
    expect(host.querySelector('.mw-toast')?.textContent).toBe(t('toast.dupEdge'))
  })
})
