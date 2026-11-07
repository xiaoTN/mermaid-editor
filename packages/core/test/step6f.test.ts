// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { correlateFlowchart } from '../../dom/src/correlate'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() { return (this.textContent ?? '').length * 8 } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
})
afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox'); Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength'); vi.unstubAllGlobals()
})

async function rendered(editor: MermaidWysiwygEditor) {
  const host = document.createElement('div')
  host.innerHTML = (await mermaid.render(`step6f-${serial++}`, editor.code)).svg
  const correlated = correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!)
  return new Map([...host.querySelectorAll<SVGPathElement>('path.flowchart-link')].map(path => [path.getAttribute('data-mw-entity')!, {
    stroke: path.style.stroke, width: path.style.strokeWidth, dash: path.style.strokeDasharray,
    pattern: [...path.classList].filter(c => /edge-pattern|edge-thickness/.test(c)).sort().join(' '),
    label: correlated.edgeLabels.get(path.getAttribute('data-mw-entity')!)?.textContent ?? '',
  }]))
}
const louvre = readFileSync(resolve(__dirname, 'fixtures/louvre.mmd'), 'utf8')
const samples = [
  [louvre, 'floor', 'result', '            tabletop & bedside & central & wallart & slippers --> result'],
  ['flowchart LR\r\n\tA[Alpha] & B[Beta] & C[Gamma] -->|yes| D[Delta] & E[Echo] --> F & G  \r\n\t%% keep  \r\n\tX --> Y\r\n', 'B', 'E', 'A[Alpha] & C[Gamma] -->|yes| D[Delta] & E[Echo]'],
  ['flowchart LR\n X --> A & B -- words --> C & D --> Y\n A --> C\n', 'A', 'C', 'B -- words --> C & D'],
  ['flowchart LR\n A --> B & C & D\n', 'A', 'C', 'A --> B & D'],
  ['flowchart LR\n A[Alpha] & B[Beta] <-->|yes| C[Gamma] & D[Delta]; X --> Y\n', 'B', 'C', 'A[Alpha] <-->|yes| C[Gamma] & D[Delta]'],
] as const

it.each(samples.map(([source, a, b, remaining], i) => ({ source, a, b, remaining, i })))('fan $i: preserves every other SVG style', async ({ source, a, b, remaining }) => {
  for (const action of ['line', 'thick', 'color'] as const) {
    const raw = new MermaidWysiwygEditor({ code: source })
    // Give every edge a distinct width and color, so index swaps cannot hide.
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    const code = source.trimEnd() + eol + raw.result.flowchart!.edges.map((_, i) => ` linkStyle ${i} stroke:#${(0x112200 + i).toString(16)},stroke-width:${i + 1}px`).join(eol) + eol
    const editor = new MermaidWysiwygEditor({ code })
    const id = editor.result.flowchart!.edges.find(e => e.source === a && e.target === b)!.entityId
    const before = await rendered(editor)
    editor.dispatch(action === 'color' ? { type: 'setEdgeColor', edgeId: id, value: '#ab1234' }
      : { type: 'setEdgeStyle', edgeId: id, line: action === 'line' ? 'dotted' : 'thick', preserveLabelForm: true })
    expect(editor.code).toContain(remaining)
    const after = await rendered(editor)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [key, style] of before) {
      if (key === id) expect(after.get(key)).not.toEqual(style)
      else expect(after.get(key), key).toEqual(style)
    }
    const afterCode = editor.code
    expect(editor.undo()).toBe(true); expect(editor.code).toBe(code)
    expect(editor.redo()).toBe(true); expect(editor.code).toBe(afterCode)
  }
}, 30000)

it('Louvre only removes floor from the authored fan and inserts floor immediately below it', () => {
  const editor = new MermaidWysiwygEditor({ code: louvre })
  editor.dispatch({ type: 'setEdgeStyle', edgeId: 'edge:floor->result#0', line: 'dotted' })
  expect(editor.code).toBe(louvre.replace('tabletop & bedside & central & wallart & floor & slippers --> result',
    'tabletop & bedside & central & wallart & slippers --> result\n            floor -.-> result'))
})
