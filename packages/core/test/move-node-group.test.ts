// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { correlateFlowchart } from '../../dom/src/correlate'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() { return (this.textContent ?? '').length * 8 } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
})
afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
})
const CODE = 'flowchart TD\r\n\tX[组外]\r\n\tsubgraph first[第一组]\r\n\t\tA([甲]) --> B[乙]\r\n\tend\r\n\tsubgraph second[第二组]\r\n\t\tC[丙]\r\n\tend\r\n\tB --> C\r\n'
const edges = (editor: MermaidWysiwygEditor) => editor.result.flowchart!.edges.map(edge => [edge.source, edge.target, edge.seg.line, edge.seg.arrowStart, edge.seg.arrowEnd, edge.label, edge.seg.edgeId]).sort()
async function groups(code: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code)
  const db = diagram.db as { getSubGraphs(): { id: string; nodes: string[] }[] }
  return Object.fromEntries(db.getSubGraphs().map(group => [group.id, [...group.nodes].sort()]))
}
describe('移动节点调整分组', () => {
  it.each([
    ['X', 'first', { first: ['A', 'B', 'X'], second: ['C'] }],
    ['A', 'second', { first: ['B'], second: ['A', 'C'] }],
    ['C', 'first', { first: ['A', 'B', 'C'], second: [] }],
    ['A', null, { first: ['B'], second: ['C'] }],
  ] as const)('%s 移到 %s，节点和连线不丢失，一次撤销恢复源码与选区', async (id, subgraph, expected) => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    editor.setSelection([`node:${id}`], 'canvas')
    const before = edges(editor)
    editor.dispatch({ type: 'moveNodeToSubgraph', id, subgraph })
    expect(editor.result.flowchart!.nodeById.get(id)?.subgraph).toBe(subgraph)
    expect(await groups(editor.code)).toEqual(expected)
    expect(edges(editor)).toEqual(before)
    const rendered = await mermaid.render(`move-node-${serial++}`, editor.code)
    const host = document.createElement('div'); host.innerHTML = rendered.svg
    const svg = host.querySelector('svg')!
    const correlation = correlateFlowchart(svg, editor.result.flowchart!)
    expect(correlation.failed).toEqual([])
    expect(host.querySelectorAll('[data-mw-entity^="node:"]')).toHaveLength(4)
    expect(host.querySelectorAll('[data-mw-entity^="subgraph:"]')).toHaveLength(2)
    const after = editor.code
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.selection).toEqual([`node:${id}`]); expect(editor.canUndo).toBe(false)
    editor.redo(); expect(editor.code).toBe(after)
  })

  it('扇出和链中的节点跨组移动后，保留节点属性、边 ID、文字及各条边的样式', async () => {
    const code = 'flowchart LR\n  subgraph first[原组]\n    A([甲]):::marked & B[乙] -.  文字  .-> C[丙] e1@--> D[丁]\n  end\n  subgraph second[目标]\n    E[戊]\n  end\n  classDef marked fill:#abc\n  style A stroke:#123abc\n  linkStyle 0 stroke:red\n  linkStyle 1 stroke:green\n  linkStyle 2 stroke:blue\n'
    const editor = new MermaidWysiwygEditor({ code })
    const before = edges(editor)
    editor.dispatch({ type: 'moveNodeToSubgraph', id: 'A', subgraph: 'second' })
    expect(edges(editor)).toEqual(before)
    expect(await groups(editor.code)).toEqual({ first: ['B', 'C', 'D'], second: ['A', 'E'] })
    expect(editor.result.flowchart!.nodeById.get('A')).toMatchObject({ label: '甲', shape: 'stadium', classes: ['marked'] })
    expect(editor.code).toContain('  style A stroke:#123abc\n')
    const rendered = await mermaid.render(`move-node-${serial++}`, editor.code)
    const host = document.createElement('div'); host.innerHTML = rendered.svg
    const paths = [...host.querySelectorAll<SVGElement>('path.flowchart-link')]
    expect(paths.filter(path => path.style.stroke === 'red')).toHaveLength(1)
    expect(paths.filter(path => path.style.stroke === 'green')).toHaveLength(1)
    expect(paths.filter(path => path.style.stroke === 'blue')).toHaveLength(1)
    editor.undo(); expect(editor.code).toBe(code)
  })

  it('节点曾在组外提前引用，也能从嵌套分组移到父组或其他子组', async () => {
    const code = 'flowchart TD\n  A --> X\n  subgraph outer[父组]\n    subgraph first[第一组]\n      A[甲] --> B[乙]\n    end\n    subgraph second[第二组]\n      C[丙]\n    end\n  end\n'
    for (const subgraph of ['outer', 'second', null]) {
      const editor = new MermaidWysiwygEditor({ code })
      editor.dispatch({ type: 'moveNodeToSubgraph', id: 'A', subgraph })
      expect(editor.result.flowchart!.nodeById.get('A')?.subgraph).toBe(subgraph)
      expect(await groups(editor.code)).toEqual({
        first: ['B'], second: subgraph === 'second' ? ['A', 'C'] : ['C'],
        outer: subgraph === 'outer' ? ['A', 'first', 'second'] : ['first', 'second'],
      })
      editor.undo(); expect(editor.code).toBe(code)
    }
  })

  it('保留 CRLF、独立注释、行尾空格和多行标签，目标组原有内容不改', async () => {
    const code = CODE.replace('A([甲]) --> B[乙]', '%% 保留注释  \r\n\t\tA["`多行\r\n标签`"] --> B[乙]  ')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'moveNodeToSubgraph', id: 'A', subgraph: 'second' })
    expect(editor.code).toContain('\t\t%% 保留注释  \r\n')
    expect(editor.code).toContain('A["`多行\r\n标签`"]')
    expect(editor.code).toContain('\t\tC[丙]\r\n')
    expect(await groups(editor.code)).toEqual({ first: ['B'], second: ['A', 'C'] })
    editor.undo(); expect(editor.code).toBe(code)
  })

  it('同组拖放不产生历史，不存在的节点、目标分组或分组本身均不改图', () => {
    for (const [id, subgraph] of [['A', 'first'], ['missing', 'first'], ['A', 'missing'], ['first', 'second']]) {
      const editor = new MermaidWysiwygEditor({ code: CODE })
      editor.dispatch({ type: 'moveNodeToSubgraph', id, subgraph })
      expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    }
  })

  it('移入分组会让已有箭头连接自身内部时，提示原因并保留原图', () => {
    const code = CODE + '\tX --> second\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(editor.dispatch({ type: 'moveNodeToSubgraph', id: 'X', subgraph: 'second' }))
      .toEqual({ edits: [], warnings: [{ key: 'toast.moveGroupCycle' }] })
    expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  })
})
