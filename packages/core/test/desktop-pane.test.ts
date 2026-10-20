// @vitest-environment jsdom
/// <reference lib="dom" />
import './dom-layout'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { MermaidCodeMirror } from '../../codemirror/src'

describe('桌面文件进入真实 CodeMirror 后的字节保真', () => {
  it('CRLF 与 LF 混排时画布和源码交替编辑，撤销与重做仍保留每行原始字节', () => {
    const original = 'flowchart TD\r\n\t%% 注释\t \n\t甲[开始] --> 乙[结束]  \r\n'
    const editor = new MermaidWysiwygEditor({ code: original })
    const host = document.createElement('div'); document.body.append(host)
    const pane = new MermaidCodeMirror(host, editor)
    try {
      editor.dispatch({ type: 'renameNode', id: '甲', label: '起点' })
      expect(editor.code).toBe(original.replace('开始', '起点'))
      expect(pane.view.state.doc.toString()).toBe(editor.code.replace(/\r\n/g, '\n'))
      const start = pane.view.state.doc.toString().indexOf('结束')
      pane.view.dispatch({ changes: { from: start, to: start + 2, insert: '终点' } })
      expect(editor.code).toBe(original.replace('开始', '起点').replace('结束', '终点'))
      const anchor = pane.view.state.doc.toString().indexOf('乙[终点]') + 2
      pane.view.dispatch({ selection: { anchor } })
      expect(editor.selection).toEqual(['node:乙'])
      editor.setSelection(['node:甲'], 'canvas')
      expect(Array.from(host.querySelectorAll('.mw-cm-entity')).map(mark => mark.textContent).join('')).toContain('甲[起点]')
      expect(host.querySelector('.mw-cm-selected-line')?.textContent).toBe('\t甲[起点] --> 乙[终点]  ')
      editor.setSelection(['edge:甲->乙#0'], 'canvas')
      expect(host.querySelectorAll('.mw-cm-selected-line')).toHaveLength(1)
      editor.clearSelection('canvas')
      expect(host.querySelector('.mw-cm-selected-line')).toBeNull()
      editor.undo(); editor.undo()
      expect(editor.code).toBe(original)
      expect(pane.view.state.doc.toString()).toBe(original.replace(/\r\n/g, '\n'))
      editor.redo(); editor.redo()
      expect(editor.code).toBe(original.replace('开始', '起点').replace('结束', '终点'))
    } finally { pane.destroy(); host.remove() }
  })

  it('打开另一种换行文件后偏移映射同步切换；输入新增行仍使用文件换行', () => {
    const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n A --> B\n' })
    const host = document.createElement('div'); document.body.append(host)
    const pane = new MermaidCodeMirror(host, editor)
    const opened = 'flowchart LR\r\n\t甲 --> 乙  \r\n'
    try {
      editor.setCode(opened, 'external')
      pane.view.dispatch({ changes: { from: pane.view.state.doc.length, insert: '\t丙\n' } })
      expect(editor.code).toBe(opened + '\t丙\r\n')
      editor.undo(); expect(editor.code).toBe(opened)
    } finally { pane.destroy(); host.remove() }
  })
})
