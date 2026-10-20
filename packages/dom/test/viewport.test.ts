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

it('E1: real Louvre auto-fit stops at 60%, starts within reach, and its viewport scrolls', () => {
  const svg = host.querySelector<SVGSVGElement>('svg')!
  expect(svg.style.transform).toMatch(/translate\([\d.]+px, [\d.]+px\) scale\(0.6\)/)
  expect(getComputedStyle(host.querySelector('.mw-svg-host')!).overflow).toBe('auto')
  view.zoomBy(.5); expect(svg.style.transform).toContain('scale(0.3)') // manual zoom remains available
  view.fitView(); expect(svg.style.transform).toContain('scale(0.6)')
})

it.each([false, true])('first edge press after panning selects it, whether the release click reaches the SVG: %s', releaseClick => {
  const svg = host.querySelector('svg')!
  pointer(svg, 'pointerdown'); pointer(host, 'pointermove', 90); pointer(host, 'pointerup', 90)
  if (releaseClick) pointer(svg, 'click', 90)
  const edge = host.querySelector('path[data-mw-entity="edge:entry->layout#0"]')!
  pointer(edge, 'pointerdown'); pointer(edge, 'pointerup'); pointer(edge, 'click')
  expect(editor.selection).toEqual(['edge:entry->layout#0'])
  expect(edge.classList.contains('mw-selected')).toBe(true)
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})
