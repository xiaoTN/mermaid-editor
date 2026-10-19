import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// 使用只读 testdata 中与 check.mjs 相同的 Mermaid 和 DOM 依赖。
const require = createRequire(new URL('../../testdata/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><body></body>')
globalThis.window = dom.window
globalThis.document = dom.window.document
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href)
mermaid.initialize({ startOnLoad: false })

async function membership(path) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(readFileSync(path, 'utf8'))
  return diagram.db.getSubGraphs().map(({ id, nodes }) => ({ id, nodes: [...nodes].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

const [before, after] = process.argv.slice(2)
assert.deepEqual(await membership(after), await membership(before), 'Mermaid 解析后的子图节点归属改变')
console.log('Mermaid 子图归属检查通过')
