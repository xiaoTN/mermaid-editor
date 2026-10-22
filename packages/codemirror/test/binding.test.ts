// @vitest-environment jsdom
import '../../core/test/dom-layout'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCodeMirror } from '../src'

const CODE = 'flowchart TD\n  A[Start] --> B[End]\n'

function mount(code = CODE) {
  const editor = new MermaidWysiwygEditor({ code })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const cm = new MermaidCodeMirror(host, editor)
  return { editor, host, cm }
}

describe('MermaidCodeMirror against real CodeMirror 6', () => {
  it('粘贴完整 Mermaid 代码块后画布可编辑，源码高亮和撤销保留包装', () => {
    const { editor, host, cm } = mount()
    const wrapped = '```mermaid\n' + CODE + '```'
    cm.view.dispatch({ changes: { from: 0, to: cm.view.state.doc.length, insert: wrapped } })
    expect(editor.result.typeInfo?.id).toBe('flowchart')
    const offset = wrapped.indexOf('A[Start]') + 1
    cm.view.dispatch({ selection: { anchor: offset } })
    expect(editor.selection).toEqual(['node:A'])
    expect([...host.querySelectorAll('.mw-cm-entity')].map(mark => mark.textContent).join('')).toContain('A[Start]')
    editor.dispatch({ type: 'renameNode', id: 'A', label: '开始' })
    expect(cm.view.state.doc.toString()).toBe(wrapped.replace('Start', '开始'))
    editor.undo(); expect(cm.view.state.doc.toString()).toBe(wrapped)
    editor.undo(); expect(cm.view.state.doc.toString()).toBe(CODE)
    cm.destroy(); host.remove()
  })
  it('mirrors engine ops into the view', () => {
    const { editor, cm } = mount()
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(cm.view.state.doc.toString()).toBe(editor.code)
    expect(cm.view.state.doc.toString()).toContain('A[Begin]')
    cm.destroy()
  })

  it('flows view edits into the engine without echoing back', () => {
    const { editor, cm } = mount()
    const pos = cm.view.state.doc.toString().indexOf('B[End]')
    cm.view.dispatch({ changes: { from: pos, to: pos + 6, insert: 'B[Done]' } })
    expect(editor.code).toBe(cm.view.state.doc.toString())
    expect(editor.code).toContain('B[Done]')
    cm.destroy()
  })

  it('renders entity selection as decorations', () => {
    const { editor, host, cm } = mount()
    editor.setSelection(['node:A'], 'canvas')
    const marks = host.querySelectorAll('.mw-cm-entity')
    expect(marks.length).toBeGreaterThan(0)
    expect([...marks].map((m) => m.textContent).join('')).toContain('A[Start]')
    cm.destroy()
  })

  it('caret movement selects the entity under it', () => {
    const { editor, cm } = mount()
    const anchor = cm.view.state.doc.toString().indexOf('A[Start]') + 1
    cm.view.dispatch({ selection: { anchor } })
    expect(editor.selection).toEqual(['node:A'])
    cm.destroy()
  })

  it('keeps engine undo authoritative across both surfaces', () => {
    const { editor, cm } = mount()
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    editor.undo()
    expect(editor.code).toBe(CODE)
    expect(cm.view.state.doc.toString()).toBe(CODE)
    editor.redo()
    expect(cm.view.state.doc.toString()).toContain('A[Begin]')
    cm.destroy()
  })

  it('stops syncing after destroy', () => {
    const { editor, cm } = mount()
    cm.destroy()
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(cm.view.state.doc.toString()).toBe(CODE)
  })
})
