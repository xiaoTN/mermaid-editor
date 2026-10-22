// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
beforeAll(async () => {
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' })
})

async function renderedGroups(code: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code)
  const db = diagram.db as { getSubGraphs(): { id: string; nodes: string[] }[] }
  return Object.fromEntries(db.getSubGraphs().map(group => [group.id, [...group.nodes].sort()]))
}

describe('将选中的节点放入新分组', () => {
  it('只包含选中的节点，保留原始字节、节点属性和连线顺序，一次撤销恢复选区', async () => {
    const code = 'flowchart LR\r\n\tA([起点]) --> B{判断}  \r\n\t%% 保留\r\n\tB -.-> C[结果]\r\n\tclassDef chosen fill:#abc\r\n\tclass A chosen\r\n\tlinkStyle 1 stroke:red  \r\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.setSelection(['node:A', 'node:C'], 'canvas')
    const before = editor.result.flowchart!
    const result = editor.dispatch({ type: 'addSubgraph', title: '新分组', nodeIds: ['A', 'C'] })!
    expect(result.edits).toHaveLength(1)
    const [edit] = result.edits
    expect(edit.start).toBe(edit.end)
    expect(editor.code.slice(0, edit.start) + editor.code.slice(edit.start + edit.text.length)).toBe(code)
    expect(edit.text).toBe('\r\n\tsubgraph group1[新分组]\r\n\t\tA\r\n\t\tC\r\n\tend')
    const graph = editor.result.flowchart!
    expect(graph.nodes.map(node => [node.id, node.subgraph])).toEqual([
      ['A', 'group1'], ['C', 'group1'], ['B', null],
    ])
    for (const id of ['A', 'B', 'C']) {
      const node = graph.nodeById.get(id)!, original = before.nodeById.get(id)!
      expect([node.label, node.shape, node.classes]).toEqual([original.label, original.shape, original.classes])
    }
    expect(graph.edges.map(edge => [edge.entityId, edge.source, edge.target, edge.order, edge.seg.line]))
      .toEqual(before.edges.map(edge => [edge.entityId, edge.source, edge.target, edge.order, edge.seg.line]))
    expect(await renderedGroups(editor.code)).toEqual({ group1: ['A', 'C'] })
    expect(editor.selection).toEqual(['subgraph:group1'])
    const grouped = editor.code
    editor.undo()
    expect(editor.code).toBe(code)
    expect(editor.selection).toEqual(['node:A', 'node:C'])
    expect(editor.canUndo).toBe(false)
    editor.redo()
    expect(editor.code).toBe(grouped)
    expect(editor.selection).toEqual(['subgraph:group1'])
  })

  it('可从不同的嵌套分组中重新归组，其余节点仍属于原分组', async () => {
    const code = 'flowchart TD\n  subgraph outer[外层]\n    subgraph old[原分组]\n      A[甲] --> B[乙]\n    end\n    C[丙]\n  end\n  subgraph other[其他]\n    D[丁] --> E[戊]\n  end\n  C --> D\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'addSubgraph', title: '合并选择', nodeIds: ['A', 'D'] })
    expect(await renderedGroups(editor.code)).toEqual({
      group1: ['A', 'D'], old: ['B'], outer: ['C', 'old'], other: ['E'],
    })
    expect(editor.result.flowchart!.nodes.map(node => [node.id, node.subgraph])).toEqual([
      ['A', 'group1'], ['D', 'group1'], ['B', 'old'], ['C', 'outer'], ['E', 'other'],
    ])
  })

  it('单节点、重复选择和已有分组编号也能处理', async () => {
    const code = 'flowchart TD\n  subgraph group1[已有]\n    A[甲]\n  end\n  group2[普通节点]\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'addSubgraph', title: '单个节点', nodeIds: ['A', 'A'] })
    expect(await renderedGroups(editor.code)).toEqual({ group3: ['A'], group1: [] })
    expect(editor.result.flowchart!.nodeById.get('group2')?.subgraph).toBeNull()
  })

  it('保留节点形状、带引号的分组名及多行标签的定义', async () => {
    const code = 'flowchart TD\n  Z(["结束"]) --> A["`多行\n标签`"]\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'addSubgraph', title: '带"引号', nodeIds: ['Z', 'A'] })
    expect(await renderedGroups(editor.code)).toEqual({ group1: ['A', 'Z'] })
    expect(editor.code.endsWith(code.slice('flowchart TD'.length))).toBe(true)
    expect(editor.result.flowchart!.nodeById.get('Z')?.shape).toBe('stadium')
    expect(editor.result.flowchart!.nodeById.get('A')?.label).toBe('多行\n标签')
  })

  it('过期节点或分组 ID 不会创建残缺分组，也不会修改撤销历史', () => {
    const code = 'flowchart TD\n  subgraph old[已有]\n    A --> B\n  end\n  old --> C\n'
    for (const nodeIds of [['A', 'missing'], ['old']]) {
      const editor = new MermaidWysiwygEditor({ code })
      expect(editor.dispatch({ type: 'addSubgraph', title: '新分组', nodeIds })).toBeNull()
      expect(editor.code).toBe(code)
      expect(editor.canUndo).toBe(false)
    }
  })
})
