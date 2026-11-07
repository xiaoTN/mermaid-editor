import ts from 'typescript'

// Preserve the original range and include Han characters outside the BMP.
const chinese = /[\u3400-\u9fff\p{Script=Han}]/u

/** Scan all code tokens, not just UI-looking expressions, as case 33 historically did. */
export function hasHardcodedChinese(source: string, fileName: string): boolean {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)

  function visit(node: ts.Node): boolean {
    // JSDoc may appear as syntax nodes even though it is comment trivia.
    if (ts.isJSDoc(node)) return false
    // Literal text is decoded by TypeScript, catching e.g. '\\u4e2d' as well.
    if ((ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) && chinese.test(node.text)) return true
    // JSX text and quoted attributes also interpret numeric HTML character references.
    if (ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent))) {
      const decoded = node.text.replace(/&#(?:x([\da-f]+)|(\d+));/gi, (entity, hex, decimal) => {
        const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10)
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
      })
      if (chinese.test(decoded)) return true
    }
    const children = node.getChildren(file)
    if (children.length) return children.some(visit)
    // getStart excludes comments and other trivia, but preserves JSX text verbatim.
    return chinese.test(source.slice(node.getStart(file), node.end))
  }
  return visit(file)
}
