import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

describe('delete an edge from an ampersand list with minimal edits', () => {
  it.each([
    ['select --> tabletop & bedside & central & floor & wallart & slippers', 'select', 'floor', 'select --> tabletop & bedside & central & wallart & slippers'],
    ['A & B & C --> D', 'B', 'D', 'A & C --> D'],
    ['A --> B & C', 'A', 'B', 'A --> C'],
    ['A & B --> C', 'A', 'C', 'B --> C'],
    ['A --> B & C & D', 'A', 'D', 'A --> B & C'],
    ['A --> B[bee]  &\tC & D', 'A', 'C', 'A --> B[bee]  &\tD'],
    ['A & B & C --> D --> E', 'B', 'D', 'A & C --> D --> E'],
    ['A --> B --> C & D & E', 'B', 'D', 'A --> B --> C & E'],
    ['A & B --> C & D', 'A', 'C', 'A --> D\r\n\tB --> C & D'],
  ])('%s removes only %s → %s', (body, source, target, expected) => {
    const code = `flowchart LR\r\n\t${body}; Z --> X  %% keep\r\n`
    const editor = new MermaidWysiwygEditor({ code })
    const edge = editor.result.flowchart!.edges.find(e => e.source === source && e.target === target)!
    editor.dispatch({ type: 'deleteEdge', edgeId: edge.entityId })
    expect(editor.code).toBe(code.replace(body, expected))
    editor.undo(); expect(editor.code).toBe(code)
  })
  it('deleting a node preserves both fan lists and surrounding syntax', () => {
    const code = 'flowchart TD\r\n\tfloor[Floor]\r\n\tselect --> a & floor & c  %% keep\r\n\ta & floor & c --> result\r\n'
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'deleteNode', id: 'floor' })
    expect(editor.code).toBe(code.replace('\tfloor[Floor]\r\n', '').replaceAll('a & floor & c', 'a & c'))
    editor.undo(); expect(editor.code).toBe(code)
  })
})
