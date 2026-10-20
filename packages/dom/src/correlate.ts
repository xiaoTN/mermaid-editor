import type {
  ClassGraph,
  ErGraph,
  FlowGraph,
  GanttGraph,
  LineItemsGraph,
  PieGraph,
  SequenceGraph,
  StateGraph,
} from '@inkeep/mermaid-wysiwyg-core'

export interface Correlation {
  nodes: Map<string, SVGGElement>
  edges: Map<string, SVGElement>
  edgeLabels: Map<string, SVGGElement>
  /** entity ids that failed to correlate (degraded to view-only) */
  failed: string[]
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function edgeIdentity(svg: SVGSVGElement, el: SVGElement): string | null {
  const id = el.getAttribute('data-id')
  if (id) return !el.id || el.id === id || el.id === `${svg.id}-${id}` ? id : null
  return svg.id && el.id.startsWith(`${svg.id}-`) ? el.id.slice(svg.id.length + 1) : el.id
}

/** Claim only one-to-one identities, never the first candidate or paint order. */
function matchNodes<T extends { entityId: string }>(
  entities: T[], elements: SVGGElement[], matches: (entity: T, el: SVGGElement) => boolean,
  nodes: Map<string, SVGGElement>, failed: string[],
) {
  const candidates = entities.map(entity => elements.filter(el => matches(entity, el)))
  entities.forEach((entity, i) => {
    const [el] = candidates[i]
    if (candidates[i].length !== 1 || candidates.filter(els => els.includes(el)).length !== 1) {
      failed.push(entity.entityId)
      return
    }
    nodes.set(entity.entityId, el)
    el.setAttribute('data-mw-entity', entity.entityId)
  })
}

/** Keep failed hit areas distinct from both the background and parent groups. */
function markUncorrelated(svg: SVGSVGElement) {
  for (const el of svg.querySelectorAll<SVGElement>(
    'g.node, g.cluster, g.statediagram-state, g.statediagram-cluster, .edgePaths > path, path.flowchart-link, path.transition, path.relation, path.relationshipLine, .edgeLabels > .edgeLabel, .relationshipLabel',
  )) {
    if (el.hasAttribute('data-mw-entity')) continue
    el.setAttribute('data-mw-ambiguous', '')
    el.style.pointerEvents = 'auto'
  }
}

/** Endpoint identities plus Mermaid's numeric suffix resolve parallel edges. */
function matchRelations<T extends { entityId: string; source: string; target: string }>(
  svg: SVGSVGElement, relations: T[], prefix: (relation: T) => string | null,
  edges: Map<string, SVGElement>, edgeLabels: Map<string, SVGGElement>, failed: string[],
) {
  const paths = [...svg.querySelectorAll<SVGElement>('.edgePaths > path')]
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
  const groups = new Map<string, T[]>()
  for (const relation of relations) {
    const pair = JSON.stringify([relation.source, relation.target])
    const group = groups.get(pair) ?? []
    group.push(relation)
    groups.set(pair, group)
  }
  for (const group of groups.values()) {
    const key = prefix(group[0])
    if (!key || [...groups.values()].some(other => other !== group && prefix(other[0]) === key)) continue
    const re = new RegExp(`^${esc(key)}(\\d+)$`)
    const candidates = paths.flatMap(el => {
      const id = edgeIdentity(svg, el) ?? ''
      const match = re.exec(id)
      return match && el.id === `${svg.id}-${id}` ? [{ el, id, order: Number(match[1]) }] : []
    }).sort((a, b) => a.order - b.order)
    if (candidates.length !== group.length || new Set(candidates.map(c => c.order)).size !== candidates.length) continue
    group.forEach((relation, i) => {
      const { el, id } = candidates[i]
      edges.set(relation.entityId, el)
      el.setAttribute('data-mw-entity', relation.entityId)
      const matchingLabels = labels.filter(label => [...label.querySelectorAll('[data-id]')].some(child => child.getAttribute('data-id') === id))
      if (matchingLabels.length !== 1) return
      edgeLabels.set(relation.entityId, matchingLabels[0])
      matchingLabels[0].setAttribute('data-mw-entity', relation.entityId)
    })
  }
  for (const relation of relations) if (!edges.has(relation.entityId)) failed.push(relation.entityId)
}

/**
 * Correlate mermaid's rendered flowchart SVG with the semantic graph.
 * Edge identity comes from Mermaid's ids, never SVG paint order (clusters
 * reorder paths). Unresolved or ambiguous identities stay code-only.
 */
export function correlateFlowchart(svg: SVGSVGElement, graph: FlowGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.node')]
  matchNodes(graph.nodes, nodeEls,
    (node, el) => new RegExp(`^${esc(svg.id)}-flowchart-${esc(node.id)}-\\d+$`).test(el.id), nodes, failed)

  const edgeEls = [...svg.querySelectorAll<SVGElement>('.edgePaths > path, path.flowchart-link')]
  const claimedEdges = new Set<Element>()
  const originalIds = new Map<SVGElement, string>()
  const claimEdge = (entityId: string, el: SVGElement) => {
    edges.set(entityId, el)
    claimedEdges.add(el)
    el.setAttribute('data-mw-entity', entityId)
  }
  // Reserve explicit ids before matching anonymous parallel edges. Mermaid 11
  // prefixes the DOM id with diagramId but keeps the original in data-id.
  for (const edge of graph.edges) {
    const id = edge.seg.edgeId
    if (!id) continue
    const candidates = edgeEls.filter(e => edgeIdentity(svg, e) === id)
    const [el] = candidates
    const conflicts = graph.edges.some(other => other !== edge && (other.seg.edgeId === id ||
      (!other.seg.edgeId && new RegExp(`^L_${esc(other.source)}_${esc(other.target)}_\\d+$`).test(id))))
    if (candidates.length === 1 && !conflicts) {
      claimEdge(edge.entityId, el)
      originalIds.set(el, id)
    }
  }
  const pairs = new Map<string, typeof graph.edges>()
  for (const edge of graph.edges) {
    if (edge.seg.edgeId) continue
    const key = JSON.stringify([edge.source, edge.target])
    const group = pairs.get(key) ?? []
    group.push(edge)
    pairs.set(key, group)
  }
  for (const group of pairs.values()) {
    const { source, target } = group[0]
    // Distinct endpoint pairs can share an underscore-delimited Mermaid id.
    // Reject the namespace even if only one of its paths rendered.
    if ([...pairs.values()].some(other => other !== group &&
      `${other[0].source}_${other[0].target}` === `${source}_${target}`)) continue
    const re = new RegExp(`^L_${esc(source)}_${esc(target)}_(\\d+)$`)
    const candidates = edgeEls.filter(e => !claimedEdges.has(e)).flatMap(el => {
      const match = re.exec(edgeIdentity(svg, el) ?? '')
      return match ? [{ el, order: Number(match[1]), id: match[0] }] : []
    }).sort((a, b) => a.order - b.order)
    // Counts must agree: a partially rendered parallel set is ambiguous.
    // Mermaid 11's suffixes can have gaps (e.g. 0, 2), so use numeric rank.
    if (candidates.length === group.length && new Set(candidates.map(c => c.order)).size === candidates.length &&
      !candidates.some(c => graph.edges.some(e => e.seg.edgeId === c.id))) {
      group.forEach((edge, i) => {
        claimEdge(edge.entityId, candidates[i].el)
        originalIds.set(candidates[i].el, candidates[i].id)
      })
    }
  }
  for (const edge of graph.edges) if (!edges.has(edge.entityId)) failed.push(edge.entityId)

  matchNodes(graph.subgraphs, [...svg.querySelectorAll<SVGGElement>('g.cluster')],
    (sg, el) => el.id === `${svg.id}-${sg.id}`, nodes, failed)

  // Mermaid 11 puts the original edge id on the inner g.label[data-id].
  // Label containers are reordered with clusters just like paths. Correlate
  // through the already resolved path, including explicit edge ids.
  const labelEls = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
  const labelsById = new Map<string, Set<SVGGElement>>()
  for (const label of labelEls) {
    for (const el of [label, ...label.querySelectorAll('[data-id], [id]')]) {
      for (const id of [el.id, el.getAttribute('data-id')]) {
        if (id) {
          const labels = labelsById.get(id) ?? new Set<SVGGElement>()
          labels.add(label)
          labelsById.set(id, labels)
        }
      }
    }
  }
  const claimedLabels = new Set<Element>()
  for (const [entityId, path] of edges) {
    const ids = [path.getAttribute('data-id'), path.id,
      originalIds.get(path),
      svg.id && path.id.startsWith(`${svg.id}-`) ? path.id.slice(svg.id.length + 1) : '']
    const candidates = new Set(ids.flatMap(id => [...(labelsById.get(id ?? '') ?? [])]))
    const [label] = candidates
    if (candidates.size !== 1 || claimedLabels.has(label)) continue
    edgeLabels.set(entityId, label)
    claimedLabels.add(label)
    label.setAttribute('data-mw-entity', entityId)
  }

  markUncorrelated(svg)
  return { nodes, edges, edgeLabels, failed }
}

/**
 * Correlate mermaid's state-diagram SVG (v2 renders through the same
 * dagre wrapper as flowcharts). Returns the flowchart-shaped Correlation so
 * the same canvas interactions apply; `[*]` pseudo-states stay view-only.
 */
export function correlateState(svg: SVGSVGElement, graph: StateGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  matchNodes(graph.states, [...svg.querySelectorAll<SVGGElement>('g.node, g.statediagram-state')],
    (state, el) => new RegExp(`^${esc(svg.id)}-state-${esc(state.id)}-\\d+$`).test(el.id), nodes, failed)
  // State transition ids are only edge<N>; they carry no endpoint identity.
  // Nested states reorder them, so leave transitions and their labels code-only.
  failed.push(...graph.transitions.map(t => t.entityId))

  markUncorrelated(svg)
  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's class-diagram SVG (dagre wrapper, like flowcharts). */
export function correlateClass(svg: SVGSVGElement, graph: ClassGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.node')]
  matchNodes(graph.classes, nodeEls,
    (cls, el) => new RegExp(`^${esc(svg.id)}-classId-${esc(cls.id)}-\\d+$`).test(el.id), nodes, failed)

  // tag member label rows for double-click editing (mermaid displays
  // attributes first, then methods, after the class-name label)
  for (const cls of graph.classes) {
    const el = nodes.get(cls.entityId)
    if (!el) continue
    const labels = [...el.querySelectorAll<HTMLElement>('.nodeLabel')]
    const attrs = cls.members.filter((m) => !m.text.includes('('))
    const methods = cls.members.filter((m) => m.text.includes('('))
    const displayed = [...attrs, ...methods]
    displayed.forEach((m, i) => {
      const lab = labels[i + 1]
      if (lab) {
        lab.setAttribute('data-mw-member-class', cls.id)
        lab.setAttribute('data-mw-member-line', String(m.lineIndex))
      }
    })
  }

  matchRelations(svg, graph.relations, r => `id_${r.source}_${r.target}_`, edges, edgeLabels, failed)

  markUncorrelated(svg)
  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's ER SVG: entity groups carry `entity-<id>` prefixed ids. */
export function correlateEr(svg: SVGSVGElement, graph: ErGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  matchNodes(graph.entities, [...svg.querySelectorAll<SVGGElement>('g.node')],
    (entity, el) => new RegExp(`^${esc(svg.id)}-entity-${esc(entity.id)}-\\d+$`).test(el.id), nodes, failed)

  // tag attribute rows (4 .nodeLabel cells per attribute, after the name label)
  for (const entity of graph.entities) {
    const el = nodes.get(entity.entityId)
    if (!el || !entity.attributes.length) continue
    const labels = [...el.querySelectorAll<HTMLElement>('.nodeLabel')]
    entity.attributes.forEach((attr, i) => {
      for (let cell = 0; cell < 4; cell++) {
        const lab = labels[1 + i * 4 + cell]
        if (lab) {
          lab.setAttribute('data-mw-attr-entity', entity.id)
          lab.setAttribute('data-mw-attr-line', String(attr.lineIndex))
        }
      }
    })
  }

  matchRelations(svg, graph.relations, r => {
    const source = nodes.get(`entity:${r.source}`), target = nodes.get(`entity:${r.target}`)
    return source && target ? `id_${source.id.slice(svg.id.length + 1)}_${target.id.slice(svg.id.length + 1)}_` : null
  }, edges, edgeLabels, failed)

  markUncorrelated(svg)
  return { nodes, edges, edgeLabels, failed }
}

/**
 * Correlate mermaid's pie SVG. Mermaid sorts slices by value before drawing,
 * so index matching against the document fails — but the legend rows and the
 * slice paths share d3's draw order, and legend text carries the label.
 */
export function correlatePie(svg: SVGSVGElement, graph: PieGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const paths = [...svg.querySelectorAll<SVGGElement>('.pieCircle')]
  const legends = [...svg.querySelectorAll<SVGGElement>('g.legend')]
  legends.forEach((legend, i) => {
    const text = legend.querySelector('text')?.textContent?.trim() ?? ''
    const slice = graph.slices.find((s) => s.label === text || text.startsWith(`${s.label} `))
    if (!slice) return
    const path = paths[i]
    if (path && !nodes.has(slice.entityId)) {
      nodes.set(slice.entityId, path)
      path.setAttribute('data-mw-entity', slice.entityId)
      legend.setAttribute('data-mw-entity', slice.entityId)
    }
  })
  for (const s of graph.slices) if (!nodes.has(s.entityId)) failed.push(s.entityId)

  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's gantt SVG: task bars render in document order. */
export function correlateGantt(svg: SVGSVGElement, graph: GanttGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const bars = [...svg.querySelectorAll<SVGGElement>('rect.task')]
  const texts = [...svg.querySelectorAll<SVGGElement>('text.taskText')]
  if (bars.length === graph.tasks.length) {
    graph.tasks.forEach((t, i) => {
      nodes.set(t.entityId, bars[i])
      bars[i].setAttribute('data-mw-entity', t.entityId)
      texts[i]?.setAttribute('data-mw-entity', t.entityId)
    })
  } else {
    for (const t of graph.tasks) failed.push(t.entityId)
  }
  return { nodes, edges, edgeLabels, failed }
}

/**
 * Generic correlation for line-item chart types: match each item's rendered
 * label by text content against the SVG's text-bearing elements. Diagram-type
 * agnostic — items whose label can't be found stay code-only.
 */
export function correlateLineItems(svg: SVGSVGElement, graph: LineItemsGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  // leaf text carriers: svg <text>/<tspan-parents> and html label spans
  const candidates = [...svg.querySelectorAll<Element>('text, span, p, div')].filter(
    (el) => el.children.length === 0 || el.tagName === 'text',
  )
  const claimed = new Set<Element>()

  for (const item of graph.items) {
    if (!item.matchText) {
      failed.push(item.entityId)
      continue
    }
    const target = item.matchText.trim()
    let el =
      candidates.find((c) => !claimed.has(c) && c.textContent?.trim() === target) ??
      candidates.find((c) => !claimed.has(c) && (c.textContent?.trim().startsWith(target) ?? false))
    if (!el) {
      failed.push(item.entityId)
      continue
    }
    claimed.add(el)
    // tag a small ancestor group when available so hit areas include shapes
    let anchor: Element = el
    const parent = el.closest('g') ?? el.parentElement
    if (parent && parent !== svg && (parent.textContent?.trim().length ?? 0) <= target.length + 24) {
      anchor = parent
    }
    anchor.setAttribute('data-mw-entity', item.entityId)
    if (anchor !== el) el.setAttribute('data-mw-entity', item.entityId)
    // several chart renderers disable pointer events on labels — re-enable so
    // the item is clickable (an explicit 'auto' wins over an ancestor 'none')
    for (const target of new Set([anchor, el])) {
      const style = (target as HTMLElement | SVGElement).style
      if (style) style.pointerEvents = 'auto'
    }
    nodes.set(item.entityId, anchor as SVGGElement)
  }

  return { nodes, edges, edgeLabels, failed }
}

export interface SequenceCorrelation {
  /** participant entity id → every SVG element belonging to it (top + bottom boxes) */
  participants: Map<string, Element[]>
  /** participant entity id → lifeline <line> element */
  lifelines: Map<string, SVGLineElement>
  /** event entity id → primary element (message line / note rect) */
  events: Map<string, Element>
  /** event entity id → its text element */
  eventTexts: Map<string, Element>
  failed: string[]
}

/**
 * Correlate mermaid's sequence-diagram SVG. Mermaid renders messages, notes and
 * actors in document order, so index matching is reliable; actor elements also
 * carry a `name` attribute we can key on.
 */
export function correlateSequence(svg: SVGSVGElement, graph: SequenceGraph): SequenceCorrelation {
  const participants = new Map<string, Element[]>()
  const lifelines = new Map<string, SVGLineElement>()
  const events = new Map<string, Element>()
  const eventTexts = new Map<string, Element>()
  const failed: string[] = []

  // --- participants: mermaid stamps `name="<id>"` on actor rects/paths/lines
  for (const p of graph.participants) {
    const els = [...svg.querySelectorAll(`[name="${CSS.escape(p.id)}"]`)]
    if (els.length) {
      participants.set(p.entityId, els)
      for (const el of els) el.setAttribute('data-mw-entity', p.entityId)
      // also tag the text label drawn next to each actor element
      for (const el of els) {
        const g = el.parentElement
        if (g && (g as Element).tagName === 'g') (g as Element).setAttribute('data-mw-entity', p.entityId)
      }
    } else {
      failed.push(p.entityId)
    }
  }

  // --- lifelines: match by x proximity to each participant's box (DOM order
  // of `line.actor-line` is NOT guaranteed to follow declaration order)
  const lifelineEls = [...svg.querySelectorAll<SVGLineElement>('line.actor-line, .actor-line')]
  for (const p of graph.participants) {
    const els = participants.get(p.entityId)
    if (!els?.length) continue
    const box = (els[0] as SVGGraphicsElement).getBoundingClientRect()
    const cx = box.left + box.width / 2
    let best: SVGLineElement | null = null
    let bestDist = Infinity
    for (const l of lifelineEls) {
      const r = l.getBoundingClientRect()
      const d = Math.abs(r.left + r.width / 2 - cx)
      if (d < bestDist) {
        bestDist = d
        best = l as SVGLineElement
      }
    }
    if (best && bestDist < 40) lifelines.set(p.entityId, best)
  }

  // --- messages: text.messageText + messageLine paths, both in message order
  const messages = graph.events.filter((e) => e.kind === 'message')
  const msgTexts = [...svg.querySelectorAll('text.messageText')]
  const msgLines = [...svg.querySelectorAll('.messageLine0, .messageLine1')]
  messages.forEach((ev, i) => {
    const line = msgLines[i]
    const text = msgTexts[i]
    if (line) {
      events.set(ev.entityId, line)
      line.setAttribute('data-mw-entity', ev.entityId)
    } else {
      failed.push(ev.entityId)
    }
    if (text) {
      eventTexts.set(ev.entityId, text)
      text.setAttribute('data-mw-entity', ev.entityId)
    }
  })

  // --- notes: rect.note + text.noteText in note order
  const notes = graph.events.filter((e) => e.kind === 'note')
  const noteRects = [...svg.querySelectorAll('.note')]
  const noteTexts = [...svg.querySelectorAll('.noteText')]
  notes.forEach((ev, i) => {
    const rect = noteRects[i]
    const text = noteTexts[i]
    if (rect) {
      events.set(ev.entityId, rect)
      rect.setAttribute('data-mw-entity', ev.entityId)
      const g = rect.parentElement
      if (g && (g as Element).tagName === 'g') (g as Element).setAttribute('data-mw-entity', ev.entityId)
    } else {
      failed.push(ev.entityId)
    }
    if (text) {
      eventTexts.set(ev.entityId, text)
      text.setAttribute('data-mw-entity', ev.entityId)
    }
  })

  return { participants, lifelines, events, eventTexts, failed }
}
