// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, type MermaidLike } from '../src'

const CODE = 'flowchart LR\n subgraph group[被拖动的组]\n A[甲]\n B[乙]\n end\n X[组外甲]\n Y[组外乙]\n A -->|出口| X\n Y -->|入口| B\n A --> B\n group -.-> X\n X --> Y\n A <--> X\n'
let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView, renderer: MermaidLike, scale: number
const points = [[100, 60], [180, 10], [320, 110], [400, 60]]
const pathData = 'M100,60C180,10 320,110 400,60'
const find = (id: string, tag = '') => host.querySelector<SVGGraphicsElement>(`${tag}[data-mw-entity="${id}"]:not(.mw-edge-hit)`)!
const edge = (id: string) => find(id, 'path') as SVGPathElement
const coordinates = (path: SVGPathElement) => (path.getAttribute('d')!.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
const pointer = (target: EventTarget, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
}
const drag = (id = 'subgraph:group', dx = 60, dy = 40) => {
  pointer(find(id), 'pointerdown', 100, 100)
  pointer(document, 'pointermove', 100 + dx, 100 + dy)
}
const cancel = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

beforeEach(async () => {
  vi.useFakeTimers(); scale = 1
  vi.stubGlobal('CSS', { escape: (text: string) => text.replace(/[^\w-]/g, char => `\\${char}`) })
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform(matrix: DOMMatrix) { return { x: matrix.a * this.x + matrix.c * this.y + matrix.e, y: matrix.b * this.x + matrix.d * this.y + matrix.f } }
  })
  // jsdom 没有原生 SVG 几何，只补矩阵和曲线读取；拖动、命中和恢复仍走正式画布。
  Object.defineProperties(SVGElement.prototype, {
    getScreenCTM: { configurable: true, value() { return { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0,
      inverse() { return { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: 0, f: 0 } } } } },
    getTotalLength: { configurable: true, value: vi.fn(() => 100) },
    getPointAtLength: { configurable: true, value: vi.fn((length: number) => {
      const t = length / 100, weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3]
      return { x: points.reduce((sum, point, i) => sum + point[0] * weights[i], 0), y: points.reduce((sum, point, i) => sum + point[1] * weights[i], 0) }
    }) },
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const x = Number(this.getAttribute('x') ?? 0), y = Number(this.getAttribute('y') ?? 0)
    const width = Number(this.getAttribute('width') ?? 800), height = Number(this.getAttribute('height') ?? 600)
    return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} }
  })
  renderer = { initialize() {}, async parse() {}, render: vi.fn(async (id, code) => {
    const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
    const edgeId = (entity: string) => { const value = /edge:(.+)->(.+)#(\d+)/.exec(entity)!; return `L_${value[1]}_${value[2]}_${value[3]}` }
    return { svg: `<svg id="${id}" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${id}-arrow"/></defs><g class="clusters"><g class="cluster" id="${id}-group"><rect x="40" y="20" width="180" height="180"/></g></g><g class="nodes">${graph.nodes.filter(node => node.id !== 'group').map(node =>
      `<g class="node" id="${id}-flowchart-${node.id}-0"><rect width="40" height="20"/><text>${node.label}</text></g>`).join('')}</g><g class="edgePaths">${graph.edges.map(item =>
      `<path class="flowchart-link" id="${id}-${edgeId(item.entityId)}" d="${pathData}" marker-start="url(#${id}-arrow)" marker-end="url(#${id}-arrow)" stroke-dasharray="3 4"/>`).join('')}</g><g class="edgeLabels">${graph.edges.filter(item => item.label).map(item =>
      `<g class="edgeLabel" transform="translate(250,60)"><g class="label" data-id="${edgeId(item.entityId)}"><text>${item.label}</text></g></g>`).join('')}</g></svg>` }
  }) }
  host = document.createElement('div'); document.body.append(host)
  editor = new MermaidWysiwygEditor({ code: CODE })
  view = new MermaidCanvasView({ editor, container: host, mermaid: renderer, debounceMs: 10000 })
  await view.render()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('.mw-svg-host') })
})
afterEach(() => {
  view.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  for (const key of ['getScreenCTM', 'getTotalLength', 'getPointAtLength']) Reflect.deleteProperty(SVGElement.prototype, key)
  Reflect.deleteProperty(document, 'elementFromPoint')
})

it.each([.5, 1, 2])('组拖动时跨组的入线、出线和直接分组连线实时跟随，倍率 %s', value => {
  scale = value
  const outgoing = edge('edge:A->X#0'), incoming = edge('edge:Y->B#0'), direct = edge('edge:group->X#0')
  const marker = outgoing.getAttribute('marker-end'), renderCount = vi.mocked(renderer.render).mock.calls.length
  drag()
  expect(coordinates(outgoing).slice(0, 2)).toEqual([100 + 60 / scale, 60 + 40 / scale])
  expect(coordinates(outgoing).slice(-2)).toEqual([400, 60])
  expect(coordinates(incoming).slice(0, 2)).toEqual([100, 60])
  expect(coordinates(incoming).slice(-2)).toEqual([400 + 60 / scale, 60 + 40 / scale])
  expect(coordinates(direct)).toEqual(coordinates(outgoing))
  expect(coordinates(edge('edge:A->X#1'))).toEqual(coordinates(outgoing))
  const hit = host.querySelector<SVGPathElement>('.mw-edge-hit[data-mw-entity="edge:A->X#0"]')!
  expect(hit.getAttribute('d')).toBe(outgoing.getAttribute('d'))
  expect(outgoing.getAttribute('marker-end')).toBe(marker)
  expect(outgoing.getAttribute('marker-start')).toBe(marker)
  expect(outgoing.getAttribute('stroke-dasharray')).toBe('3 4')
  expect(find('edge:A->X#0', 'g').getAttribute('transform')).toBe(`translate(${30 / scale},${20 / scale}) translate(250,60)`)
  expect(edge('edge:A->B#0').getAttribute('d')).toBe(pathData)
  expect(edge('edge:A->B#0').getAttribute('transform')).toContain(`translate(${60 / scale},${40 / scale})`)
  expect(edge('edge:X->Y#0').getAttribute('d')).toBe(pathData)
  expect(edge('edge:X->Y#0').getAttribute('transform')).toBeNull()
  const samples = vi.mocked(outgoing.getPointAtLength).mock.calls.length
  pointer(document, 'pointermove', 180, 160)
  expect(coordinates(outgoing).slice(0, 2)).toEqual([100 + 80 / scale, 60 + 60 / scale])
  expect(vi.mocked(outgoing.getPointAtLength).mock.calls.length).toBe(samples)
  expect(renderer.render).toHaveBeenCalledTimes(renderCount)
  expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  cancel()
  expect(outgoing.getAttribute('d')).toBe(pathData)
  expect(hit.getAttribute('d')).toBe(pathData)
  expect(find('edge:A->X#0', 'g').getAttribute('transform')).toBe('translate(250,60)')
  expect(host.querySelector('.mw-node-moving')).toBeNull()
})

it('线条和文字本身嵌在被拖组中时，扣掉父组位移，组外端点仍固定', () => {
  const group = find('subgraph:group'), outgoing = edge('edge:A->X#0'), label = find('edge:A->X#0', 'g')
  group.append(outgoing, label)
  drag()
  expect(coordinates(outgoing).slice(0, 2)).toEqual([100, 60])
  expect(coordinates(outgoing).slice(-2)).toEqual([340, 20])
  expect(label.getAttribute('transform')).toBe('translate(-30,-20) translate(250,60)')
  cancel()
  expect(outgoing.getAttribute('d')).toBe(pathData)
  expect(label.getAttribute('transform')).toBe('translate(250,60)')
})

it('只拖一个节点时也只移动对应端，其他节点和源码不变', () => {
  drag('node:A')
  expect(coordinates(edge('edge:A->X#0')).slice(0, 2)).toEqual([160, 100])
  expect(coordinates(edge('edge:A->B#0')).slice(-2)).toEqual([400, 60])
  expect(find('node:B').getAttribute('transform')).toBeNull()
  expect(editor.code).toBe(CODE)
})

it('无法读取的路径保持原样，连线文字也不单独漂走', () => {
  vi.mocked(SVGElement.prototype.getPointAtLength).mockImplementation(() => { throw new Error('模拟路径不可读') })
  drag()
  expect(edge('edge:A->X#0').getAttribute('d')).toBe(pathData)
  expect(find('edge:A->X#0', 'g').getAttribute('transform')).toBe('translate(250,60)')
})

it('节点的自循环连线整体平移，取消后恢复原始路径和位置', async () => {
  editor.setCode(CODE + ' B --> B\n', 'code'); await view.render()
  const loop = edge('edge:B->B#0')
  drag('node:B')
  expect(loop.getAttribute('d')).toBe(pathData)
  expect(loop.getAttribute('transform')).toBe('translate(60,40) ')
  cancel()
  expect(loop.getAttribute('transform')).toBeNull()
  expect(loop.getAttribute('d')).toBe(pathData)
})

it.each(['Escape', 'pointercancel', 'readonly', 'change', 'outside'])('%s 后精确恢复所有临时路径和文字，不残留拖动样式', reason => {
  const paths = [...host.querySelectorAll<SVGPathElement>('path[data-mw-entity]')], original = paths.map(path => path.getAttribute('d'))
  drag()
  expect(edge('edge:A->X#0').getAttribute('d')).not.toBe(pathData)
  if (reason === 'Escape') cancel()
  if (reason === 'pointercancel') pointer(document, 'pointercancel', 160, 140)
  if (reason === 'readonly') view.setReadOnly(true)
  if (reason === 'change') editor.setCode(CODE + ' Z[新输入]\n', 'code')
  if (reason === 'outside') {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
    pointer(document, 'pointerup', 1600, 1400)
  }
  expect(paths.map(path => path.getAttribute('d'))).toEqual(original)
  expect(host.querySelector('.mw-node-moving')).toBeNull()
  expect(editor.code).toBe(reason === 'change' ? CODE + ' Z[新输入]\n' : CODE)
})
