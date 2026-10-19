import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

const sample = readFileSync(new URL('../../../testdata/samples/05-shapes-multi.mmd', import.meta.url), 'utf8')

function expectUndoRedo(editor: MermaidWysiwygEditor, before: string, after: string) {
  expect(editor.code).toBe(after)
  expect(editor.undo()).toBe(true)
  expect(Buffer.from(editor.code)).toEqual(Buffer.from(before))
  expect(editor.redo()).toBe(true)
  expect(editor.code).toBe(after)
}

describe('flowchart label escaping', () => {
  it('05: renames A with Mermaid quote entities and preserves every other byte', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    const start = sample.indexOf('方框')
    const result = editor.dispatch({ type: 'renameNode', id: 'A', label: '含 "引号" 和 end' })
    expect(result?.edits).toEqual([{ start, end: start + 2, text: '"含 #quot;引号#quot; 和 end"' }])
    expect(editor.result.flowchart!.nodeById.get('A')?.label).toBe('含 #quot;引号#quot; 和 end')
    expectUndoRedo(editor, sample, sample.replace('方框', '"含 #quot;引号#quot; 和 end"'))
  })

  it('05: preserves existing HTML and Mermaid entities when renaming L', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    const oldLabel = '带 &quot;引号&quot; 和 #35; 的文字'
    const label = '保留 &quot;引号&quot; 和 #35;、#quot;，含 "新引号"'
    const encoded = '保留 &quot;引号&quot; 和 #35;、#quot;，含 #quot;新引号#quot;'
    const start = sample.indexOf(oldLabel)
    const result = editor.dispatch({ type: 'renameNode', id: 'L', label })
    expect(result?.edits).toEqual([{ start, end: start + oldLabel.length, text: encoded }])
    expect(editor.result.flowchart!.nodeById.get('L')?.primary!.ref.quoted).toBe(true)
    expectUndoRedo(editor, sample, sample.replace(oldLabel, encoded))
  })

  it.each([
    ['end', 'end'], ['before end after', 'before end after'], [']', ']'],
    ['"', '#quot;'], ['#quot;', '#quot;'], ['-->', '-->'], ['---', '---'],
    ['--', '--'], ['==', '=='], ['-.', '-.'], ['~~~', '~~~'],
  ])('quotes new node labels containing %j', (label, encoded) => {
    const before = 'flowchart LR\r\n\tA[原文]  \r\n\t%% 保留'
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'addNode', id: 'N', label })
    expect(editor.result.flowchart!.nodeById.get('N')?.label).toBe(encoded)
    expectUndoRedo(editor, before, `flowchart LR\r\n\tA[原文]  \r\n\tN["${encoded}"]\r\n\t%% 保留`)
  })

  it.each(['原文', '"原文"'])('quotes rename results and retains existing wrappers (%s)', (oldLabel) => {
    const before = `flowchart LR\r\n\tA{${oldLabel}} --> B; C[不变];  \r\n\t%% 保留`
    const editor = new MermaidWysiwygEditor({ code: before })
    const start = before.indexOf('原文')
    const label = '含 "引号" 和 end'
    const encoded = '含 #quot;引号#quot; 和 end'
    const result = editor.dispatch({ type: 'renameNode', id: 'A', label })
    expect(result?.edits).toEqual([{ start, end: start + 2, text: oldLabel.startsWith('"') ? encoded : `"${encoded}"` }])
    expect(editor.result.flowchart!.nodeById.get('A')?.shape).toBe('diamond')
    expectUndoRedo(editor, before, before.replace(oldLabel, `"${encoded}"`))
  })

  it('preserves quotes around a simple renamed label', () => {
    const before = 'flowchart LR\n  A["original"] --> B\n'
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'simple' })
    expectUndoRedo(editor, before, before.replace('original', 'simple'))
  })

  it('quotes a renamed implicit node without changing its neighbors', () => {
    const before = 'flowchart LR\n\tA --> B; C --> D;  '
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'renameNode', id: 'B', label: 'end -- "quoted"' })
    expectUndoRedo(editor, before, before.replace('B;', 'B["end -- #quot;quoted#quot;"];'))
  })

  it.each(['\n', '\r\n'])('escapes only Markdown content and uses the document EOL (%j)', (eol) => {
    const before = ['flowchart LR', '\tA["`第一行', '第二行`"] --> B; C;  ', '\t%% 保留'].join(eol)
    const editor = new MermaidWysiwygEditor({ code: before })
    const label = '**含 "引号"** &quot; #35;\n末行'
    const encoded = `**含 #quot;引号#quot;** &quot; #35;${eol}末行`
    const result = editor.dispatch({ type: 'renameNode', id: 'A', label })
    expect(result?.edits).toEqual([{ start: before.indexOf('第一行'), end: before.indexOf('`"]'), text: encoded }])
    expect(editor.result.flowchart!.nodeById.get('A')?.primary!.ref.markdown).toBe(true)
    expectUndoRedo(editor, before, before.replace(`第一行${eol}第二行`, encoded))
  })

  it.each([
    ['a|b', 'a#124;b'], ['|', '#124;'],
    ['a|"b" &quot; #35;', 'a#124;#quot;b#quot; &quot; #35;'],
  ])('connect encodes pipes without dropping label characters (%j)', (label, encoded) => {
    const before = 'flowchart LR\r\n\tA -.-> B;  \r\n\t%% 保留'
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'connect', source: 'A', target: 'B', label })
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    expectUndoRedo(editor, before, before.replace('\r\n\t%%', `\r\n\tA -->|"${encoded}"| B\r\n\t%%`))
  })

  it.each(['-->', '-->|old|', '-->|"old"|', '-- old -->', '-. old .->', '== old ==>'])('sets an escaped edge label in place (%s)', (operator) => {
    const before = `flowchart LR\r\n\tA e1@${operator} B ; C --> D;  \r\n\t%% 保留`
    const editor = new MermaidWysiwygEditor({ code: before })
    const edge = editor.result.flowchart!.edges[0]
    const result = editor.dispatch({ type: 'setEdgeLabel', edgeId: edge.entityId, label: 'a|"b"' })!
    const encoded = '"a#124;#quot;b#quot;"'
    const expectedOperator = operator === '-->' ? `-->|${encoded}|` : operator.replace(/"?old"?/, encoded)
    expect(result.edits).toEqual([edge.seg.labelSpan
      ? { ...edge.seg.labelSpan, text: encoded }
      : { start: edge.seg.span.end, end: edge.seg.span.end, text: `|${encoded}|` }])
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    expect(editor.result.flowchart!.edges[0].seg.edgeId).toBe('e1')
    expectUndoRedo(editor, before, before.replace(operator, expectedOperator))
  })

  it.each(['-->|"a#124;b#quot; &quot; #35;"|', '-- "a#124;b#quot; &quot; #35;" -->'])('preserves encoded labels when changing edge style (%s)', (operator) => {
    const before = `flowchart LR\n\tA e1@${operator} B; C --> D;  `
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'setEdgeStyle', edgeId: editor.result.flowchart!.edges[0].entityId, line: 'thick' })
    expectUndoRedo(editor, before, before.replace(operator, '==>|"a#124;b#quot; &quot; #35;"|'))
  })

  it('encodes a raw pipe in an inline label when changing edge style', () => {
    const before = 'flowchart LR\r\n\tA e1@-- a|b --> B  \r\n\tC --> D;  \r\n\t%% 保留'
    const editor = new MermaidWysiwygEditor({ code: before })
    expect(editor.result.flowchart!.edges[0].label).toBe('a|b')
    editor.dispatch({ type: 'setEdgeStyle', edgeId: editor.result.flowchart!.edges[0].entityId, line: 'thick' })
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    expectUndoRedo(editor, before, before.replace('-- a|b -->', '==>|"a#124;b"|'))
  })

  it('keeps ordinary labels unquoted and preserves single quotes', () => {
    const before = 'flowchart LR\n  A --> B\n'
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'addNode', id: 'N', label: "Bob's weekend" })
    expectUndoRedo(editor, before, before + "  N[Bob's weekend]\n")
  })

  it.each(['-->|"old"|', '-- "old" -->'])('retains existing edge quotes on a simple rename (%s)', (operator) => {
    const before = `flowchart LR\n  A ${operator} B\n`
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'setEdgeLabel', edgeId: editor.result.flowchart!.edges[0].entityId, label: 'simple' })
    expectUndoRedo(editor, before, before.replace('old', 'simple'))
  })

  it.each(['-->|old|', '-->|"old"|', '-. old .->'])('removes empty edge labels (%s)', (operator) => {
    const before = `flowchart LR\n  A ${operator} B\n`
    const editor = new MermaidWysiwygEditor({ code: before })
    editor.dispatch({ type: 'setEdgeLabel', edgeId: editor.result.flowchart!.edges[0].entityId, label: '' })
    expectUndoRedo(editor, before, before.replace(operator, operator.startsWith('-.') ? '-.->' : '-->'))
  })
})
