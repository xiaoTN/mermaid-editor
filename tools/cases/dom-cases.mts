import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MermaidWysiwygEditor, bindTextPane, type FlowEdge, type Span } from '../../packages/core/src/index.js'
import { correlateFlowchart } from '../../packages/dom/src/correlate.js'
import { assertOnlyReplacesLine } from './line-diff.mjs'

export function createDomCases(directory: string): [string, string, (document: Document) => void][] {
  const fixture = (name: string, ext: string) => readFileSync(join(directory, `${name}.${ext}`), 'utf8')
  const typical = ['entry->layout', 'goods->decor', 'decor->assembly', 'select->floor', 'floor->result', 'primary->ai']
  const signature = (edge: FlowEdge) => ({ source: edge.source, target: edge.target, label: edge.label,
    line: edge.seg.line, arrowStart: edge.seg.arrowStart, arrowEnd: edge.seg.arrowEnd, id: edge.seg.edgeId })

  function setup(document: Document, name = 'louvre') {
    const code = fixture(name, 'mmd')
    const editor = new MermaidWysiwygEditor({ code })
    const host = document.createElement('div')
    host.innerHTML = fixture(name, 'svg')
    const svg = host.querySelector('svg')!
    const graph = editor.result.flowchart!
    const correlation = correlateFlowchart(svg, graph)
    assert.equal(correlation.edges.size, graph.edges.length, '每条代码边都必须对应真实 SVG path')
    assert.deepEqual(correlation.failed.filter(id => id.startsWith('edge:')), [], '边不得降级或漏配')
    for (const edge of graph.edges) {
      const path = correlation.edges.get(edge.entityId)!
      const id = path.getAttribute('data-id')!
      assert(id === edge.seg.edgeId || id.startsWith(`L_${edge.source}_${edge.target}_`), 'path 端点必须对应源码')
      assert.equal(correlation.edgeLabels.get(edge.entityId)?.querySelector('.label')?.getAttribute('data-id'), id,
        '标签通过真实 data-id 指向同一条边')
      assert.equal(path.getAttribute('data-mw-entity'), edge.entityId)
    }
    return { code, editor, graph, host, svg, correlation }
  }

  function roundTrip(editor: MermaidWysiwygEditor, before: string) {
    const after = editor.code
    assert.notEqual(after, before, '操作必须产生改动')
    editor.undo(); assert.equal(editor.code, before, '撤销必须字节一致')
    editor.redo(); assert.equal(editor.code, after, '重做必须字节一致')
  }

  type Action = 'delete' | 'style' | 'color' | 'target' | 'source' | 'label'
  function operate(document: Document, name: string, index: number, action: Action, throughLabel = false) {
    const { code, editor, graph, correlation } = setup(document, name)
    const selected = graph.edges[index]
    // 从真实元素取得 entity，而非用期望的语义 id 直接绕过 DOM。
    const element = (throughLabel ? correlation.edgeLabels : correlation.edges).get(selected.entityId)!
    editor.setSelection([element.getAttribute('data-mw-entity')!], 'canvas')
    assert.deepEqual(editor.selection, [selected.entityId])
    const before = graph.edges.map(signature)
    let expected = before.map(e => ({ ...e }))
    const edgeId = editor.selection[0]
    if (action === 'delete') {
      editor.deleteEntities(editor.selection)
      expected.splice(index, 1)
    } else if (action === 'style') {
      editor.dispatch({ type: 'setEdgeStyle', edgeId, line: 'dotted', preserveLabelForm: true })
      expected[index].line = 'dotted'
    } else if (action === 'color') {
      editor.dispatch({ type: 'setEdgeColor', edgeId, value: '#123abc' })
      assert.equal(editor.code, code.replace(/\n?$/, `\n    linkStyle ${selected.order} stroke:#123abc,stroke-width:2px\n`),
        '只允许新增指向选中边源码序号的 linkStyle')
    } else if (action === 'label') {
      editor.dispatch({ type: 'setEdgeLabel', edgeId, label: '只改这一条' })
      expected[index].label = '只改这一条'
    } else {
      editor.dispatch({ type: 'retargetEdge', edgeId, end: action, nodeId: 'output' })
      expected[index][action] = 'output'
    }
    assert.deepEqual(editor.result.flowchart!.edges.map(signature), expected, '只能影响选中的一条边，其他边及顺序必须不变')
    if (action !== 'color') assertOnlyReplacesLine(code, editor.code, selected.lineIndex + 1)
    if (name === 'louvre' && selected.source === 'entry' && selected.target === 'layout' && action === 'delete') {
      assert.equal(editor.code, code.replace('entry --> layout & hard', 'entry --> hard'))
    }
    roundTrip(editor, code)
  }

  function typicalOperations(document: Document, actions: Action[]) {
    const { graph } = setup(document)
    for (const pair of typical) {
      const index = graph.edges.findIndex(e => `${e.source}->${e.target}` === pair)
      assert(index >= 0)
      for (const action of actions) operate(document, 'louvre', index, action)
    }
  }

  return [
    ['46a', '真实 SVG：六条典型边分别删除，范围与撤销字节校验', document => typicalOperations(document, ['delete'])],
    ['46b', '真实 SVG：六条边分别改颜色、线型，linkStyle 指向正确', document => typicalOperations(document, ['color', 'style'])],
    ['46c', '真实 SVG：六条边分别拖起点、终点，只改选中边', document => typicalOperations(document, ['source', 'target'])],
    ['46d', '源码选中范围、整行定位及取消清理', document => {
      const { editor, code, graph, correlation } = setup(document)
      let highlights: Span[] = [], revealed = -1
      const binding = bindTextPane(editor, { getText: () => code, applyEdits() {}, setText() {},
        setHighlights: spans => { highlights = spans }, revealPosition: offset => { revealed = offset } })
      try {
        for (const edge of graph.edges) {
          editor.setSelection([correlation.edges.get(edge.entityId)!.getAttribute('data-mw-entity')!], 'canvas')
          const start = code.lastIndexOf('\n', highlights[0].start - 1) + 1
          assert.equal(code.slice(0, start).split('\n').length, edge.lineIndex + 1)
          assert.equal(revealed, highlights[0].start)
          editor.clearSelection('canvas'); assert.deepEqual(highlights, [])
        }
        for (const [id] of correlation.nodes) {
          editor.setSelection([id], 'canvas'); assert(highlights.length > 0)
          assert.equal(revealed, highlights[0].start)
          editor.clearSelection('canvas'); assert.deepEqual(highlights, [])
        }
        assert.equal(editor.code, code); assert.equal(editor.canUndo, false)
      } finally { binding.dispose() }
    }],
    ['47', '真实 SVG：Louvre 全部 37 条边逐条删除，每次从原图开始', document => {
      const { graph } = setup(document)
      graph.edges.forEach((_, index) => operate(document, 'louvre', index, 'delete'))
    }],
    ['48', '真实 SVG：指向分组、从分组引出的边删除和改端点', document => {
      const { graph } = setup(document)
      for (const pair of ['goods->decor', 'decor->assembly']) {
        const index = graph.edges.findIndex(e => `${e.source}->${e.target}` === pair)
        for (const action of ['delete', 'target'] as const) operate(document, 'louvre', index, action)
      }
    }],
    ['49', '真实 SVG：& 扇出和扇入中间边删除、改线型和文字，其余顺序不变', document => {
      const { graph } = setup(document, 'edge-forms')
      for (const pair of ['A->C', 'C->D']) {
        const index = graph.edges.findIndex(e => `${e.source}->${e.target}` === pair)
        for (const action of ['delete', 'style', 'label'] as const) operate(document, 'edge-forms', index, action)
      }
    }],
    ['50', '真实 SVG：链式中间段删除、改文字，只影响该段', document => {
      const { graph } = setup(document, 'edge-forms')
      const index = graph.edges.findIndex(e => e.source === 'b' && e.target === 'c')
      operate(document, 'edge-forms', index, 'delete')
      operate(document, 'edge-forms', index, 'label', true)
    }],
    ['51', '真实 SVG：中文平行边的不同序号与标签逐一对应，分别改文字', document => {
      const { graph, correlation } = setup(document, 'edge-forms')
      for (const index of [0, 1]) {
        const edge = graph.edges[index]
        assert.equal(correlation.edgeLabels.get(edge.entityId)!.textContent, edge.label)
        operate(document, 'edge-forms', index, 'label', true)
      }
    }],
    ['52', '真实 SVG：自定义边 id、标签与 linkStyle 关联，删除后索引重算', document => {
      const { editor, code, graph, correlation } = setup(document, 'edge-forms')
      const edge = graph.edges.find(e => e.seg.edgeId === 'e1')!
      const path = correlation.edges.get(edge.entityId)!
      assert.equal(path.id, 'fixture-edge-forms-e1')
      editor.setSelection([path.getAttribute('data-mw-entity')!], 'canvas')
      editor.deleteEntities(editor.selection)
      assert.deepEqual(editor.result.flowchart!.edges.map(signature), graph.edges.filter(e => e !== edge).map(signature))
      assert.equal(editor.code, code.replace('  甲 e1@-->|自定义| 丙\n', '  丙\n').replace('linkStyle 0,2 ', 'linkStyle 0 '))
      roundTrip(editor, code)
    }],
  ]
}
