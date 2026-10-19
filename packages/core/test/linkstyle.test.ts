import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, type EditorOp } from '../src'

const sample = readFileSync(new URL('../../../testdata/samples/11-linkstyle-split.mmd', import.meta.url), 'utf8')

function edgeId(editor: MermaidWysiwygEditor, source: string, target: string): string {
  return editor.result.flowchart!.edges.find((item) => item.source === source && item.target === target)!.entityId
}

function expectEdges(editor: MermaidWysiwygEditor, pairs: string[]) {
  expect(editor.result.flowchart!.edges.map((edge) => `${edge.source}→${edge.target}`)).toEqual(pairs)
}

function expectUndoRedo(editor: MermaidWysiwygEditor, before: string, after: string) {
  expect(editor.code).toBe(after)
  expect(editor.undo()).toBe(true)
  expect(Buffer.from(editor.code).equals(Buffer.from(before))).toBe(true)
  expect(editor.redo()).toBe(true)
  expect(Buffer.from(editor.code).equals(Buffer.from(after))).toBe(true)
}

describe('linkStyle index remapping', () => {
  it('deletes B→C from a list and renumbers the surviving indices', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    editor.dispatch({ type: 'deleteEdge', edgeId: edgeId(editor, 'B', 'C') })
    expectEdges(editor, ['A→C', 'C→D', 'D→E', 'E→F'])
    expectUndoRedo(editor, sample, sample
      .replace('A[甲] & B[乙] --> C{判断}', 'A[甲] --> C{判断}\n    B[乙]')
      .replace('linkStyle 1,3', 'linkStyle 2').replace('linkStyle 4', 'linkStyle 3'))
  })

  it('deletes A→C and drops the style whose only index disappeared', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    editor.dispatch({ type: 'deleteEdge', edgeId: edgeId(editor, 'A', 'C') })
    expectEdges(editor, ['B→C', 'C→D', 'D→E', 'E→F'])
    expectUndoRedo(editor, sample, sample
      .replace('A[甲] & B[乙] --> C{判断}', 'B[乙] --> C{判断}\n    A[甲]')
      .replace('    linkStyle 0 stroke:red\n', '')
      .replace('linkStyle 1,3', 'linkStyle 0,2').replace('linkStyle 4', 'linkStyle 3'))
  })

  it('inserts C→D after the entire chain, at index 4, and moves blue to index 5', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    const result = editor.dispatch({ type: 'connect', source: 'C', target: 'D', line: 'dotted' })!
    const insertAt = sample.indexOf('\n    E -.-> F')
    const styleIndex = sample.indexOf('linkStyle 4') + 'linkStyle '.length
    expect(result.edits).toEqual([
      { start: insertAt, end: insertAt, text: '\n    C -.-> D' },
      { start: styleIndex, end: styleIndex + 1, text: '5' },
    ])
    expectEdges(editor, ['A→C', 'B→C', 'C→D', 'D→E', 'C→D', 'E→F'])
    expectUndoRedo(editor, sample, sample
      .replace('    E -.-> F', '    C -.-> D\n    E -.-> F')
      .replace('linkStyle 4', 'linkStyle 5'))
  })

  it('appends E→F without changing any existing indices', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    editor.dispatch({ type: 'connect', source: 'E', target: 'F' })
    expectEdges(editor, ['A→C', 'B→C', 'C→D', 'D→E', 'E→F', 'E→F'])
    expectUndoRedo(editor, sample, sample.replace('    linkStyle 0', '    E --> F\n    linkStyle 0'))
  })

  it('deletes node C and all three incident edges while preserving D→E and E→F styles', () => {
    const editor = new MermaidWysiwygEditor({ code: sample })
    editor.dispatch({ type: 'deleteNode', id: 'C' })
    expectEdges(editor, ['D→E', 'E→F'])
    expectUndoRedo(editor, sample, sample
      .replace('A[甲] & B[乙] --> C{判断}', 'A[甲]\n    B[乙]')
      .replace('C --> D(丁)', 'D(丁)')
      .replace('    linkStyle 0 stroke:red\n', '')
      .replace('linkStyle 1,3', 'linkStyle 0').replace('linkStyle 4', 'linkStyle 1'))
  })

  it('preserves linkStyle default byte for byte through structural and color operations', () => {
    const defaultLine = '\tlinkStyle default\tstroke:#aaa,stroke-width:4px  %% default  \n'
    const code = sample + defaultLine
    const operations: EditorOp[] = [
      { type: 'connect', source: 'C', target: 'D', line: 'dotted' },
      { type: 'deleteEdge', edgeId: 'edge:B->C#0' },
      { type: 'deleteNode', id: 'C' },
      { type: 'setEdgeColor', edgeId: 'edge:B->C#0', value: 'orange' },
      { type: 'setEdgeColor', edgeId: 'edge:B->C#0', value: null },
    ]
    for (const op of operations) {
      const editor = new MermaidWysiwygEditor({ code })
      editor.dispatch(op)
      expect(editor.code).toContain(defaultLine)
      expectUndoRedo(editor, code, editor.code)
    }
  })

  it('preserves comma spacing, tabs, comments, style properties and CRLF in statement lists', () => {
    const code = sample.replace(/\n/g, '\r\n')
      .replace('    linkStyle 1,3 stroke:green', '\tlinkStyle\t1 \t, 3\tstroke:green,opacity:0.5; linkStyle 0, 2 ,4 stroke:pink  %% keep  ')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'deleteEdge', edgeId: edgeId(editor, 'B', 'C') })
    expectUndoRedo(editor, code, code
      .replace('A[甲] & B[乙] --> C{判断}', 'A[甲] --> C{判断}\r\n    B[乙]')
      .replace('1 \t, 3\tstroke:', '2\tstroke:')
      .replace('0, 2 ,4', '0, 1 ,3').replace('linkStyle 4', 'linkStyle 3'))
  })

  it('leaves unchanged number lists and their original leading zeros untouched', () => {
    const code = sample.replace('linkStyle 1,3', 'linkStyle 01 \t, 003')
    const editor = new MermaidWysiwygEditor({ code })
    const result = editor.dispatch({ type: 'deleteEdge', edgeId: edgeId(editor, 'E', 'F') })!
    expect(result.edits.every((edit) => !code.slice(edit.start, edit.end).includes('linkStyle 01'))).toBe(true)
    expectUndoRedo(editor, code, code.replace('E -.-> F', 'F').replace('    linkStyle 4 stroke:blue,stroke-width:3px\n', ''))
  })

  it('removes an exhausted list at EOF without leaving blank lines or orphan CR characters', () => {
    for (const trailing of ['', '\r\n']) {
      const code = 'flowchart LR\r\n\tA\r\n\tB\r\n\tC --> D --> E\r\n\tlinkStyle 0 , 1 stroke:red' + trailing
      const editor = new MermaidWysiwygEditor({ code })
      editor.dispatch({ type: 'deleteNode', id: 'D' })
      expectUndoRedo(editor, code, 'flowchart LR\r\n\tA\r\n\tB\r\n\tC\r\n\tE' + trailing)
    }
  })

  it('sets or clears either member of a shared style without changing the other member', () => {
    for (const order of [1, 3]) {
      for (const value of ['orange', null]) {
        const code = sample.replace('linkStyle 1,3 stroke:green', '\tlinkStyle\t1 , 3\tstroke:green,opacity:0.5')
        const editor = new MermaidWysiwygEditor({ code })
        editor.dispatch({ type: 'setEdgeColor', edgeId: editor.result.flowchart!.edges[order].entityId, value })
        const after = code.replace('1 , 3\tstroke:green', `${order === 1 ? 3 : 1}\tstroke:green`)
        const expected = value === null ? after : after.trimEnd() + `\n    linkStyle ${order} stroke:orange,stroke-width:2px\n`
        expectUndoRedo(editor, code, expected)
      }
    }
  })

  it('tracks surviving parallel edges by occurrence rather than their old entity ids', () => {
    const code = 'flowchart LR\n  A e1@--> B\n  A --> B\n  A --> B\n  A e2@--> B\n  X --> Y\n  linkStyle 1,2 stroke:red\n  linkStyle 4 stroke:blue\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'deleteEdge', edgeId: editor.result.flowchart!.edges[1].entityId })
    const afterDelete = code.replace('  A --> B\n', '').replace('linkStyle 1,2', 'linkStyle 1').replace('linkStyle 4', 'linkStyle 3')
    expectUndoRedo(editor, code, afterDelete)
    editor.dispatch({ type: 'connect', source: 'A', target: 'B', line: 'dotted' })
    expectUndoRedo(editor, afterDelete, afterDelete.replace('  X --> Y', '  A -.-> B\n  X --> Y').replace('linkStyle 3', 'linkStyle 4'))
  })
})
