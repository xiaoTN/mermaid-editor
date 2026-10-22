import { t, onLocaleChange } from './i18n'
import { MermaidWysiwygEditor, diffText, type EditorNotice } from '@inkeep/mermaid-wysiwyg-core'

/** 优先命中内部节点；分组自身的标题、边框和空白也可作为端点。 */
export function flowchartEndpoint(host: HTMLElement, hit: Element | null): Element | null {
  const entity = hit?.closest('[data-mw-entity], [data-mw-ambiguous]')
  if (!entity || !host.contains(entity) || entity.hasAttribute('data-mw-ambiguous')) return null
  return /^(node|subgraph):/.test(entity.getAttribute('data-mw-entity') ?? '') ? entity : null
}

function endpointId(element: Element): string {
  return element.getAttribute('data-mw-entity')!.replace(/^(node|subgraph):/, '')
}

interface NodeMove {
  node: SVGGraphicsElement
  svg: SVGSVGElement
  id: string
  x: number
  y: number
  pointerId: number
  transform: string | null
  code: string
  active: boolean
  valid: boolean
  group: string | null
  target: Element | null
}

/** 连线控件独立于 Mermaid 的 SVG，保留渲染器生成的原始 ID。 */
export class FlowchartGestures {
  private ports = document.createElement('div')
  private ends = document.createElement('div')
  private hint = document.createElement('div')
  private drag: { source?: string; edgeId?: string; end?: 'source' | 'target'; x: number; y: number; pointerId: number } | null = null
  private target: Element | null = null
  private ghost: SVGLineElement | null = null
  private hovered: Element | null = null
  private nodeMove: NodeMove | null = null
  private blockNodeClick = false
  private clickTimer: ReturnType<typeof setTimeout> | null = null
  private disposers: (() => void)[] = []

  constructor(private editor: MermaidWysiwygEditor, private host: HTMLElement,
    private readonly: () => boolean, private refresh: () => void, private notify: (notices: EditorNotice[]) => void,
    private canMoveNode: () => boolean = () => true, private onNodeMove: () => void = () => {},
    private onNodeCreated: (entityId: string) => void = () => {}) {
    this.ports.className = 'mw-ports'
    this.ends.className = 'mw-endpoints'
    this.hint.className = 'mw-connect-hint'
    host.append(this.ports, this.ends, this.hint)
    const listen = (el: EventTarget, type: string, fn: (e: any) => void, capture = false) => {
      el.addEventListener(type, fn, capture)
      this.disposers.push(() => el.removeEventListener(type, fn, capture))
    }
    listen(host, 'pointerover', (e: PointerEvent) => {
      if (this.drag || this.nodeMove || this.readonly() || !editor.result.flowchart) return
      const node = flowchartEndpoint(this.host, e.target as Element)
      if (node) { this.hovered = node; this.showPorts(node) }
      else if (!(e.target as Element).closest?.('.mw-ports')) this.clearPorts()
    })
    listen(host, 'pointerdown', (e: PointerEvent) => this.beginNodeMove(e))
    listen(host, 'click', (e: MouseEvent) => {
      if (!this.blockNodeClick) return
      this.blockNodeClick = false
      e.preventDefault(); e.stopImmediatePropagation()
    }, true)
    listen(document, 'pointermove', (e: PointerEvent) => this.nodeMove ? this.moveNode(e) : this.move(e))
    listen(document, 'pointerup', (e: PointerEvent) => this.nodeMove ? this.finishNodeMove(e) : this.finish(e))
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
    this.disposers.push(editor.on('change', () => this.cancel()))
  }

  private beginNodeMove(e: PointerEvent) {
    if (this.drag || this.readonly() || !this.canMoveNode() || e.button !== 0 || e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || e.detail > 1) return
    const node = flowchartEndpoint(this.host, e.target as Element) as SVGGraphicsElement | null
    if (!node?.getAttribute('data-mw-entity')?.startsWith('node:') || !node.ownerSVGElement) return
    this.nodeMove = { node, svg: node.ownerSVGElement, id: endpointId(node), x: e.clientX, y: e.clientY,
      pointerId: e.pointerId, transform: node.getAttribute('transform'), code: this.editor.code,
      active: false, valid: false, group: null, target: null }
  }

  private moveNode(e: PointerEvent) {
    const drag = this.nodeMove
    if (!drag || e.pointerId !== drag.pointerId) return
    if (this.readonly() || !this.canMoveNode() || drag.code !== this.editor.code) { this.cancel(); return }
    let dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.active && Math.hypot(dx, dy) < 5) return
    e.preventDefault()
    if (!drag.active) {
      drag.active = true; this.clearPorts(); this.ends.replaceChildren(); this.onNodeMove()
      drag.node.classList.add('mw-node-moving')
      try { drag.svg.setPointerCapture?.(e.pointerId) } catch { /* 合成指针事件可能不支持捕获。 */ }
    }
    // 使用父级屏幕矩阵换算位移，缩放或平移画布后节点仍跟随指针。
    const matrix = (drag.node.parentElement as unknown as SVGGraphicsElement)?.getScreenCTM?.()?.inverse()
    if (matrix) {
      const from = new DOMPoint(drag.x, drag.y).matrixTransform(matrix)
      const to = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
      dx = to.x - from.x; dy = to.y - from.y
    }
    drag.node.setAttribute('transform', `translate(${dx},${dy}) ${drag.transform ?? ''}`)
    drag.target?.classList.remove('mw-group-drop-target')
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    drag.valid = !!hit && this.host.contains(hit) && (drag.svg.contains(hit) || hit === this.host || !!hit.closest('.mw-svg-host')) &&
      !hit.closest('button, input, [contenteditable="true"], .mw-popover, [data-mw-ambiguous]')
    // Mermaid 的成员节点与分组边框不一定是 DOM 父子关系，按边框范围寻找最内层分组。
    const candidates = drag.valid ? [...this.host.querySelectorAll('[data-mw-entity^="subgraph:"]')].flatMap(group => {
      const box = (group.querySelector(':scope > rect') ?? group.querySelector('rect'))?.getBoundingClientRect()
      return box && box.width > 0 && box.height > 0 && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
        ? [{ group, area: box.width * box.height }] : []
    }).sort((a, b) => a.area - b.area) : []
    drag.target = candidates[0]?.group ?? null
    drag.group = drag.target ? endpointId(drag.target) : null
    drag.target?.classList.add('mw-group-drop-target')
    const title = this.editor.result.flowchart?.subgraphs.find(group => group.id === drag.group)?.title ?? drag.group ?? ''
    this.hint.textContent = !drag.valid ? t('drag.moveCancel') : drag.group ? t('drag.moveInto', { name: title }) : t('drag.moveOut')
    const box = this.host.getBoundingClientRect()
    this.hint.style.left = `${e.clientX - box.left + this.host.scrollLeft + 12}px`
    this.hint.style.top = `${e.clientY - box.top + this.host.scrollTop + 12}px`
  }

  private finishNodeMove(e: PointerEvent) {
    const drag = this.nodeMove
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.active) this.moveNode(e)
    const commit = this.nodeMove === drag && drag.active && drag.valid && drag.code === this.editor.code && !this.readonly()
    this.cancel()
    if (!drag.active) return
    // 拖放后的 click 不能再次选中落点内的其他节点，也不影响下一次正常点击。
    this.blockNodeClick = true
    if (this.clickTimer) clearTimeout(this.clickTimer)
    this.clickTimer = setTimeout(() => { this.blockNodeClick = false; this.clickTimer = null }, 0)
    if (commit) this.editor.dispatch({ type: 'moveNodeToSubgraph', id: drag.id, subgraph: drag.group })
    this.refresh()
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
      try { b.setPointerCapture?.(e.pointerId) } catch { /* 合成指针事件可能不支持捕获。 */ }
      start(e)
    })
    b.addEventListener('click', e => e.stopPropagation())
    parent.append(b)
  }

  private showPorts(node: Element) {
    this.ports.replaceChildren()
    const id = endpointId(node), p = this.at(node)
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
    if (this.nodeMove?.active) { this.ports.replaceChildren(); return }
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
        // 两端使用相同的操作提示，通过 data-end 区分起点和终点。
        this.drag = { edgeId: id, end, x: e.clientX, y: e.clientY, pointerId: e.pointerId }
        this.clearPorts()
      })
      this.ends.lastElementChild?.setAttribute('data-end', end)
    }
  }

  private move(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return
    this.target?.classList.remove('mw-connect-target')
    this.target = flowchartEndpoint(this.host, document.elementFromPoint(e.clientX, e.clientY))
    this.target?.classList.add('mw-connect-target')
    const id = this.target ? endpointId(this.target) : null
    const graph = this.editor.result.flowchart
    const group = graph?.subgraphs.find(group => group.id === id)
    this.hint.textContent = id ? t('drag.dropOn', { name: group?.title ?? graph?.nodeById.get(id)?.label ?? id }) : ''
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
    const drag = this.drag, target = this.target ? endpointId(this.target) : null
    this.cancel()
    if (this.readonly()) return
    if (drag.edgeId && target) {
      this.editor.dispatch({ type: 'retargetEdge', edgeId: drag.edgeId, end: drag.end!, nodeId: target })
    } else if (drag.source && target && target !== drag.source) {
      const result = this.editor.dispatch({ type: 'connect', source: drag.source, target, insideGroup: true })
      if (result?.edits.length) this.directionNotice(drag.source, target)
    } else if (drag.source && !target) {
      this.newNodeMenu(drag.source, e.clientX, e.clientY)
    }
    this.refresh()
  }

  private directionNotice(source: string, target: string) {
    const graph = this.editor.result.flowchart
    if (!graph) return
    const groups = (id: string) => {
      const ids = new Set<string>()
      const endpointGroup = graph.subgraphs.find(group => group.id === id)
      let group = endpointGroup ? endpointGroup.parent : graph.nodeById.get(id)?.subgraph
      while (group && !ids.has(group)) { ids.add(group); group = graph.subgraphs.find(sg => sg.id === group)?.parent }
      return ids
    }
    const from = groups(source), to = groups(target)
    const notices = graph.subgraphs.filter(group => group.directionLines.length && from.has(group.id) !== to.has(group.id))
      .map(group => ({ key: 'toast.directionClip', params: { name: group.title ?? group.id },
        action: { key: 'toast.removeDirection', op: { type: 'removeSubgraphDirection' as const, id: group.id } } }))
    if (notices.length) this.notify(notices)
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
      // 在临时图上编译两个操作，再将修改合为一次编辑，保证一次撤销。
      const draft = new MermaidWysiwygEditor({ code: this.editor.code })
      const node = draft.dispatch({ type: 'addNode', label: t('drag.newNode') })?.created?.[0]?.slice(5)
      if (!node) return
      const edge = draft.dispatch({ type: 'connect', source, target: node, insideGroup: true })?.created
      const edit = diffText(this.editor.code, draft.code)
      if (edit) this.editor.applyEdits([edit], 'canvas')
      if (edit) {
        const entityId = `node:${node}`
        this.editor.setSelection([entityId], 'canvas')
        this.onNodeCreated(entityId)
        if (edge) this.directionNotice(source, node)
      }
    }
    this.host.append(menu)
    const close = (e: Event) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('pointerdown', close) } }
    document.addEventListener('pointerdown', close)
    this.disposers.push(() => document.removeEventListener('pointerdown', close))
  }

  cancel() {
    if (this.nodeMove) {
      const { node, svg, pointerId, transform, target } = this.nodeMove
      node.classList.remove('mw-node-moving'); target?.classList.remove('mw-group-drop-target')
      if (transform === null) node.removeAttribute('transform'); else node.setAttribute('transform', transform)
      try { if (svg.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId) } catch { /* 取消时指针可能已经释放。 */ }
      this.nodeMove = null
    }
    this.drag = null; this.target?.classList.remove('mw-connect-target'); this.target = null
    this.ghost?.remove(); this.ghost = null; this.hint.textContent = ''
    this.ends.replaceChildren()
  }

  destroy() { this.cancel(); if (this.clickTimer) clearTimeout(this.clickTimer); this.disposers.forEach(fn => fn()); this.ports.remove(); this.ends.remove(); this.hint.remove(); this.host.querySelector('.mw-new-node-menu')?.remove() }
}

export const GESTURE_CSS = `
.mw-handle { position:absolute; z-index:22; width:11px; height:11px; padding:0; border:2px solid #2563eb; border-radius:50%; background:white; transform:translate(-50%,-50%); cursor:crosshair; touch-action:none; }
.mw-connect-target > :is(rect,polygon,path,circle,ellipse) { stroke:#2563eb !important; stroke-width:3px !important; }
.mw-node-moving { opacity:.55; }
.mw-node-moving, .mw-node-moving * { pointer-events:none !important; }
.mw-group-drop-target > rect, .mw-group-drop-target.node rect { stroke:#2563eb !important; stroke-width:3px !important; stroke-dasharray:7 4; }
.mw-connect-hint { position:absolute; z-index:23; pointer-events:none; padding:4px 8px; border-radius:4px; background:#111827; color:white; font:12px/1.4 system-ui; white-space:nowrap; }
.mw-connect-hint:empty { display:none; }
.mw-canvas:has(.mw-connect-target) .mw-connect-hint { background:#eff6ff; color:#2563eb; border:1px solid #93c5fd; }
.mw-canvas .mw-edge-hit { stroke:transparent !important; stroke-width:12px !important; fill:none !important; pointer-events:stroke; filter:none !important; }
.mw-canvas .mw-edge-hover { stroke:#2563eb !important; }
.mw-canvas [contenteditable="true"]:empty:before { content:attr(placeholder); color:#64748b; font-size:12px; }
`
