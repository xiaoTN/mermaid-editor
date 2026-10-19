import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse } from '../src/index'

const sample = (name: string) => readFileSync(new URL(`../../../testdata/samples/${name}`, import.meta.url), 'utf8')
const chinese = sample('01-chinese-basic.mmd')

describe('中文 ID 与最小文本改动', () => {
  it('从真实样例解析出五个中文节点和五条边', () => {
    const graph = parse(chinese).flowchart!
    expect(graph.nodes.map((node) => node.id)).toEqual(['开始', '输入', '校验', '首页', '报错'])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['开始', '输入'], ['输入', '校验'], ['校验', '首页'], ['校验', '报错'], ['报错', '输入'],
    ])
    expect(graph.nodeById.get('校验')?.shape).toBe('diamond')
  })

  it('改名只替换第三行的文字，保留菱形括号并可按字节撤销', () => {
    const editor = new MermaidWysiwygEditor({ code: chinese })
    const label = '校验通过？'
    const start = chinese.indexOf(label)
    const result = editor.dispatch({ type: 'renameNode', id: '校验', label: '校验通过了吗？' })
    expect(result?.edits).toEqual([{ start, end: start + label.length, text: '校验通过了吗？' }])
    const lines = chinese.split('\n')
    lines[2] = '    输入 --> 校验{校验通过了吗？}'
    expect(editor.code).toBe(lines.join('\n'))
    expect(editor.result.flowchart?.nodeById.get('校验')?.shape).toBe('diamond')
    expect(editor.undo()).toBe(true)
    expect(Buffer.from(editor.code)).toEqual(Buffer.from(chinese))
    expect(editor.canUndo).toBe(false)
  })

  it('改边文字只替换第四行的文字，保留 -->|…| 写法', () => {
    const editor = new MermaidWysiwygEditor({ code: chinese })
    const edge = editor.result.flowchart!.edges.find((edge) => edge.source === '校验' && edge.target === '首页')!
    const start = chinese.indexOf('|是|') + 1
    const result = editor.dispatch({ type: 'setEdgeLabel', edgeId: edge.entityId, label: '通过' })
    expect(result?.edits).toEqual([{ start, end: start + 1, text: '通过' }])
    const lines = chinese.split('\n')
    lines[3] = '    校验 -->|通过| 首页[进入首页]'
    expect(editor.code).toBe(lines.join('\n'))
    expect(editor.undo()).toBe(true)
    expect(Buffer.from(editor.code)).toEqual(Buffer.from(chinese))
  })

  it('06 样例中的 id-1 是一个完整的节点 ID', () => {
    const graph = parse(sample('06-edge-cases.mmd')).flowchart!
    expect(graph.nodeById.get('id-1')?.label).toBe('节点 id 含连字符')
    expect(graph.nodeById.has('id')).toBe(false)
    expect(graph.edges.some((edge) => edge.source === 'id-1' && edge.target === 'id_2')).toBe(true)
  })

  it.each(['甲-->乙', '甲-1-->乙_2', 'café-2-->节点.3'])('无空格箭头不会被 ID 吞掉：%s', (statement) => {
    const [source, target] = statement.split('-->')
    const graph = parse(`flowchart LR\n  ${statement}\n`).flowchart!
    expect(graph.nodes.map((node) => node.id)).toEqual([source, target])
    expect(graph.edges).toHaveLength(1)
  })

  it('class/style/click 能识别中文及连字符 ID，span 指回原文', () => {
    const code = 'flowchart LR\n  节点-1 --> 节点_2\n  class 节点-1,节点_2 高亮\n  style 节点-1 fill:red\n  click 节点_2 "https://example.com"\n'
    const graph = parse(code).flowchart!
    const assignment = graph.statements.get(2)!
    expect(assignment.kind).toBe('classAssign')
    if (assignment.kind !== 'classAssign') throw new Error('未识别中文 class 语句')
    expect(assignment.ids).toEqual(['节点-1', '节点_2'])
    expect(code.slice(assignment.idsSpan!.start, assignment.idsSpan!.end)).toBe('节点-1,节点_2')
    expect(graph.statements.get(3)).toMatchObject({ kind: 'style', ids: ['节点-1'] })
    expect(graph.statements.get(4)).toMatchObject({ kind: 'click', ids: ['节点_2'] })
  })

  it('中文改名保留 CRLF、tab、注释、行尾空格和末尾无换行', () => {
    const code = '%% 保留注释\r\nflowchart LR\r\n\t校验{原文} --> 首页   \r\n\tclass 校验 hot'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'renameNode', id: '校验', label: '新文' })
    expect(editor.code).toBe(code.replace('{原文}', '{新文}'))
    expect(editor.undo()).toBe(true)
    expect(Buffer.from(editor.code)).toEqual(Buffer.from(code))
  })
})
