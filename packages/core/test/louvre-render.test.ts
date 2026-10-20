// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { correlateFlowchart } from '../../dom/src/correlate'

const code = readFileSync(resolve(__dirname, 'fixtures/louvre.mmd'), 'utf8')
const initialSvg = readFileSync(resolve(__dirname, 'fixtures/louvre.svg'), 'utf8')
const pairs = ['entry->layout', 'goods->decor', 'decor->assembly', 'select->floor', 'floor->result', 'primary->ai']
let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
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

it.each(pairs)('真实 Mermaid 重绘 %s：改色和改线型各自只作用于选中的 path', async pair => {
  for (const action of ['color', 'style'] as const) {
    const editor = new MermaidWysiwygEditor({ code })
    const host = document.createElement('div'); host.innerHTML = initialSvg
    correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!)
    const path = host.querySelector(`[id="fixture-louvre-L_${pair.replace('->', '_')}_0"]`)!
    const id = path.getAttribute('data-mw-entity')!
    editor.setSelection([id], 'canvas')
    editor.dispatch(action === 'color' ? { type: 'setEdgeColor', edgeId: id, value: '#123abc' }
      : { type: 'setEdgeStyle', edgeId: id, line: 'dotted', preserveLabelForm: true })
    const result = await mermaid.render(`verification-${serial++}`, editor.code)
    host.innerHTML = result.svg
    const paths = [...host.querySelectorAll<SVGPathElement>('path.flowchart-link')]
    const changed = paths.filter(p => action === 'color' ? p.style.stroke === '#123abc'
      : p.classList.contains('edge-pattern-dotted'))
    expect(changed).toHaveLength(1)
    expect(changed[0].getAttribute('data-id')).toBe(`L_${pair.replace('->', '_')}_0`)
    editor.undo(); expect(editor.code).toBe(code)
  }
}, 20000)
