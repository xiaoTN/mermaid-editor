import { expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

const code = '%% 保留原注释\r\nflowchart LR\r\n\tA[甲] --> B[乙]  \r\n\tA -->|第二条| B\r\n\tA -->|第三条| B\r\n\tC[不修改]\r\n'

it('批量修改仅影响所选节点，只有一次变更通知，撤销恢复原始字节和选区', () => {
  const editor = new MermaidWysiwygEditor({ code })
  editor.setSelection(['node:A', 'node:B'])
  let changes = 0; editor.on('change', () => changes++)
  editor.dispatchBatch(['A', 'B'].map(id => ({ type: 'setNodeColor', id, prop: 'fill', value: '#ef4444' })))
  expect(changes).toBe(1)
  expect(editor.code).toContain('style A fill:#ef4444')
  expect(editor.code).toContain('style B fill:#ef4444')
  expect(editor.code).not.toContain('style C')
  const updated = editor.code
  editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  expect(editor.selection).toEqual(['node:A', 'node:B'])
  editor.redo(); expect(editor.code).toBe(updated)
})

it('多选删除只需撤销一次，正确处理同起终点的多条边', () => {
  const editor = new MermaidWysiwygEditor({ code })
  const selected = ['edge:A->B#0', 'edge:A->B#1']
  editor.setSelection(selected)
  editor.deleteEntities(selected)
  expect(editor.result.flowchart!.edges.map(edge => edge.label)).toEqual(['第三条'])
  editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  editor.setSelection(['node:A', 'node:B'])
  editor.deleteEntities(editor.selection)
  expect(editor.result.flowchart!.nodes.map(node => node.id)).toEqual(['C'])
  editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it('无变化的批量操作不产生撤销记录', () => {
  const editor = new MermaidWysiwygEditor({ code })
  editor.dispatchBatch([]); editor.deleteEntities(['node:missing'])
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})
