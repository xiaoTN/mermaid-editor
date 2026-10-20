import { applyEdits, type TextEdit } from '@inkeep/mermaid-wysiwyg-core'

/** CodeMirror stores every line break as one position; the engine keeps raw bytes. */
export class LosslessText {
  constructor(public code: string) {}

  rawOffset(position: number): number {
    let raw = 0, normalized = 0
    while (raw < this.code.length && normalized < position) {
      raw += this.code[raw] === '\r' && this.code[raw + 1] === '\n' ? 2 : 1
      normalized++
    }
    return raw
  }

  paneOffset(position: number): number {
    return this.code.slice(0, position).replace(/\r\n/g, '\n').length
  }

  editPane(changes: { from: number; to: number; insert: string }[]): void {
    const eol = /\r\n|\r|\n/.exec(this.code)?.[0] ?? '\n'
    this.apply(changes.map(change => ({ start: this.rawOffset(change.from), end: this.rawOffset(change.to),
      text: change.insert.replace(/\r\n|\r|\n/g, eol) })))
  }

  apply(edits: TextEdit[]): void { this.code = applyEdits(this.code, edits).text }
}
