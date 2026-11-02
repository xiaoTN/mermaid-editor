import { MermaidWysiwygEditor, flowchartOrderPeers, mermaidSource, type EditorNotice, type FlowchartOp } from '@inkeep/mermaid-wysiwyg-core'
import { correlateFlowchart } from './correlate'
import { t, onLocaleChange } from './i18n'
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
}
interface Candidate {
  key: string
  op: FlowchartOp
  code: string
  order?: Order
  state: 'loading' | 'ready' | 'blocked'
}

let previewSerial = 0

/** 拖动只修改临时副本；真实排版通过且预览已经显示后，才允许提交一次修改。 */
export class NodeMovePreview {
  private panel = document.createElement('aside')
  private title = document.createElement('strong')
  private status = document.createElement('div')
  private image = document.createElement('div')
  private actions = document.createElement('div')
  private applyButton = document.createElement('button')
  private cancelButton = document.createElement('button')
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
    this.actions.className = 'mw-drag-preview-actions'
    this.applyButton.type = this.cancelButton.type = 'button'
    this.applyButton.addEventListener('click', () => this.drop())
    this.cancelButton.addEventListener('click', () => { this.cancel(); this.host.focus({ preventScroll: true }) })
    this.actions.append(this.cancelButton, this.applyButton)
    this.panel.append(this.title, this.status, this.image, this.actions)
    host.append(this.panel)
    this.localize()
    this.disposers.push(editor.on('change', () => this.cancel()), onLocaleChange(() => { this.cancel(); this.localize() }))
  }

  private localize() {
    this.panel.setAttribute('aria-label', t('preview.title'))
    this.title.textContent = t('preview.title')
    this.applyButton.textContent = t('preview.apply')
    this.cancelButton.textContent = t('preview.cancel')
    this.applyButton.setAttribute('aria-label', t('preview.apply'))
    this.cancelButton.setAttribute('aria-label', t('preview.cancel'))
  }

  private snapshot(id: string, svg: SVGSVGElement): Session {
    const boxes = new Map<string, Box>()
    for (const node of svg.querySelectorAll<SVGGraphicsElement>('[data-mw-entity^="node:"]')) {
      const box = node.getBoundingClientRect()
      boxes.set(node.getAttribute('data-mw-entity')!.slice(5), {
        x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height,
      })
    }
    const graph = this.editor.result.flowchart!
    const source = boxes.get(id)
    const peers = flowchartOrderPeers(graph, id).filter(peer => boxes.has(peer))
    let order: Order | null = null
    if (source) {
      for (const peer of peers.filter(peer => peer !== id)) {
        const box = boxes.get(peer)!
        const axis: Axis | null = Math.abs(box.y - source.y) <= 4 && Math.abs(box.x - source.x) > 4 ? 'x'
          : Math.abs(box.x - source.x) <= 4 && Math.abs(box.y - source.y) > 4 ? 'y' : null
        if (!axis) continue
        const other = axis === 'x' ? 'y' : 'x'
        order = { axis, ids: peers.filter(peer => Math.abs(boxes.get(peer)![other] - source[other]) <= 4)
          .sort((a, b) => boxes.get(a)![axis] - boxes.get(b)![axis]) }
        break
      }
    }
    return { id, code: this.editor.code, group: graph.nodeById.get(id)?.subgraph ?? null, boxes, order, keyboard: false }
  }

  begin(id: string, svg: SVGSVGElement) {
    this.cancel()
    this.session = this.snapshot(id, svg)
    const source = this.session.boxes.get(id), bounds = this.host.getBoundingClientRect()
    this.panel.style.left = source && source.x > bounds.left + bounds.width / 2 ? '12px' : ''
    this.panel.style.right = this.panel.style.left ? '' : '12px'
    this.panel.style.maxHeight = `${Math.max(140, (this.host.clientHeight || 280) - 24)}px`
    this.localize()
    this.actions.hidden = true
    this.applyButton.disabled = true
    this.panel.style.pointerEvents = 'none'
    this.panel.hidden = false
    this.idle('preview.choose')
  }

  private idle(key: 'preview.choose' | 'preview.unsupported' | 'drag.moveCancel') {
    ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.candidate = null
    this.image.replaceChildren()
    this.status.textContent = t(key)
    this.panel.dataset.state = 'idle'
  }

  move(group: string | null, valid: boolean, x: number, y: number) {
    const session = this.session
    if (!session) return
    if (!valid) { this.idle('drag.moveCancel'); return }
    if (group !== session.group) {
      this.request({ type: 'moveNodeToSubgraph', id: session.id, subgraph: group })
      return
    }
    const order = session.order, source = session.boxes.get(session.id)
    if (!order || !source) { this.idle('preview.unsupported'); return }
    const other = order.axis === 'x' ? 'y' : 'x'
    const cross = other === 'x' ? x : y
    const span = other === 'x' ? source.width : source.height
    if (Math.abs(cross - source[other]) > span / 2 + 24) { this.idle('preview.unsupported'); return }
    const coordinate = order.axis === 'x' ? x : y
    const ids = order.ids.filter(id => id !== session.id)
    const before = ids.findIndex(id => session.boxes.get(id)![order.axis] > coordinate)
    ids.splice(before < 0 ? ids.length : before, 0, session.id)
    if (ids.join('\0') === order.ids.join('\0')) { this.idle('preview.choose'); return }
    this.request({ type: 'reorderNodes', ids }, { axis: order.axis, ids })
  }

  private request(op: FlowchartOp, order?: Order) {
    const session = this.session
    if (!session) return
    const key = JSON.stringify(op)
    if (this.candidate?.key === key) return
    const draft = new MermaidWysiwygEditor({ code: session.code })
    const result = draft.dispatch(op)
    if (!result?.edits.length || result.warnings?.length) { this.idle('preview.unsupported'); return }
    if (this.timer) clearTimeout(this.timer)
    const candidate: Candidate = { key, op, code: draft.code, order, state: 'loading' }
    this.candidate = candidate
    const generation = ++this.generation
    this.image.replaceChildren()
    this.status.textContent = t('preview.loading')
    this.panel.dataset.state = 'loading'
    this.applyButton.disabled = true
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
      const draft = new MermaidWysiwygEditor({ code: candidate.code })
      const correlation = correlateFlowchart(svg, draft.result.flowchart!)
      let valid = correlation.failed.length === 0
      if (candidate.order) {
        const { axis, ids } = candidate.order
        const positions = ids.map(id => {
          const box = correlation.nodes.get(`node:${id}`)?.getBoundingClientRect()
          return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
        })
        const other = axis === 'x' ? 'y' : 'x'
        valid &&= positions.every((box, index) => !!box && !!positions[0] &&
          Math.abs(box[other] - positions[0]![other]) <= 4 &&
          (index === 0 || box[axis] > positions[index - 1]![axis] + 1))
      }
      correlation.nodes.get(`node:${session.id}`)?.classList.add('mw-preview-focus')
      // 缩略图不参与主画布的节点命中、框选和分组检测。
      for (const element of svg.querySelectorAll('[data-mw-entity], [data-mw-ambiguous]')) {
        element.removeAttribute('data-mw-entity'); element.removeAttribute('data-mw-ambiguous')
      }
      svg.removeAttribute('width'); svg.removeAttribute('height')
      svg.style.cssText = 'width:100%;height:100%;max-width:none'
      this.image.replaceChildren(svg)
      candidate.state = valid ? 'ready' : 'blocked'
      this.panel.dataset.state = candidate.state
      this.status.textContent = t(valid ? session.keyboard ? 'preview.keyboardReady' : 'preview.ready' : 'preview.blocked')
      this.applyButton.disabled = !valid
      if (session.keyboard && valid) this.applyButton.focus()
    } catch {
      if (generation !== this.generation || this.session !== session) return
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
      // 直接应用已验证的完整候选，保证保存的源码与小窗展示的是同一次计算结果。
      this.editor.setCode(candidate!.code, 'canvas')
      this.editor.setSelection([`node:${session.id}`], 'canvas')
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
    this.panel.style.pointerEvents = 'auto'
    this.cancelButton.focus()
    const order = session.order!, ids = [...order.ids], index = ids.indexOf(id)
    ;[ids[index], ids[index + step]] = [ids[index + step], ids[index]]
    this.request({ type: 'reorderNodes', ids }, { axis: order.axis, ids })
  }

  cancel() {
    ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.session = null; this.candidate = null
    this.panel.hidden = true; this.image.replaceChildren()
    this.status.textContent = ''
  }

  destroy() { this.cancel(); this.disposers.forEach(dispose => dispose()); this.panel.remove() }
}

export const NODE_MOVE_PREVIEW_CSS = `
.mw-drag-preview { position:absolute; top:12px; right:12px; z-index:24; width:min(320px,calc(100% - 24px)); height:250px; box-sizing:border-box; padding:12px; display:flex; flex-direction:column; gap:8px; border:1px solid var(--mw-chrome-border,#d9e1ed); border-radius:12px; background:var(--mw-chrome-bg,#fff); color:var(--mw-chrome-fg,#25334a); box-shadow:0 6px 24px #25334a22; pointer-events:none; font:12px/1.5 system-ui; }
.mw-drag-preview[hidden] { display:none; }
.mw-drag-preview strong { font-size:13px; }
.mw-drag-preview [role=status] { min-height:36px; }
.mw-drag-preview[data-state=blocked] [role=status] { color:#b45309; }
.mw-drag-preview-image { flex:1; min-height:0; overflow:hidden; border:1px solid var(--mw-chrome-border,#d9e1ed); border-radius:7px; }
.mw-drag-preview-image:empty { border-style:dashed; }
.mw-drag-preview .mw-preview-focus { filter:drop-shadow(0 0 4px var(--mw-accent,#315fd6)); }
.mw-drag-preview-actions { display:flex; justify-content:flex-end; gap:8px; }
.mw-drag-preview-actions[hidden] { display:none; }
.mw-drag-preview-actions button { padding:5px 10px; border:1px solid var(--mw-chrome-border,#d9e1ed); border-radius:7px; color:inherit; background:var(--mw-chrome-bg,#fff); cursor:pointer; font:inherit; }
.mw-drag-preview-actions button:focus-visible { outline:2px solid var(--mw-accent,#315fd6); outline-offset:2px; }
.mw-drag-preview-actions button:hover:not(:disabled) { background:var(--mw-chrome-hover,#eef2f8); }
.mw-drag-preview-actions button:disabled { opacity:.5; cursor:default; }
`
