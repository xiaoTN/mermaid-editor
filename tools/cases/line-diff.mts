export interface LineChange {
  kind: 'add' | 'remove'
  line: number
  text: string
}

/** 保留整行原始字节所对应的文本，包括 CRLF、行尾空格和末尾换行。 */
export function rawLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

export function lineDiff(before: string, after: string): LineChange[] {
  const a = rawLines(before)
  const b = rawLines(after)
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const changes: LineChange[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++ }
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      changes.push({ kind: 'add', line: j + 1, text: b[j++] })
    } else {
      changes.push({ kind: 'remove', line: i + 1, text: a[i++] })
    }
  }
  return changes
}

/** line 为原文件的一基行号；remove=0 表示在该行之前插入。add 不带换行符。 */
export interface AllowedChange {
  line: number
  remove: number
  add: string[]
}

export function assertAllowedChanges(before: string, after: string, allowed: AllowedChange[]): void {
  const lines = rawLines(before)
  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  const expected: string[] = []
  let next = 0
  for (const change of [...allowed].sort((a, b) => a.line - b.line)) {
    const at = change.line - 1
    if (at < next || at > lines.length || change.remove < 0 || at + change.remove > lines.length) {
      throw new Error('允许改动的行号重叠或越界')
    }
    expected.push(...lines.slice(next, at), ...change.add.map((line) => line + eol))
    next = at + change.remove
  }
  expected.push(...lines.slice(next))
  const actualDiff = lineDiff(before, after)
  const expectedDiff = lineDiff(before, expected.join(''))
  if (JSON.stringify(actualDiff) !== JSON.stringify(expectedDiff)) {
    const at = Array.from({ length: Math.max(actualDiff.length, expectedDiff.length) }, (_, index) => index)
      .find((index) => JSON.stringify(actualDiff[index]) !== JSON.stringify(expectedDiff[index]))!
    const format = (change: LineChange | undefined) => change
      ? `${change.kind === 'add' ? '+' : '-'}${change.line}: ${JSON.stringify(change.text)}` : '无更多改动'
    throw new Error(`行级改动不符合预期（第 ${at + 1} 项）；预期 ${format(expectedDiff[at])}；实际 ${format(actualDiff[at])}`)
  }
}
