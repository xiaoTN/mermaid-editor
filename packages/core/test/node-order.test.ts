import { expect, it } from 'vitest'
import { MermaidWysiwygEditor, flowchartOrderPeers } from '../src'

const code = 'flowchart TD\n  A[入口]\n  B[乙]\n  C[丙]\n  A -->|乙分支| B  %% 跟随乙\n  A -.->|丙分支| C\n  linkStyle 0 stroke:red\n  linkStyle 1 stroke:blue\n'

it.each(['\n', '\r\n'])('分支重排保留连接、标签、注释和边样式，支持原字节撤销，换行 %j', eol => {
  const original = code.replaceAll('\n', eol)
  const editor = new MermaidWysiwygEditor({ code: original })
  expect(flowchartOrderPeers(editor.result.flowchart!, 'B')).toEqual(['B', 'C'])
  const result = editor.dispatch({ type: 'reorderNodes', ids: ['C', 'B'] })
  expect(result?.edits.length).toBeGreaterThan(0)
  expect(editor.code).toContain(`  A -.->|丙分支| C${eol}  A -->|乙分支| B  %% 跟随乙`)
  expect(editor.code).toContain('linkStyle 1 stroke:red')
  expect(editor.code).toContain('linkStyle 0 stroke:blue')
  expect(editor.result.flowchart!.edges.map(edge => [edge.source, edge.target, edge.label])).toEqual([
    ['A', 'C', '丙分支'], ['A', 'B', '乙分支'],
  ])
  editor.undo(); expect(editor.code).toBe(original)
  editor.redo(); expect(editor.result.flowchart!.edges[0].target).toBe('C')
})

it('嵌套分组和 Markdown 包装保持原样', () => {
  const original = '```mermaid\nflowchart LR\n subgraph outer[父组]\n  subgraph inner[子组]\n   A --> B\n   A --> C\n  end\n end\n```\n'
  const editor = new MermaidWysiwygEditor({ code: original })
  editor.dispatch({ type: 'reorderNodes', ids: ['C', 'B'] })
  expect(editor.code).toBe(original.replace('   A --> B\n   A --> C', '   A --> C\n   A --> B'))
})

it.each([
  ['链式连线', 'flowchart TD\n A --> B --> C\n'],
  ['合并分支', 'flowchart TD\n A --> B & C\n'],
  ['多入口', 'flowchart TD\n A --> B\n A --> C\n D --> C\n'],
  ['不同分组', 'flowchart TD\n subgraph one\n B\n end\n A --> B\n A --> C\n'],
  ['重复定义会变义', 'flowchart TD\n A[旧入口] --> B\n A[新入口] --> C\n'],
])('%s 不做不安全重排', (_name, original) => {
  const editor = new MermaidWysiwygEditor({ code: original })
  const result = editor.dispatch({ type: 'reorderNodes', ids: ['C', 'B'] })
  expect(result?.edits ?? []).toEqual([])
  expect(editor.code).toBe(original)
  expect(editor.canUndo).toBe(false)
})

it('重复节点或原顺序不会增加历史', () => {
  const editor = new MermaidWysiwygEditor({ code })
  editor.dispatch({ type: 'reorderNodes', ids: ['B', 'B'] })
  editor.dispatch({ type: 'reorderNodes', ids: ['B', 'C'] })
  expect(editor.code).toBe(code)
  expect(editor.canUndo).toBe(false)
})
