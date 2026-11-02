// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterAll, beforeAll, expect, it } from 'vitest'
import { MermaidWysiwygEditor, flowchartSubgraphContains, flowchartSubgraphOrderPeers } from '../src'
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

const CODE = `flowchart TD
  X[组外]
  subgraph outer[父组]
    subgraph first[第一组]
      direction LR
      %% 内部注释
      A([甲]):::marked e1@-->|内部| B[乙]
      subgraph child[子组]
        C[丙]
      end
    end
    subgraph second[第二组]
      D[丁]
    end
  end
  subgraph target[目标组]
    E[戊]
  end
  B -.-> E
  C --> X
  classDef marked fill:#abc
  style first fill:#eef
  linkStyle 0 stroke:red
  linkStyle 1 stroke:blue
`
const edges = (editor: MermaidWysiwygEditor) => editor.result.flowchart!.edges.map(edge =>
  [edge.source, edge.target, edge.seg.edgeId, edge.seg.line, edge.seg.arrowStart, edge.seg.arrowEnd, edge.label]).sort()

async function checkRender(editor: MermaidWysiwygEditor) {
  const { svg } = await mermaid.render(`group-move-${serial++}`, editor.code)
  const host = document.createElement('div'); host.innerHTML = svg
  expect(correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!).failed).toEqual([])
  return host
}

it.each(['\n', '\r\n'])('整组跨父级移动，保留子组、节点、连线、注释和样式，换行 %j', async eol => {
  const original = CODE.replaceAll('\n', eol)
  const editor = new MermaidWysiwygEditor({ code: original }), before = edges(editor)
  editor.setSelection(['subgraph:first'])
  expect(flowchartSubgraphContains(editor.result.flowchart!, 'first', 'C')).toBe(true)
  expect(editor.dispatch({ type: 'moveSubgraph', id: 'first', subgraph: 'target' })?.edits.length).toBeGreaterThan(0)
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'first')?.parent).toBe('target')
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'child')?.parent).toBe('first')
  expect(editor.result.flowchart!.nodeById.get('A')).toMatchObject({ label: '甲', shape: 'stadium', classes: ['marked'] })
  expect(editor.code).toContain('%% 内部注释')
  expect(edges(editor)).toEqual(before)
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(editor.code)
  const groups = (diagram.db as { getSubGraphs(): { id: string; nodes: string[] }[] }).getSubGraphs()
  expect(groups.find(group => group.id === 'target')?.nodes).toEqual(expect.arrayContaining(['first', 'E']))
  expect(groups.find(group => group.id === 'outer')?.nodes).not.toContain('first')
  const host = await checkRender(editor)
  expect(host.querySelector('path[data-id="e1"]')?.getAttribute('style')).toContain('red')
  const moved = editor.code
  editor.undo(); expect(editor.code).toBe(original); expect(editor.selection).toEqual(['subgraph:first'])
  expect(editor.canUndo).toBe(false)
  editor.redo(); expect(editor.code).toBe(moved)
})

it('子组整体移出到最外层，父组和全部内部成员都保留', async () => {
  const editor = new MermaidWysiwygEditor({ code: CODE })
  expect(editor.dispatch({ type: 'moveSubgraph', id: 'first', subgraph: null })?.edits.length).toBeGreaterThan(0)
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'first')?.parent).toBeNull()
  expect(editor.result.flowchart!.nodeById.get('C')?.subgraph).toBe('child')
  await checkRender(editor)
})

it('同层分组排序会带着子组及内部连线一起换位，并迁移入口边和边样式', async () => {
  const code = `flowchart TD
  X[入口]
  subgraph one[第一组]
    A --> B
  end
  subgraph two[第二组]
    C --> D
  end
  X -->|甲入口| A
  X -.->|丙入口| C
  linkStyle 0 stroke:red
  linkStyle 2 stroke:green
  linkStyle 3 stroke:blue
`
  const editor = new MermaidWysiwygEditor({ code }), before = edges(editor)
  expect(flowchartSubgraphOrderPeers(editor.result.flowchart!, 'one')).toEqual(['one', 'two'])
  expect(editor.dispatch({ type: 'reorderSubgraphs', ids: ['two', 'one'] })?.edits.length).toBeGreaterThan(0)
  expect(editor.code.indexOf('subgraph two')).toBeLessThan(editor.code.indexOf('subgraph one'))
  expect(editor.code).toContain('  X -.->|丙入口| C\n  X -->|甲入口| A')
  expect(editor.code).toContain('linkStyle 1 stroke:red')
  expect(editor.code).toContain('linkStyle 3 stroke:green')
  expect(editor.code).toContain('linkStyle 2 stroke:blue')
  expect(edges(editor)).toEqual(before)
  await checkRender(editor)
  editor.undo(); expect(editor.code).toBe(code)
})

it('Markdown 包装、多行标签和空分组可以一起移动', async () => {
  const code = '```mermaid\nflowchart LR\n  subgraph first[原组]\n    A["`第一行\n  第二行`"]\n    subgraph empty[空组]\n    end\n  end\n  subgraph target[目标]\n    B\n  end\n```\n'
  const editor = new MermaidWysiwygEditor({ code })
  expect(editor.dispatch({ type: 'moveSubgraph', id: 'first', subgraph: 'target' })?.edits.length).toBeGreaterThan(0)
  expect(editor.code.startsWith('```mermaid\n')).toBe(true)
  expect(editor.code.endsWith('```\n')).toBe(true)
  expect(editor.code).toContain('第一行\n  第二行')
  editor.undo(); expect(editor.code).toBe(code)
})

it.each([
  ['自己', CODE, 'first', 'first'],
  ['自己的子组', CODE, 'first', 'child'],
  ['不存在的组', CODE, 'first', 'missing'],
  ['造成祖孙连线', 'flowchart TD\n subgraph a\n A\n end\n subgraph b\n B\n end\n a --> b\n', 'a', 'b'],
  ['同一行含多个结构语句', 'flowchart TD\n subgraph a; A; end\n subgraph b\n B\n end\n', 'a', 'b'],
])('%s 时不改源码和撤销历史', (_name, code, id, subgraph) => {
  const editor = new MermaidWysiwygEditor({ code })
  expect(editor.dispatch({ type: 'moveSubgraph', id, subgraph })?.edits ?? []).toEqual([])
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it('不同父组、重复项和会改写节点含义的组排序都被拒绝', () => {
  const editor = new MermaidWysiwygEditor({ code: CODE })
  for (const ids of [['first', 'target'], ['first', 'first']]) expect(editor.dispatch({ type: 'reorderSubgraphs', ids })?.edits ?? []).toEqual([])
  const repeated = 'flowchart TD\n subgraph a\n X[旧名]\n end\n subgraph b\n X[新名]\n end\n'
  editor.setCode(repeated, 'code')
  expect(editor.dispatch({ type: 'reorderSubgraphs', ids: ['b', 'a'] })?.edits ?? []).toEqual([])
  expect(editor.code).toBe(repeated)
})
