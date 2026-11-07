import { expect, it } from 'vitest'
import { MermaidWysiwygEditor, flowchartOrderPeers } from '../src'

it('共同接在 H 后面的三个并列节点，即使 J 还有另一条入口，也应允许调整显示顺序', () => {
  const code = 'flowchart LR\n H[订单完成]\n I[人工处理]\n J[练习用节点]\n K[短信通知]\n L[站内通知]\n I <--> J\n H --- J\n H --> K\n H --> L\n'
  const editor = new MermaidWysiwygEditor({ code })
  expect(flowchartOrderPeers(editor.result.flowchart!, 'J')).toEqual(['J', 'K', 'L'])
  expect(editor.dispatch({ type: 'reorderNodes', ids: ['L', 'K', 'J'] })?.edits.length).toBeGreaterThan(0)
  expect(editor.code.indexOf('L[站内通知]')).toBeLessThan(editor.code.indexOf('K[短信通知]'))
  expect(editor.code.indexOf('K[短信通知]')).toBeLessThan(editor.code.indexOf('J[练习用节点]'))
  expect(editor.code).toContain('I <--> J')
  expect(editor.code).toContain('H --- J')
  editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})

it('有额外入口的内联节点可以交换分行入口连线，并保留额外入口', () => {
  const code = 'flowchart TD\n A --> B\n A --> C\n D --> C\n'
  const editor = new MermaidWysiwygEditor({ code })
  expect(editor.dispatch({ type: 'reorderNodes', ids: ['C', 'B'] })?.edits.length).toBeGreaterThan(0)
  expect(editor.code).toContain(' A --> C\n A --> B\n D --> C')
  editor.undo(); expect(editor.code).toBe(code)
})

it('先在组外引用但实际属于不同分组的节点，不能互换声明', () => {
  const code = 'flowchart LR\n H --> J\n H --> K\n subgraph one\n J[甲]\n end\n subgraph two\n K[乙]\n end\n'
  const editor = new MermaidWysiwygEditor({ code })
  expect(editor.dispatch({ type: 'reorderNodes', ids: ['K', 'J'] })?.edits ?? []).toEqual([])
  expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
})
