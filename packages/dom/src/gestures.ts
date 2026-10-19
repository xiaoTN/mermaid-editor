import { t, onLocaleChange } from './i18n'
import { MermaidWysiwygEditor, diffText } from '@inkeep/mermaid-wysiwyg-core'

/** Flowchart chrome is separate from Mermaid's SVG so its original IDs survive. */
export class FlowchartGestures {
  private ports = document.createElement('div')
  private ends = document.createElement('div')
  private hint = document.createElement('div')
  private drag: { source?: string; edgeId?: string; end?: 'source' | 'target'; x: number; y: number; pointerId: number } | null = null
  private target: Element | null = null
  private ghost: SVGLineElement | null = null
  private hovered: Element | null = null
  private disposers: (() => void)[] = []

  constructor(private editor: MermaidWysiwygEditor, private host: HTMLElement,
    private readonly: () => boolean, private refresh: () => void) {
    this.ports.className = 'mw-ports'
    this.ends.className = 'mw-endpoints'
    this.hint.className = 'mw-connect-hint'
    host.append(this.ports, this.ends, this.hint)
    const listen = (el: EventTarget, type: string, fn: (e: any) => void) => {
      el.addEventListener(type, fn)
      this.disposers.push(() => el.removeEventListener(type, fn))
    }
    listen(host, 'pointerover', (e: PointerEvent) => {
      if (this.drag || this.readonly() || !editor.result.flowchart) return
      const node = (e.target as Element).closest?.('[data-mw-entity^="node:"]')
      if (node) { this.hovered = node; this.showPorts(node) }
      else if (!(e.target as Element).closest?.('.mw-ports')) this.clearPorts()
    })
    listen(document, 'pointermove', (e: PointerEvent) => this.move(e))
    listen(document, 'pointerup', (e: PointerEvent) => this.finish(e))
    listen(document, 'pointercancel', () => { this.cancel(); this.update() })
    listen(document, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') { this.cancel(); this.update() } })
    listen(host, 'scroll', () => this.update())
    listen(window, 'resize', () => this.update())
    this.disposers.push(onLocaleChange(() => {
      this.update()
      const button = this.host.querySelector('.mw-new-node-menu button')
      if (button) { button.textContent = t('drag.newNode'); button.setAttribute('aria-label', t('drag.newNode')) }
      const cancel = this.host.querySelector('.mw-new-node-menu button:last-child')
      if (cancel) { cancel.textContent = t('menu.cancel'); cancel.setAttribute('aria-label', t('menu.cancel')) }
    }))
    this.disposers.push(editor.on('selectionChange', () => this.update()))
  }

  private at(el: Element) {
    const a = el.getBoundingClientRect(), b = this.host.getBoundingClientRect()
    return { x: a.left - b.left + this.host.scrollLeft, y: a.top - b.top + this.host.scrollTop, w: a.width, h: a.height }
  }

  private dot(parent: HTMLElement, x: number, y: number, label: string, start: (e: PointerEvent) => void) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'mw-handle'
    b.setAttribute('aria-label', label); b.title = label
    b.style.left = `${x}px`; b.style.top = `${y}px`
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.readonly()) return
      e.preventDefault(); e.stopPropagation()
      try { b.setPointerCapture?.(e.pointerId) } catch { /* synthetic pointer */ }
      start(e)
    })
    b.addEventListener('click', e => e.stopPropagation())
    parent.append(b)
  }

  private showPorts(node: Element) {
    this.ports.replaceChildren()
    const id = node.getAttribute('data-mw-entity')!.slice(5), p = this.at(node)
    for (const [x, y] of [[p.x + p.w / 2, p.y], [p.x + p.w, p.y + p.h / 2], [p.x + p.w / 2, p.y + p.h], [p.x, p.y + p.h / 2]]) {
      this.dot(this.ports, x, y, t('aria.connectDot'), e => {
        this.drag = { source: id, x: e.clientX, y: e.clientY, pointerId: e.pointerId }
        this.hint.textContent = ''; this.ends.replaceChildren()
      })
    }
    this.hint.textContent = t('hover.connect')
    this.hint.style.left = `${p.x}px`; this.hint.style.top = `${p.y + p.h + 14}px`
  }

  private clearPorts() { this.ports.replaceChildren(); this.hint.textContent = ''; this.hovered = null }

  update() {
    this.ends.replaceChildren()
    if (this.readonly() || !this.editor.result.flowchart) { this.cancel(); this.clearPorts(); return }
    if (this.hovered?.isConnected && !this.drag) this.showPorts(this.hovered)
    else if (!this.drag) this.clearPorts()
    const id = this.editor.selection.length === 1 ? this.editor.selection[0] : ''
    const path = [...this.host.querySelectorAll<SVGPathElement>('path[data-mw-entity]:not(.mw-edge-hit)')].find(el => el.getAttribute('data-mw-entity') === id)
    if (!id.startsWith('edge:') || !path || this.drag) return
    const box = this.at(path)
    for (const end of ['source', 'target'] as const) {
      let x = box.x + (end === 'target' ? box.w : 0), y = box.y + box.h / 2
      if (path.getTotalLength && path.getScreenCTM) {
        const point = path.getPointAtLength(end === 'source' ? 0 : path.getTotalLength())
        const matrix = path.getScreenCTM()
        if (matrix) {
          const p = new DOMPoint(point.x, point.y).matrixTransform(matrix), h = this.host.getBoundingClientRect()
          x = p.x - h.left + this.host.scrollLeft; y = p.y - h.top + this.host.scrollTop
        }
      }
      this.dot(this.ends, x, y, t('aria.edgeEndDot'), e => {
        // Both endpoints share product copy; data identifies their semantics.
        this.drag = { edgeId: id, end, x: e.clientX, y: e.clientY, pointerId: e.pointerId }
        this.clearPorts()
      })
      this.ends.lastElementChild?.setAttribute('data-end', end)
    }
  }

  private move(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return
    this.target?.classList.remove('mw-connect-target')
    this.target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mw-entity^="node:"]') ?? null
    if (this.target && !this.host.contains(this.target)) this.target = null
    this.target?.classList.add('mw-connect-target')
    const id = this.target?.getAttribute('data-mw-entity')?.slice(5)
    this.hint.textContent = id ? t('drag.dropOn', { name: this.editor.result.flowchart?.nodeById.get(id)?.label ?? id }) : ''
    const h = this.host.getBoundingClientRect()
    this.hint.style.left = `${e.clientX - h.left + this.host.scrollLeft + 12}px`
    this.hint.style.top = `${e.clientY - h.top + this.host.scrollTop + 12}px`
    const svg = this.host.querySelector('svg')
    const matrix = svg?.getScreenCTM?.()?.inverse()
    if (svg && matrix) {
      if (!this.ghost) {
        this.ghost = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        this.ghost.classList.add('mw-ghost-edge'); svg.append(this.ghost)
      }
      const from = new DOMPoint(this.drag.x, this.drag.y).matrixTransform(matrix)
      const to = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
      for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })) this.ghost.setAttribute(key, String(value))
    }
  }

  private finish(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return
    this.move(e)
    const drag = this.drag, target = this.target?.getAttribute('data-mw-entity')?.slice(5)
    this.cancel()
    if (this.readonly()) return
    if (drag.edgeId && target) {
      this.editor.dispatch({ type: 'retargetEdge', edgeId: drag.edgeId, end: drag.end!, nodeId: target })
    } else if (drag.source && target && target !== drag.source) {
      this.editor.dispatch({ type: 'connect', source: drag.source, target })
    } else if (drag.source && !target) {
      this.newNodeMenu(drag.source, e.clientX, e.clientY)
    }
    this.refresh()
  }

  private newNodeMenu(source: string, x: number, y: number) {
    this.host.querySelector('.mw-new-node-menu')?.remove()
    const menu = document.createElement('div'); menu.className = 'mw-plus-menu mw-new-node-menu'
    const b = document.createElement('button'); b.textContent = t('drag.newNode'); b.setAttribute('aria-label', t('drag.newNode'))
    const cancel = document.createElement('button')
    cancel.type = b.type = 'button'
    cancel.textContent = t('menu.cancel'); cancel.setAttribute('aria-label', t('menu.cancel'))
    cancel.onclick = () => menu.remove()
    menu.append(b, cancel)
    const h = this.host.getBoundingClientRect()
    menu.style.left = `${x - h.left + this.host.scrollLeft}px`; menu.style.top = `${y - h.top + this.host.scrollTop}px`
    menu.addEventListener('pointerdown', e => e.stopPropagation())
    b.onclick = () => {
      menu.remove()
      if (this.readonly()) return
      // Compile both semantic operations against a temporary projection. Their
      // contiguous insertion is applied as one TextEdit and one undo entry.
      const draft = new MermaidWysiwygEditor({ code: this.editor.code })
      const node = draft.dispatch({ type: 'addNode', label: t('drag.newNode') })?.created?.[0]?.slice(5)
      if (!node) return
      const edge = draft.dispatch({ type: 'connect', source, target: node })?.created
      const edit = diffText(this.editor.code, draft.code)
      if (edit) this.editor.applyEdits([edit], 'canvas')
      if (edge) this.editor.setSelection(edge, 'canvas')
    }
    this.host.append(menu)
    const close = (e: Event) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('pointerdown', close) } }
    document.addEventListener('pointerdown', close)
    this.disposers.push(() => document.removeEventListener('pointerdown', close))
  }

  cancel() {
    this.drag = null; this.target?.classList.remove('mw-connect-target'); this.target = null
    this.ghost?.remove(); this.ghost = null; this.hint.textContent = ''
    this.ends.replaceChildren()
  }

  destroy() { this.cancel(); this.disposers.forEach(fn => fn()); this.ports.remove(); this.ends.remove(); this.hint.remove(); this.host.querySelector('.mw-new-node-menu')?.remove() }
}

export const GESTURE_CSS = `
.mw-handle { position:absolute; z-index:22; width:11px; height:11px; padding:0; border:2px solid #2563eb; border-radius:50%; background:white; transform:translate(-50%,-50%); cursor:crosshair; touch-action:none; }
.mw-connect-target > :is(rect,polygon,path,circle,ellipse) { stroke:#2563eb !important; stroke-width:3px !important; }
.mw-connect-hint { position:absolute; z-index:23; pointer-events:none; padding:4px 8px; border-radius:4px; background:#111827; color:white; font:12px/1.4 system-ui; white-space:nowrap; }
.mw-connect-hint:empty { display:none; }
.mw-canvas:has(.mw-connect-target) .mw-connect-hint { background:#eff6ff; color:#2563eb; border:1px solid #93c5fd; }
.mw-canvas .mw-edge-hit { stroke:transparent !important; stroke-width:12px !important; fill:none !important; pointer-events:stroke; filter:none !important; }
.mw-canvas .mw-edge-hover { stroke:#2563eb !important; }
.mw-canvas [contenteditable="true"]:empty:before { content:attr(placeholder); color:#64748b; font-size:12px; }
`
