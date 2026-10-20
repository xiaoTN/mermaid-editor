// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import './dom-layout'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '../src'
import { MermaidCanvasView, setLocale, t } from '../../dom/src'
import { MermaidCodeMirror } from '../../codemirror/src'
import { flashField, flashLines } from '../../../apps/playground/src/changedLines'
import { EditorView, type DecorationSet } from '../../../apps/playground/node_modules/@codemirror/view'

const code = readFileSync(resolve(__dirname, 'fixtures/louvre.mmd'), 'utf8')
const svg = readFileSync(resolve(__dirname, 'fixtures/louvre.svg'), 'utf8')
const pairs = ['entry->layout', 'goods->decor', 'decor->assembly', 'select->floor', 'floor->result', 'primary->ai']
const pointer = (target: EventTarget, type: string, x = 0) => target.dispatchEvent(
  new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 30 }))
let host: HTMLElement, editor: MermaidWysiwygEditor, canvas: MermaidCanvasView

beforeEach(async () => {
  setLocale('zh-CN')
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  editor = new MermaidWysiwygEditor({ code })
  host = document.createElement('div'); document.body.append(host)
  // Fixture is the unmodified result of real Mermaid 11 rendering, including
  // its cluster order, prefixed paths and inner label[data-id] structure.
  canvas = new MermaidCanvasView({ editor, container: host, debounceMs: 10000,
    mermaid: { initialize() {}, async parse() {}, async render() { return { svg } } } })
  await canvas.render()
})
afterEach(() => { canvas.destroy(); host.remove(); Reflect.deleteProperty(document, 'elementFromPoint'); vi.unstubAllGlobals() })

describe.each(pairs)('Louvre 真实 SVG 手势：%s', pair => {
  const selected = () => editor.result.flowchart!.edges.find(e => `${e.source}->${e.target}` === pair)!
  function clickEdge() {
    const path = host.querySelector(`[id="fixture-louvre-L_${pair.replace('->', '_')}_0"]`)!
    pointer(path, 'click')
    expect(editor.selection).toEqual([selected().entityId])
    expect(path.classList.contains('mw-selected')).toBe(true)
    const label = [...host.querySelectorAll('.edgeLabels > .edgeLabel')].find(el =>
      el.querySelector('.label')?.getAttribute('data-id') === path.getAttribute('data-id'))!
    expect(label.classList.contains('mw-selected')).toBe(true)
    return path
  }
  function checkHistory() {
    const after = editor.code
    editor.undo(); expect(editor.code).toBe(code)
    editor.redo(); expect(editor.code).toBe(after)
  }
  it('选中 path 后从弹出菜单删除，只删该边', () => {
    const edge = selected(), before = editor.result.flowchart!.edges.map(e => e.entityId)
    clickEdge()
    pointer(host.querySelector(`[aria-label="${t('edge.delete')}"]`)!, 'click')
    expect(editor.result.flowchart!.edges.map(e => e.entityId)).toEqual(before.filter(id => id !== edge.entityId))
    checkHistory()
  })
  it('点击真实标签也选中同一条边，菜单切线型不影响其他边', () => {
    const edge = selected()
    const inner = host.querySelector(`[data-id="L_${pair.replace('->', '_')}_0"].label`)!
    pointer(inner, 'click')
    expect(editor.selection).toEqual([edge.entityId])
    pointer(host.querySelector(`[aria-label="${t('edge.dotted')}"]`)!, 'click')
    expect(editor.result.flowchart!.edges.filter(e => e.seg.line === 'dotted').map(e => e.entityId)).toEqual([edge.entityId])
    checkHistory()
  })
  it.each(['source', 'target'] as const)('拖动 %s 端点只改选中边', end => {
    const edge = selected(), before = editor.result.flowchart!.edges.map(e => [e.source, e.target])
    clickEdge()
    const target = host.querySelector('[data-mw-entity="node:output"]')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    pointer(host.querySelector(`[data-end="${end}"]`)!, 'pointerdown')
    pointer(document, 'pointermove', 90); pointer(document, 'pointerup', 90)
    before[edge.order][end === 'source' ? 0 : 1] = 'output'
    expect(editor.result.flowchart!.edges.map(e => [e.source, e.target])).toEqual(before)
    checkHistory()
  })
})

it('真实 CodeMirror：选节点、分组、& 和链式边同步源码整行，取消清理；黄色改动高亮独立', () => {
  const paneHost = document.createElement('div'); document.body.append(paneHost)
  const pane = new MermaidCodeMirror(paneHost, editor, [flashField])
  const highlighted = () => {
    const starts: number[] = []
    for (const value of pane.view.state.facet(EditorView.decorations)) {
      if (typeof value === 'function') continue
      ;(value as DecorationSet).between(0, pane.view.state.doc.length, (from, _to, deco) => {
        if (deco.spec.class === 'mw-cm-selected-line') starts.push(from)
      })
    }
    return starts
  }
  try {
    pane.view.dispatch({ effects: flashLines.of([3]) })
    for (const id of ['node:entry', 'subgraph:decor', ...pairs.map(p => `edge:${p}#0`)]) {
      const element = [...host.querySelectorAll('[data-mw-entity]')].find(el => el.getAttribute('data-mw-entity') === id)!
      pointer(element, 'click')
      const doc = pane.view.state.doc
      const expected = [...new Set(editor.selectionSpans().map(s => doc.lineAt(s.start).from))].sort((a, b) => a - b)
      expect(highlighted()).toEqual(expected)
      pointer(host.querySelector('svg')!, 'click')
      expect(highlighted()).toEqual([])
      expect(pane.view.state.field(flashField).size).toBe(1)
    }
    expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  } finally { pane.destroy(); paneHost.remove() }
})
