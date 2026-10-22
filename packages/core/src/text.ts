import type { LineInfo, LineKind, Span, TextEdit } from './types'

/** Split code into lines with absolute offsets. Lossless: joining `text` with '\n' at recorded offsets reproduces input. */
export function scanLines(code: string): LineInfo[] {
  const lines: LineInfo[] = []
  let start = 0
  let index = 0
  while (start <= code.length) {
    let nl = code.indexOf('\n', start)
    if (nl === -1) nl = code.length
    const text = code.slice(start, nl)
    const indent = /^[ \t]*/.exec(text)![0]
    lines.push({ index, kind: 'statement', text, start, end: nl, indent })
    index++
    if (nl === code.length) break
    start = nl + 1
  }
  return lines
}

/** 只识别完整包裹单张图的 Mermaid 代码块，不从多段 Markdown 中擅自选图。 */
function mermaidFenceLines(lines: LineInfo[]): { first: number; last: number } | null {
  const first = lines.findIndex(line => line.text.trim() !== '')
  if (first < 0) return null
  const opening = /^ {0,3}(`{3,}|~{3,})[\t ]*mermaid[\t ]*\r?$/i.exec(lines[first].text.replace(/^\uFEFF/, ''))
  if (!opening) return null
  let last = lines.length - 1
  while (last > first && !lines[last].text.trim()) last--
  const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[\\t ]*\\r?$`)
  if (last <= first || !closing.test(lines[last].text)) return null
  if (lines.slice(first + 1, last).some(line => closing.test(line.text))) return null
  return { first, last }
}

/** 渲染时移除 Markdown 包装，编辑器仍保存原始字符串及全部源码偏移。 */
export function mermaidSource(code: string): string {
  const lines = scanLines(code), fence = mermaidFenceLines(lines)
  return fence ? code.slice(lines[fence.first + 1].start, lines[fence.last].start) : code
}

/** 标记前置信息、注释、指令和图表头，保留每行在原文中的位置。 */
export function classifyLines(lines: LineInfo[]): { headerIndex: number } {
  const fence = mermaidFenceLines(lines)
  let headerIndex = -1
  let inFrontmatter = false
  let frontmatterDone = false
  let sawContent = false

  for (const line of lines) {
    if (fence && (line.index <= fence.first || line.index >= fence.last)) {
      line.kind = 'comment'
      continue
    }
    const t = line.text.trim()
    if (!sawContent && !frontmatterDone && t === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true
        line.kind = 'frontmatter'
        continue
      } else {
        inFrontmatter = false
        frontmatterDone = true
        line.kind = 'frontmatter'
        continue
      }
    }
    if (inFrontmatter) {
      line.kind = 'frontmatter'
      continue
    }
    if (t === '') {
      line.kind = 'blank'
      continue
    }
    if (t.startsWith('%%{')) {
      line.kind = 'directive'
      continue
    }
    if (t.startsWith('%%')) {
      line.kind = 'comment'
      continue
    }
    if (headerIndex === -1) {
      line.kind = 'header'
      headerIndex = line.index
      sawContent = true
      continue
    }
    line.kind = 'statement'
    sawContent = true
  }
  return { headerIndex }
}

/** Apply edits (non-overlapping) and return new text plus the inverse edits (for undo). */
export function applyEdits(code: string, edits: TextEdit[]): { text: string; inverse: TextEdit[] } {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error('Overlapping text edits')
    }
  }
  let out = ''
  let pos = 0
  const inverse: TextEdit[] = []
  let delta = 0
  for (const e of sorted) {
    out += code.slice(pos, e.start)
    out += e.text
    inverse.push({ start: e.start + delta, end: e.start + delta + e.text.length, text: code.slice(e.start, e.end) })
    delta += e.text.length - (e.end - e.start)
    pos = e.end
  }
  out += code.slice(pos)
  return { text: out, inverse }
}

/** Minimal single-edit diff between two versions (common prefix/suffix trim). */
export function diffText(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null
  let p = 0
  const oLen = oldText.length
  const nLen = newText.length
  const min = Math.min(oLen, nLen)
  while (p < min && oldText[p] === newText[p]) p++
  let so = oLen
  let sn = nLen
  while (so > p && sn > p && oldText[so - 1] === newText[sn - 1]) {
    so--
    sn--
  }
  return { start: p, end: so, text: newText.slice(p, sn) }
}

export function spanContains(span: Span, offset: number): boolean {
  return offset >= span.start && offset <= span.end
}

/** Map a position through a set of edits (for keeping selections stable). */
export function mapOffset(offset: number, edits: TextEdit[]): number {
  let result = offset
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.end <= offset) {
      result += e.text.length - (e.end - e.start)
    } else if (e.start < offset) {
      result = e.start + e.text.length
    }
  }
  return result
}
