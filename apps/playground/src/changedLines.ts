import type { ChangeEvent } from '@inkeep/mermaid-wysiwyg-core'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** One-based lines in the resulting document, including the join after deletion. */
export function changedLines({ edits, code }: ChangeEvent): number[] {
  const lines = new Set<number>()
  let shift = 0
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    const start = edit.start + shift
    let first = code.slice(0, start).split('\n').length
    let inserted = edit.text.replace(/\r\n/g, '\n')
    // Core appends before a line's existing EOL: that original line remains
    // byte-identical, so only the newly inserted following lines should flash.
    if (edit.start === edit.end && inserted.startsWith('\n') && /^(?:\r?\n|$)/.test(code.slice(start + edit.text.length))) {
      first++; inserted = inserted.slice(1)
    }
    const count = inserted.replace(/\n$/, '').split('\n').length
    for (let i = 0; i < count; i++) lines.add(first + i)
    shift += edit.text.length - (edit.end - edit.start)
  }
  return [...lines]
}

export const flashLines = StateEffect.define<number[]>()
export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(flashLines)) {
      value = Decoration.set(effect.value.filter(n => n <= tr.newDoc.lines)
        .map(n => Decoration.line({ class: 'mw-changed-line' }).range(tr.newDoc.line(n).from)), true)
    }
    return value
  },
  provide: field => EditorView.decorations.from(field),
})
