// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, setLocale, t, type MermaidLike } from '../src'

const CODE = 'flowchart TD\n  A[组外] --> B[第一组节点]\n  subgraph first[第一组]\n    B\n  end\n  subgraph second[第二组]\n    C[第二组节点]\n    subgraph child[内层组]\n      D[内层节点]\n    end\n  end\n'
const fake: MermaidLike = {
  initialize() {}, async parse() {},
  async render(_id, code) {
    const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
    return { svg: `<svg id="fixture" xmlns="http://www.w3.org/2000/svg"><g class="clusters">${graph.subgraphs.map(group =>
      `<g class="cluster" id="fixture-${group.id}"><rect data-group="${group.id}"/><g class="cluster-label"><text>${group.title}</text></g></g>`).join('')}</g><g class="nodes">${graph.nodes.filter(node => !graph.subgraphs.some(group => group.id === node.id)).map(node =>
      `<g class="node" id="fixture-flowchart-${node.id}-0" transform="translate(10 20)"><rect/><text>${node.label}</text></g>`).join('')}</g><g class="edgePaths">${graph.edges.map(edge =>
      `<path id="L_${edge.source}_${edge.target}_0" d="M0 0L100 100"/>`).join('')}</g></svg>` }
  },
}
let editor: MermaidWysiwygEditor, host: HTMLElement, view: MermaidCanvasView
const entity = (id: string) => host.querySelector(`[data-mw-entity="${id}"]`)!
const pointer = (target: EventTarget, type: string, x: number, y: number, extra: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event)
}
const start = (id: string) => pointer(entity(`node:${id}`).querySelector('text')!, 'pointerdown', 20, 30)
const aim = (hit: Element | null, x: number, y: number) => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit })
  pointer(document, 'pointermove', x, y)
}
const bounds = () => {
  for (const rect of host.querySelectorAll<SVGRectElement>('rect[data-group]')) {
    const [x, y, width, height] = rect.dataset.group === 'first' ? [100, 100, 150, 170]
      : rect.dataset.group === 'second' ? [350, 100, 200, 200] : [370, 150, 150, 110]
    vi.spyOn(rect, 'getBoundingClientRect').mockReturnValue({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} })
  }
}
beforeEach(async () => {
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  editor = new MermaidWysiwygEditor({ code: CODE })
  host = document.createElement('div'); document.body.append(host)
  view = new MermaidCanvasView({ editor, container: host, mermaid: fake, debounceMs: 10000, panZoom: true })
  await view.render(); bounds()
})
afterEach(() => {
  view.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale('zh-CN')
  Reflect.deleteProperty(document, 'elementFromPoint')
})

describe.each(['zh-CN', 'en'] as const)('%s 拖动节点调整分组', locale => {
  beforeEach(() => setLocale(locale))
  it.each([['A', 'second', 400, 120], ['B', 'second', 400, 120], ['C', 'first', 140, 150], ['B', 'child', 400, 200]] as const)(
    '%s 可以直接拖入 %s，预览高亮目标，支持一次撤销', (id, group, x, y) => {
    editor.setSelection([`node:${id}`], 'canvas')
    const source = entity(`node:${id}`), target = entity(`subgraph:${group}`)
    start(id); aim(target.querySelector('rect'), x, y)
    expect(source.classList.contains('mw-node-moving')).toBe(true)
    expect(source.getAttribute('transform')).not.toBe('translate(10 20)')
    expect(target.classList.contains('mw-group-drop-target')).toBe(true)
    expect(host.classList.contains('mw-panning')).toBe(false)
    expect(host.querySelector('.mw-connect-hint')?.textContent).toBe(t('drag.moveInto', { name: group === 'first' ? '第一组' : group === 'second' ? '第二组' : '内层组' }))
    pointer(document, 'pointerup', x, y)
    expect(source.getAttribute('transform')).toBe('translate(10 20)')
    expect(source.classList.contains('mw-node-moving')).toBe(false)
    expect(target.classList.contains('mw-group-drop-target')).toBe(false)
    expect(editor.result.flowchart!.nodeById.get(id)?.subgraph).toBe(group)
    expect(editor.result.flowchart!.edges).toHaveLength(1)
    expect(editor.selection).toEqual([`node:${id}`])
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  })

  it('松在目标分组内部节点上也移入该组，拖放后的 click 不改选其他节点', async () => {
    start('B'); aim(entity('node:C').querySelector('text'), 400, 120)
    pointer(document, 'pointerup', 400, 120)
    pointer(entity('node:C'), 'click', 400, 120)
    expect(editor.result.flowchart!.nodeById.get('B')?.subgraph).toBe('second')
    expect(editor.selection).toEqual(['node:B'])
    await new Promise(resolve => setTimeout(resolve, 0))
    pointer(entity('node:C'), 'click', 400, 120)
    expect(editor.selection).toEqual(['node:C'])
  })

  it('拖到空白处可移出分组，同组拖放不增加历史', () => {
    start('C'); aim(entity('subgraph:second').querySelector('rect'), 400, 120)
    pointer(document, 'pointerup', 400, 120)
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    start('C'); aim(host.querySelector('svg'), 40, 320)
    expect(host.querySelector('.mw-connect-hint')?.textContent).toBe(t('drag.moveOut'))
    pointer(document, 'pointerup', 40, 320)
    expect(editor.result.flowchart!.nodeById.get('C')?.subgraph).toBeNull()
    editor.undo(); expect(editor.code).toBe(CODE)
  })

  it.each(['Escape', 'pointercancel', 'outside', 'readonly', 'change'])('%s 会取消拖动，恢复节点位置且不提交移动', reason => {
    const source = entity('node:C')
    start('C'); aim(entity('subgraph:first').querySelector('rect'), 140, 150)
    if (reason === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (reason === 'pointercancel') pointer(document, 'pointercancel', 140, 150)
    if (reason === 'outside') aim(document.body, 700, 400)
    if (reason === 'readonly') view.setReadOnly(true)
    const expected = reason === 'change' ? CODE + '  E[新增]\n' : CODE
    if (reason === 'change') editor.setCode(expected, 'api')
    pointer(document, 'pointerup', 140, 150)
    expect(editor.code).toBe(expected)
    expect(source.getAttribute('transform')).toBe('translate(10 20)')
    expect(source.classList.contains('mw-node-moving')).toBe(false)
    expect(host.querySelector('.mw-group-drop-target')).toBeNull()
  })

  it('普通点击、微小位移和 Alt 连线不会触发节点移动', () => {
    start('C'); aim(entity('node:C'), 22, 32); pointer(document, 'pointerup', 22, 32)
    pointer(entity('node:C'), 'click', 22, 32)
    expect(editor.selection).toEqual(['node:C'])
    expect(editor.code).toBe(CODE)
    pointer(entity('node:C'), 'pointerdown', 20, 30, { altKey: true })
    aim(entity('subgraph:first').querySelector('rect'), 140, 150)
    expect(host.querySelector('.mw-node-moving')).toBeNull()
    expect(editor.code).toBe(CODE)
  })
})
