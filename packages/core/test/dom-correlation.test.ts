// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { correlateFlowchart } from '../../dom/src/correlate'
import { createDomCases } from '../../../tools/cases/dom-cases.mjs'

const original = readFileSync(resolve(__dirname, 'fixtures/louvre.mmd'), 'utf8')
const rendered = readFileSync(resolve(__dirname, 'fixtures/louvre.svg'), 'utf8')
beforeAll(() => vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) }))
afterAll(() => vi.unstubAllGlobals())

it('真实 Mermaid 11 的嵌套分组 SVG：选中 entry→layout 删除只移除这一条边', () => {
  const editor = new MermaidWysiwygEditor({ code: original })
  const host = document.createElement('div')
  host.innerHTML = rendered
  correlateFlowchart(host.querySelector('svg')!, editor.result.flowchart!)
  const path = host.querySelector('[id="fixture-louvre-L_entry_layout_0"]')!
  editor.setSelection([path.getAttribute('data-mw-entity')!], 'canvas')
  editor.deleteEntities(editor.selection)
  expect(editor.code).toBe(original.replace('entry --> layout & hard', 'entry --> hard'))
  editor.undo()
  expect(editor.code).toBe(original)
})

it.each(createDomCases(resolve(__dirname, 'fixtures')))('用例 %s：%s', (_number, _note, run) => run(document))
