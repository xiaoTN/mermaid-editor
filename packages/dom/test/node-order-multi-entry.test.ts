// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor, flowchartOrderPeers } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from '../src/correlate'
import { MermaidCanvasView } from '../src'
import { DEFAULT_EXAMPLE } from '../../../apps/playground/src/defaultExample'

const CODE = readFileSync(resolve(process.cwd(), '../core/test/fixtures/node-order-multi-entry.mmd'), 'utf8')
const ORDERS = ['JKL', 'JLK', 'KJL', 'KLJ', 'LJK', 'LKJ']
let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
  vi.stubGlobal('CSS', { escape: (text: string) => text.replace(/[^\w-]/g, value => `\\${value}`) })
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() { return (this.textContent ?? '').length * 8 } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
})
afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox'); Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
  vi.unstubAllGlobals()
})

const fingerprint = (editor: MermaidWysiwygEditor) => {
  const graph = editor.result.flowchart!
  return JSON.stringify([
    graph.nodes.map(node => [node.id, node.label, node.shape, node.subgraph, node.classes]).sort(),
    graph.edges.map(edge => [edge.source, edge.target, edge.label, edge.seg.line, edge.seg.arrowStart, edge.seg.arrowEnd]).sort(),
    graph.subgraphs.map(group => [group.id, group.parent]).sort(),
  ])
}

it.each([['截图', CODE], ['默认示例', DEFAULT_EXAMPLE]].flatMap(([name, code]) => ORDERS.map(order => [name, order, code])))
('%s中的 J/K/L 可以排成 %s，真实 Mermaid 位置、连线和样式保持正确', async (_name, order, code) => {
  const editor = new MermaidWysiwygEditor({ code }), before = fingerprint(editor)
  expect(new Set(flowchartOrderPeers(editor.result.flowchart!, 'J'))).toEqual(new Set(['J', 'K', 'L']))
  editor.dispatch({ type: 'reorderNodes', ids: [...order] })
  const { svg } = await mermaid.render(`multi-entry-${serial++}`, editor.code)
  const host = document.createElement('div'); host.innerHTML = svg
  const correlation = correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!)
  expect(correlation.failed).toEqual([])
  const positions = ['J', 'K', 'L'].map(id => {
    const node = correlation.nodes.get(`node:${id}`)!
    const value = /translate\(([-\d.]+)[, ]+([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '')!
    return { id, x: Number(value[1]), y: Number(value[2]) }
  })
  expect(Math.max(...positions.map(point => point.x)) - Math.min(...positions.map(point => point.x))).toBeLessThan(1)
  expect(positions.sort((a, b) => a.y - b.y).map(point => point.id).join('')).toBe(order)
  expect(fingerprint(editor)).toBe(before)
  expect(editor.code).toContain('linkStyle 4 stroke:#315fd6,stroke-width:3px')
  editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it('在截图结构中把站内通知拖到最前面，先看到对照，松手应用，撤销恢复整份源码', async () => {
  const host = document.createElement('div'); document.body.append(host)
  Object.defineProperties(host, { clientWidth: { value: 1400 }, clientHeight: { value: 1000 } })
  const bounds = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const shape = this.matches('g.node,g.cluster') ? this.querySelector(':scope > rect') ?? this : this
    const viewBox = this.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    const width = Number(shape.getAttribute('width') ?? viewBox?.[2] ?? 40), height = Number(shape.getAttribute('height') ?? viewBox?.[3] ?? 20)
    let x = Number(shape.getAttribute('x') ?? 0), y = Number(shape.getAttribute('y') ?? 0), current: Element | null = this
    while (current) {
      for (const match of (current.getAttribute('transform') ?? '').matchAll(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/g)) { x += Number(match[1]); y += Number(match[2]) }
      current = current.parentElement
    }
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} }
  })
  const editor = new MermaidWysiwygEditor({ code: CODE })
  const view = new MermaidCanvasView({ editor, container: host, mermaid, debounceMs: 10000,
    mermaidConfig: { startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } } })
  const pointer = (target: EventTarget, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
  }
  try {
    await view.render()
    const source = host.querySelector('[data-mw-entity="node:L"]')!, peer = host.querySelector('[data-mw-entity="node:J"]')!
    const from = source.getBoundingClientRect(), to = peer.getBoundingClientRect(), x = to.left + to.width / 2, y = to.top - 16
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('.mw-svg-host > svg') })
    pointer(source, 'pointerdown', from.left + from.width / 2, from.top + from.height / 2)
    pointer(document, 'pointermove', x, y)
    await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.mw-drag-preview')?.dataset.state).toBe('ready'), { timeout: 3000 })
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    expect(host.querySelector('.mw-compare-after [data-mw-preview-change][data-mw-preview-entity="node:L"]')).not.toBeNull()
    const positions = ['J', 'K', 'L'].map(id => ({ id, y: Number(/translate\([-\d.]+[, ]+([-\d.]+)\)/
      .exec(host.querySelector(`.mw-compare-after [data-mw-preview-entity="node:${id}"]`)!.getAttribute('transform') ?? '')![1]) }))
    expect(positions.sort((a, b) => a.y - b.y).map(point => point.id).join('')).toBe('LJK')
    pointer(document, 'pointerup', x, y)
    expect(editor.code.indexOf('L[站内通知]')).toBeLessThan(editor.code.indexOf('J[练习用节点]'))
    expect(editor.code.indexOf('J[练习用节点]')).toBeLessThan(editor.code.indexOf('K[短信通知]'))
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  } finally { view.destroy(); host.remove(); bounds.mockRestore() }
})
