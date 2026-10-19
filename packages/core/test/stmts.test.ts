import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse, scanLines, splitStatements } from '../src'

const sample = (name: string) => readFileSync(new URL(`../../../testdata/samples/${name}.mmd`, import.meta.url), 'utf8')

function expectUndoRedo(ed: MermaidWysiwygEditor, before: string, after: string) {
  expect(ed.code).toBe(after)
  expect(ed.undo()).toBe(true)
  expect(Buffer.from(ed.code)).toEqual(Buffer.from(before))
  expect(ed.redo()).toBe(true)
  expect(ed.code).toBe(after)
}

describe('流程图语句和原文保留', () => {
  it('06：解析分号语句、边 id，属性不生成同名节点', () => {
    const g = parse(sample('06-edge-cases')).flowchart!
    expect(g.edges.map((e) => `${e.source}→${e.target}`)).toEqual([
      'id-1→id_2', 'node.with.dot→end1', 'A1→A1', 'x1→x2', 'B1→C1', 'C1→D1', 'D1→E1',
    ])
    expect(g.nodeById.has('e1')).toBe(false)
    expect(g.edges.find((e) => e.source === 'x1')?.seg).toMatchObject({ edgeId: 'e1' })
  })

  it('只改分号后面那条边的文字，撤销字节一致', () => {
    const code = sample('06-edge-cases')
    const ed = new MermaidWysiwygEditor({ code })
    const edge = ed.result.flowchart!.edges.find((e) => e.source === 'D1')!
    expect(edge).toBeDefined()
    ed.dispatch({ type: 'setEdgeLabel', edgeId: edge.entityId, label: '继续' })
    expect(ed.code).toBe(code.replace('C1 --> D1; D1 --> E1', 'C1 --> D1; D1 -->|继续| E1'))
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it('删除分号前面的边，只留下后面的语句', () => {
    const code = sample('06-edge-cases')
    const ed = new MermaidWysiwygEditor({ code })
    const edge = ed.result.flowchart!.edges.find((e) => e.source === 'C1')!
    expect(edge).toBeDefined()
    ed.dispatch({ type: 'deleteEdge', edgeId: edge.entityId })
    expect(ed.code).toBe(code.replace('C1 --> D1; D1 --> E1', 'D1 --> E1'))
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it('05：跨行 Markdown 标签保留节点、边及反引号', () => {
    const code = sample('05-shapes-multi')
    const ed = new MermaidWysiwygEditor({ code })
    const g = ed.result.flowchart!
    expect(g.nodeById.get('M')?.label).toBe('**markdown** 文字\n    第二行')
    expect(g.edges.some((e) => e.source === 'K' && e.target === 'M')).toBe(true)
    ed.dispatch({ type: 'renameNode', id: 'M', label: '**新文字**\n    第二行' })
    expect(ed.code).toBe(code.replace('**markdown** 文字', '**新文字**'))
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it.each(['connect', 'addNode', 'deleteEdge'] as const)('07：%s 保留 CRLF、行尾空格和撤销字节', (type) => {
    const code = sample('07-crlf-trailing')
    expect(code).toContain('\r\n')
    expect(scanLines(code).map((line) => line.text).join('\n')).toBe(code)
    const ed = new MermaidWysiwygEditor({ code })
    if (type === 'connect') ed.dispatch({ type, source: 'P', target: 'R' })
    else if (type === 'addNode') ed.dispatch({ type, id: '新节点', label: '新增节点' })
    else ed.dispatch({ type, edgeId: ed.result.flowchart!.edges[1].entityId })
    expect(ed.code.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(ed.code.split('\r\n')[1]).toBe(code.split('\r\n')[1])
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it.each([
    'A[甲;乙]', 'A(甲;乙)', 'A{甲;乙}', 'A["甲;乙"]',
    'A["`甲;乙`"]', 'A -->|甲;乙| B', 'A@{ label: "甲;乙" }',
    'A>甲;乙]',
  ])('分号在标签或属性里不切分：%s', (first) => {
    const code = `flowchart LR\r\n\t${first} ;  C --> D ;  \r\n`
    const line = scanLines(code)[1]
    expect(splitStatements(line).map((span) => code.slice(span.start, span.end))).toEqual([first, 'C --> D'])
    const stmts = parse(code).flowchart!.statements.get(1)!
    expect(stmts.map((stmt) => stmt.stmtIndex)).toEqual([0, 1])
    expect(stmts.map((stmt) => code.slice(stmt.span.start, stmt.span.end))).toEqual([first, 'C --> D'])
  })

  it('边的 id span 独立于箭头；改文字和样式都不改 id、邻段及行尾分号', () => {
    const code = '\t%% 注释\nflowchart LR\n\tA e1@--> B ;  C --> D ;  \n'
    const ed = new MermaidWysiwygEditor({ code })
    const edge = ed.result.flowchart!.edges[0]
    expect(code.slice(edge.seg.idSpan!.start, edge.seg.idSpan!.end)).toBe('e1@')
    expect(code.slice(edge.seg.span.start, edge.seg.span.end)).toBe('-->')
    const result = ed.dispatch({ type: 'setEdgeLabel', edgeId: edge.entityId, label: '走' })!
    expect(result.edits).toEqual([{ start: code.indexOf('-->') + 3, end: code.indexOf('-->') + 3, text: '|走|' }])
    ed.dispatch({ type: 'setEdgeStyle', edgeId: edge.entityId, line: 'thick' })
    expect(ed.code).toBe(code.replace('e1@-->', 'e1@==>|走|'))
    ed.undo()
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it('重建链保留未删除边的 id 和原来的 tab、空格', () => {
    const code = 'flowchart LR\n  A --> B\te1@-->  C ; D --> E;  \n  A\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expectUndoRedo(ed, code, code.replace('A --> B\te1@-->  C', 'B\te1@-->  C'))
    expect(ed.result.flowchart!.edges[0].seg.edgeId).toBe('e1')
  })

  it.each([false, true])('边属性可写在边的前面（%s），删除时只清理对应属性', (before) => {
    const edge = '\tA e1@--> B ; C --> D;  \r\n'
    const attrs = '\te1@{ animate: true, label: "甲;乙}" };  N@{ shape: rect };  \r\n'
    const code = 'flowchart LR\r\n' + (before ? attrs + edge : edge + attrs) + '\tA\r\n\tB\r\n'
    const ed = new MermaidWysiwygEditor({ code })
    const g = ed.result.flowchart!
    expect(g.nodeById.has('e1')).toBe(false)
    expect(g.nodeById.has('N')).toBe(true)
    expect([...g.statements.values()].flat().find((stmt) => stmt.kind === 'edgeAttrs')).toMatchObject({ ids: ['e1'] })
    ed.dispatch({ type: 'deleteEdge', edgeId: g.edges[0].entityId })
    expectUndoRedo(ed, code, code.replace('A e1@--> B ; ', '').replace('e1@{ animate: true, label: "甲;乙}" };  ', ''))
  })

  it('删除同一行的边和属性不会生成重叠编辑', () => {
    const code = 'flowchart LR\n  A e1@--> B; e1@{ animate: true }; C --> D;  \n  A\n  B\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expectUndoRedo(ed, code, code.replace('A e1@--> B; e1@{ animate: true }; ', ''))
  })

  it.each(['\n', '\r\n'])('Markdown 续行不被当成语句，新增边放在整个标签后面（%j）', (eol) => {
    const code = ['flowchart LR', '\tA["`第一;行', '%% 第二行', '', '第三行`"] --> B; C', ''].join(eol)
    const ed = new MermaidWysiwygEditor({ code })
    expect(ed.result.lines.map((line) => line.kind)).toEqual([
      'header', 'statement', 'continuation', 'continuation', 'continuation', 'blank',
    ])
    expect(ed.result.flowchart!.statements.has(2)).toBe(false)
    const ref = ed.result.flowchart!.nodeById.get('A')!.primary!.ref
    expect(code.slice(ref.labelSpan!.start, ref.labelSpan!.end)).toBe(['第一;行', '%% 第二行', '', '第三行'].join(eol))
    ed.dispatch({ type: 'connect', source: 'A', target: 'C' })
    expectUndoRedo(ed, code, code.slice(0, -eol.length) + eol + '\tA --> C' + eol)
  })

  it('修改 Markdown 节点形状时保留引号、反引号和续行', () => {
    const code = 'flowchart LR\n  A["`第一行\n第二行`"] --> B\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'setNodeShape', id: 'A', shape: 'diamond' })
    expectUndoRedo(ed, code, code.replace('A[', 'A{').replace('`"]', '`"}'))
  })

  it('CRLF Markdown 改名用文档换行符，只替换反引号内的内容', () => {
    const code = 'flowchart LR\r\n  A["`第一行\r\n第二行`"] --> B; C;  \r\n'
    const ed = new MermaidWysiwygEditor({ code })
    const result = ed.dispatch({ type: 'renameNode', id: 'A', label: '**新文**\n末行' })!
    const start = code.indexOf('第一行')
    expect(result.edits).toEqual([{ start, end: code.indexOf('`"]'), text: '**新文**\r\n末行' }])
    expectUndoRedo(ed, code, code.replace('第一行\r\n第二行', '**新文**\r\n末行'))
  })

  it('重建跨行语句只替换目标段，前后语句和分号不变', () => {
    const code = 'flowchart LR\r\n\tX; A --> B["`第一行\r\n第二行`"] --> C;  Y;  \r\n\tA\r\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expectUndoRedo(ed, code, code.replace('A --> B[', 'B['))
    expect(ed.result.flowchart!.nodes.map((node) => node.id)).toEqual(['X', 'B', 'C', 'Y', 'A'])
  })

  it('删除最后一段时保留其他段及原来的行尾分号和空白', () => {
    const code = 'flowchart LR\n\tA --> B ;  C --> D ;  \n  C\n  D\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[1].entityId })
    expectUndoRedo(ed, code, code.replace(' ;  C --> D', ''))
  })

  it('反转分号后面的边时不动其他段', () => {
    const code = 'flowchart LR\n  A --> B ;\tC e1@--> D ;  \n'
    const ed = new MermaidWysiwygEditor({ code })
    const edge = ed.result.flowchart!.edges[1]
    expect(edge.stmtIndex).toBe(1)
    ed.dispatch({ type: 'reverseEdge', edgeId: edge.entityId })
    expectUndoRedo(ed, code, code.replace('C e1@--> D', 'D e1@--> C'))
  })

  it.each(['node', 'edge'] as const)('修改和清除 %s 颜色只影响对应语句段', (kind) => {
    const style = kind === 'node' ? 'style A fill:red' : 'linkStyle 0 stroke:red,stroke-width:2px'
    const code = `flowchart LR\r\n\tA --> B; ${style}; C;  \r\n`
    const ed = new MermaidWysiwygEditor({ code })
    const edgeId = ed.result.flowchart!.edges[0].entityId
    if (kind === 'node') ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'fill', value: 'blue' })
    else ed.dispatch({ type: 'setEdgeColor', edgeId, value: 'blue' })
    expect(ed.code).toBe(code.replace('red', 'blue'))
    if (kind === 'node') ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'fill', value: null })
    else ed.dispatch({ type: 'setEdgeColor', edgeId, value: null })
    expect(ed.code).toBe(code.replace(style + '; ', ''))
    ed.undo()
    ed.undo()
    expect(ed.code).toBe(code)
  })

  it('删除节点时处理同一行的多个语句段，保留样式并给出提示', () => {
    const code = 'flowchart LR\n  A --> B; B --> C; style B fill:red; linkStyle 0 stroke:red; X --> Y\n  A\n  C\n'
    const ed = new MermaidWysiwygEditor({ code })
    expect(ed.dispatch({ type: 'deleteNode', id: 'B' })!.warnings).toHaveLength(1)
    expectUndoRedo(ed, code, code.replace('A --> B; B --> C; ', '').replace('linkStyle 0 stroke:red; ', ''))
  })

  it.each(['\n', '\r\n'])('删除末尾无换行的边和属性不留下孤立回车（%j）', (eol) => {
    const code = ['flowchart LR', '  A', '  B', '  A e1@--> B', '  e1@{ animate: true }'].join(eol)
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expectUndoRedo(ed, code, ['flowchart LR', '  A', '  B'].join(eol))
  })

  it('只删除单条边时保留行内注释', () => {
    const code = 'flowchart LR\n  A\n  B\n  A --> B  %% 保留;注释\n'
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expectUndoRedo(ed, code, code.replace('A --> B', ''))
  })
})
