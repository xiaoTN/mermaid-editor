// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView } from '../src'

it.each([false, true])('returning to the displayed file invalidates an older in-flight render (error: %s)', async fail => {
  const base = 'flowchart LR\n A[Original] --> B\n'
  const editor = new MermaidWysiwygEditor({ code: base })
  const host = document.createElement('div'); document.body.append(host)
  let finish!: () => void
  const view = new MermaidCanvasView({ editor, container: host, debounceMs: 60000, mermaid: {
    initialize() {}, async parse() {}, async render(_id, code) {
      if (code !== base) {
        await new Promise<void>(resolve => { finish = resolve })
        if (fail) throw new Error('obsolete parse error')
      }
      return { svg: `<svg><text>${code === base ? 'Original' : 'Stale'}</text></svg>` }
    },
  } })
  try {
    await view.render()
    editor.setCode(base.replace('Original', 'Stale'), 'api')
    const stale = view.render()
    // A native reload/undo restores exactly the already displayed bytes.
    editor.loadCode(base)
    await view.render()
    finish(); await stale
    expect(host.querySelector('svg text')?.textContent).toBe('Original')
    expect(view.renderError).toBeNull()
    expect(editor.code).toBe(base)
  } finally { view.destroy(); host.remove() }
})
