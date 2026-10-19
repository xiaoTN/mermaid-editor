import type { LineInfo, Span, TextEdit } from '../types'
import { applyEdits, classifyLines, diffText, scanLines } from '../text'
import { buildFlowGraph, type FlowGraph, type FlowEdge, type FlowNode } from './graph'
import { SHAPE_DELIMS, type ChainStmt, type EdgeArrow, type EdgeLine, type FlowStmt, type NodeRef, type ShapeId } from './parse'

export type FlowchartOp =
  | { type: 'addNode'; shape?: ShapeId; label?: string; id?: string }
  | { type: 'connect'; source: string; target: string; line?: EdgeLine; arrowEnd?: EdgeArrow; label?: string }
  | { type: 'renameNode'; id: string; label: string }
  | { type: 'setNodeShape'; id: string; shape: ShapeId }
  | { type: 'setEdgeLabel'; edgeId: string; label: string }
  | { type: 'setEdgeStyle'; edgeId: string; line?: EdgeLine; arrowEnd?: EdgeArrow }
  | { type: 'setDirection'; direction: string }
  | { type: 'deleteNode'; id: string }
  | { type: 'deleteEdge'; edgeId: string }
  | { type: 'renameSubgraph'; id: string; title: string }
  | { type: 'setNodeColor'; id: string; prop: 'fill' | 'stroke' | 'color'; value: string | null }
  | { type: 'setEdgeColor'; edgeId: string; value: string | null }
  | { type: 'reverseEdge'; edgeId: string }
  | { type: 'duplicateNode'; id: string }

export interface OpResult {
  edits: TextEdit[]
  /** entity ids created by this op (e.g. the new node) */
  created?: string[]
}

export interface FlowOpContext {
  code: string
  lines: LineInfo[]
  graph: FlowGraph
}

// ---------- helpers ----------

const NEEDS_QUOTE = /[[\]{}()|<>"\\/&%#;]|^\s|\s$|\bend\b|--|==|-\.|~~~/

function escapeLabel(label: string): string {
  // Preserve existing Mermaid/HTML entities, including their literal `#`.
  return label.replace(/"/g, '#quot;')
}

function printLabel(label: string, forceQuote: boolean): string {
  const escaped = escapeLabel(label)
  if (forceQuote || NEEDS_QUOTE.test(label)) return `"${escaped}"`
  return escaped
}

function isQuotedLabel(label: string | null): boolean {
  return label !== null && label.length >= 2 && label.startsWith('"') && label.endsWith('"')
}

function printEdgeLabel(label: string, forceQuote = false): string {
  return printLabel(label.replace(/\|/g, '#124;'), forceQuote)
}

function edgeOpString(line: EdgeLine, arrowEnd: EdgeArrow): string {
  const end = arrowEnd === 'arrow' ? '>' : arrowEnd === 'cross' ? 'x' : arrowEnd === 'circle' ? 'o' : ''
  switch (line) {
    case 'thick':
      return end ? `==${end}` : '==='
    case 'dotted':
      return end ? `-.-${end}` : '-.-'
    case 'invisible':
      return '~~~'
    default:
      return end ? `--${end}` : '---'
  }
}

function bodyIndent(ctx: FlowOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function eolOf(ctx: FlowOpContext): string {
  return ctx.code.includes('\r\n') ? '\r\n' : '\n'
}

function lineBody(line: LineInfo): Span {
  return { start: line.start, end: line.end - (line.text.endsWith('\r') ? 1 : 0) }
}

function logicalEndLine(ctx: FlowOpContext, lineIndex: number): number {
  while (ctx.lines[lineIndex + 1]?.kind === 'continuation') lineIndex++
  return lineIndex
}

export function insertLinesBefore(ctx: FlowOpContext, lineIndex: number, texts: string[]): TextEdit {
  const start = ctx.lines[lineIndex].start
  const eol = eolOf(ctx)
  return { start, end: start, text: texts.map((text) => text + eol).join('') }
}

function insertLinesAfter(ctx: FlowOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[logicalEndLine(ctx, lineIndex)]
  const at = lineBody(line).end
  return { start: at, end: at, text: texts.map((t) => `${eolOf(ctx)}${t}`).join('') }
}

function deleteLineEdit(ctx: FlowOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  const last = ctx.lines[logicalEndLine(ctx, lineIndex)]
  if (last.end < ctx.code.length) return { start: line.start, end: last.end + 1, text: '' }
  if (line.start > 0) {
    const eolLength = ctx.code.slice(line.start - 2, line.start) === '\r\n' ? 2 : 1
    return { start: line.start - eolLength, end: last.end, text: '' }
  }
  return { start: line.start, end: last.end, text: '' }
}

type StatementChanges = Map<FlowStmt, string[]>

/** Replace statement spans; remove adjacent separators only when a statement disappears. */
function statementEdits(ctx: FlowOpContext, changes: StatementChanges): TextEdit[] {
  const edits: TextEdit[] = []
  for (const lineIndex of new Set([...changes.keys()].map((stmt) => stmt.lineIndex))) {
    const stmts = ctx.graph.statements.get(lineIndex)!
    const removed = (stmt: FlowStmt) => changes.get(stmt)?.length === 0
    if (stmts.every(removed)) {
      const last = ctx.lines[logicalEndLine(ctx, lineIndex)]
      const suffix = ctx.code.slice(stmts[stmts.length - 1].span.end, lineBody(last).end)
      if (!suffix.trimStart().startsWith('%%')) {
        edits.push(deleteLineEdit(ctx, lineIndex))
        continue
      }
    }
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]
      if (removed(stmt)) {
        let endIndex = i
        while (endIndex + 1 < stmts.length && removed(stmts[endIndex + 1])) endIndex++
        edits.push({
          start: endIndex + 1 < stmts.length || i === 0 ? stmt.span.start : stmts[i - 1].span.end,
          end: endIndex + 1 < stmts.length ? stmts[endIndex + 1].span.start : stmts[endIndex].span.end,
          text: '',
        })
        i = endIndex
      } else if (changes.has(stmt)) {
        const text = changes.get(stmt)!.join(eolOf(ctx) + ctx.lines[lineIndex].indent)
        const diff = diffText(slice(ctx, stmt.span), text)
        if (diff) edits.push({ start: stmt.span.start + diff.start, end: stmt.span.start + diff.end, text: diff.text })
      }
    }
  }
  // Adjacent deleted physical lines at EOF can share the preceding newline.
  const sorted = edits.sort((a, b) => a.start - b.start)
  const merged: TextEdit[] = []
  for (const edit of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && previous.text === '' && edit.text === '' && edit.start <= previous.end) {
      previous.end = Math.max(previous.end, edit.end)
    } else merged.push(edit)
  }
  const last = merged[merged.length - 1]
  if (last?.text === '' && last.end === ctx.code.length && !ctx.code.endsWith('\n') && ctx.code[last.start - 1] === '\n') {
    last.start -= ctx.code[last.start - 2] === '\r' ? 2 : 1
  }
  return merged
}

function slice(ctx: FlowOpContext, span: { start: number; end: number }): string {
  return ctx.code.slice(span.start, span.end)
}

function generateNodeId(graph: FlowGraph, preferred?: string): string {
  const existing = new Set(graph.nodes.map((n) => n.id))
  if (preferred && !existing.has(preferred)) return preferred
  const allLetters = graph.nodes.length > 0 && graph.nodes.every((n) => /^[A-Z]$/.test(n.id))
  if (allLetters) {
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i)
      if (!existing.has(c)) return c
    }
  }
  let i = 1
  while (existing.has(`n${i}`)) i++
  return `n${i}`
}

function lastRefLine(graph: FlowGraph, ids: string[]): number {
  let last = graph.lastContentLine
  let found = -1
  for (const id of ids) {
    const n = graph.nodeById.get(id)
    if (!n) continue
    for (const r of n.refs) found = Math.max(found, r.lineIndex)
  }
  return found === -1 ? last : found
}

/**
 * Rebuild a chain statement without a node and/or without one specific edge.
 * Returns replacement line texts ([] = drop the line). Preserves the exact
 * source text of surviving refs and edge segments.
 */
function rebuildChain(
  ctx: FlowOpContext,
  lineIndex: number,
  chain: ChainStmt,
  opts: { dropNodeId?: string; dropEdge?: { segIndex: number; source: string; target: string } },
): string[] {
  interface Expanded {
    a: NodeRef
    b: NodeRef
    segIndex: number
  }
  const expanded: Expanded[] = []
  chain.edges.forEach((_, i) => {
    for (const a of chain.groups[i]) {
      for (const b of chain.groups[i + 1]) {
        expanded.push({ a, b, segIndex: i })
      }
    }
  })

  const kept = expanded.filter((e) => {
    if (opts.dropNodeId && (e.a.id === opts.dropNodeId || e.b.id === opts.dropNodeId)) return false
    if (
      opts.dropEdge &&
      e.segIndex === opts.dropEdge.segIndex &&
      e.a.id === opts.dropEdge.source &&
      e.b.id === opts.dropEdge.target
    ) {
      return false
    }
    return true
  })

  if (kept.length === expanded.length && !opts.dropNodeId) return [slice(ctx, chain.span)]

  const survivors = new Set<NodeRef>()
  for (const e of kept) {
    survivors.add(e.a)
    survivors.add(e.b)
  }

  // re-chain greedily: A-->B-->C stays one line where the refs connect
  const out: string[] = []
  let current = ''
  let lastB: NodeRef | null = null
  for (const e of kept) {
    const seg = chain.edges[e.segIndex]
    const segStart = seg.idSpan?.start ?? seg.span.start
    const segText = slice(ctx, { start: segStart, end: seg.span.end })
    const sourceGroup = chain.groups[e.segIndex]
    const before = slice(ctx, { start: sourceGroup[sourceGroup.length - 1].span.end, end: segStart })
    const after = slice(ctx, { start: seg.span.end, end: chain.groups[e.segIndex + 1][0].span.start })
    if (lastB === e.a && current) {
      current += `${before}${segText}${after}${slice(ctx, e.b.span)}`
    } else {
      if (current) out.push(current)
      current = `${slice(ctx, e.a.span)}${before}${segText}${after}${slice(ctx, e.b.span)}`
    }
    lastB = e.b
  }
  if (current) out.push(current)

  // preserve standalone declarations for refs that lost all their edges on this
  // line but carry information (a shape/label) or are defined nowhere else
  for (const group of chain.groups) {
    for (const ref of group) {
      if (ref.id === opts.dropNodeId) continue
      if (survivors.has(ref)) continue
      const node = ctx.graph.nodeById.get(ref.id)
      if (!node) continue
      const shapedElsewhere = node.refs.some((r) => r.ref !== ref && r.ref.shape)
      const referencedElsewhere = node.refs.some((r) => r.lineIndex !== lineIndex || r.stmtIndex !== chain.stmtIndex || (r.ref !== ref && survivors.has(r.ref)))
      if (ref.shape && !shapedElsewhere) {
        out.push(slice(ctx, ref.span))
      } else if (!referencedElsewhere && !ref.shape) {
        out.push(slice(ctx, ref.span))
      }
    }
  }

  return out
}

function findEdge(graph: FlowGraph, edgeId: string): FlowEdge | null {
  return graph.edges.find((e) => e.entityId === edgeId) ?? null
}

const LINK_STYLE_INDICES = /^(\s*linkStyle\s+)(\d+(?:\s*,\s*\d+)*)(?=\s)/

/** Only rewrite the numeric list; keep separators and the entire style suffix. */
function remapLinkStyle(raw: string, map: (index: number) => number | null): string | null {
  const match = LINK_STYLE_INDICES.exec(raw)
  // In particular, `linkStyle default` never participates in index remapping.
  if (!match) return raw
  const parts = match[2].split(/(\s*,\s*)/)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const oldIndex = Number(parts[i])
    const newIndex = map(oldIndex)
    if (newIndex === null) continue
    if (kept.length) kept.push(parts[i - 1])
    kept.push(newIndex === oldIndex ? parts[i] : String(newIndex))
  }
  if (kept.length === 0) return null
  return match[1] + kept.join('') + raw.slice(match[1].length + match[2].length)
}

/** Map each list member independently; drop a statement only when none survive. */
function renumberLinkStyles(ctx: FlowOpContext, map: (index: number) => number | null, changes: StatementChanges = new Map()): StatementChanges {
  for (const stmt of [...ctx.graph.statements.values()].flat()) {
    if (stmt.kind !== 'linkStyle') continue
    const raw = slice(ctx, stmt.span)
    const text = remapLinkStyle(raw, map)
    if (text !== raw) changes.set(stmt, text === null ? [] : [text])
  }
  return changes
}

/**
 * `before` contains surviving edges with their original order indices. Match
 * parallel edges by endpoints, explicit id and occurrence, since entity ids
 * themselves change when an earlier occurrence is deleted. Connect inserts
 * after both endpoints' last references, hence after all existing parallels.
 */
function orderPermutation(before: FlowEdge[], afterCode: string): (index: number) => number | null {
  const lines = scanLines(afterCode)
  const { headerIndex } = classifyLines(lines)
  const after = buildFlowGraph(lines, headerIndex).edges
  const key = (edge: FlowEdge) => JSON.stringify([edge.source, edge.target, edge.seg.edgeId])
  const orders = new Map<string, number[]>()
  for (const edge of after) {
    const identity = key(edge)
    const queue = orders.get(identity) ?? []
    queue.push(edge.order)
    orders.set(identity, queue)
  }
  const permutation = new Map<number, number>()
  for (const edge of before) {
    const order = orders.get(key(edge))?.shift()
    if (order !== undefined) permutation.set(edge.order, order)
  }
  return (index) => permutation.get(index) ?? null
}

/** Reparse the structural edits, then compile styles in the original coordinates. */
function structuralEdits(ctx: FlowOpContext, before: FlowEdge[], changes: StatementChanges, extra: TextEdit[] = []): TextEdit[] {
  const afterCode = applyEdits(ctx.code, [...extra, ...statementEdits(ctx, changes)]).text
  const map = orderPermutation(before, afterCode)
  return [...extra, ...statementEdits(ctx, renumberLinkStyles(ctx, map, changes))]
}

function nodeOf(graph: FlowGraph, id: string): FlowNode | null {
  return graph.nodeById.get(id) ?? null
}

// ---------- compiler ----------

export function compileFlowchartOp(ctx: FlowOpContext, op: FlowchartOp): OpResult | null {
  const { graph } = ctx

  switch (op.type) {
    case 'addNode': {
      const id = generateNodeId(graph, op.id)
      const shape = op.shape ?? 'rect'
      const label = op.label ?? id
      const { open, close } = SHAPE_DELIMS[shape]
      const text = `${bodyIndent(ctx)}${id}${open}${printLabel(label, false)}${close}`
      const edit = insertLinesAfter(ctx, graph.lastContentLine, [text])
      return { edits: [edit], created: [`node:${id}`] }
    }

    case 'connect': {
      const src = nodeOf(graph, op.source)
      const tgt = nodeOf(graph, op.target)
      if (!src || !tgt) return null
      const opStr = edgeOpString(op.line ?? 'solid', op.arrowEnd ?? 'arrow')
      const label = op.label ? `|${printEdgeLabel(op.label)}|` : ''
      const after = lastRefLine(graph, [op.source, op.target])
      const indent = ctx.lines[after].kind === 'statement' ? ctx.lines[after].indent : bodyIndent(ctx)
      const text = `${indent}${op.source} ${opStr}${label} ${op.target}`
      const occ = graph.edges.filter((e) => e.source === op.source && e.target === op.target).length
      return {
        edits: structuralEdits(ctx, graph.edges, new Map(), [insertLinesAfter(ctx, after, [text])]),
        created: [`edge:${op.source}->${op.target}#${occ}`],
      }
    }

    case 'renameNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      if (node.primary && node.primary.ref.labelSpan) {
        const ref = node.primary.ref
        const span = ref.labelSpan!
        if (ref.quoted) {
          const label = ref.markdown ? op.label.replace(/\r?\n/g, eolOf(ctx)) : op.label
          return { edits: [{ start: span.start, end: span.end, text: escapeLabel(label) }] }
        }
        return { edits: [{ start: span.start, end: span.end, text: printLabel(op.label, false) }] }
      }
      // implicit node: attach a rect declaration at its first reference
      const first = node.refs[0]
      if (!first) return null
      const at = first.ref.idSpan.end
      return { edits: [{ start: at, end: at, text: `[${printLabel(op.label, false)}]` }] }
    }

    case 'setNodeShape': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const { open, close } = SHAPE_DELIMS[op.shape]
      if (node.primary && node.primary.ref.labelSpan) {
        const ref = node.primary.ref
        const oldDelims = SHAPE_DELIMS[ref.shape!]
        const q = ref.markdown ? 2 : ref.quoted ? 1 : 0
        const openStart = ref.idSpan.end
        const openEnd = ref.labelSpan!.start - q
        const closeStart = ref.labelSpan!.end + q
        const closeEnd = closeStart + oldDelims.close.length
        return {
          edits: [
            { start: openStart, end: openEnd, text: open },
            { start: closeStart, end: closeEnd, text: close },
          ],
        }
      }
      const first = node.refs[0]
      if (!first) return null
      const at = first.ref.idSpan.end
      return { edits: [{ start: at, end: at, text: `${open}${printLabel(node.label, false)}${close}` }] }
    }

    case 'setEdgeLabel': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const label = op.label
      if (edge.seg.labelSpan) {
        if (label === '') {
          // remove the label entirely by rewriting the operator
          const opStr = edgeOpString(edge.seg.line, edge.seg.arrowEnd)
          return { edits: [{ start: edge.seg.span.start, end: edge.seg.span.end, text: opStr }] }
        }
        return { edits: [{ start: edge.seg.labelSpan.start, end: edge.seg.labelSpan.end, text: printEdgeLabel(label, isQuotedLabel(edge.seg.label)) }] }
      }
      if (label === '') return { edits: [] }
      return { edits: [{ start: edge.seg.span.end, end: edge.seg.span.end, text: `|${printEdgeLabel(label)}|` }] }
    }

    case 'setEdgeStyle': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const line = op.line ?? edge.seg.line
      const arrowEnd = op.arrowEnd ?? edge.seg.arrowEnd
      const opStr = edgeOpString(line, arrowEnd)
      const quoted = isQuotedLabel(edge.seg.label)
      const content = quoted ? edge.seg.label!.slice(1, -1) : edge.seg.label
      const label = content !== null ? `|${printEdgeLabel(content, quoted)}|` : ''
      return { edits: [{ start: edge.seg.span.start, end: edge.seg.span.end, text: `${opStr}${label}` }] }
    }

    case 'setDirection': {
      if (graph.directionSpan) {
        return { edits: [{ start: graph.directionSpan.start, end: graph.directionSpan.end, text: op.direction }] }
      }
      const header = ctx.lines[graph.headerLine]
      const kwEnd = header.start + header.indent.length + graph.keyword.length
      return { edits: [{ start: kwEnd, end: kwEnd, text: ` ${op.direction}` }] }
    }

    case 'deleteEdge': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const stmt = graph.statements.get(edge.lineIndex)?.[edge.stmtIndex]
      if (!stmt || stmt.kind !== 'chain') return null
      const texts = rebuildChain(ctx, edge.lineIndex, stmt, {
        dropEdge: { segIndex: edge.segIndex, source: edge.source, target: edge.target },
      })
      const changes: StatementChanges = new Map([[stmt, texts]])
      const id = edge.seg.edgeId
      if (id && !graph.edges.some((other) => other !== edge && other.seg.edgeId === id)) {
        for (const attr of [...graph.statements.values()].flat()) {
          if (attr.kind === 'edgeAttrs' && attr.ids[0] === id) changes.set(attr, [])
        }
      }
      return {
        edits: structuralEdits(ctx, graph.edges.filter((other) => other !== edge), changes),
      }
    }

    case 'deleteNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const edits: TextEdit[] = []
      const changes: StatementChanges = new Map()
      const chainLines = new Set<number>()
      for (const r of node.refs) chainLines.add(r.lineIndex)
      for (const lineIndex of chainLines) {
        for (const stmt of graph.statements.get(lineIndex) ?? []) {
          if (stmt.kind !== 'chain' || !stmt.groups.some((group) => group.some((ref) => ref.id === op.id))) continue
          changes.set(stmt, rebuildChain(ctx, lineIndex, stmt, { dropNodeId: op.id }))
        }
      }
      // clean up class/style/click statements that reference the node
      for (const stmt of [...graph.statements.values()].flat()) {
        if (stmt.kind === 'classAssign' && stmt.ids.includes(op.id) && stmt.idsSpan) {
          const remaining = stmt.ids.filter((i) => i !== op.id)
          if (remaining.length === 0) changes.set(stmt, [])
          else edits.push({ start: stmt.idsSpan.start, end: stmt.idsSpan.end, text: remaining.join(',') })
        } else if ((stmt.kind === 'style' || stmt.kind === 'click') && stmt.ids[0] === op.id) {
          changes.set(stmt, [])
        } else if (stmt.kind === 'edgeAttrs') {
          const associated = graph.edges.filter((edge) => edge.seg.edgeId === stmt.ids[0])
          if (associated.every((edge) => edge.source === op.id || edge.target === op.id)) changes.set(stmt, [])
        }
      }
      const surviving = graph.edges.filter((edge) => edge.source !== op.id && edge.target !== op.id)
      return { edits: structuralEdits(ctx, surviving, changes, edits) }
    }

    case 'duplicateNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const newId = generateNodeId(graph)
      const { open, close } = SHAPE_DELIMS[node.shape]
      const classes = node.classes.length ? `:::${node.classes[0]}` : ''
      const anchor = node.primary?.lineIndex ?? node.refs[0]?.lineIndex ?? graph.lastContentLine
      const indent = ctx.lines[anchor].kind === 'statement' ? ctx.lines[anchor].indent : bodyIndent(ctx)
      const text = `${indent}${newId}${open}${printLabel(node.label, false)}${close}${classes}`
      return {
        edits: [insertLinesAfter(ctx, anchor, [text])],
        created: [`node:${newId}`],
      }
    }

    case 'reverseEdge': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const stmt = graph.statements.get(edge.lineIndex)?.[edge.stmtIndex]
      // only safe on a simple `A --> B` statement — in chains/fans, swapping
      // the two refs would silently rewire the neighbors
      if (!stmt || stmt.kind !== 'chain' || stmt.groups.length !== 2) return null
      if (stmt.groups[0].length !== 1 || stmt.groups[1].length !== 1) return null
      const srcRaw = slice(ctx, edge.sourceRef.span)
      const tgtRaw = slice(ctx, edge.targetRef.span)
      return {
        edits: [
          { start: edge.sourceRef.span.start, end: edge.sourceRef.span.end, text: tgtRaw },
          { start: edge.targetRef.span.start, end: edge.targetRef.span.end, text: srcRaw },
        ],
      }
    }

    case 'setNodeColor': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      // manage a `style <id> k:v,k:v` statement for this node
      let styleStmt: FlowStmt | undefined
      for (const stmt of [...graph.statements.values()].flat()) {
        if (stmt.kind === 'style' && stmt.ids[0] === op.id) {
          styleStmt = stmt
          break
        }
      }
      const props = new Map<string, string>()
      if (styleStmt) {
        const rest = slice(ctx, styleStmt.span).replace(/^style\s+\S+\s*/, '')
        for (const pair of rest.split(',')) {
          const i = pair.indexOf(':')
          if (i > 0) props.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
        }
      }
      if (op.value === null) props.delete(op.prop)
      else props.set(op.prop, op.value)
      // a readable stroke needs some width; keep mermaid's default otherwise
      if (props.has('stroke') && !props.has('stroke-width')) props.set('stroke-width', '2px')
      if (!props.has('stroke')) props.delete('stroke-width')

      const text = `style ${op.id} ${[...props].map(([k, v]) => `${k}:${v}`).join(',')}`
      if (styleStmt) {
        return { edits: statementEdits(ctx, new Map([[styleStmt, props.size === 0 ? [] : [text]]])) }
      }
      if (props.size === 0) return { edits: [] }
      return { edits: [insertLinesAfter(ctx, graph.lastContentLine, [bodyIndent(ctx) + text])] }
    }

    case 'setEdgeColor': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      // linkStyle addresses edges by render index (== document order)
      let linkStmt: FlowStmt | undefined
      let shared = false
      for (const stmt of [...graph.statements.values()].flat()) {
        if (stmt.kind !== 'linkStyle') continue
        const match = LINK_STYLE_INDICES.exec(slice(ctx, stmt.span))
        const indices = match?.[2].split(/\s*,\s*/).map(Number)
        if (indices?.includes(edge.order)) {
          linkStmt = stmt
          shared = indices.some((index) => index !== edge.order)
          break
        }
      }
      const changes: StatementChanges = new Map()
      if (linkStmt) {
        const remaining = remapLinkStyle(slice(ctx, linkStmt.span), (index) => index === edge.order ? null : index)
        changes.set(linkStmt, remaining === null ? [] : [remaining])
      }
      if (op.value === null) {
        return { edits: statementEdits(ctx, changes) }
      }
      const text = `linkStyle ${edge.order} stroke:${op.value},stroke-width:2px`
      if (linkStmt && !shared) return { edits: statementEdits(ctx, new Map([[linkStmt, [text]]])) }
      return { edits: [...statementEdits(ctx, changes), insertLinesAfter(ctx, graph.lastContentLine, [bodyIndent(ctx) + text])] }
    }

    case 'renameSubgraph': {
      const sg = graph.subgraphs.find((s) => s.id === op.id)
      if (!sg) return null
      if (sg.titleSpan) {
        return { edits: [{ start: sg.titleSpan.start, end: sg.titleSpan.end, text: op.title.replace(/[\]"]/g, '') }] }
      }
      const line = ctx.lines[sg.openLine]
      const stmt = graph.statements.get(sg.openLine)?.find((item) => item.kind === 'subgraphOpen' && item.id === sg.id)
      const at = stmt?.span.end ?? lineBody(line).end
      return { edits: [{ start: at, end: at, text: ` [${op.title.replace(/[\]"]/g, '')}]` }] }
    }
  }
}
