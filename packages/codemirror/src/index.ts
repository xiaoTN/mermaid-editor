import { defaultKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { bindTextPane, type MermaidWysiwygEditor, type Span, type TextPaneBinding } from '@inkeep/mermaid-wysiwyg-core'
import { mermaidLanguage } from './language'
import { LosslessText } from './lossless'

export { mermaidLanguage } from './language'

const setHighlights = StateEffect.define<Span[]>()

const highlightMark = Decoration.mark({ class: 'mw-cm-entity' })
const selectedLine = Decoration.line({ class: 'mw-cm-selected-line' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const spans = e.value.filter(s => s.start >= 0 && s.end > s.start && s.end <= tr.newDoc.length)
        const lines = new Set<number>()
        for (const span of spans) {
          const last = tr.newDoc.lineAt(span.end - 1).number
          for (let n = tr.newDoc.lineAt(span.start).number; n <= last; n++) {
            lines.add(tr.newDoc.line(n).from)
          }
        }
        deco = Decoration.set(
          [...spans.map(s => highlightMark.range(s.start, s.end)),
            ...[...lines].map(from => selectedLine.range(from))], true,
        )
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const baseTheme = EditorView.baseTheme({
  '.mw-cm-selected-line': {
    backgroundColor: 'rgba(96, 165, 250, 0.18)',
    boxShadow: 'inset 3px 0 #60a5fa',
  },
  '.mw-cm-entity': {
    backgroundColor: 'color-mix(in srgb, var(--mw-accent, #6366f1) 28%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--mw-accent, #6366f1) 55%, transparent)',
    borderRadius: '3px',
  },
})

/**
 * CodeMirror 6 pane bound to a MermaidWysiwygEditor.
 *
 * A thin adapter over core's editor-agnostic `bindTextPane`; the same contract
 * works for Monaco or any other code editor.
 *
 * - typing flows into the engine (`origin: 'code'`), keeping the canvas live
 * - canvas/api/history changes are applied as the engine's exact minimal edits
 * - entity selection renders as decorations; the caret selects entities
 * - ⌘Z/⌘⇧Z route to the engine's unified history (the same stack the canvas uses)
 */
export class MermaidCodeMirror {
  readonly view: EditorView
  private binding: TextPaneBinding

  constructor(host: HTMLElement, editor: MermaidWysiwygEditor, extraExtensions: unknown[] = []) {
    const raw = new LosslessText(editor.code)
    let revealOffset: number | null = null
    const updateListener = EditorView.updateListener.of((update) => {
      if (this.binding?.applying) return
      if (update.docChanged) {
        const changes: { from: number; to: number; insert: string }[] = []
        update.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }))
        raw.editPane(changes)
        this.binding.notifyTextChange()
      }
      else if (update.selectionSet) this.binding.notifyCaretMove(raw.rawOffset(update.state.selection.main.head))
    })

    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: editor.code,
        extensions: [
          keymap.of([
            {
              key: 'Mod-z',
              run: () => {
                this.binding.undo()
                return true
              },
            },
            {
              key: 'Mod-Shift-z',
              run: () => {
                this.binding.redo()
                return true
              },
            },
          ]),
          keymap.of(defaultKeymap),
          lineNumbers(),
          mermaidLanguage(),
          EditorView.scrollHandler.of((view, range) => {
            if (range.head !== revealOffset) return false
            revealOffset = null
            const block = view.lineBlockAt(range.head)
            const scroller = view.scrollDOM
            scroller.scrollTop = Math.max(0, block.top - (scroller.clientHeight - block.height) / 2)
            return true
          }),
          highlightField,
          baseTheme,
          updateListener,
          ...(extraExtensions as []),
        ],
      }),
    })

    this.binding = bindTextPane(editor, {
      getText: () => raw.code,
      applyEdits: (edits) => {
        const changes = edits.map(e => ({ from: raw.paneOffset(e.start), to: raw.paneOffset(e.end), insert: e.text }))
        raw.apply(edits)
        this.view.dispatch({ changes })
      },
      setText: (text) => {
        raw.code = text
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } })
      },
      setHighlights: (spans) => this.view.dispatch({ effects: setHighlights.of(spans.map(span => ({ start: raw.paneOffset(span.start), end: raw.paneOffset(span.end) }))) }),
      revealPosition: (offset) => {
        // Scroll only the editor's own scroller. CodeMirror's scrollIntoView
        // effect also scrolls every scrollable ancestor — including the page —
        // so a canvas click revealing a span would yank the host app's
        // viewport around.
        // Let CodeMirror measure and render the target before the scoped
        // scroll handler runs. Immediate lineBlockAt can use stale heights.
        revealOffset = raw.paneOffset(offset)
        this.view.dispatch({ effects: EditorView.scrollIntoView(revealOffset, { y: 'center' }) })
      },
    })
  }

  destroy() {
    this.binding.dispose()
    this.view.destroy()
  }
}
