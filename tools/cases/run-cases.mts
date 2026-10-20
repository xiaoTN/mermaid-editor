import { getLocale, setLocale, messages, listKeys } from '../../packages/dom/src/i18n/index.ts'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  MermaidWysiwygEditor, detectDiagramType,
  type EditorOp, type FlowEdge, type OpResult,
} from '../../packages/core/src/index.ts'
import { assertAllowedChanges, assertOnlyReplacesLine, lineDiff, type AllowedChange } from './line-diff.mts'
import { DraftStore, draftKey, hashContent, type DraftStorage } from '../../apps/playground/src/draft.ts'
import { JSDOM } from '../../packages/dom/node_modules/jsdom/lib/api.js'
import { createDomCases } from './dom-cases.mts'

// 仅写入仓库根目录的 out/cases；testdata 中的样例、规则和校验器始终只读。
const root = fileURLToPath(new URL('../../', import.meta.url))
const samples = join(root, 'testdata', 'samples')
const output = join(root, 'out', 'cases')
// 同步副本在仓库根目录，testdata/ 内的历史规则只读。
const expectedCaseNumbers = new Set([...readFileSync(join(root, 'CASES.md'), 'utf8')
  .matchAll(/^(?:\|\s*|- )?(\d+[a-d]?)(?:\s*\||\.|\s)/gm)].map(match => match[1]))
mkdirSync(output, { recursive: true })

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function graph(editor: MermaidWysiwygEditor) {
  check(editor.result.flowchart, '未能解析流程图')
  return editor.result.flowchart
}

function edge(editor: MermaidWysiwygEditor, source: string, target: string, occurrence = 0): FlowEdge {
  const found = graph(editor).edges.filter((item) => item.source === source && item.target === target)[occurrence]
  check(found, `未解析出边 ${source}→${target}（第 ${occurrence + 1} 次出现）`)
  return found
}

function dispatch(editor: MermaidWysiwygEditor, op: EditorOp): OpResult {
  const result = editor.dispatch(op)
  check(result?.edits.length, `操作 ${op.type} 没有生成文本改动`)
  return result
}

function retarget(editor: MermaidWysiwygEditor, source: string, target: string, nodeId: string, occurrence = 0) {
  dispatch(editor, {
    type: 'retargetEdge', edgeId: edge(editor, source, target, occurrence).entityId, end: 'target', nodeId,
  })
}

interface Scenario {
  sample: number
  name?: string
  edit: (editor: MermaidWysiwygEditor) => void
  /** 数字表示只允许替换这一条原始行，拆行方式由语义断言约束。 */
  allowed: AllowedChange[] | number
  verify?: (editor: MermaidWysiwygEditor) => void
  expectedUndos?: number
  maxMs?: number
}

const replace = (line: number, ...add: string[]): AllowedChange => ({ line, remove: 1, add })
const insert = (line: number, ...add: string[]): AllowedChange => ({ line, remove: 0, add })
const drop = (line: number): AllowedChange => replace(line)

function expectEdges(editor: MermaidWysiwygEditor, pairs: string[]) {
  const actual = graph(editor).edges.map((item) => `${item.source}→${item.target}`)
  check(JSON.stringify(actual) === JSON.stringify(pairs), `边及顺序不符合预期：${actual.join('、')}`)
}

function preserveDecision(editor: MermaidWysiwygEditor) {
  const node = graph(editor).nodeById.get('校验')
  check(node?.shape === 'diamond' && node.label === '校验通过？', '校验节点的菱形或文字丢失')
  check(!graph(editor).edges.some((item) => item.source === '输入' && item.target === '校验'), '旧端点仍然存在')
  edge(editor, '输入', '首页')
}

function decisionScenario(): Scenario {
  return {
    sample: 1,
    edit: (editor) => retarget(editor, '输入', '校验', '首页'),
    allowed: [replace(3, '    校验{校验通过？}', '    输入 --> 首页')],
    verify: preserveDecision,
  }
}

function case01(): Scenario[] { return [decisionScenario()] }

function case02(): Scenario[] {
  return [{
    sample: 1,
    edit: (editor) => { dispatch(editor, { type: 'renameNode', id: '校验', label: '校验通过了吗？' }) },
    allowed: [replace(3, '    输入 --> 校验{校验通过了吗？}')],
    verify: (editor) => {
      const node = graph(editor).nodeById.get('校验')
      check(node?.shape === 'diamond' && node.label === '校验通过了吗？', '菱形或节点新文字不符合预期')
    },
  }]
}

function case03(): Scenario[] {
  return [{
    sample: 1,
    edit: (editor) => { dispatch(editor, { type: 'setEdgeLabel', edgeId: edge(editor, '校验', '首页').entityId, label: '通过' }) },
    allowed: [replace(4, '    校验 -->|通过| 首页[进入首页]')],
    verify: (editor) => { check(edge(editor, '校验', '首页').label === '通过', '边的新文字不符合预期') },
  }]
}

function case04(): Scenario[] {
  return ([
    ['虚线', 'D', 4, '    A -.-> B'],
    ['粗线', 'F', 6, '    A ==> B'],
    ['圆端点', 'H', 8, '    A --o B'],
    ['双向', 'J', 10, '    A <--> B'],
    ['不可见', 'O', 15, '    A ~~~ B'],
  ] as const).map(([name, target, line, content]) => ({
    sample: 2, name,
    edit: (editor) => retarget(editor, 'A', target, 'B'),
    allowed: [replace(line, `    ${target}`, content)],
    verify: editor => { check(graph(editor).nodeById.has(target), `旧节点 ${target} 丢失`) },
  })).concat([{
    sample: 2, name: 'D 改到 O，保留隐式 D',
    edit: editor => retarget(editor, 'A', 'D', 'O'),
    allowed: [replace(4, '    D', '    A -.-> O')],
    verify: editor => { check(graph(editor).nodeById.has('D'), 'D 消失') },
  }])
}

function case05(): Scenario[] {
  return [{
    sample: 2,
    edit: (editor) => { dispatch(editor, { type: 'setEdgeLabel', edgeId: edge(editor, 'A', 'L').entityId, label: '新文字' }) },
    allowed: [replace(12, '    A -. 新文字 .-> L')],
    verify: (editor) => { check(edge(editor, 'A', 'L').seg.line === 'dotted', '虚线样式丢失') },
  }]
}

function case06(): Scenario[] {
  return [{
    sample: 3,
    edit: (editor) => { dispatch(editor, { type: 'connect', source: 'DB', target: 'UI' }) },
    allowed: [insert(15, '    DB --> UI')],
    verify: (editor) => {
      edge(editor, 'DB', 'UI')
      check(graph(editor).nodeById.get('UI')?.subgraph === '前端', '核心图中的 UI 子图归属改变')
    },
  }]
}

function case07(): Scenario[] {
  return [{
    sample: 3,
    edit: (editor) => { editor.deleteEntities([edge(editor, 'SVC', 'Cache').entityId]) },
    allowed: [drop(13)],
    verify: (editor) => { check(graph(editor).nodeById.get('Cache')?.subgraph === '存储', 'Cache 节点或子图归属丢失') },
  }]
}

function case08(): Scenario[] {
  return [{
    sample: 3,
    edit: (editor) => { editor.deleteEntities(['node:SVC']) },
    allowed: [replace(7, '        API[API 网关]'), drop(12), drop(13)],
    verify: (editor) => {
      const g = graph(editor)
      check(!g.nodeById.has('SVC'), 'SVC 节点仍然存在')
      check(g.edges.every((item) => item.source !== 'SVC' && item.target !== 'SVC'), 'SVC 仍有连接边')
      check(g.subgraphs.length === 3 && g.subgraphs.every((item) => item.endLine > item.openLine), '子图或 end 结构损坏')
    },
  }]
}

function case09(): Scenario[] {
  return [{
    sample: 4,
    edit: (editor) => { dispatch(editor, { type: 'setEdgeLabel', edgeId: edge(editor, 'a5', 'a1').entityId, label: '返回' }) },
    allowed: [replace(10, '\ta5 -->|返回| a1')],
  }]
}

function case10(): Scenario[] {
  return [{
    sample: 4,
    edit: (editor) => { editor.deleteEntities([edge(editor, 'a1', 'a2').entityId]) },
    allowed: [replace(5, '    a1[订单创建]:::hot', '    a2(支付)'), drop(16)],
    verify: (editor) => { check(graph(editor).edges.length === 4, '应只删除第一条边') },
  }]
}

function case11(): Scenario[] {
  return [{
    sample: 5,
    edit: (editor) => retarget(editor, 'A', 'C', 'D'),
    allowed: [replace(2, '    A[方框] --> D', '    B(圆角) --> C((圆))')],
    verify: (editor) => { edge(editor, 'A', 'D'); edge(editor, 'B', 'C') },
  }, {
    sample: 5, name: '拒绝同一行重复边', allowed: [], expectedUndos: 0,
    edit: editor => {
      const before = editor.code, warnings: unknown[] = []
      editor.on('warning', messages => warnings.push(messages))
      const result = editor.dispatch({ type: 'retargetEdge', edgeId: edge(editor, 'A', 'C').entityId, end: 'source', nodeId: 'B' })!
      check(result.edits.length === 0 && result.warnings?.[0]?.key === 'toast.dupEdge', '没有拒绝重复边')
      check(warnings[0] === result.warnings && editor.code === before, 'warning 缺失或原文发生改动')
    },
  }]
}

function case12(): Scenario[] {
  return [{
    sample: 5,
    edit: (editor) => retarget(editor, 'B', 'C', 'D', 1),
    allowed: [replace(13, '    A --> B --> D')],
  }]
}

function case13(): Scenario[] {
  return [{
    sample: 5, name: '实体',
    edit: (editor) => { dispatch(editor, { type: 'renameNode', id: 'L', label: '保留 &quot;引号&quot; 和 #35;' }) },
    allowed: [replace(10, '    J --> L["保留 &quot;引号&quot; 和 #35;"]')],
  }, {
    sample: 5, name: '跨行 markdown',
    edit: (editor) => { dispatch(editor, { type: 'renameNode', id: 'M', label: '**新文字**\n    第二行' }) },
    allowed: [{ line: 11, remove: 2, add: ['    K --> M["`**新文字**', '    第二行`"]'] }],
  }, {
    sample: 5, name: '引号',
    edit: (editor) => { dispatch(editor, { type: 'renameNode', id: 'A', label: '含 "引号" 和 end' }) },
    allowed: [replace(2, '    A["含 #quot;引号#quot; 和 end"] & B(圆角) --> C((圆))')],
  }]
}

function case14(): Scenario[] {
  return [{
    sample: 6,
    edit: (editor) => retarget(editor, 'x1', 'x2', 'id_2'),
    allowed: [replace(5, '    x2', '    x1 e1@--> id_2')],
  }]
}

function case15(): Scenario[] {
  return [{
    sample: 6,
    edit: (editor) => retarget(editor, 'D1', 'E1', 'B1'),
    allowed: [replace(8, '    E1', '    C1 --> D1; D1 --> B1')],
  }]
}

function case16(): Scenario[] {
  return [
    ['end', 'end'], [']', ']'], ['"', '#quot;'], ['-->', '-->'],
  ].map(([label, encoded]) => ({
    sample: 6, name: label,
    edit: (editor) => { dispatch(editor, { type: 'addNode', id: '测试', label }) },
    allowed: [insert(10, `    测试["${encoded}"]`)],
  }))
}

function case17(): Scenario[] {
  return [{
    sample: 7, name: '改名',
    edit: (editor) => { dispatch(editor, { type: 'renameNode', id: 'R', label: '新' }) },
    allowed: [replace(3, '  Q --> R[新]')],
  }, {
    sample: 7, name: '加箭头',
    edit: (editor) => { dispatch(editor, { type: 'connect', source: 'P', target: 'R' }) },
    allowed: [insert(4, '  P --> R')],
  }, {
    sample: 7, name: '加节点',
    edit: (editor) => { dispatch(editor, { type: 'addNode', id: '新节点', label: '新增节点' }) },
    allowed: [insert(4, '  新节点[新增节点]')],
  }, {
    sample: 7, name: '删边',
    edit: (editor) => { editor.deleteEntities([edge(editor, 'Q', 'R').entityId]) },
    allowed: [replace(3, '  R')],
  }]
}

function case18(): Scenario[] {
  return ([['sequence', 8], ['gantt', 9]] as const).map(([type, sample]) => ({
    sample, name: type, allowed: [], expectedUndos: 0,
    edit: (editor) => {
      check(detectDiagramType(editor.code.split(/\r?\n/)[0])?.id === type, `图类型应为 ${type}`)
      check(editor.result.typeInfo?.id === type, '编辑器识别的图类型不一致')
    },
  }))
}

function case19(): Scenario[] {
  return [{
    sample: 10, expectedUndos: 20, maxMs: 2000,
    edit: (editor) => {
      check(graph(editor).nodes.length >= 200, '大图样例没有被完整解析')
      for (let i = 1; i <= 20; i++) {
        dispatch(editor, { type: 'setEdgeLabel', edgeId: edge(editor, 'n1', 'n2').entityId, label: `步骤${i}` })
      }
    },
    allowed: [replace(2, '    n1[节点1] -->|步骤20| n2')],
  }]
}

function case20(): Scenario[] {
  return [{
    sample: 1, expectedUndos: 2,
    edit: (editor) => {
      dispatch(editor, { type: 'addNode', id: '新节点', label: '新增节点' })
      dispatch(editor, { type: 'connect', source: '开始', target: '新节点' })
    },
    allowed: [insert(7, '    新节点[新增节点]', '    开始 --> 新节点')],
    verify: (editor) => { check(graph(editor).nodes.length === 6 && graph(editor).edges.length === 6, '新增节点或边丢失') },
  }]
}

function case21(): Scenario[] { return [decisionScenario()] }

function groupScenario(source: 'A' | 'B' = 'A'): Scenario {
  return {
    sample: 11,
    edit: (editor) => retarget(editor, source, 'C', 'F'),
    // 10/19 最新规则：按原边序拆行，22 和 22b 分别覆盖第 0、1 条边。
    allowed: 3,
    verify: (editor) => {
      expectEdges(editor, [source === 'A' ? 'A→F' : 'A→C', source === 'B' ? 'B→F' : 'B→C', 'C→D', 'D→E', 'E→F'])
      check(['A', 'B'].every((id) => graph(editor).nodeById.get(id)?.shape === 'rect') &&
        graph(editor).nodeById.get('A')?.label === '甲' && graph(editor).nodeById.get('B')?.label === '乙', 'A、B 的形状或文字丢失')
    },
  }
}

function chainScenario(): Scenario {
  return {
    sample: 11,
    edit: (editor) => retarget(editor, 'C', 'D', 'F'),
    allowed: [replace(4, '    C --> F', '    D(丁) --> E[(戊)]')],
    verify: (editor) => { expectEdges(editor, ['A→C', 'B→C', 'C→F', 'D→E', 'E→F']) },
  }
}

function deleteGroupedScenario(source: 'A' | 'B'): Scenario {
  const deletingA = source === 'A'
  return {
    sample: 11,
    edit: (editor) => { editor.deleteEntities([edge(editor, source, 'C').entityId]) },
    allowed: [
      replace(3, deletingA ? '    B[乙] --> C{判断}' : '    A[甲] --> C{判断}', deletingA ? '    A[甲]' : '    B[乙]'),
      ...(deletingA ? [drop(6)] : []),
      replace(7, deletingA ? '    linkStyle 0,2 stroke:green' : '    linkStyle 2 stroke:green'),
      replace(8, '    linkStyle 3 stroke:blue,stroke-width:3px'),
    ],
    verify: (editor) => { expectEdges(editor, [deletingA ? 'B→C' : 'A→C', 'C→D', 'D→E', 'E→F']) },
  }
}

function connectScenario(append = false): Scenario {
  return {
    sample: 11, name: append ? '末尾新增' : '中间新增',
    edit: (editor) => { dispatch(editor, { type: 'connect', source: append ? 'E' : 'C', target: append ? 'F' : 'D', line: append ? 'solid' : 'dotted' }) },
    allowed: append ? [insert(6, '    E --> F')] : [
      insert(5, '    C -.-> D'), replace(8, '    linkStyle 5 stroke:blue,stroke-width:3px'),
    ],
    verify: (editor) => { expectEdges(editor, append
      ? ['A→C', 'B→C', 'C→D', 'D→E', 'E→F', 'E→F']
      : ['A→C', 'B→C', 'C→D', 'D→E', 'C→D', 'E→F']) },
  }
}

function case22(): Scenario[] { return [groupScenario()] }
function case22b(): Scenario[] { return [groupScenario('B')] }
function case23(): Scenario[] { return [chainScenario()] }
function case24(): Scenario[] { return [deleteGroupedScenario('B')] }
function case25(): Scenario[] { return [deleteGroupedScenario('A')] }
function case26(): Scenario[] { return [connectScenario(), connectScenario(true)] }
function case27(): Scenario[] {
  return [groupScenario(), groupScenario('B'), chainScenario(), deleteGroupedScenario('B'), deleteGroupedScenario('A'), connectScenario(), connectScenario(true)]
    .map((scenario, index) => ({ ...scenario, name: `用例${['22', '22b', '23', '24', '25', '26中间', '26末尾'][index]}`, expectedUndos: 1 }))
}

function case28(): Scenario[] {
  // allowed 限制改动范围，语义断言约束边序，同时验证样式后缀和 default
  // 在删边、拆行、改端点及插入边之后仍保持原始字节。
  const scenarios = [...case10(), groupScenario(), groupScenario('B'), chainScenario(),
    deleteGroupedScenario('B'), deleteGroupedScenario('A'), connectScenario(), connectScenario(true)]
  const originalDefault = readFileSync(join(samples, '04-styles-comments.mmd'), 'utf8')
    .split(/\r?\n/).find((line) => /^\s*linkStyle default\b/.test(line))!
  return [...scenarios.map((scenario, index) => ({
    ...scenario, name: `样式检查${index + 1}`,
    verify: (editor: MermaidWysiwygEditor) => {
      scenario.verify?.(editor)
      if (scenario.sample === 4) check(editor.code.split(/\r?\n/).includes(originalDefault), 'linkStyle default 原文发生改动')
      const suffixes = [...graph(editor).statements.values()].flat()
        .filter((stmt) => stmt.kind === 'linkStyle')
        .map((stmt) => editor.code.slice(stmt.span.start, stmt.span.end).replace(/^linkStyle\s+(?:default|\d+(?:\s*,\s*\d+)*)/, ''))
      const original = readFileSync(join(samples, scenario.sample === 4 ? '04-styles-comments.mmd' : '11-linkstyle-split.mmd'), 'utf8')
      check(suffixes.every((suffix) => original.includes(suffix)), 'linkStyle 的样式部分发生改动')
    },
  })), {
    sample: 4, name: '删节点只提示', allowed: [drop(7)],
    edit: (editor: MermaidWysiwygEditor) => {
      const warnings: unknown[] = []
      editor.on('warning', (messages) => warnings.push(messages))
      const result = dispatch(editor, { type: 'deleteNode', id: 'a4' })
      check(result.warnings?.length === 2 && warnings[0] === result.warnings, 'class/click 的中文提示或 warning 事件缺失')
      check(result.warnings.every((warning) => warning.key === 'toast.nodeHasStyle' && warning.params?.name === 'a4'), '提示内容不正确')
    },
  }]
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function runScenario(number: string, scenario: Scenario, index: number): number | undefined {
  const prefix = String(scenario.sample).padStart(2, '0') + '-'
  const filename = readdirSync(samples).find((name) => name.startsWith(prefix) && name.endsWith('.mmd'))
  check(filename, `找不到样例 ${prefix}`)
  const source = join(samples, filename)
  const original = readFileSync(source)
  const before = original.toString('utf8')
  const stem = `c${number}${getLocale() === 'en' ? '-en' : ''}${index === 0 ? '' : `-${index + 1}`}`
  const target = join(output, `${stem}.mmd`)
  const log = join(output, `${stem}.check.txt`)
  const started = performance.now()
  const editor = new MermaidWysiwygEditor({ code: before })
  const errors: string[] = []
  let forwardMs = 0
  let totalMs = 0
  let checkerOutput = ''
  const verify = (label: string, action: () => void) => {
    try { action() } catch (error) { errors.push(`${label}：${message(error)}`) }
  }
  try {
    try { scenario.edit(editor) } catch (error) {
      errors.push(`操作：${message(error)}`)
    }
    forwardMs = performance.now() - started
    writeFileSync(target, editor.code, 'utf8')
    // 校验进程、文件 I/O 和 LCS 不计入第 19 条的核心编辑/撤销耗时。
    const result = spawnSync(process.execPath, [join(root, 'testdata', 'check.mjs'), source, target], {
      cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    })
    checkerOutput = result.stdout + result.stderr
    verify('Mermaid 校验', () => {
      check(!result.error, `无法运行校验器：${result.error?.message}`)
      const detail = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 4).join(' ')
      check(result.status === 0, detail || `校验器异常退出（${result.status ?? result.signal}）`)
    })
    if (number === '06') {
      const membership = spawnSync(process.execPath, [join(root, 'tools', 'cases', 'check-subgraphs.mjs'), source, target], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
      })
      checkerOutput += membership.stdout + membership.stderr
      verify('Mermaid 子图归属', () => {
        check(!membership.error && membership.status === 0, membership.stderr || `子图检查异常退出：${membership.error ?? membership.status}`)
      })
    }
    verify('允许改动', () => typeof scenario.allowed === 'number'
      ? assertOnlyReplacesLine(before, editor.code, scenario.allowed)
      : assertAllowedChanges(before, editor.code, scenario.allowed))
    if (scenario.verify) verify('结果', () => scenario.verify!(editor))
    writeFileSync(join(output, `${stem}.diff.json`), JSON.stringify(lineDiff(before, editor.code), null, 2) + '\n')
  } finally {
    const undoStarted = performance.now()
    let undos = 0
    try {
      while (editor.canUndo) {
        check(editor.undo(), '撤销栈非空但 undo 返回失败')
        undos++
      }
    } catch (error) { errors.push(`撤销：${message(error)}`) }
    totalMs = forwardMs + performance.now() - undoStarted
    verify('撤销字节', () => { check(Buffer.from(editor.code, 'utf8').equals(original), '撤销到底后与原文件字节不一致') })
    if (scenario.expectedUndos !== undefined) {
      verify('撤销次数', () => { check(undos === scenario.expectedUndos, `预期 ${scenario.expectedUndos} 次，实际 ${undos} 次`) })
    }
    if (scenario.maxMs !== undefined) {
      verify('性能', () => { check(totalMs < scenario.maxMs!, `核心编辑和撤销耗时 ${totalMs.toFixed(1)} ms，要求 < ${scenario.maxMs} ms`) })
    }
    writeFileSync(log, `${checkerOutput}\n撤销 ${undos} 次，核心编辑和撤销耗时 ${totalMs.toFixed(1)} ms\n${errors.join('\n')}\n`, 'utf8')
    if (errors.length) throw new Error(`${errors.join('；')}（详见 ${relative(root, log)}）`)
  }
  return scenario.maxMs === undefined ? undefined : totalMs
}

const cases: [string, () => Scenario[]][] = [case01, case02, case03, case04, case05, case06, case07, case08, case09,
  case10, case11, case12, case13, case14, case15, case16, case17, case18, case19,
  case20, case21, case22, case23, case24, case25, case26, case27, case28]
  .map((run, index) => [String(index + 1).padStart(2, '0'), run])
cases.splice(22, 0, ['22b', case22b])
let passed = 0
let failed = 0
const report: string[] = []
const print = (text: string) => { console.log(text); report.push(text) }
for (const [number, makeScenarios] of cases) {
  const failures: string[] = []
  const times: number[] = []
  try {
    const scenarios = makeScenarios()
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      for (const [variant, scenario] of scenarios.entries()) {
        try {
          const elapsed = runScenario(number, scenario, variant)
          if (elapsed !== undefined) times.push(elapsed)
        } catch (error) {
          const reason = `${scenario.name ? `${scenario.name}：` : ''}${message(error)}`
          failures.push(reason)
        }
      }
    }
    if (failures.length) throw new Error(failures.join('；'))
    passed++
    const note = number === '06' ? '跨子图边位于最外层 end 后；Mermaid 原生子图归属检查通过'
      : number === '18' ? '核心类型及原文检查，渲染和界面只读待界面验收'
      : number === '19' ? `核心编辑 20 次并撤销 20 次，共 ${times[0].toFixed(1)} ms；拖动待界面验收` : ''
    print(`用例 ${number}：通过${note ? `（${note}）` : ''}`)
  } catch (error) {
    failed++
    const reason = message(error).replace(/\s+/g, ' ')
    print(`用例 ${number}：失败（${reason.length > 360 ? reason.slice(0, 360) + '…；详见 out/cases/c' + number + '*.check.txt' : reason}）`)
  }
}
const languageChecks: [string, string, () => void | Promise<void>][] = [
  ['29', '默认中文；语言按钮位置待界面验收', () => {
    check(messages['zh-CN']['tb.open'] === '打开', '缺少默认中文')
    setLocale('zh-CN'); check(getLocale() === 'zh-CN', '中文选择失败')
  }],
  ['30', '英文语言包无中文；菜单 DOM 扫描由 dom vitest 覆盖，完整点击待界面验收', () => {
    check(Object.values(messages.en).every(text => !/[\u3400-\u9fff]/u.test(text)), '英文语言包含中文')
  }],
  ['31', '切换前后中文样例代码字节一致', () => {
    const bytes = readFileSync(join(samples, '01-chinese-basic.mmd'))
    const editor = new MermaidWysiwygEditor({ code: bytes.toString('utf8') })
    for (const locale of ['en', 'zh-CN'] as const) {
      setLocale(locale)
      check(Buffer.from(editor.code).equals(bytes) && !editor.canUndo, '语言切换改变了原文或历史')
    }
  }],
  ['32', '重新加载模块读取已存语言；真实浏览器重启待界面验收', async () => {
    const data = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } })
    try {
      for (const locale of ['en', 'zh-CN'] as const) {
        setLocale(locale)
        check(data.get('mermaid-editor.locale') === locale, '语言设置未保存')
        const reloaded = await import(new URL(`../../packages/dom/src/i18n/index.ts?locale=${locale}`, import.meta.url).href)
        check(reloaded.getLocale() === locale, '重新加载后语言错误')
      }
    } finally { Reflect.deleteProperty(globalThis, 'localStorage') }
  }],
  ['33', 'key 集合和非空值检查；界面源码扫描通过', () => {
    check(JSON.stringify(listKeys()) === JSON.stringify(Object.keys(messages['zh-CN']).sort()), '中英 key 不一致')
    check(Object.values(messages).every(bundle => Object.values(bundle).every(text => text.trim())), '语言包有空值')
    for (const dir of ['packages/dom/src', 'apps/playground/src']) {
      for (const file of readdirSync(join(root, dir), { recursive: true }).map(String).filter(file => /\.(ts|tsx)$/.test(file) && !file.startsWith('i18n') && file !== 'defaultExample.ts')) {
        check(!/[\u3400-\u9fff]/u.test(readFileSync(join(root, dir, file), 'utf8')), `界面源码含硬编码中文：${dir}/${file}`)
      }
    }
  }],
  ['34', '1–28（含 22b）已分别在中英文执行；长英文菜单尺寸、拖动流畅度待界面验收', () => {
    check(failed === 0, '前面的中英编辑用例失败')
  }],
]
for (const [number, note, run] of languageChecks) {
  try { await run(); passed++; print(`用例 ${number}：通过（${note}）`) }
  catch (error) { failed++; print(`用例 ${number}：失败（${message(error)}）`) }
}
function memoryDrafts() {
  const data = new Map<string, string>()
  const storage: DraftStorage = {
    get length() { return data.size }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
  return { data, storage, drafts: new DraftStore(storage) }
}

const draftFile = { name: '订单.mmd', path: 'D:/订单/订单.mmd', code: 'flowchart LR\r\n\tA --> B  \r\n' }
const draftChecks: [string, string, () => void | Promise<void>][] = [
  ['35', '最近草稿字节恢复、恢复文案及保存清理通过；浏览器提示由 dom vitest 覆盖', async () => {
    const { drafts, storage } = memoryDrafts()
    check(drafts.resume() === null, '无草稿时不应恢复')
    const session = await drafts.open(draftFile)
    session.edit(draftFile.code.replace('B', 'C'))
    const resumed = new DraftStore(storage).resume()
    check(resumed?.code === session.code && resumed.name === draftFile.name, '未恢复最近草稿原始字节')
    check(messages[getLocale()]['draft.restored'] === (getLocale() === 'en' ? 'Restored your unsaved edits' : '已恢复上次未保存的编辑'), '恢复提示文案错误')
    await resumed.saved(resumed.code)
    check(new DraftStore(storage).resume() === null, '保存成功后仍有草稿')
  }],
  ['36', '桌面接口：打开保留文件内容，提示不操作、恢复、丢弃分别通过；预览打开不接提示栏', async () => {
    const { data, drafts } = memoryDrafts()
    const initial = await drafts.open(draftFile); initial.edit('flowchart LR\r\n\tA --> C  \r\n')
    const before = JSON.stringify([...data])
    const opened = await drafts.open(draftFile)
    check(opened.code === draftFile.code && opened.prompt?.key === 'draft.found', '打开未保留文件或缺少提示')
    check(opened.prompt.restore === 'draft.restore' && opened.prompt.discard === 'draft.discard', '缺少恢复/丢弃动作')
    opened.edit(draftFile.code)
    check(JSON.stringify([...data]) === before && opened.code === draftFile.code, '未操作提示却改变了文件或草稿')
    check(opened.restore() === initial.code && !opened.prompt, '恢复操作错误')
    const discard = await drafts.open(draftFile); discard.discard()
    check(discard.code === draftFile.code && !discard.prompt && !drafts.resume(), '丢弃操作错误')
  }],
  ['37', '桌面接口：同路径 SHA-256 不符提示外部修改，不自动覆盖', async () => {
    const { data, drafts } = memoryDrafts()
    const session = await drafts.open(draftFile); session.edit('flowchart LR\n A --> C')
    check(data.has(draftKey(draftFile.path, await hashContent(draftFile.code))), '草稿键缺少路径与 SHA-256')
    const file = { ...draftFile, code: draftFile.code.replaceAll('\r\n', '\n') }
    const opened = await drafts.open(file)
    check(opened.prompt?.changedOutside && opened.code === file.code, '哈希不符未提示或覆盖了文件')
    opened.restore()
    check(data.size === 1 && data.has(draftKey(file.path, await hashContent(file.code))), '恢复后草稿未使用新打开内容的哈希')
  }],
  ['38', '桌面接口：同名不同路径草稿隔离，中英文五个 key 及非空值一致', async () => {
    const { drafts } = memoryDrafts()
    const first = await drafts.open(draftFile); first.edit('flowchart LR\n A --> C')
    const other = { ...draftFile, path: 'D:/其他/订单.mmd' }
    const second = await drafts.open(other)
    check(!second.prompt && second.code === other.code, '不同路径误用草稿')
    second.edit('flowchart LR\n X --> Y')
    check((await drafts.open(draftFile)).restore() === first.code, '第一个路径草稿串用')
    check((await drafts.open(other)).restore() === second.code, '第二个路径草稿串用')
    for (const key of ['draft.found', 'draft.restore', 'draft.discard', 'draft.restored', 'draft.changedOutside']) {
      check(listKeys().includes(key) && messages[getLocale()][key as keyof typeof messages.en].trim(), `缺少草稿文案 ${key}`)
    }
  }],
  ['39', '新增连线全图查重，含子图、& 展开；代码与历史不变并发出 toast.dupEdge', () => {
    for (const token of ['-->', '-.->', '==>', '--o', '--x', '---', '~~~']) {
      const code = `flowchart LR\r\n\tsubgraph group\r\n\t\tA & C ${token} B & D  %% 保留\r\n\tend\r\n`
      const editor = new MermaidWysiwygEditor({ code })
      const existing = edge(editor, 'C', 'D')
      const notices: unknown[] = []
      editor.on('warning', notice => notices.push(notice))
      const result = editor.dispatch({ type: 'connect', source: 'C', target: 'D', line: existing.seg.line, arrowEnd: existing.seg.arrowEnd })
      check(result?.edits.length === 0 && result.warnings?.[0]?.key === 'toast.dupEdge' && notices.length === 1, '没有拦下重复边或未提示')
      check(editor.code === code && !editor.canUndo, '拒绝重复边改变了代码或历史')
    }
  }],
  ['40', '跨行改起点/终点全图查重，代码与撤销/重做记录不变并提示', () => {
    for (const end of ['source', 'target'] as const) {
      const code = end === 'target' ? 'flowchart LR\r\n\tA --> B  \r\n\tA --> C\r\n' : 'flowchart LR\r\n\tA --> B  \r\n\tC --> B\r\n'
      const editor = new MermaidWysiwygEditor({ code })
      dispatch(editor, { type: 'addNode' }); editor.undo()
      const notices: unknown[] = []
      editor.on('warning', notice => notices.push(notice))
      const result = editor.dispatch({ type: 'retargetEdge', edgeId: graph(editor).edges[1].entityId, end, nodeId: end === 'target' ? 'B' : 'A' })
      check(result?.edits.length === 0 && result.warnings?.[0]?.key === 'toast.dupEdge' && notices.length === 1, '跨行重复边未拒绝或无提示')
      check(editor.code === code && !editor.canUndo && editor.canRedo, '拒绝重复边改变了字节或历史')
    }
  }],
]
for (const [number, note, run] of draftChecks) {
  try {
    check(expectedCaseNumbers.has(number), `最新 CASES.md 缺少用例 ${number}`)
    for (const locale of ['zh-CN', 'en'] as const) { setLocale(locale); await run() }
    passed++; print(`用例 ${number}：通过（${note}）`)
  } catch (error) { failed++; print(`用例 ${number}：失败（${message(error)}）`) }
}
const dom = new JSDOM('<!doctype html><body></body>')
try {
  for (const [number, note, run] of createDomCases(join(root, 'packages/core/test/fixtures'))) {
    try {
      check(expectedCaseNumbers.has(number), `最新 CASES.md 缺少用例 ${number}`)
      for (const locale of ['zh-CN', 'en'] as const) { setLocale(locale); run(dom.window.document) }
      passed++; print(`用例 ${number}：通过（${note}；高亮线、菜单及实际拖动观感：界面验）`)
    } catch (error) { failed++; print(`用例 ${number}：失败（${message(error)}）`) }
  }
} finally { dom.window.close() }
print(`合计：通过 ${passed}，失败 ${failed}；退出码 ${failed}`)
writeFileSync(join(output, 'summary.txt'), report.join('\n') + '\n', 'utf8')
process.exitCode = failed
