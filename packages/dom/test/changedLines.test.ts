import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { changedLines } from '../../../apps/playground/src/changedLines'

describe('代码改动行高亮', () => {
  it('末尾新建节点仅高亮新增行，不高亮原来字节不变的行', () => {
    const editor = new MermaidWysiwygEditor({ code: 'flowchart LR\r\n\tA --> B  \r\n' })
    const lines: number[][] = []
    editor.on('change', event => lines.push(changedLines(event)))
    editor.dispatch({ type: 'addNode', id: 'C', label: '丙' })
    expect(lines).toEqual([[3]])
  })
  it('多个最小 TextEdit 插入旧节点并改 ID，正确计算移动后的行号', () => {
    const editor = new MermaidWysiwygEditor({ code: 'flowchart LR\r\n\tA --> B\r\n\tC\r\n' })
    const lines: number[][] = []
    editor.on('change', event => lines.push(changedLines(event)))
    editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:A->B#0', end: 'target', nodeId: 'C' })
    expect(lines).toEqual([[2, 3]])
    editor.undo(); expect(lines[1]).toEqual([2])
  })
})
