// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { parse } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from '../src/correlate'

it.each(['', 'mw-123-'])('显式边 id 与匿名平行边分别关联，部分渲染时仍能选中正确的边（%s）', (prefix) => {
  const graph = parse('flowchart LR\n  A e1@--> B; A --> B; B e2@--> C\n').flowchart!
  const host = document.createElement('div')
  host.innerHTML = `<svg id="${prefix.replace(/-$/, '')}" xmlns="http://www.w3.org/2000/svg"><g class="edgePaths">` +
    `<path id="${prefix}L_A_B_1"></path><path id="${prefix}e1" data-id="e1"></path></g></svg>`
  const svg = host.querySelector('svg')!
  const result = correlateFlowchart(svg, graph)
  expect(result.edges.get(graph.edges[0].entityId)?.id).toBe(`${prefix}e1`)
  expect(result.edges.get(graph.edges[1].entityId)?.id).toBe(`${prefix}L_A_B_1`)
  expect(result.failed).toContain(graph.edges[2].entityId)
})

it('带前缀的边按端点匹配，平行边按数字序号排列，标签按内部 data-id 关联', () => {
  const graph = parse('flowchart LR\n  甲 -->|一| 乙\n  甲 -->|二| 乙\n  甲 -->|三| 乙\n  乙 --> 丙\n').flowchart!
  const host = document.createElement('div')
  host.innerHTML = '<svg id="mw-123"><g class="edgePaths">' +
    '<path id="mw-123-L_乙_丙_0"/><path id="mw-123-L_甲_乙_10"/>' +
    '<path id="mw-123-L_甲_乙_2"/><path id="mw-123-L_甲_乙_0"/></g>' +
    '<g class="edgeLabels"><g class="edgeLabel"><g class="label" data-id="L_甲_乙_2">二</g></g>' +
    '<g class="edgeLabel"><g class="label" data-id="L_甲_乙_0">一</g></g></g></svg>'
  const result = correlateFlowchart(host.querySelector('svg')!, graph)
  expect(graph.edges.map(e => result.edges.get(e.entityId)?.id)).toEqual([
    'mw-123-L_甲_乙_0', 'mw-123-L_甲_乙_2', 'mw-123-L_甲_乙_10', 'mw-123-L_乙_丙_0',
  ])
  expect(result.edgeLabels.get(graph.edges[0].entityId)?.textContent).toBe('一')
  expect(result.edgeLabels.get(graph.edges[1].entityId)?.textContent).toBe('二')
})

it('精简复现：带前缀的 path 反序时不会选错边', () => {
  const graph = parse('flowchart LR\n A --> B\n B --> C\n').flowchart!
  const host = document.createElement('div')
  host.innerHTML = '<svg id="mw"><g class="edgePaths"><path id="mw-L_B_C_0"/><path id="mw-L_A_B_0"/></g></svg>'
  expect(correlateFlowchart(host.querySelector('svg')!, graph).edges.get(graph.edges[0].entityId)?.id).toBe('mw-L_A_B_0')
})

it('有未知 id、id 末尾不完整或没有 id 时保持只读，禁止顺序兜底', () => {
  const graph = parse('flowchart LR\n A --> B\n B --> C\n').flowchart!
  for (const paths of [
    '<path id="unknown"/><path id="mw-L_B_C_0-extra"/>',
    '<path id="mw-XL_A_B_0"/><path id="mw-L_B_C_0"/>',
  ]) {
    const host = document.createElement('div')
    host.innerHTML = `<svg id="mw"><g class="edgePaths">${paths}</g></svg>`
    const result = correlateFlowchart(host.querySelector('svg')!, graph)
    expect(result.edges.has(graph.edges[0].entityId)).toBe(false)
    expect(result.failed).toContain(graph.edges[0].entityId)
  }
  const host = document.createElement('div')
  host.innerHTML = '<svg><g class="edgePaths"><path/><path/></g><g class="edgeLabels"><g class="edgeLabel"/><g class="edgeLabel"/></g></svg>'
  const result = correlateFlowchart(host.querySelector('svg')!, graph)
  expect(result.edges.size).toBe(0)
  expect(result.edgeLabels.size).toBe(0)
  expect(result.failed).toEqual(expect.arrayContaining(graph.edges.map(e => e.entityId)))
})

it('只渲染部分平行边时不猜测其出现次序', () => {
  const graph = parse('flowchart LR\n A --> B\n A --> B\n').flowchart!
  const host = document.createElement('div')
  host.innerHTML = '<svg id="mw"><g class="edgePaths"><path id="mw-L_A_B_2"/></g></svg>'
  const result = correlateFlowchart(host.querySelector('svg')!, graph)
  expect(result.edges.size).toBe(0)
  expect(result.failed.filter(id => id.startsWith('edge:'))).toEqual(graph.edges.map(e => e.entityId))
})
