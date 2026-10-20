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

/** Compare against disk, independent of selection and of the latest operation. */
export function diskChangedLines(baseline: string, code: string): number[] {
  if (baseline === code) return []
  const a = baseline.split('\n'), b = code.split('\n')
  let first = 0, endA = a.length, endB = b.length
  while (first < endA && first < endB && a[first] === b[first]) first++
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const m = endA - first, n = endB - first
  const changed = new Set<number>()
  if (m * n > 1_000_000) {
    for (let j = first; j < endB; j++) changed.add(j + 1)
  } else {
    const table = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
      table[i][j] = a[first + i] === b[first + j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1])
    }
    let i = 0, j = 0
    while (i < m || j < n) {
      if (i < m && j < n && a[first + i] === b[first + j]) { i++; j++ }
      else {
        const start = j
        while ((i < m || j < n) && !(i < m && j < n && a[first + i] === b[first + j])) {
          if (j < n && (i === m || table[i][j + 1] >= table[i + 1][j])) j++
          else i++
        }
        if (j === start) changed.add(Math.min(first + j + 1, b.length))
        else for (let k = start; k < j; k++) changed.add(first + k + 1)
      }
    }
  }
  return [...changed].sort((x, y) => x - y)
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
