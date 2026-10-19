import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

describe('画布工具栏', () => {
  it('重复拖出同起终点和箭头的边时拒绝，代码与撤销历史保持原样', () => {
    const code = 'flowchart TD\r\n\tC[扣减库存] --> D[通知补货]  %% 保留\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    const result = editor.dispatch({ type: 'connect', source: 'C', target: 'D' })!
    expect(result.edits).toEqual([])
    expect(result.warnings).toEqual([{ key: 'toast.dupEdge' }])
    expect(editor.code).toBe(code)
    expect(editor.canUndo).toBe(false)
  })
  it.each(['-->', '-.->', '==>', '--o', '--x', '---'])('跨行和扇出中的重复 %s 连线也拒绝', token => {
    const code = `flowchart LR\r\n\tA & C ${token} D  %% 保留\r\n\tD[终点]\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    const edge = editor.result.flowchart!.edges.find(e => e.source === 'C')!
    const result = editor.dispatch({ type: 'connect', source: 'C', target: 'D', line: edge.seg.line, arrowEnd: edge.seg.arrowEnd })!
    expect(result).toEqual({ edits: [], warnings: [{ key: 'toast.dupEdge' }] })
    expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  })
  it('同起终点的其他箭头或反向连接允许，插入之外字节不变且可撤销', () => {
    const code = 'flowchart LR\r\n\tC[起点] -.-> D[终点]  \r\n\t%% 尾注释\t\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    for (const op of [
      { type: 'connect', source: 'C', target: 'D' },
      { type: 'connect', source: 'D', target: 'C' },
    ] as const) {
      const result = editor.dispatch(op)!
      expect(result.edits).toHaveLength(1)
      expect(result.edits[0].start).toBe(result.edits[0].end)
      expect(editor.result.flowchart!.edges).toHaveLength(2)
      const after = editor.code
      editor.undo(); expect(editor.code).toBe(code)
      editor.redo(); expect(editor.code).toBe(after)
      editor.undo()
    }
  })
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
