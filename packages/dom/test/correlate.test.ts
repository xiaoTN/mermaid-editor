// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { parse } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from '../src/correlate'

it('显式边 id 与匿名平行边分别关联，部分渲染时仍能选中正确的边', () => {
  const graph = parse('flowchart LR\n  A e1@--> B; A --> B; B e2@--> C\n').flowchart!
  const host = document.createElement('div')
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g class="edgePaths">' +
    '<path id="L_A_B_1"></path><path id="e1"></path></g></svg>'
  const svg = host.querySelector('svg')!
  const result = correlateFlowchart(svg, graph)
  expect(result.edges.get(graph.edges[0].entityId)?.id).toBe('e1')
  expect(result.edges.get(graph.edges[1].entityId)?.id).toBe('L_A_B_1')
  expect(result.failed).toContain(graph.edges[2].entityId)
})
