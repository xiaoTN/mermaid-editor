// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, setLocale, t, type MermaidLike } from '../src'

const CODE = 'flowchart TD\n A[入口]\n B[乙]\n C[丙]\n A --> B\n A --> C\n'
let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView, renderer: MermaidLike
const main = () => host.querySelector<SVGSVGElement>('.mw-svg-host > svg')!
const pointer = (target: EventTarget, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
}

beforeEach(async () => {
  vi.useFakeTimers()
  setLocale('zh-CN')
  vi.stubGlobal('CSS', { escape: (text: string) => text })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const x = Number(this.getAttribute('data-x') ?? 0), y = Number(this.getAttribute('data-y') ?? 0)
    const width = this.hasAttribute('data-x') ? 40 : 800, height = this.hasAttribute('data-x') ? 20 : 600
    return { x: x - width / 2, y: y - height / 2, left: x - width / 2, top: y - height / 2,
      right: x + width / 2, bottom: y + height / 2, width, height, toJSON() {} }
  })
  renderer = { initialize() {}, async parse() {}, render: vi.fn(async (id, code) => {
    const graph = new MermaidWysiwygEditor({ code }).result.flowchart!, order = graph.edges.map(edge => edge.target)
    return { svg: `<svg id="${id}" data-order="${order.join('')}" viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg"><g class="nodes">${graph.nodes.map(node =>
      `<g class="node" id="${id}-flowchart-${node.id}-0" data-x="${node.id === 'A' ? 100 : 50 + order.indexOf(node.id) * 130}" data-y="${node.id === 'A' ? 20 : 100}"><rect width="40" height="20"/><text>${node.label}</text></g>`).join('')}</g><g class="edgePaths">${graph.edges.map(edge =>
      `<path id="${id}-L_${edge.source}_${edge.target}_0"/>`).join('')}</g></svg>` }
  }) }
  host = document.createElement('div'); document.body.append(host)
  editor = new MermaidWysiwygEditor({ code: CODE })
  view = new MermaidCanvasView({ editor, container: host, mermaid: renderer, debounceMs: 1000 })
  await view.render()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => main() })
})
afterEach(() => {
  view.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  Reflect.deleteProperty(document, 'elementFromPoint'); setLocale('zh-CN')
})

it.each(['拖动松手', '菜单应用'])('%s后的第一帧直接显示已确认的新排版，不露出旧图或重新等待渲染', async entry => {
  const original = main(), node = original.querySelector('[data-mw-entity="node:C"]')!
  if (entry === '拖动松手') {
    pointer(node, 'pointerdown', 180, 100)
    pointer(document, 'pointermove', 20, 100)
  } else {
    editor.setSelection(['node:C'])
    host.querySelector<HTMLButtonElement>(`button[aria-label="${t('ui.orderEarlier')}"]`)!.click()
  }
  await vi.advanceTimersByTimeAsync(140)
  expect(host.querySelector<HTMLElement>('.mw-drag-preview')?.dataset.state).toBe('ready')
  const renderCount = vi.mocked(renderer.render).mock.calls.length
  expect(editor.code).toBe(CODE)
  if (entry === '拖动松手') pointer(document, 'pointerup', 20, 100)
  else host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!.click()
  expect(main().getAttribute('data-order')).toBe('CB')
  expect(original.isConnected).toBe(false)
  expect(host.querySelector('.mw-compare-before, .mw-compare-after, .mw-node-moving')).toBeNull()
  await vi.advanceTimersByTimeAsync(1100)
  expect(renderer.render).toHaveBeenCalledTimes(renderCount)
  expect(editor.selection).toEqual(['node:C'])
  editor.undo(); expect(editor.code).toBe(CODE)
  await view.render(); expect(main().getAttribute('data-order')).toBe('BC')
  editor.redo(); await view.render(); expect(main().getAttribute('data-order')).toBe('CB')
  pointer(main().querySelector('[data-mw-entity="node:B"]')!, 'click', 180, 100)
  expect(editor.selection).toEqual(['node:B'])
})

it.each(['完成', '失败'])('应用新排版后，之前还在计算的旧图%s也不能覆盖新图', async outcome => {
  const stale = main().outerHTML
  let complete!: (result: { svg: string }) => void, fail!: (reason: Error) => void
  vi.mocked(renderer.render).mockImplementationOnce(() => new Promise((resolve, reject) => { complete = resolve; fail = reject }))
  view.setMermaidConfig({ theme: 'default' })
  pointer(main().querySelector('[data-mw-entity="node:C"]')!, 'pointerdown', 180, 100)
  pointer(document, 'pointermove', 20, 100)
  await vi.advanceTimersByTimeAsync(140)
  pointer(document, 'pointerup', 20, 100)
  const applied = main()
  expect(applied.getAttribute('data-order')).toBe('CB')
  if (outcome === '完成') complete({ svg: stale })
  else fail(new Error('旧图渲染失败'))
  await vi.advanceTimersByTimeAsync(1100)
  expect(main()).toBe(applied)
  expect(editor.code).not.toBe(CODE)
  expect(editor.diagnostics).toEqual([])
  expect(host.querySelector<HTMLElement>('.mw-error-badge')!.style.display).toBe('none')
})
