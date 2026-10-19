import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

describe('画布工具栏', () => {
  it('切换线型保留内联文字、空白、边 ID 和行尾注释，只改符号', () => {
    const code = 'flowchart LR\r\n\tA e1@-.  文字  .-> B  %% 注释\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'setEdgeStyle', edgeId: editor.result.flowchart!.edges[0].entityId, line: 'thick', preserveLabelForm: true })
    expect(editor.code).toBe('flowchart LR\r\n\tA e1@==  文字  ==> B  %% 注释\r\n')
    editor.undo(); expect(editor.code).toBe(code)
  })
  it('新增分组只插入所需行，撤销恢复 CRLF、tab 和尾空格', () => {
    const code = 'flowchart LR\r\n\tA --> B  \r\n'
    const editor = new MermaidWysiwygEditor({ code })
    const result = editor.dispatch({ type: 'addSubgraph', title: '新分组' })!
    expect(result.edits).toHaveLength(1)
    expect(editor.code).toBe('flowchart LR\r\n\tA --> B  \r\n\tsubgraph group1[新分组]\r\n\tend\r\n')
    expect(editor.result.flowchart!.subgraphs).toHaveLength(1)
    editor.undo(); expect(editor.code).toBe(code)
    editor.redo(); expect(editor.result.flowchart!.subgraphs).toHaveLength(1)
  })
})
