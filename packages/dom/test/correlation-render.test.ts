// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { correlateClass, correlateEr, correlateFlowchart, correlateState, type Correlation } from '../src/correlate'
import { MermaidCanvasView, setLocale, t } from '../src'
import { correlationSources } from '../../../tools/cases/correlation-sources.mts'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
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
  setLocale('zh-CN')
})

async function render(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const result = await mermaid.render(`regression-${serial++}`, code)
  const host = document.createElement('div')
  host.innerHTML = result.svg
  const svg = host.querySelector('svg')!
  return { editor, host, svg }
}

async function canvasFor(code: string, transform?: (svg: SVGSVGElement) => void) {
  const { editor, host, svg } = await render(code)
  transform?.(svg)
  const markup = svg.outerHTML
  host.replaceChildren()
  document.body.append(host)
  const canvas = new MermaidCanvasView({ editor, container: host, debounceMs: 10000,
    mermaid: { initialize() {}, async parse() {}, async render() { return { svg: markup } } } })
  await canvas.render()
  expect(canvas.renderError).toBeNull()
  return { editor, host, canvas, destroy() { canvas.destroy(); host.remove() } }
}

it('57: deleting the rendered b_a keeps a and a --> c in their original group', async () => {
  const code = correlationSources['node-boundaries']
  const { editor, svg } = await render(code)
  correlateFlowchart(svg, editor.result.flowchart!)
  const node = [...svg.querySelectorAll('g.node')].find(el => el.textContent === '节点b_a')!
  expect(node.getAttribute('data-mw-entity')).toBe('node:b_a')
  editor.setSelection([node.getAttribute('data-mw-entity')!], 'canvas')
  editor.deleteEntities(editor.selection)
  expect(editor.code).toBe(code.replace('    b_a["节点b_a"]\n', ''))
  editor.undo(); expect(editor.code).toBe(code)
})

it('58: every rendered cluster maps to its whole id, regardless of paint order', async () => {
  const code = correlationSources['cluster-boundaries']
  const { editor, svg } = await render(code)
  const correlation = correlateFlowchart(svg, editor.result.flowchart!)
  for (const sg of editor.result.flowchart!.subgraphs) {
    const cluster = [...svg.querySelectorAll('g.cluster')].find(el => el.id === `${svg.id}-${sg.id}`)!
    expect(cluster.getAttribute('data-mw-entity')).toBe(sg.entityId)
    expect(correlation.nodes.get(sg.entityId)).toBe(cluster)
  }
})

it('59: duplicate Mermaid edge ids never claim either source edge or label', async () => {
  const { editor, svg } = await render(correlationSources['edge-collision'])
  const graph = editor.result.flowchart!
  const result = correlateFlowchart(svg, graph)
  const collisions = [...svg.querySelectorAll('path.flowchart-link[data-id="L_a_b_c_0"]')]
  expect(collisions).toHaveLength(2)
  for (const edge of graph.edges.slice(0, 2)) {
    expect(result.failed).toContain(edge.entityId)
    expect(result.edges.has(edge.entityId)).toBe(false)
    expect(result.edgeLabels.has(edge.entityId)).toBe(false)
  }
  expect(result.edges.has(graph.edges[2].entityId)).toBe(true)
})

it.each(['zh-CN', 'en'] as const)('59: clicking a real ambiguous edge or label shows the %s hint without edits', async locale => {
  setLocale(locale)
  const code = correlationSources['edge-collision']
  const { editor, host, destroy } = await canvasFor(code)
  try {
    for (const el of [
      ...host.querySelectorAll('path.flowchart-link[data-id="L_a_b_c_0"]'),
      ...host.querySelectorAll('.edgeLabel .label[data-id="L_a_b_c_0"]'),
    ]) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(editor.selection).toEqual([])
      expect(host.querySelector('.mw-toast')?.textContent).toBe(t('canvas.ambiguous'))
      expect(host.querySelector('.mw-toast')?.textContent).toBe(locale === 'en'
        ? "This item can't be edited safely on the canvas. Please edit it in the code."
        : '这个元素无法在画布上安全编辑，请在左侧代码里修改')
      expect(host.querySelector('.mw-popover')).toBeNull()
    }
    expect(editor.code).toBe(code)
    expect(editor.canUndo).toBe(false)
  } finally { destroy() }
})

it('node ids and diagram ids containing regex metacharacters match literally', async () => {
  const { editor, svg } = await render('flowchart TB\n subgraph A\n a.b\n end\n subgraph B\n axb\n end\n')
  const oldId = svg.id
  svg.id = 'literal.diagram'
  for (const el of svg.querySelectorAll('[id]')) {
    if (el.id.startsWith(`${oldId}-`)) el.id = `${svg.id}-${el.id.slice(oldId.length + 1)}`
  }
  const result = correlateFlowchart(svg, editor.result.flowchart!)
  expect(result.nodes.get('node:a.b')?.textContent).toBe('a.b')
  expect(result.nodes.get('node:axb')?.textContent).toBe('axb')
  expect(result.failed).toEqual([])
})

it.each(['missing', 'unknown', 'duplicate'] as const)('real node %s identity cannot fall through to its parent group', async kind => {
  setLocale('zh-CN')
  const code = correlationSources['node-boundaries']
  const result = await canvasFor(code, svg => {
    const node = [...svg.querySelectorAll('g.node')].find(el => el.textContent === '节点b_a')!
    if (kind === 'duplicate') node.after(node.cloneNode(true))
    else if (kind === 'missing') node.removeAttribute('id')
    else node.id = 'unrecognized-node'
  })
  try {
    const node = [...result.host.querySelectorAll('g.node')].find(el => el.textContent === '节点b_a')!
    for (const type of ['click', 'dblclick']) {
      node.querySelector('.nodeLabel')!.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      result.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      expect(result.editor.selection).toEqual([])
      expect(result.host.querySelector('.mw-toast')?.textContent).toBe(t('canvas.ambiguous'))
      expect(result.host.querySelector('[contenteditable="true"]')).toBeNull()
      expect(result.editor.code).toBe(code)
      expect(result.editor.canUndo).toBe(false)
    }
    expect(node.hasAttribute('data-mw-entity')).toBe(false)
  } finally { result.destroy() }
})

it.each(['missing', 'unknown', 'duplicate'] as const)('real cluster %s identity cannot match by title or substring', async kind => {
  const { editor, svg } = await render(correlationSources['cluster-boundaries'])
  const cluster = [...svg.querySelectorAll('g.cluster')].find(el => el.id === `${svg.id}-other`)!
  if (kind === 'duplicate') cluster.after(cluster.cloneNode(true))
  else if (kind === 'missing') cluster.removeAttribute('id')
  else cluster.id = `${svg.id}-other-suffix`
  const result = correlateFlowchart(svg, editor.result.flowchart!)
  expect(result.nodes.has('subgraph:other')).toBe(false)
  expect(result.failed).toContain('subgraph:other')
  expect(cluster.hasAttribute('data-mw-entity')).toBe(false)
})

it('real anonymous paths never fall back to DOM order, even when counts agree', async () => {
  const { editor, svg } = await render('flowchart LR\n A -->|one| B\n B -->|two| C\n')
  for (const el of svg.querySelectorAll('.edgePaths > path, .edgeLabels [data-id]')) {
    el.removeAttribute('id'); el.removeAttribute('data-id')
  }
  const result = correlateFlowchart(svg, editor.result.flowchart!)
  expect(result.edges.size).toBe(0)
  expect(result.edgeLabels.size).toBe(0)
  expect(result.failed).toEqual(editor.result.flowchart!.edges.map(e => e.entityId))
})

it('an edge-id collision stays code-only when only one colliding path remains', async () => {
  const { editor, svg } = await render(correlationSources['edge-collision'])
  svg.querySelector('path.flowchart-link[data-id="L_a_b_c_0"]')!.remove()
  const result = correlateFlowchart(svg, editor.result.flowchart!)
  expect(result.edges.size).toBe(1)
  expect(result.failed).toEqual(editor.result.flowchart!.edges.slice(0, 2).map(e => e.entityId))
})

const otherDiagrams = [
  ['state', 'stateDiagram-v2\n state outer {\n a --> b_a: inside\n }\n outer --> other: outside\n'],
  ['class', 'classDiagram\n a --> b_a: one\n b_a --> c: two\n'],
  ['er', 'erDiagram\n a ||--o{ b_a : owns\n b_a ||--o{ c : contains\n'],
] as const
function correlateOther(svg: SVGSVGElement, editor: MermaidWysiwygEditor, kind: string): Correlation {
  return kind === 'state' ? correlateState(svg, editor.result.state!)
    : kind === 'class' ? correlateClass(svg, editor.result.classGraph!) : correlateEr(svg, editor.result.er!)
}

it.each(otherDiagrams)('%s: real nodes use complete ids; edges and labels never use paint order', async (kind, code) => {
  const { editor, svg } = await render(code)
  for (const parent of svg.querySelectorAll('.nodes, .edgePaths, .edgeLabels')) {
    parent.append(...[...parent.children].reverse())
  }
  const result = correlateOther(svg, editor, kind)
  const prefix = kind === 'state' ? 'state' : kind === 'class' ? 'class' : 'entity'
  expect(result.nodes.get(`${prefix}:a`)?.textContent).toBe('a')
  expect(result.nodes.get(`${prefix}:b_a`)?.textContent).toBe('b_a')
  if (kind === 'state') {
    expect(result.nodes.get('state:outer')?.getAttribute('data-id')).toBe('outer')
    expect(result.edges.size).toBe(0)
    expect(result.edgeLabels.size).toBe(0)
    expect(result.failed).toEqual(editor.result.state!.transitions.map(t => t.entityId))
  } else {
    const relations = kind === 'class' ? editor.result.classGraph!.relations : editor.result.er!.relations
    expect(result.failed).toEqual([])
    for (const r of relations) {
      const path = result.edges.get(r.entityId)!
      expect(path.getAttribute('data-id')).toContain(kind === 'class' ? `id_${r.source}_${r.target}_` : `id_entity-${r.source}-`)
      expect(result.edgeLabels.get(r.entityId)?.textContent).toBe(r.label)
    }
  }
})

it.each(otherDiagrams)('%s: missing real ids stay untagged even with matching element counts', async (kind, code) => {
  const { editor, svg } = await render(code)
  for (const el of svg.querySelectorAll('g.node, g.statediagram-state, .edgePaths > path, .edgeLabels [data-id]')) {
    el.removeAttribute('id'); el.removeAttribute('data-id')
  }
  const result = correlateOther(svg, editor, kind)
  expect(result.nodes.size).toBe(0)
  expect(result.edges.size).toBe(0)
  expect(result.edgeLabels.size).toBe(0)
  expect(result.failed.length).toBeGreaterThan(0)
  expect(svg.querySelector('[data-mw-entity]')).toBeNull()
})

it.each(otherDiagrams)('%s: clicking real preview paths and labels is silent and cannot edit', async (_kind, code) => {
  const result = await canvasFor(code, svg => {
    for (const el of svg.querySelectorAll('.edgePaths > path, .edgeLabels [data-id]')) {
      el.removeAttribute('id'); el.removeAttribute('data-id')
    }
  })
  try {
    const targets = [...result.host.querySelectorAll('.edgePaths > path, .edgeLabels > .edgeLabel')]
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      result.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      expect(result.editor.selection).toEqual([])
      expect(result.host.querySelector('.mw-toast')?.textContent).toBe('')
      expect(result.host.querySelector('.mw-readonly-hint')?.textContent).toBe(t('canvas.previewOnly'))
      expect(result.host.querySelector('[data-mw-entity]')).toBeNull()
      expect(result.editor.code).toBe(code)
      expect(result.editor.canUndo).toBe(false)
    }
  } finally { result.destroy() }
})

it('real parallel paths with duplicated numeric identities cannot select either occurrence', async () => {
  const { editor, svg } = await render('flowchart LR\n A -->|first| B\n A -->|second| B\n')
  const paths = [...svg.querySelectorAll('path.flowchart-link')]
  paths[1].id = paths[0].id
  paths[1].setAttribute('data-id', paths[0].getAttribute('data-id')!)
  const result = correlateFlowchart(svg, editor.result.flowchart!)
  expect(result.edges.size).toBe(0)
  expect(result.edgeLabels.size).toBe(0)
  expect(result.failed).toEqual(editor.result.flowchart!.edges.map(e => e.entityId))
})

it('a real edge whose endpoint id contains -L_ cannot impersonate another pair', async () => {
  const { editor, svg } = await render('flowchart LR\n a --> b\n x-L_a --> b\n')
  const graph = editor.result.flowchart!
  const result = correlateFlowchart(svg, graph)
  expect(result.edges.size).toBe(2)
  for (const edge of graph.edges) {
    expect(result.edges.get(edge.entityId)?.getAttribute('data-id')).toBe(`L_${edge.source}_${edge.target}_0`)
  }
})

it('a composite state and its children remain preview-only even with valid ids', async () => {
  const code = otherDiagrams[0][1]
  const result = await canvasFor(code, svg => {
    svg.querySelector('g.statediagram-cluster')!.id = 'unknown-composite'
  })
  try {
    const child = result.host.querySelector('g.statediagram-state')!
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(result.editor.selection).toEqual([])
    expect(result.host.querySelector('.mw-toast')?.textContent).toBe('')
    expect(result.editor.code).toBe(code)
    expect(result.editor.canUndo).toBe(false)
  } finally { result.destroy() }
})
