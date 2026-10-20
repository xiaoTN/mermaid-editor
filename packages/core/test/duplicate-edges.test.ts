import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

describe('全图重复边检查', () => {
  it('隐形边按实际生成的无箭头符号查重', () => {
    const code = 'flowchart LR\r\n\tA ~~~ B  \r\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(editor.dispatch({ type: 'connect', source: 'A', target: 'B', line: 'invisible' }))
      .toEqual({ edits: [], warnings: [{ key: 'toast.dupEdge' }] })
    expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  })
  it.each(['source', 'target'] as const)('跨行改动 %s 不产生重复边、文本改动或历史', end => {
    const code = end === 'target'
      ? 'flowchart LR\r\n\tA --> B  %% 保留\r\n\tA --> C\r\n'
      : 'flowchart LR\r\n\tA --> B  %% 保留\r\n\tC --> B\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    const warnings: unknown[] = []
    editor.on('warning', notice => warnings.push(notice))
    const result = editor.dispatch({ type: 'retargetEdge', edgeId: editor.result.flowchart!.edges[1].entityId,
      end, nodeId: end === 'target' ? 'B' : 'A' })!
    expect(result).toEqual({ edits: [], warnings: [{ key: 'toast.dupEdge' }] })
    expect(warnings).toEqual([result.warnings])
    expect(Buffer.from(editor.code)).toEqual(Buffer.from(code))
    expect(editor.canUndo).toBe(false)
  })
  it.each(['-->', '-.->', '==>', '--o', '--x', '---', '<-->', '<-.->', '<==>'])('跨子图和 & 展开的 %s 使用相同查重规则', token => {
    const code = `flowchart LR\r\n\tsubgraph group1\r\n\t\tA & X ${token} B & Y\r\n\tend\r\n\tsubgraph group2\r\n\t\tA ${token} C\r\n\tend\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    const edges = editor.result.flowchart!.edges
    const result = editor.dispatch({ type: 'retargetEdge', edgeId: edges[4].entityId, end: 'target', nodeId: 'B' })!
    expect(result).toEqual({ edits: [], warnings: [{ key: 'toast.dupEdge' }] })
    if (edges[0].seg.arrowStart === 'open') {
      expect(editor.dispatch({ type: 'connect', source: 'X', target: 'Y', line: edges[0].seg.line,
        arrowEnd: edges[0].seg.arrowEnd })).toEqual(result)
    }
    expect(editor.code).toBe(code)
    expect(editor.canUndo).toBe(false)
  })
  it.each(['A -.-> C', 'A <--> C', 'C --> A'])('允许不同线型、箭头方向或反向边：%s', changed => {
    const code = `flowchart LR\r\n\tA --> B  %% 保留\r\n\t${changed}\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    const edge = editor.result.flowchart!.edges[1]
    expect(editor.dispatch({ type: 'retargetEdge', edgeId: edge.entityId,
      end: edge.source === 'C' ? 'source' : 'target', nodeId: 'B' })!.edits.length).toBeGreaterThan(0)
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    editor.undo(); expect(editor.code).toBe(code)
  })
  it('拒绝重复边不会清空已有重做记录或产生 change 事件', () => {
    const code = 'flowchart LR\n A --> B\n A --> C\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'addNode' }); editor.undo()
    let changes = 0
    editor.on('change', () => changes++)
    editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:A->C#0', end: 'target', nodeId: 'B' })
    expect(editor.canRedo).toBe(true)
    expect(changes).toBe(0)
    expect(editor.code).toBe(code)
  })
})
