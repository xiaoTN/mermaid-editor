import { MermaidWysiwygEditor, flowchartOrderPeers, flowchartSubgraphOrderPeers, flowchartSubgraphContains, mermaidSource, type EditorNotice, type FlowchartOp } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from './correlate'
import { t, onLocaleChange } from './i18n'
import { LayoutComparison, LAYOUT_COMPARISON_CSS } from './layoutComparison'
import type { MermaidLike } from './view'

type Axis = 'x' | 'y'
type Box = { x: number; y: number; width: number; height: number }
type Order = { ids: string[]; axis: Axis }
interface Session {
  id: string
  code: string
  group: string | null
  order: Order | null
  boxes: Map<string, Box>
  keyboard: boolean
  isGroup: boolean
}
interface Candidate {
  key: string
  op: FlowchartOp
  code: string
  order?: Order
  state: 'loading' | 'ready' | 'blocked'
  alternate: boolean
}

let previewSerial = 0

function sameLayer(a: Box, b: Box, axis: Axis, isGroup: boolean) {
  const other = axis === 'x' ? 'y' : 'x'
  const size = other === 'x' ? 'width' : 'height'
  return Math.abs(a[other] - b[other]) <= (isGroup ? (a[size] + b[size]) / 2 - 1 : 4)
}

/** 拖动只修改临时副本；真实排版通过且预览已经显示后，才允许提交一次修改。 */
export class NodeMovePreview {
  private panel = document.createElement('aside')
  private title = document.createElement('strong')
  private status = document.createElement('div')
  private image = document.createElement('div')
  private actions = document.createElement('div')
  private applyButton = document.createElement('button')
  private cancelButton = document.createElement('button')
  private controls = document.createElement('div')
  private footer = document.createElement('div')
  private beforeLabel = document.createElement('span')
  private afterLabel = document.createElement('span')
  private onlyAfterLabel = document.createElement('label')
  private onlyAfterInput = document.createElement('input')
  private onlyAfterText = document.createElement('span')
  private comparison: LayoutComparison | null = null
  private session: Session | null = null
  private candidate: Candidate | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private disposers: (() => void)[] = []

  constructor(private editor: MermaidWysiwygEditor, private host: HTMLElement, private mermaid: MermaidLike,
    private svg: () => SVGSVGElement | null, private readonly: () => boolean,
    private notify: (notices: EditorNotice[]) => void) {
    this.panel.className = 'mw-drag-preview'
    this.panel.hidden = true
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    this.image.className = 'mw-drag-preview-image'
    this.image.setAttribute('aria-hidden', 'true')
    this.controls.className = 'mw-preview-controls'
    this.footer.className = 'mw-preview-footer'
    this.beforeLabel.className = 'mw-preview-legend before'
    this.afterLabel.className = 'mw-preview-legend after'
    this.onlyAfterInput.type = 'checkbox'
    this.onlyAfterInput.addEventListener('change', () => this.comparison?.setOnlyAfter(this.onlyAfterInput.checked))
    this.onlyAfterLabel.append(this.onlyAfterInput, this.onlyAfterText)
    this.controls.append(this.title, this.beforeLabel, this.afterLabel, this.onlyAfterLabel)
    this.actions.className = 'mw-drag-preview-actions'
    this.applyButton.type = this.cancelButton.type = 'button'
    this.applyButton.addEventListener('click', () => this.drop())
    this.cancelButton.addEventListener('click', () => { this.cancel(); this.host.focus({ preventScroll: true }) })
    this.actions.append(this.cancelButton, this.applyButton)
    this.footer.append(this.status, this.actions)
    this.panel.append(this.image, this.controls, this.footer)
    host.append(this.panel)
    this.localize()
    this.disposers.push(editor.on('change', () => this.cancel()), onLocaleChange(() => { this.cancel(); this.localize() }))
    const viewport = () => this.updateViewport()
    host.addEventListener('scroll', viewport, true); window.addEventListener('resize', viewport)
    this.disposers.push(() => { host.removeEventListener('scroll', viewport, true); window.removeEventListener('resize', viewport) })
  }

  private localize() {
    this.panel.setAttribute('aria-label', t('preview.title'))
    this.title.textContent = t('preview.title')
    this.applyButton.textContent = t('preview.apply')
    this.cancelButton.textContent = t('preview.cancel')
    this.applyButton.setAttribute('aria-label', t('preview.apply'))
    this.cancelButton.setAttribute('aria-label', t('preview.cancel'))
    this.beforeLabel.textContent = t('preview.before'); this.afterLabel.textContent = t('preview.after')
    this.onlyAfterText.textContent = t('preview.onlyAfter')
    this.onlyAfterInput.setAttribute('aria-label', t('preview.onlyAfter'))
  }

  private snapshot(id: string, svg: SVGSVGElement): Session {
    const boxes = new Map<string, Box>()
    for (const node of svg.querySelectorAll<SVGGraphicsElement>('[data-mw-entity^="node:"], [data-mw-entity^="subgraph:"]')) {
      const box = (node.getAttribute('data-mw-entity')!.startsWith('subgraph:') ? node.querySelector(':scope > rect') ?? node : node).getBoundingClientRect()
      boxes.set(node.getAttribute('data-mw-entity')!.replace(/^(node|subgraph):/, ''), {
        x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height,
      })
    }
    const graph = this.editor.result.flowchart!
    const group = graph.subgraphs.find(group => group.id === id), isGroup = !!group
    let parent = graph.subgraphs.find(parent => parent.id === group?.parent), direction = graph.direction
    while (parent) {
      const directionLine = parent.directionLines.at(-1)
      if (directionLine !== undefined) {
        direction = /\bdirection\s+(TD|TB|BT|LR|RL)\b/.exec(this.editor.result.lines[directionLine].text)?.[1] ?? direction
        break
      }
      parent = graph.subgraphs.find(group => group.id === parent!.parent)
    }
    const groupAxis: Axis = direction === 'LR' || direction === 'RL' ? 'y' : 'x'
    const source = boxes.get(id)
    const peers = (isGroup ? flowchartSubgraphOrderPeers(graph, id) : flowchartOrderPeers(graph, id)).filter(peer => boxes.has(peer))
    let order: Order | null = null
    if (source) {
      for (const peer of peers.filter(peer => peer !== id)) {
        const box = boxes.get(peer)!
        const axis: Axis | null = isGroup ? sameLayer(box, source, groupAxis, true) && Math.abs(box[groupAxis] - source[groupAxis]) > 4 ? groupAxis : null
          : sameLayer(box, source, 'x', false) && Math.abs(box.x - source.x) > 4 ? 'x'
          : sameLayer(box, source, 'y', isGroup) && Math.abs(box.y - source.y) > 4 ? 'y' : null
        if (!axis) continue
        order = { axis, ids: peers.filter(peer => sameLayer(boxes.get(peer)!, source, axis, isGroup))
          .sort((a, b) => boxes.get(a)![axis] - boxes.get(b)![axis]) }
        break
      }
    }
    return { id, code: this.editor.code, group: isGroup ? group.parent : graph.nodeById.get(id)?.subgraph ?? null, boxes, order, keyboard: false, isGroup }
  }

  begin(id: string, svg: SVGSVGElement) {
    this.cancel()
    this.session = this.snapshot(id, svg)
    const graph = this.editor.result.flowchart!
    const moving = new Set([...graph.nodes, ...graph.subgraphs].filter(item => this.session!.isGroup
      ? flowchartSubgraphContains(graph, id, item.id) : item.id === id).map(item => item.entityId))
    const anchor = graph.nodes.find(node => !moving.has(node.entityId) && !graph.subgraphs.some(group => group.id === node.id) &&
      !graph.edges.some(edge => edge.target === node.id))?.entityId
    this.comparison = new LayoutComparison(this.host, this.image, svg, `${this.session.isGroup ? 'subgraph' : 'node'}:${id}`, moving, anchor)
    this.comparison.setOnlyAfter(this.onlyAfterInput.checked)
    this.localize()
    this.actions.hidden = true
    this.applyButton.disabled = true
    this.onlyAfterInput.disabled = true
    this.panel.style.pointerEvents = 'none'
    this.panel.hidden = false
    this.idle(this.session.isGroup ? 'preview.groupChoose' : 'preview.choose')
  }

  private idle(key: 'preview.choose' | 'preview.unsupported' | 'preview.groupChoose' | 'preview.groupUnsupported' | 'preview.groupCycle' | 'drag.moveCancel') {
    ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.candidate = null
    this.comparison?.clear()
    this.status.textContent = t(key)
    this.panel.dataset.state = 'idle'
    this.onlyAfterInput.disabled = true
    this.applyButton.disabled = true
  }

  move(group: string | null, valid: boolean, x: number, y: number) {
    const session = this.session
    if (!session) return
    if (!valid) { this.idle('drag.moveCancel'); return }
    if (session.isGroup && group && flowchartSubgraphContains(this.editor.result.flowchart!, session.id, group)) {
      this.idle('preview.groupCycle'); return
    }
    if (group !== session.group) {
      this.request({ type: session.isGroup ? 'moveSubgraph' : 'moveNodeToSubgraph', id: session.id, subgraph: group })
      return
    }
    const order = session.order, source = session.boxes.get(session.id)
    if (!order || !source) { this.idle(session.isGroup ? 'preview.groupUnsupported' : 'preview.unsupported'); return }
    // 排序看沿排列方向的位置，允许从画布空白处绕行，不把原来的行或列变成隐形边界。
    const coordinate = order.axis === 'x' ? x : y
    const ids = order.ids.filter(id => id !== session.id)
    const before = ids.findIndex(id => session.boxes.get(id)![order.axis] > coordinate)
    ids.splice(before < 0 ? ids.length : before, 0, session.id)
    if (ids.join('\0') === order.ids.join('\0')) { this.idle(session.isGroup ? 'preview.groupChoose' : 'preview.choose'); return }
    this.request({ type: session.isGroup ? 'reorderSubgraphs' : 'reorderNodes', ids }, { axis: order.axis, ids })
  }

  private request(op: FlowchartOp, order?: Order, alternate = false, key = JSON.stringify(op)) {
    const session = this.session
    if (!session) return
    if (!alternate && this.candidate?.key === key) return
    const draft = new MermaidWysiwygEditor({ code: session.code })
    const result = draft.dispatch(op)
    if (!result?.edits.length || result.warnings?.length) {
      if ((op.type === 'reorderSubgraphs' || op.type === 'reorderNodes') && order && !alternate) {
        this.request({ type: op.type, ids: [...op.ids].reverse() }, order, true, key); return
      }
      this.idle(session.isGroup ? 'preview.groupUnsupported' : 'preview.unsupported'); return
    }
    if (this.timer) clearTimeout(this.timer)
    const candidate: Candidate = { key, op, code: draft.code, order, state: 'loading', alternate }
    this.candidate = candidate
    const generation = ++this.generation
    this.comparison?.clear()
    this.status.textContent = t('preview.loading')
    this.panel.dataset.state = 'loading'
    this.applyButton.disabled = true
    this.onlyAfterInput.disabled = true
    this.timer = setTimeout(() => { this.timer = null; void this.render(candidate, generation) }, session.keyboard ? 0 : 120)
  }

  private async render(candidate: Candidate, generation: number) {
    const session = this.session
    if (!session) return
    const id = `mw-preview-${++previewSerial}`
    const scratch = document.createElement('div')
    scratch.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden;pointer-events:none'
    document.body.append(scratch)
    try {
      const { svg: markup } = await this.mermaid.render(id, mermaidSource(candidate.code), scratch)
      if (generation !== this.generation || this.session !== session || this.editor.code !== session.code) return
      scratch.innerHTML = markup
      const svg = scratch.querySelector('svg')
      if (!svg) throw new Error()
      const dimensions = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
      if (dimensions?.[2] && dimensions[3]) svg.style.cssText = `width:${dimensions[2]}px;height:${dimensions[3]}px;max-width:none`
      const draft = new MermaidWysiwygEditor({ code: candidate.code })
      const correlation = correlateFlowchart(svg, draft.result.flowchart!)
      let valid = correlation.failed.length === 0
      if (candidate.order) {
        const { axis, ids } = candidate.order
        const positions = ids.map(id => {
          const entity = correlation.nodes.get(`${session.isGroup ? 'subgraph' : 'node'}:${id}`)
          const box = (session.isGroup ? entity?.querySelector(':scope > rect') ?? entity : entity)?.getBoundingClientRect()
          return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height } : null
        })
        valid &&= positions.every((box, index) => !!box && !!positions[0] &&
          sameLayer(box, positions[0]!, axis, session.isGroup) &&
          (index === 0 || box[axis] > positions[index - 1]![axis] + 1))
      }
      // 自动排版可能反向使用源码顺序；只尝试有实际改动的另一种提示，并核对画面顺序。
      if (!valid && (candidate.op.type === 'reorderSubgraphs' || candidate.op.type === 'reorderNodes') && candidate.order && !candidate.alternate) {
        const reversed = { type: candidate.op.type, ids: [...candidate.op.ids].reverse() }
        const fallback = new MermaidWysiwygEditor({ code: session.code })
        if (fallback.dispatch(reversed)?.edits.length) {
          this.request(reversed, candidate.order, true, candidate.key)
          return
        }
      }
      if (valid) {
        const original = this.editor.result.flowchart!, changedIds = new Set(candidate.order?.ids ?? [session.id])
        const affected = new Set([...original.nodes, ...original.subgraphs].filter(item => session.isGroup
          ? [...changedIds].some(id => flowchartSubgraphContains(original, id, item.id)) : changedIds.has(item.id)).map(item => item.id))
        const focus = new Set<string>()
        for (const graph of [original, draft.result.flowchart!]) {
          for (const item of [...graph.nodes, ...graph.subgraphs]) if (affected.has(item.id)) focus.add(item.entityId)
          for (const group of graph.subgraphs) if ([...affected].some(id => flowchartSubgraphContains(graph, group.id, id))) focus.add(group.entityId)
          for (const edge of graph.edges) if (affected.has(edge.source) || affected.has(edge.target)) focus.add(edge.entityId)
        }
        this.comparison?.show(svg, focus)
      }
      candidate.state = valid ? 'ready' : 'blocked'
      this.panel.dataset.state = candidate.state
      this.status.textContent = t(valid ? session.keyboard ? 'preview.keyboardReady' : 'preview.ready' : 'preview.blocked')
      this.applyButton.disabled = !valid
      this.onlyAfterInput.disabled = !valid
      if (session.keyboard && valid) this.applyButton.focus()
    } catch {
      if (generation !== this.generation || this.session !== session) return
      this.comparison?.clear()
      candidate.state = 'blocked'
      this.panel.dataset.state = 'blocked'
      this.status.textContent = t('preview.failed')
    } finally {
      scratch.remove()
      document.getElementById(`d${id}`)?.remove()
      const leftover = document.getElementById(id)
      if (leftover && !this.panel.contains(leftover)) leftover.remove()
    }
  }

  /** 返回是否接管了拖放；未完成或不满足顺序的预览不会改动正式文档。 */
  drop(): boolean {
    const session = this.session, candidate = this.candidate
    if (!session) return false
    const canApply = candidate?.state === 'ready' && this.editor.code === session.code && !this.readonly()
    const warning = candidate?.state === 'loading' ? 'preview.pendingDrop' : 'preview.notApplied'
    this.cancel()
    if (canApply) {
      // 直接应用已验证的完整候选，保证保存的源码与画布对照的是同一次计算结果。
      this.editor.setCode(candidate!.code, 'canvas')
      this.editor.setSelection([`${session.isGroup ? 'subgraph' : 'node'}:${session.id}`], 'canvas')
      this.host.focus({ preventScroll: true })
      this.notify([{ key: 'preview.applied', action: { key: 'toast.undo' } }])
    } else if (candidate) this.notify([{ key: warning }])
    return true
  }

  canNudge(id: string, step: number): boolean {
    const svg = this.svg()
    if (!svg || this.readonly()) return false
    const order = this.snapshot(id, svg).order
    const index = order?.ids.indexOf(id) ?? -1
    return !!order && index >= 0 && index + step >= 0 && index + step < order.ids.length
  }

  nudge(id: string, step: number) {
    const svg = this.svg()
    if (!svg || !this.canNudge(id, step)) return
    this.begin(id, svg)
    const session = this.session!
    session.keyboard = true
    this.actions.hidden = false
    this.cancelButton.focus()
    const order = session.order!, ids = [...order.ids], index = ids.indexOf(id)
    ;[ids[index], ids[index + step]] = [ids[index + step], ids[index]]
    this.request({ type: session.isGroup ? 'reorderSubgraphs' : 'reorderNodes', ids }, { axis: order.axis, ids })
  }

  /** 分组菜单提供不依赖拖动的目标选择，同样先预览再应用。 */
  relocate(id: string, group: string | null) {
    const svg = this.svg()
    if (!svg || this.readonly()) return
    this.begin(id, svg)
    this.session!.keyboard = true
    this.actions.hidden = false
    this.cancelButton.focus()
    this.request({ type: 'moveSubgraph', id, subgraph: group })
  }

  cancel() {
    ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.session = null; this.candidate = null
    this.comparison?.clear(); this.comparison = null
    this.panel.hidden = true; this.image.replaceChildren()
    this.status.textContent = ''
  }

  updateViewport() { this.comparison?.updateViewport() }

  get active() { return this.session !== null }

  destroy() { this.cancel(); this.disposers.forEach(dispose => dispose()); this.panel.remove() }
}

export const NODE_MOVE_PREVIEW_CSS = `
.mw-drag-preview { position:absolute; inset:0; z-index:24; box-sizing:border-box; color:var(--mw-chrome-fg,#25334a); pointer-events:none; font:12px/1.5 system-ui; overflow:hidden; }
.mw-drag-preview[hidden] { display:none; }
.mw-preview-controls { position:absolute; top:8px; left:12px; right:12px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding:7px 10px; border-bottom:1px solid var(--mw-chrome-border,#d9e1ed); background:var(--mw-chrome-bg,#fff); }
.mw-preview-controls strong { font-size:12px; margin-right:auto; }
.mw-preview-legend { display:flex; align-items:center; gap:6px; }
.mw-preview-legend::before { content:''; width:22px; height:12px; border:1px dashed #627189; border-radius:3px; }
.mw-preview-legend.after::before { border-style:solid; border-color:var(--mw-accent,#315fd6); background:color-mix(in srgb,var(--mw-accent,#315fd6) 6%,transparent); }
.mw-preview-controls label { display:flex; align-items:center; gap:5px; cursor:pointer; pointer-events:auto; }
.mw-preview-controls input { accent-color:var(--mw-accent,#315fd6); }
.mw-preview-controls input:focus-visible { outline:2px solid var(--mw-accent,#315fd6); outline-offset:2px; }
.mw-preview-footer { position:absolute; bottom:10px; left:12px; right:104px; display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:7px; background:color-mix(in srgb,var(--mw-accent,#315fd6) 7%,var(--mw-chrome-bg,#fff)); border:1px solid var(--mw-chrome-border,#d9e1ed); }
.mw-drag-preview [role=status] { flex:1; min-width:0; }
.mw-drag-preview[data-state=blocked] [role=status] { color:#b45309; }
.mw-drag-preview-image { position:absolute; inset:0; overflow:hidden; }
.mw-drag-preview-actions { display:flex; justify-content:flex-end; gap:8px; pointer-events:auto; }
.mw-drag-preview-actions[hidden] { display:none; }
.mw-drag-preview-actions button { padding:5px 10px; border:1px solid var(--mw-chrome-border,#d9e1ed); border-radius:7px; color:inherit; background:var(--mw-chrome-bg,#fff); cursor:pointer; font:inherit; }
.mw-drag-preview-actions button:focus-visible { outline:2px solid var(--mw-accent,#315fd6); outline-offset:2px; }
.mw-drag-preview-actions button:hover:not(:disabled) { background:var(--mw-chrome-hover,#eef2f8); }
.mw-drag-preview-actions button:disabled { opacity:.5; cursor:default; }
@media(max-width:700px) { .mw-preview-controls { gap:6px 12px; } .mw-preview-controls strong { display:none; } .mw-preview-footer { right:12px; bottom:46px; flex-wrap:wrap; } .mw-drag-preview-actions { margin-left:auto; } }
` + LAYOUT_COMPARISON_CSS
