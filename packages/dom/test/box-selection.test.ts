// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView } from '../src'

let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView
const code = 'flowchart TD\n subgraph G[分组]\n A[甲]\n B[乙]\n end\n C[丙]\n A --> B\n'
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height } as DOMRect)
const pointer = (target: EventTarget, type: string, x: number, y: number, shiftKey = false) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, shiftKey }))
const node = (id: string) => host.querySelector(`[data-mw-entity="node:${id}"]`)!
beforeEach(async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  host = document.createElement('div'); document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 500))
  editor = new MermaidWysiwygEditor({ code })
  view = new MermaidCanvasView({ editor, container: host, panZoom: true, mermaid: {
    initialize() {}, async parse() {}, async render(id) { return { svg: `<svg id="${id}" viewBox="0 0 600 500">
      <g class="cluster" id="${id}-G"><rect/></g>
      ${['A', 'B', 'C'].map((name, i) => `<g class="node" id="${id}-flowchart-${name}-${i}"><rect/></g>`).join('')}</svg>` } },
  } })
  await view.render()
  vi.spyOn(node('A'), 'getBoundingClientRect').mockReturnValue(rect(40, 40, 50, 30))
  vi.spyOn(node('B'), 'getBoundingClientRect').mockReturnValue(rect(120, 90, 50, 30))
  vi.spyOn(node('C'), 'getBoundingClientRect').mockReturnValue(rect(350, 300, 50, 30))
})
afterEach(() => { view.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('从分组空白框选多个节点，不选中分组本身，松手显示批量操作且不平移', () => {
  view.setTool('box-select')
  const svg = host.querySelector('svg')!, transform = svg.style.transform
  pointer(host.querySelector('.cluster rect')!, 'pointerdown', 20, 20)
  pointer(document, 'pointermove', 200, 160)
  expect(editor.selection).toEqual(['node:A', 'node:B'])
  expect(host.querySelector('.mw-selection-box')).not.toBeNull()
  pointer(document, 'pointerup', 200, 160)
  pointer(svg, 'click', 200, 160)
  expect(editor.selection).toEqual(['node:A', 'node:B'])
  expect(host.querySelector('.mw-popover')?.textContent).toContain('2')
  expect(host.querySelector('.mw-selection-box')).toBeNull()
  expect(svg.style.transform).toBe(transform)
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it('Shift 反向拖动追加选择，Escape 和指针取消恢复原选区', () => {
  editor.setSelection(['node:C'])
  const background = host.querySelector('.mw-svg-host')!
  pointer(background, 'pointerdown', 200, 160, true)
  pointer(document, 'pointermove', 20, 20, true)
  expect(editor.selection).toEqual(['node:C', 'node:A', 'node:B'])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(editor.selection).toEqual(['node:C'])
  pointer(background, 'pointerdown', 20, 20, true)
  pointer(document, 'pointermove', 200, 160, true)
  pointer(document, 'pointercancel', 200, 160, true)
  expect(editor.selection).toEqual(['node:C'])
})

it('普通点击和只读不触发框选，画布全选仅选择节点', () => {
  pointer(node('A'), 'pointerdown', 60, 50, true)
  pointer(document, 'pointermove', 200, 160, true)
  expect(host.querySelector('.mw-selection-box')).toBeNull()
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }))
  expect(editor.selection).toEqual(['node:A', 'node:B', 'node:C'])
  view.setTool('box-select'); view.setReadOnly(true)
  pointer(host.querySelector('.mw-svg-host')!, 'pointerdown', 20, 20)
  pointer(document, 'pointermove', 200, 160)
  expect(host.querySelector('.mw-selection-box')).toBeNull()
})
