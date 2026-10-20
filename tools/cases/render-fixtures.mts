// 使用仓库锁定的 Mermaid 11 生成真实 SVG；jsdom 仅补齐文字测量 API。
import { JSDOM } from '../../packages/dom/node_modules/jsdom/lib/api.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element,
  SVGElement: dom.window.SVGElement, HTMLElement: dom.window.HTMLElement, CSSStyleSheet: dom.window.CSSStyleSheet })
Object.defineProperty(dom.window.SVGElement.prototype, 'getBBox', { value() {
  return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
} })
Object.defineProperty(dom.window.SVGElement.prototype, 'getComputedTextLength', { value() {
  return (this.textContent ?? '').length * 8
} })
const { default: mermaid } = await import('../../apps/playground/node_modules/mermaid/dist/mermaid.core.mjs')
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
const directory = `${root}packages/core/test/fixtures`
mkdirSync(directory, { recursive: true })
for (const name of ['louvre', 'edge-forms']) {
  const supplied = `${root}.codex-runs/louvre.mmd`
  const code = readFileSync(name === 'louvre' && existsSync(supplied) ? supplied : `${directory}/${name}.mmd`, 'utf8')
  if (name === 'louvre') writeFileSync(`${directory}/${name}.mmd`, code, 'utf8')
  const result = await mermaid.render(`fixture-${name}`, code)
  writeFileSync(`${directory}/${name}.svg`, result.svg, 'utf8')
  console.log(`已生成真实 Mermaid SVG：${name}`)
}
