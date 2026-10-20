import type { EditorFile } from './draft'
import { readDocument, writeDocument } from './documentFile'
export type { EditorFile } from './draft'

export interface FileAccess {
  native?: boolean
  startupPath?: string
  open(file?: File | string): Promise<EditorFile | null>
  save(file: EditorFile): Promise<EditorFile | null | void>
  saveAs?(file: EditorFile): Promise<EditorFile | null>
}

export const browserFiles: FileAccess = {
  async open(file) {
    if (!file || typeof file === 'string') return null
    const source = typeof file.arrayBuffer === 'function'
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
      : await file.text()
    return readDocument(file.name, source)
  },
  async save(file) {
    const source = writeDocument(file)
    const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    try {
      link.href = url; link.download = file.name
      document.body.append(link); link.click()
      return { ...file, source: /\.md$/i.test(file.name) ? source : undefined, untitled: false }
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  },
}

