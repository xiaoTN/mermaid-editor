// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '../src'

const CODE = 'flowchart TD\r\n\tA[起点] --> Z[终点]  \r\n\tsubgraph first[第一组]\r\n\t\tB[乙]\r\n\tend\r\n\tsubgraph second[第二组]\r\n\t\tC[丙]\r\n\tend\r\n\tlinkStyle 0 stroke:red\r\n'
let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let serial = 0
beforeAll(async () => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() {
    return (this.textContent ?? '').length * 8
  } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
})
afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
})

async function verify(editor: MermaidWysiwygEditor, source: string, target: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(editor.code)
  const db = diagram.db as { getSubGraphs(): { id: string; nodes: string[] }[] }
  expect(Object.fromEntries(db.getSubGraphs().map(group => [group.id, group.nodes]))).toEqual({ first: ['B'], second: ['C'] })
  const rendered = await mermaid.render(`group-connection-${serial++}`, editor.code)
  const host = document.createElement('div'); host.innerHTML = rendered.svg
  expect(host.querySelectorAll('g.cluster')).toHaveLength(2)
  expect(host.querySelector(`[data-id="L_${source}_${target}_0"]`)).not.toBeNull()
  return host
}

describe('箭头连接分组', () => {
  it.each([['A', 'first'], ['first', 'A'], ['first', 'second']])('首次连接 %s → %s，不生成同名节点，支持撤销重做', async (source, target) => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const result = editor.dispatch({ type: 'connect', source, target, insideGroup: true })!
    expect(result?.created).toEqual([`edge:${source}->${target}#0`])
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    expect(editor.code).toContain('\tlinkStyle 0 stroke:red\r\n')
    const host = await verify(editor, source, target)
    expect(host.querySelectorAll('g.node')).toHaveLength(4)
    const after = editor.code
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    editor.redo(); expect(editor.code).toBe(after)
  })

  it.each(['source', 'target'] as const)('已有箭头的%s可以改连到尚未引用的分组', async end => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const result = editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:A->Z#0', end, nodeId: 'second' })!
    const source = end === 'source' ? 'second' : 'A', target = end === 'target' ? 'second' : 'Z'
    expect(result?.created).toEqual([`edge:${source}->${target}#0`])
    expect(editor.result.flowchart!.nodeById.get('A')?.label).toBe('起点')
    expect(editor.result.flowchart!.nodeById.get('Z')?.label).toBe('终点')
    await verify(editor, source, target)
    editor.undo(); expect(editor.code).toBe(CODE)
  })

  it('组内链的一条边改连到另一个分组，成员不迁移，边 ID、文字和样式仍对应原来的边', async () => {
    const code = CODE.replace('\t\tB[乙]', '\t\tB[乙] e1@-->|文字| D[丁] --> E[戊]')
      .replace('linkStyle 0 stroke:red', 'linkStyle 0 stroke:red\r\n\tlinkStyle 1 stroke:blue\r\n\tlinkStyle 2 stroke:green')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:B->D#0', end: 'target', nodeId: 'second' })
    const graph = editor.result.flowchart!
    expect(graph.edges.some(edge => edge.source === 'B' && edge.target === 'second' && edge.label === '文字' && edge.seg.edgeId === 'e1')).toBe(true)
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(editor.code)
    const db = diagram.db as { getSubGraphs(): { id: string; nodes: string[] }[] }
    expect(Object.fromEntries(db.getSubGraphs().map(group => [group.id, [...group.nodes].sort()]))).toEqual({ first: ['B', 'D', 'E'], second: ['C'] })
    const rendered = await mermaid.render(`group-connection-${serial++}`, editor.code)
    const host = document.createElement('div'); host.innerHTML = rendered.svg
    expect((host.querySelector('[data-id="e1"]') as SVGElement)?.style.stroke).toBe('blue')
    expect((host.querySelector('[data-id="L_D_E_0"]') as SVGElement)?.style.stroke).toBe('green')
    editor.undo(); expect(editor.code).toBe(code)
  })

  it('移动的边与已有不同线型的平行边仍分别保留样式', async () => {
    const code = CODE.replace('\t\tB[乙]', '\t\tB[乙] --> D[丁]')
      .replace('\tlinkStyle 0 stroke:red', '\tB -.-> second\r\n\tlinkStyle 0 stroke:red\r\n\tlinkStyle 1 stroke:blue\r\n\tlinkStyle 2 stroke:green')
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:B->D#0', end: 'target', nodeId: 'second' })
    const rendered = await mermaid.render(`group-connection-${serial++}`, editor.code)
    const host = document.createElement('div'); host.innerHTML = rendered.svg
    const paths = [...host.querySelectorAll<SVGElement>('path.flowchart-link')]
    expect(paths.find(path => path.classList.contains('edge-pattern-dotted'))?.style.stroke).toBe('green')
    expect(paths.filter(path => path.style.stroke === 'blue')).toHaveLength(1)
    expect(editor.selection).toEqual(['edge:B->second#1'])
    editor.undo(); expect(editor.code).toBe(code)
  })

  it('拒绝分组与自身、内部节点或子分组连线，重复连线也不产生新历史', () => {
    const code = CODE.replace('\t\tB[乙]', '\t\tsubgraph child[子组]\r\n\t\t\tB[乙]\r\n\t\tend')
    for (const [source, target] of [['first', 'first'], ['first', 'B'], ['B', 'first'], ['first', 'child'], ['child', 'first']]) {
      const editor = new MermaidWysiwygEditor({ code })
      expect(editor.dispatch({ type: 'connect', source, target })).toEqual({ edits: [], warnings: [{ key: 'toast.groupCycle' }] })
      expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
    }
    const editor = new MermaidWysiwygEditor({ code })
    editor.dispatch({ type: 'connect', source: 'first', target: 'second' })
    const connected = editor.code
    expect(editor.dispatch({ type: 'connect', source: 'first', target: 'second' })?.warnings).toEqual([{ key: 'toast.dupEdge' }])
    expect(editor.code).toBe(connected)
    editor.undo(); expect(editor.code).toBe(code); expect(editor.canUndo).toBe(false)
  })
})
