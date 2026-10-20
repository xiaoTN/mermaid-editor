import type { EditorFile } from './draft'
import { t } from '../../../packages/dom/src/i18n'

export const supportedFile = (name: string) => /\.(mmd|mermaid|md|txt)$/i.test(name)

/** Offsets address the original string, including BOM, CRLF and trailing spaces. */
export function mermaidBlock(source: string): { start: number; end: number } | null {
  const lines = /[^\r\n]*(?:\r\n|\n|\r|$)/g
  let fence: string | undefined
  let start = 0
  let mermaid = false
  for (const match of source.matchAll(lines)) {
    if (!match[0]) continue
    const line = match[0].replace(/[\r\n]+$/, '').replace(/^\uFEFF/, '')
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line)
      if (!opening) continue
      fence = opening[1]
      mermaid = /^mermaid[\t ]*$/i.test(opening[2].trim())
      start = match.index! + match[0].length
    } else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[\\t ]*$`).test(line)) {
      if (mermaid) {
        let end = match.index!
        // The newline immediately before the closing fence belongs to its separator.
        if (end > start) end -= source.slice(start, end).endsWith('\r\n') ? 2 : 1
        return { start, end }
      }
      fence = undefined
    }
  }
  return null
}

export function readDocument(name: string, source: string, path?: string): EditorFile {
  if (!supportedFile(name)) throw new Error(t('err.fileType'))
  if (!/\.md$/i.test(name)) return { name, ...(path ? { path } : {}), code: source }
  const block = mermaidBlock(source)
  if (!block) throw new Error(t('err.mermaidBlock'))
  return { name, path, source, code: source.slice(block.start, block.end) }
}

export function writeDocument(file: EditorFile): string {
  if (!/\.md$/i.test(file.name)) return file.code
  if (file.source === undefined) return '```mermaid\n' + file.code + (file.code && !/[\r\n]$/.test(file.code) ? '\n' : '') + '```\n'
  const block = mermaidBlock(file.source)
  if (!block) throw new Error(t('err.mermaidBlock'))
  const separator = block.start === block.end && !/^[\r\n]/.test(file.source.slice(block.end)) && file.code && !/[\r\n]$/.test(file.code)
    ? (file.source.includes('\r\n') ? '\r\n' : '\n') : ''
  return file.source.slice(0, block.start) + file.code + separator + file.source.slice(block.end)
}

export function windowTitle(title: string, filename: string, dirty: boolean): string {
  return `${title} — ${filename}${dirty ? ' *' : ''}`
}
