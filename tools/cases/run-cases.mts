import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  MermaidWysiwygEditor, detectDiagramType,
  type EditorOp, type FlowEdge, type OpResult,
} from '../../packages/core/src/index.ts'
import { assertAllowedChanges, lineDiff, type AllowedChange } from './line-diff.mts'

// 仅写入仓库根目录的 out/cases；testdata 中的样例、规则和校验器始终只读。
const root = fileURLToPath(new URL('../../', import.meta.url))
const samples = join(root, 'testdata', 'samples')
const output = join(root, 'out', 'cases')
mkdirSync(output, { recursive: true })

class PendingCase extends Error {}

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

type RetargetOp = { type: 'retargetEdge'; edgeId: string; end: 'source' | 'target'; nodeId: string }
let hasRetarget: boolean | undefined

function requireRetarget(): void {
  if (hasRetarget === undefined) {
    const editor = new MermaidWysiwygEditor({ code: 'flowchart LR\n  A --> B\n  C\n' })
    const op: RetargetOp = { type: 'retargetEdge', edgeId: edge(editor, 'A', 'B').entityId, end: 'target', nodeId: 'C' }
    // 当前联合类型还没有这个操作；只在运行器边界传入未来操作。
    // 未知 switch 分支返回 undefined；已实现但错误地返回 null 必须报失败。
    const result: OpResult | null | undefined = editor.dispatch(op as unknown as EditorOp)
    hasRetarget = result !== undefined
    if (hasRetarget) {
      check(result?.edits.length, 'retargetEdge 已被识别，但有效端点变更没有生成文本改动')
      edge(editor, 'A', 'C')
    }
  }
  if (!hasRetarget) throw new PendingCase('尚未实现 retargetEdge（第 5 步）')
}

function retarget(editor: MermaidWysiwygEditor, source: string, target: string, nodeId: string, occurrence = 0) {
  requireRetarget()
  const op: RetargetOp = {
    type: 'retargetEdge', edgeId: edge(editor, source, target, occurrence).entityId, end: 'target', nodeId,
  }
  dispatch(editor, op as unknown as EditorOp)
}

interface Scenario {
  sample: number
  name?: string
  edit: (editor: MermaidWysiwygEditor) => void
  allowed: AllowedChange[]
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
    allowed: [replace(line, content)],
  }))
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
    allowed: [insert(13, '        DB --> UI')],
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
    allowed: [replace(5, '    x1 e1@--> id_2')],
  }]
}

function case15(): Scenario[] {
  return [{
    sample: 6,
    edit: (editor) => retarget(editor, 'D1', 'E1', 'B1'),
    allowed: [replace(8, '    C1 --> D1; D1 --> B1')],
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

function groupScenario(): Scenario {
  return {
    sample: 11,
    edit: (editor) => retarget(editor, 'A', 'C', 'F'),
    // CODEX_TASKS 第 5 步的后定规则覆盖 CASES 22：拆出的边放在原行上方。
    allowed: [replace(3, '    A[甲] --> F', '    B[乙] --> C{判断}')],
    verify: (editor) => { expectEdges(editor, ['A→F', 'B→C', 'C→D', 'D→E', 'E→F']) },
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
    edit: (editor) => { dispatch(editor, { type: 'connect', source: append ? 'E' : 'C', target: append ? 'F' : 'D' }) },
    allowed: append ? [insert(6, '    E --> F')] : [
      insert(5, '    C --> D'), replace(8, '    linkStyle 5 stroke:blue,stroke-width:3px'),
    ],
    verify: (editor) => { expectEdges(editor, append
      ? ['A→C', 'B→C', 'C→D', 'D→E', 'E→F', 'E→F']
      : ['A→C', 'B→C', 'C→D', 'D→E', 'C→D', 'E→F']) },
  }
}

function case22(): Scenario[] { return [groupScenario()] }
function case23(): Scenario[] { return [chainScenario()] }
function case24(): Scenario[] { return [deleteGroupedScenario('B')] }
function case25(): Scenario[] { return [deleteGroupedScenario('A')] }
function case26(): Scenario[] { return [connectScenario(), connectScenario(true)] }
function case27(): Scenario[] {
  requireRetarget()
  return [groupScenario(), chainScenario(), deleteGroupedScenario('B'), deleteGroupedScenario('A'), connectScenario()]
    .map((scenario, index) => ({ ...scenario, name: `用例${22 + index}`, expectedUndos: 1 }))
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function runScenario(id: number, scenario: Scenario, index: number): number | undefined {
  const number = String(id).padStart(2, '0')
  const prefix = String(scenario.sample).padStart(2, '0') + '-'
  const filename = readdirSync(samples).find((name) => name.startsWith(prefix) && name.endsWith('.mmd'))
  check(filename, `找不到样例 ${prefix}`)
  const source = join(samples, filename)
  const original = readFileSync(source)
  const before = original.toString('utf8')
  const stem = `c${number}${index === 0 ? '' : `-${index + 1}`}`
  const target = join(output, `${stem}.mmd`)
  const log = join(output, `${stem}.check.txt`)
  const started = performance.now()
  const editor = new MermaidWysiwygEditor({ code: before })
  const errors: string[] = []
  let forwardMs = 0
  let totalMs = 0
  let checkerOutput = ''
  let pending = false
  const verify = (label: string, action: () => void) => {
    try { action() } catch (error) { errors.push(`${label}：${message(error)}`) }
  }
  try {
    try { scenario.edit(editor) } catch (error) {
      if (error instanceof PendingCase) { pending = true; throw error }
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
    verify('允许改动', () => assertAllowedChanges(before, editor.code, scenario.allowed))
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
    if (!pending && scenario.expectedUndos !== undefined) {
      verify('撤销次数', () => { check(undos === scenario.expectedUndos, `预期 ${scenario.expectedUndos} 次，实际 ${undos} 次`) })
    }
    if (!pending && scenario.maxMs !== undefined) {
      verify('性能', () => { check(totalMs < scenario.maxMs!, `核心编辑和撤销耗时 ${totalMs.toFixed(1)} ms，要求 < ${scenario.maxMs} ms`) })
    }
    writeFileSync(log, `${checkerOutput}\n撤销 ${undos} 次，核心编辑和撤销耗时 ${totalMs.toFixed(1)} ms\n${errors.join('\n')}\n`, 'utf8')
    // 即使用例待实现，任何已经发生的改动也必须能被准确撤销。
    if (errors.length) throw new Error(`${errors.join('；')}（详见 ${relative(root, log)}）`)
  }
  return scenario.maxMs === undefined ? undefined : totalMs
}

const cases = [case01, case02, case03, case04, case05, case06, case07, case08, case09,
  case10, case11, case12, case13, case14, case15, case16, case17, case18, case19,
  case20, case21, case22, case23, case24, case25, case26, case27]
let passed = 0
let failed = 0
let pending = 0
const report: string[] = []
const print = (text: string) => { console.log(text); report.push(text) }
for (const [index, makeScenarios] of cases.entries()) {
  const id = index + 1
  const number = String(id).padStart(2, '0')
  const failures: string[] = []
  const unavailable: string[] = []
  const times: number[] = []
  try {
    const scenarios = makeScenarios()
    for (const [variant, scenario] of scenarios.entries()) {
      try {
        const elapsed = runScenario(id, scenario, variant)
        if (elapsed !== undefined) times.push(elapsed)
      } catch (error) {
        const reason = `${scenario.name ? `${scenario.name}：` : ''}${message(error)}`
        if (error instanceof PendingCase) unavailable.push(reason)
        else failures.push(reason)
      }
    }
    if (failures.length) throw new Error(failures.join('；'))
    if (unavailable.length) throw new PendingCase(unavailable[0])
    passed++
    const note = id === 6 ? '核心检查通过，UI 的渲染子图归属仍需界面验收'
      : id === 8 ? 'class/style/click 的提示规则在第 5 步补验'
      : id === 18 ? '核心类型及原文检查，渲染和界面只读待界面验收'
      : id === 19 ? `核心编辑 20 次并撤销 20 次，共 ${times[0].toFixed(1)} ms；拖动待界面验收` : ''
    print(`用例 ${number}：通过${note ? `（${note}）` : ''}`)
  } catch (error) {
    if (error instanceof PendingCase) {
      pending++
      print(`用例 ${number}：待实现（${message(error)}）`)
    } else {
      failed++
      const reason = message(error).replace(/\s+/g, ' ')
      print(`用例 ${number}：失败（${reason.length > 360 ? reason.slice(0, 360) + '…；详见 out/cases/c' + number + '*.check.txt' : reason}）`)
    }
  }
}
print(`合计：通过 ${passed}，失败 ${failed}，待实现 ${pending}；退出码 ${failed}`)
writeFileSync(join(output, 'summary.txt'), report.join('\n') + '\n', 'utf8')
process.exitCode = failed
