import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, type EditorOp } from '../src'

const sample = (name: string) => readFileSync(new URL(`../../../testdata/samples/${name}.mmd`, import.meta.url), 'utf8')
const pairs = (editor: MermaidWysiwygEditor) => editor.result.flowchart!.edges.map((edge) => `${edge.source}→${edge.target}`)

function retarget(editor: MermaidWysiwygEditor, source: string, target: string, nodeId: string, end: 'source' | 'target' = 'target', occurrence = 0) {
  const edge = editor.result.flowchart!.edges.filter((item) => item.source === source && item.target === target)[occurrence]
  return editor.dispatch({ type: 'retargetEdge', edgeId: edge.entityId, end, nodeId })!
}

function history(editor: MermaidWysiwygEditor, before: string, after: string) {
  expect(editor.code).toBe(after)
  expect(editor.undo()).toBe(true)
  expect(Buffer.from(editor.code)).toEqual(Buffer.from(before))
  expect(editor.redo()).toBe(true)
  expect(Buffer.from(editor.code)).toEqual(Buffer.from(after))
}

describe('改边端点', () => {
  it('用例 1、21：在上方保留原节点定义，新端点不继承菱形和文字', () => {
    const code = sample('01-chinese-basic')
    const editor = new MermaidWysiwygEditor({ code })
    editor.setSelection(['edge:输入->校验#0'])
    const result = retarget(editor, '输入', '校验', '首页')
    const at = code.indexOf('    输入 -->')
    const start = code.indexOf('校验{')
    expect(result.edits).toEqual([
      { start: at, end: at, text: '    校验{校验通过？}\n' },
      { start, end: start + '校验{校验通过？}'.length, text: '首页' },
    ])
    expect(result.created).toEqual(['edge:输入->首页#0'])
    expect(editor.selection).toEqual(result.created)
    expect(editor.result.flowchart!.nodeById.get('校验')).toMatchObject({ shape: 'diamond', label: '校验通过？' })
    history(editor, code, code.replace('    输入 --> 校验{校验通过？}', '    校验{校验通过？}\n    输入 --> 首页'))
    expect(editor.selection).toEqual(result.created)
    editor.undo()
    expect(editor.selection).toEqual(['edge:输入->校验#0'])
  })

  it.each([
    ['D', '-.->'], ['F', '==>'], ['H', '--o'], ['J', '<-->'], ['O', '~~~'],
  ])('用例 4：改到 B 时保留 %s 的箭头 %s', (target, arrow) => {
    const code = sample('02-arrows')
    const editor = new MermaidWysiwygEditor({ code })
    const result = retarget(editor, 'A', target, 'B')
    expect(result.edits).toHaveLength(1)
    history(editor, code, code.replace(`A ${arrow} ${target}`, `A ${arrow} B`))
  })

  it.each(['A', 'B'])('用例 22、22b：只改 %s→C，边序和所有样式不变', (source) => {
    const code = sample('11-linkstyle-split')
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, source, 'C', 'F')
    expect(pairs(editor)).toEqual([source === 'A' ? 'A→F' : 'A→C', source === 'B' ? 'B→F' : 'B→C', 'C→D', 'D→E', 'E→F'])
    expect(editor.result.flowchart!.nodeById.get('A')?.label).toBe('甲')
    expect(editor.result.flowchart!.nodeById.get('B')?.label).toBe('乙')
    history(editor, code, code.replace('A[甲] & B[乙] --> C{判断}', source === 'A'
      ? 'A[甲] --> F\n    B[乙] --> C{判断}' : 'A[甲] --> C{判断}\n    B[乙] --> F'))
  })

  it('用例 11：只拆出 A→C，B 的圆角和 C 的圆形不变', () => {
    const code = sample('05-shapes-multi')
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'A', 'C', 'D')
    history(editor, code, code.replace('A[方框] & B(圆角) --> C((圆))', 'A[方框] --> D\n    B(圆角) --> C((圆))'))
  })

  it('用例 12：末段只替换目标 ID，不拆链', () => {
    const code = sample('05-shapes-multi')
    const editor = new MermaidWysiwygEditor({ code })
    const result = retarget(editor, 'B', 'C', 'D', 'target', 1)
    const start = code.lastIndexOf('C')
    expect(result.edits).toEqual([{ start, end: start + 1, text: 'D' }])
    history(editor, code, code.replace('A --> B --> C', 'A --> B --> D'))
  })

  it('用例 23：首段拆在上方，D 的定义仍用于 D→E', () => {
    const code = sample('11-linkstyle-split')
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'C', 'D', 'F')
    expect(pairs(editor)).toEqual(['A→C', 'B→C', 'C→F', 'D→E', 'E→F'])
    history(editor, code, code.replace('C --> D(丁) --> E[(戊)]', 'C --> F\n    D(丁) --> E[(戊)]'))
  })

  it('用例 14：边 id、文字、属性原样保留', () => {
    const code = sample('06-edge-cases')
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'x1', 'x2', 'id_2')
    expect(editor.result.flowchart!.edges.find((edge) => edge.source === 'x1')?.seg.edgeId).toBe('e1')
    history(editor, code, code.replace('x1 e1@--> x2', 'x1 e1@--> id_2'))
  })

  it('用例 15：分号前后的语句、注释和空白不动', () => {
    const code = sample('06-edge-cases')
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'D1', 'E1', 'B1')
    history(editor, code, code.replace('C1 --> D1; D1 --> E1', 'C1 --> D1; D1 --> B1'))
  })

  it.each(['source', 'target'] as const)('CRLF 下把 %s 的完整定义（含属性、class）搬到上方', (end) => {
    const ref = '旧{旧文字}@{ label: "旧" }:::hot'
    const chain = end === 'source' ? `${ref}\te1@-. 文字 .->  B` : `B\te1@-. 文字 .->  ${ref}`
    const code = `%% 注释  \r\nflowchart LR\r\n\t${chain}; X;  %% 保留\r\n\t新[新文字]\r\n\te1@{ animate: true }\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, end === 'source' ? '旧' : 'B', end === 'target' ? '旧' : 'B', '新', end)
    expect(editor.result.flowchart!.nodeById.get('新')).toMatchObject({ shape: 'rect', label: '新文字', classes: [] })
    expect(editor.result.flowchart!.nodeById.get('旧')?.classes).toContain('hot')
    history(editor, code, code.replace(`\t${chain}`, `\t${ref}\r\n\t${chain.replace(ref, '新')}`))
  })

  it('别处有形状定义时不新增声明，也不把旧形状套给新端点', () => {
    const code = 'flowchart LR\n  A --> B{旧}\n  B{旧}\n  C[新]\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(retarget(editor, 'A', 'B', 'C').edits).toHaveLength(1)
    history(editor, code, code.replace('A --> B{旧}', 'A --> C'))
  })

  it('跨行 Markdown 定义完整移到上方，分号邻段和 CRLF 保持原样', () => {
    const ref = 'B["`第一行\r\n\t第二行`"]:::hot'
    const code = `flowchart LR\r\n\tX; A --> ${ref};  Y;  %% 注释\r\n\tC\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'A', 'B', 'C')
    expect(editor.result.flowchart!.nodeById.get('B')?.label).toBe('第一行\r\n\t第二行')
    history(editor, code, code.replace(`\tX; A --> ${ref}`, `\t${ref}\r\n\tX; A --> C`))
  })

  it.each(['B:::hot', 'B@{ shape: diamond, label: "旧" }'])('没有括号的定义也归旧节点：%s', (ref) => {
    const code = `flowchart LR\n  A --> ${ref}\n  C\n`
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'A', 'B', 'C')
    history(editor, code, code.replace(`  A --> ${ref}`, `  ${ref}\n  A --> C`))
  })

  it.each(['source', 'target'] as const)('改链中间边的 %s，前段仍排在新边之前', (end) => {
    const code = 'flowchart LR\n\tX --> Y; A --> B e1@<-->|文字| C --> D;  Z;  %% 注释\n\tF\n\te1@{ animate: true }\n\tlinkStyle 0,1,2,3 stroke:red,stroke-width:2px\n'
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'B', 'C', 'F', end)
    expect(pairs(editor)).toEqual(end === 'target' ? ['X→Y', 'A→B', 'B→F', 'C→D'] : ['X→Y', 'A→B', 'F→C', 'C→D'])
    history(editor, code, code.replace('A --> B e1@<-->|文字| C --> D', end === 'target'
      ? 'A --> B e1@<-->|文字| F\n\tC --> D' : 'A --> B\n\tF e1@<-->|文字| C --> D'))
  })

  it.each(['source', 'target'] as const)('双向 & 展开后改一个 %s，所有其他边序不变', (end) => {
    const code = 'flowchart LR\n  A & B e1@-.->|走| C & D\n  F\n  linkStyle 0,1,2,3 stroke:red\n'
    const editor = new MermaidWysiwygEditor({ code })
    retarget(editor, 'B', 'D', 'F', end)
    expect(pairs(editor)).toEqual(['A→C', 'A→D', 'B→C', end === 'source' ? 'F→D' : 'B→F'])
    history(editor, code, code.replace('A & B e1@-.->|走| C & D', 'A e1@-.->|走| C\n  A e1@-.->|走| D\n  B e1@-.->|走| C\n  ' + (end === 'source' ? 'F e1@-.->|走| D' : 'B e1@-.->|走| F')))
  })

  it('改成已有平行边时返回正确出现序号，样式随各条边保留', () => {
    const code = 'flowchart LR\n  A --> F\n  A & B --> C\n  A --> F\n  linkStyle 0,3 stroke:blue\n  linkStyle 1,2 stroke:green\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(retarget(editor, 'A', 'C', 'F').created).toEqual(['edge:A->F#1'])
    expect(editor.selection).toEqual(['edge:A->F#1'])
    history(editor, code, code.replace('A & B --> C', 'A --> F\n  B --> C'))
  })

  it.each([
    { edgeId: '不存在', nodeId: 'C' },
    { edgeId: 'edge:A->B#0', nodeId: '不存在' },
    { edgeId: 'edge:A->B#0', nodeId: 'B' },
  ])('无效或相同端点取消，原文和历史不变：%j', (op) => {
    const code = 'flowchart LR\r\n\tA --> B; C;  \r\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(editor.dispatch({ type: 'retargetEdge', end: 'target', ...op })).toBeNull()
    expect(editor.code).toBe(code)
    expect(editor.canUndo).toBe(false)
  })
})

describe('删除节点只提示相关样式和交互声明', () => {
  it('class/style/click 全部字节不变，提示带原文及一基行号，并发出 warning 事件', () => {
    const code = sample('04-styles-comments')
    const editor = new MermaidWysiwygEditor({ code })
    const warnings: string[][] = []
    editor.on('warning', (messages) => warnings.push(messages))
    const result = editor.dispatch({ type: 'deleteNode', id: 'a4' })!
    expect(result.warnings).toEqual([
      '「class a4,a5 cold」第 14 行还引用着已删除的节点 a4，请手动处理',
      '「click a4 "https://example.com" "发货说明"」第 18 行还引用着已删除的节点 a4，请手动处理',
    ])
    expect(warnings).toEqual([result.warnings])
    expect(editor.result.flowchart!.nodeById.has('a4')).toBe(false)
    history(editor, code, code.replace('    a3 -- yes --> a4[发货]\n', ''))
  })

  it('CRLF 下保留 style/class/click，不提示相似 ID、classDef 或无关声明', () => {
    const code = 'flowchart LR\r\n\tA --> B\r\n\tA\r\n\tclass B,A cold; style B fill:red; click B "https://example.com";  %% 注释\r\n\tclassDef B fill:blue\r\n\tstyle BB fill:red\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    const result = editor.dispatch({ type: 'deleteNode', id: 'B' })!
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings!.every((warning) => warning.includes('第 4 行'))).toBe(true)
    history(editor, code, code.replace('\tA --> B\r\n', ''))
  })

  it('用例 8：SVC 相关边照删，子图和 end、样式和交互声明保留', () => {
    const code = sample('03-subgraph') + '    class SVC hot\n    style SVC fill:red\n    click SVC "https://example.com"\n'
    const editor = new MermaidWysiwygEditor({ code })
    expect(editor.dispatch({ type: 'deleteNode', id: 'SVC' })!.warnings).toHaveLength(3)
    expect(editor.result.flowchart!.subgraphs).toHaveLength(3)
    expect(editor.result.flowchart!.nodeById.has('SVC')).toBe(false)
    history(editor, code, code.replace('API[API 网关] --> SVC[服务]', 'API[API 网关]').replace('        SVC --> DB\n', '').replace('        SVC -.-> Cache\n', ''))
  })
})

describe('跨子图新增边', () => {
  it('用例 6：DB→UI 放在最外层 end 后面', () => {
    const code = sample('03-subgraph')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'connect', source: 'DB', target: 'UI' })
    expect(editor.result.flowchart!.nodeById.get('UI')?.subgraph).toBe('前端')
    expect(editor.result.flowchart!.nodeById.get('DB')?.subgraph).toBe('存储')
    history(editor, code, code.replace('    Store -->', '    DB --> UI\n    Store -->'))
  })

  it.each([
    [{ type: 'connect', source: 'A', target: 'B' }, '  A --> B'],
    [{ type: 'connect', source: 'A', target: 'Z' }, '  A --> Z'],
    [{ type: 'connect', source: 'A', target: 'D' }, '  A --> D'],
  ] satisfies [EditorOp, string][])('跨不同深度、父子层级或顶层的边：%j', (op, text) => {
    const code = 'flowchart LR\r\n  Z\r\n  subgraph outer\r\n    D\r\n    subgraph inner\r\n      A\r\n    end\r\n    subgraph other\r\n      B\r\n    end\r\n  end\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch(op)
    history(editor, code, code + text + '\r\n')
  })

  it('同一子图内的边保留在该子图中', () => {
    const code = sample('03-subgraph')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'connect', source: 'DB', target: 'Cache' })
    history(editor, code, code.replace('        SVC -.-> Cache', '        SVC -.-> Cache\n        DB --> Cache'))
  })
})
