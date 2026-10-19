import type { EditorFile } from './draft'
export type { EditorFile } from './draft'

/** Replace this adapter when the desktop shell provides native file access. */
export interface FileAccess {
  open(file: File): Promise<EditorFile>
  save(file: EditorFile): Promise<void>
}

export const browserFiles: FileAccess = {
  async open(file) { return { code: await file.text(), name: file.name } },
  async save(file) {
    const url = URL.createObjectURL(new Blob([file.code], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    try {
      link.href = url; link.download = file.name
      document.body.append(link); link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  },
}

