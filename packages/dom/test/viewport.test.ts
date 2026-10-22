// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView } from '../src'

const code = readFileSync(resolve(__dirname, '../../core/test/fixtures/louvre.mmd'), 'utf8')
const svg = readFileSync(resolve(__dirname, '../../core/test/fixtures/louvre.svg'), 'utf8')
let host: HTMLElement, view: MermaidCanvasView, editor: MermaidWysiwygEditor
beforeEach(async () => {
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  host = document.createElement('div'); document.body.append(host)
  Object.defineProperties(host, { clientWidth: { value: 400 }, clientHeight: { value: 300 } })
  editor = new MermaidWysiwygEditor({ code })
  view = new MermaidCanvasView({ editor, container: host, panZoom: true,
    mermaid: { initialize() {}, async parse() {}, async render() { return { svg } } } })
  await view.render()
})
afterEach(() => { view.destroy(); host.remove(); vi.unstubAllGlobals() })
const pointer = (el: Element, type: string, x = 10) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 }))
const viewport = () => host.querySelector<SVGSVGElement>('svg')!.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)!.slice(1).map(Number)

it('定位屏幕外的节点时居中且不放大、不修改源码', () => {
  const node = host.querySelector('[data-mw-entity="node:entry"]')!
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect)
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 900, right: 1000, top: 700, bottom: 740 } as DOMRect)
  const before = viewport()
  view.focusEntities(['node:entry'])
  expect(editor.selection).toEqual(['node:entry'])
  expect(viewport()[0]).toBeCloseTo(before[0] + 200 - 950)
  expect(viewport()[1]).toBeCloseTo(before[1] + 150 - 720)
  expect(viewport()[2]).toBe(before[2])
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it.each(['.mw-svg-host', '[data-mw-entity="node:entry"]'])('双指滑动画布时平移视图，悬停位置为 %s', selector => {
  const target = host.querySelector(selector)!
  target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  const before = viewport()
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 34, deltaY: -52 })
  target.dispatchEvent(event)

  expect(viewport()).toEqual([before[0] - 34, before[1] + 52, before[2]])
  expect(event.defaultPrevented).toBe(true)
  expect(editor.code).toBe(code)
  expect(editor.canUndo).toBe(false)
  expect(editor.selection).toEqual([])
})

it.each(['ctrlKey', 'metaKey'])('按住 %s 滚动仍然缩放画布', modifier => {
  const before = viewport()
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -10, [modifier]: true })
  host.querySelector('[data-mw-entity="node:entry"]')!.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  expect(viewport()[2]).toBeGreaterThan(before[2])
  expect(editor.code).toBe(code)
  expect(editor.canUndo).toBe(false)
})

it.each([
  { mode: 1, x: 16, y: 16 },
  { mode: 2, x: 400, y: 300 },
])('按行或页滚动时正确换算画布位移：$mode', ({ mode, x, y }) => {
  const before = viewport()
  host.querySelector('.mw-svg-host')!.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaMode: mode, deltaX: 1, deltaY: 1,
  }))
  expect(viewport()).toEqual([before[0] - x, before[1] - y, before[2]])
})

it('平移后重新渲染仍保留视图位置', async () => {
  host.querySelector('.mw-svg-host')!.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaX: 25, deltaY: 50,
  }))
  const before = viewport()
  view.setMermaidConfig({ theme: 'default' })
  await view.render()
  expect(viewport()).toEqual(before)
  expect(editor.code).toBe(code)
  expect(editor.canUndo).toBe(false)
})

it('E1：Louvre 大图至少按 60% 显示，初始位置可触达且支持滚动', () => {
  const svg = host.querySelector<SVGSVGElement>('svg')!
  expect(svg.style.transform).toMatch(/translate\([\d.]+px, [\d.]+px\) scale\(0.6\)/)
  expect(getComputedStyle(host.querySelector('.mw-svg-host')!).overflow).toBe('auto')
  view.zoomBy(.5); expect(svg.style.transform).toContain('scale(0.3)') // 仍可手动继续缩小。
  view.fitView(); expect(svg.style.transform).toContain('scale(0.6)')
})

it.each([false, true])('平移后首次点击仍能选中边，无论松开时的点击是否落到 SVG：%s', releaseClick => {
  const svg = host.querySelector('svg')!
  pointer(svg, 'pointerdown'); pointer(host, 'pointermove', 90); pointer(host, 'pointerup', 90)
  if (releaseClick) pointer(svg, 'click', 90)
  const edge = host.querySelector('path[data-mw-entity="edge:entry->layout#0"]')!
  pointer(edge, 'pointerdown'); pointer(edge, 'pointerup'); pointer(edge, 'click')
  expect(editor.selection).toEqual(['edge:entry->layout#0'])
  expect(edge.classList.contains('mw-selected')).toBe(true)
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})
