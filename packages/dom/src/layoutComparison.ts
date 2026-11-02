import { t } from './i18n'

type Box = { x: number; y: number; width: number; height: number }
type Metric = { box: Box; points: number[]; path: string | null }
type Frame = { width: number; height: number; left: number; top: number; scaleX: number; scaleY: number }
let serial = 0

function frame(svg: SVGSVGElement): Frame {
  const box = svg.getBoundingClientRect(), viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const width = viewBox?.[2] || box.width || 1, height = viewBox?.[3] || box.height || 1
  return { width, height, left: box.left, top: box.top, scaleX: box.width / width || 1, scaleY: box.height / height || 1 }
}

function metrics(svg: SVGSVGElement): Map<string, Metric[]> {
  const result = new Map<string, Metric[]>(), root = frame(svg)
  for (const element of svg.querySelectorAll<SVGGraphicsElement>('[data-mw-entity]')) {
    if (element.classList.contains('mw-edge-hit')) continue
    const id = element.getAttribute('data-mw-entity')!
    const shape = id.startsWith('subgraph:') ? element.querySelector(':scope > rect') ?? element : element
    const rect = shape.getBoundingClientRect(), points: number[] = []
    const path = element.tagName.toLowerCase() === 'path' ? element as SVGPathElement : null
    // 连线即使包围框相同，弯曲方向也可能变化，按实际路径采样判断。
    if (path?.getTotalLength && path.getScreenCTM) {
      try {
        const length = path.getTotalLength(), matrix = path.getScreenCTM()
        if (matrix) for (let i = 0; i <= 8; i++) {
          const point = path.getPointAtLength(length * i / 8)
          points.push((matrix.a * point.x + matrix.c * point.y + matrix.e - root.left) / root.scaleX,
            (matrix.b * point.x + matrix.d * point.y + matrix.f - root.top) / root.scaleY)
        }
      } catch { /* 不支持路径测量的渲染环境继续比较包围框和路径文本。 */ }
    }
    const value = { box: { x: (rect.left - root.left) / root.scaleX, y: (rect.top - root.top) / root.scaleY,
      width: rect.width / root.scaleX, height: rect.height / root.scaleY }, points, path: path?.getAttribute('d') ?? null }
    result.set(id, [...result.get(id) ?? [], value])
  }
  return result
}

function same(before: Metric[], after: Metric[], dx: number, dy: number): boolean {
  return before.length === after.length && before.every((value, index) => {
    const next = after[index]
    if (Math.abs(value.box.x - next.box.x - dx) > 1.5 || Math.abs(value.box.y - next.box.y - dy) > 1.5 ||
      Math.abs(value.box.width - next.box.width) > 1.5 || Math.abs(value.box.height - next.box.height) > 1.5) return false
    if (value.points.length && next.points.length === value.points.length) {
      return value.points.every((point, i) => Math.abs(point - next.points[i] - (i % 2 ? dy : dx)) <= 1.5)
    }
    return value.path === next.path
  })
}

/** 克隆后的标记、CSS 和箭头引用使用独立 ID，不干扰主画布或同页的其他编辑器。 */
function namespace(svg: SVGSVGElement) {
  const prefix = `mw-compare-${++serial}-`, ids = new Map<string, string>()
  for (const element of [svg, ...svg.querySelectorAll('[id]')]) if (element.id) ids.set(element.id, prefix + element.id)
  const replacements = [...ids].sort((a, b) => b[0].length - a[0].length)
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') { element.setAttribute('id', ids.get(attribute.value)!); continue }
      let value = attribute.value
      for (const [before, after] of replacements) value = value.replaceAll(`#${before}`, `#${after}`)
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
    if (element.tagName.toLowerCase() === 'style') {
      let text = element.textContent ?? ''
      for (const [before, after] of replacements) text = text.replaceAll(`#${before}`, `#${after}`)
      element.textContent = text
    }
  }
}

function prepare(svg: SVGSVGElement, changed: Set<string>, kind: 'before' | 'after') {
  namespace(svg)
  svg.classList.add(`mw-compare-${kind}`)
  svg.classList.remove('mw-preview-source')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('inert', '')
  // 副本中的链接和自定义 HTML 标签不能抢走键盘焦点。
  for (const link of svg.querySelectorAll('a')) { link.removeAttribute('href'); link.removeAttribute('xlink:href') }
  for (const control of svg.querySelectorAll('button,input,select,textarea')) control.setAttribute('disabled', '')
  for (const editable of svg.querySelectorAll('[contenteditable]')) editable.setAttribute('contenteditable', 'false')
  for (const element of svg.querySelectorAll('.mw-edge-hit, .mw-ghost-edge')) element.remove()
  for (const element of svg.querySelectorAll<SVGElement>('[data-mw-entity], [data-mw-ambiguous], [tabindex]')) {
    const id = element.getAttribute('data-mw-entity')
    if (id) {
      element.setAttribute('data-mw-preview-entity', id)
      if (changed.has(id)) {
        element.setAttribute('data-mw-preview-change', '')
        const shapes = element.tagName.toLowerCase() === 'path' ? [element]
          : [...element.querySelectorAll<SVGElement>(':scope > rect, :scope > path, :scope > polygon, :scope > circle, :scope > ellipse')]
        // Mermaid 的自定义样式也会带 important，对照色只写到副本上，原图配色继续保留。
        for (const shape of shapes) {
          shape.style.setProperty('stroke', kind === 'before' ? '#627189' : 'var(--mw-accent,#315fd6)', 'important')
          if (kind === 'before') shape.style.setProperty('fill', 'none', 'important')
          if (!id.startsWith('edge:')) shape.style.setProperty('stroke-dasharray', kind === 'before' ? '6 4' : 'none', 'important')
          if (kind === 'after') shape.style.setProperty('stroke-width', '2px', 'important')
        }
      }
    }
    element.removeAttribute('data-mw-entity'); element.removeAttribute('data-mw-ambiguous')
    element.removeAttribute('tabindex')
    element.classList.remove('mw-selected', 'mw-node-moving', 'mw-group-drop-target', 'mw-connect-target')
  }
}

/** 在原画布倍率和坐标中绘制对照；主 SVG 只暂停绘制，仍负责稳定的拖拽命中。 */
export class LayoutComparison {
  private before: SVGSVGElement
  private after: SVGSVGElement | null = null
  private oldMetrics: Map<string, Metric[]>
  private newMetrics = new Map<string, Metric[]>()
  private offset = { x: 0, y: 0 }
  private beforeTag = document.createElement('span')
  private afterTag = document.createElement('span')
  private onlyAfter = false

  constructor(private host: HTMLElement, private layer: HTMLElement, private source: SVGSVGElement,
    private entityId: string, private moving: Set<string>, private anchor?: string) {
    this.before = source.cloneNode(true) as SVGSVGElement
    this.oldMetrics = metrics(source)
    this.beforeTag.className = 'mw-compare-tag before'
    this.afterTag.className = 'mw-compare-tag after'
    this.beforeTag.textContent = t('preview.before'); this.afterTag.textContent = t('preview.after')
  }

  show(svg: SVGSVGElement, focus: Set<string>) {
    this.clear()
    const after = svg.cloneNode(true) as SVGSVGElement
    this.newMetrics = metrics(svg)
    let anchors = [...this.oldMetrics].filter(([id]) => id.startsWith('node:') && !this.moving.has(id) && this.newMetrics.has(id))
    if (this.anchor && anchors.some(([id]) => id === this.anchor)) anchors = anchors.filter(([id]) => id === this.anchor)
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
    this.offset = {
      x: median(anchors.map(([id, values]) => values[0].box.x - this.newMetrics.get(id)![0].box.x)),
      y: median(anchors.map(([id, values]) => values[0].box.y - this.newMetrics.get(id)![0].box.y)),
    }
    const changed = new Set([...focus].filter(id => !same(this.oldMetrics.get(id) ?? [], this.newMetrics.get(id) ?? [], this.offset.x, this.offset.y)))
    const before = this.before.cloneNode(true) as SVGSVGElement
    prepare(before, changed, 'before'); prepare(after, changed, 'after')
    for (const element of before.querySelectorAll('[data-mw-preview-change]')) {
      const id = element.getAttribute('data-mw-preview-entity')!, old = this.oldMetrics.get(id)?.[0]?.box, next = this.newMetrics.get(id)?.[0]?.box
      if (!old || !next) continue
      const width = Math.max(0, Math.min(old.x + old.width, next.x + next.width + this.offset.x) - Math.max(old.x, next.x + this.offset.x))
      const height = Math.max(0, Math.min(old.y + old.height, next.y + next.height + this.offset.y) - Math.max(old.y, next.y + this.offset.y))
      if (width * height > Math.min(old.width * old.height, next.width * next.height) * .35) element.classList.add('mw-preview-overlap')
    }
    this.after = after
    this.layer.replaceChildren(after, before, this.beforeTag, this.afterTag)
    this.source.classList.add('mw-preview-source')
    this.host.classList.add('mw-layout-preview-active')
    this.setOnlyAfter(this.onlyAfter)
    this.updateViewport()
  }

  setOnlyAfter(value: boolean) {
    this.onlyAfter = value
    this.layer.classList.toggle('mw-compare-only-after', value)
    this.beforeTag.hidden = value
  }

  updateViewport() {
    if (!this.after) return
    const root = frame(this.source), bounds = this.host.getBoundingClientRect()
    const left = root.left - bounds.left + this.host.scrollLeft, top = root.top - bounds.top + this.host.scrollTop
    const before = this.layer.querySelector<SVGSVGElement>('.mw-compare-before')!
    const after = this.after, next = frame(after)
    const place = (svg: SVGSVGElement, x: number, y: number, width: number, height: number) => {
      svg.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;max-width:none;transform:none;overflow:visible;pointer-events:none`
    }
    place(before, left, top, root.width * root.scaleX, root.height * root.scaleY)
    place(after, left + this.offset.x * root.scaleX, top + this.offset.y * root.scaleY, next.width * root.scaleX, next.height * root.scaleY)
    const tag = (element: HTMLElement, box: Box | undefined, dx: number, dy: number) => {
      if (!box) { element.hidden = true; return }
      const x = left + (box.x + box.width + dx) * root.scaleX, y = top + (box.y + dy) * root.scaleY
      element.style.left = `${Math.max(4, Math.min(this.host.clientWidth - 70, x - 56))}px`
      element.style.top = `${Math.max(48, Math.min(this.host.clientHeight - 72, y - 22))}px`
    }
    tag(this.beforeTag, this.oldMetrics.get(this.entityId)?.[0]?.box, 0, 0)
    tag(this.afterTag, this.newMetrics.get(this.entityId)?.[0]?.box, this.offset.x, this.offset.y)
    if (Math.abs(parseFloat(this.beforeTag.style.left) - parseFloat(this.afterTag.style.left)) < 75 &&
      Math.abs(parseFloat(this.beforeTag.style.top) - parseFloat(this.afterTag.style.top)) < 24) {
      const box = this.newMetrics.get(this.entityId)?.[0]?.box
      if (box) this.afterTag.style.top = `${Math.min(this.host.clientHeight - 72, top + (box.y + box.height + this.offset.y) * root.scaleY + 6)}px`
    }
  }

  clear() {
    this.source.classList.remove('mw-preview-source')
    this.host.classList.remove('mw-layout-preview-active')
    this.layer.replaceChildren(); this.after = null
  }
}

// 原图只隐藏绘制以保留落点；旧位置重叠时隐藏旧文字，对照色的强制覆盖仅作用于 SVG 副本。
export const LAYOUT_COMPARISON_CSS = `
.mw-canvas .mw-preview-source { opacity:0 !important; }
.mw-drag-preview-image, .mw-drag-preview-image * { pointer-events:none !important; }
.mw-compare-before { opacity:.6; filter:grayscale(1); visibility:hidden; }
.mw-compare-before [data-mw-preview-entity] { visibility:hidden; }
.mw-compare-before [data-mw-preview-change] { visibility:visible; }
.mw-compare-before .mw-preview-overlap :is(text,foreignObject) { visibility:hidden; }
.mw-compare-before [data-mw-preview-change] > :is(rect,polygon,path,circle,ellipse), .mw-compare-before path[data-mw-preview-change] { stroke:#627189 !important; stroke-dasharray:6 4 !important; fill-opacity:.35; }
.mw-compare-after [data-mw-preview-change] > :is(rect,polygon,path,circle,ellipse), .mw-compare-after path[data-mw-preview-change] { stroke:var(--mw-accent,#315fd6) !important; stroke-width:2px !important; }
.mw-compare-only-after .mw-compare-before { display:none; }
.mw-compare-tag { position:absolute; padding:3px 8px; border-radius:12px; color:white; font:11px/1.3 system-ui; background:#627189; white-space:nowrap; }
.mw-compare-tag.after { background:var(--mw-accent,#315fd6); }
.mw-compare-tag[hidden] { display:none; }
.mw-canvas:has(.mw-drag-preview:not([hidden])) > :is(.mw-ports,.mw-endpoints,.mw-connect-hint) { display:none; }
`
