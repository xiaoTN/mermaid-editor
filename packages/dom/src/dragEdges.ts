import type { FlowGraph } from '@inkeep/mermaid-wysiwyg-core'

type Point = { x: number; y: number }
type Snapshot = { element: SVGGraphicsElement; original: string | null; ancestorMoves: boolean; wasMoving: boolean }
type Path = Snapshot & { element: SVGPathElement; points: Point[]; sourceMoves: boolean }

function offset(element: SVGGraphicsElement, dx: number, dy: number): Point {
  const matrix = element.getScreenCTM?.()?.inverse()
  return matrix ? { x: matrix.a * dx + matrix.c * dy, y: matrix.b * dx + matrix.d * dy } : { x: dx, y: dy }
}

/** 只变形跨边界连线的临时画面，正式排版、线型、箭头和源码都继续由 Mermaid 管理。 */
export class DragEdges {
  private paths: Path[] = []
  private labels: Snapshot[] = []

  constructor(svg: SVGSVGElement, graph: FlowGraph, moving: Set<string>, roots: SVGGraphicsElement[]) {
    const crossing = new Map(graph.edges.filter(edge => moving.has(edge.source) !== moving.has(edge.target))
      .map(edge => [edge.entityId, moving.has(edge.source)]))
    for (const element of svg.querySelectorAll<SVGGraphicsElement>('[data-mw-entity]')) {
      const sourceMoves = crossing.get(element.getAttribute('data-mw-entity')!)
      if (sourceMoves === undefined) continue
      const snapshot = { element, ancestorMoves: roots.some(root => root.contains(element)), wasMoving: element.classList.contains('mw-node-moving') }
      if (element.tagName.toLowerCase() === 'path') {
        const path = element as SVGPathElement
        if (!path.getTotalLength || !path.getPointAtLength) continue
        try {
          const length = path.getTotalLength()
          if (!Number.isFinite(length) || length <= 0) continue
          // 开始拖动时采样一次，后续只改坐标；曲线沿用原有走向，不在每次指针移动时重排全图。
          const count = Math.max(8, Math.min(160, Math.ceil(length / 8)))
          const points = Array.from({ length: count + 1 }, (_, index) => {
            const point = path.getPointAtLength(length * index / count)
            return { x: point.x, y: point.y }
          })
          if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue
          this.paths.push({ ...snapshot, element: path, original: path.getAttribute('d'), points, sourceMoves })
        } catch { /* 无法读取的路径不改写，仍保留原有连线。 */ }
      } else if (element.matches('.edgeLabel')) {
        this.labels.push({ ...snapshot, original: element.getAttribute('transform') })
      }
    }
    const supported = new Set(this.paths.map(path => path.element.getAttribute('data-mw-entity')))
    this.labels = this.labels.filter(label => supported.has(label.element.getAttribute('data-mw-entity')))
  }

  move(dx: number, dy: number) {
    for (const path of this.paths) {
      const delta = offset(path.element, dx, dy)
      const d = path.points.map((point, index) => {
        const t = index / (path.points.length - 1), blend = t * t * (3 - 2 * t)
        // 端点处平滑收尾，固定端不移动，移动端跟随；父组已平移的部分要扣掉，避免重复位移。
        const weight = (path.sourceMoves ? 1 - blend : blend) - Number(path.ancestorMoves)
        return `${index ? 'L' : 'M'}${point.x + delta.x * weight},${point.y + delta.y * weight}`
      }).join('')
      path.element.setAttribute('d', d)
      path.element.classList.add('mw-node-moving')
    }
    for (const label of this.labels) {
      const delta = offset(label.element.parentElement as unknown as SVGGraphicsElement, dx, dy)
      const weight = .5 - Number(label.ancestorMoves)
      label.element.setAttribute('transform', `translate(${delta.x * weight},${delta.y * weight}) ${label.original ?? ''}`)
      label.element.classList.add('mw-node-moving')
    }
  }

  restore() {
    for (const snapshot of [...this.paths, ...this.labels]) {
      const attribute = snapshot.element.tagName.toLowerCase() === 'path' ? 'd' : 'transform'
      if (snapshot.original === null) snapshot.element.removeAttribute(attribute)
      else snapshot.element.setAttribute(attribute, snapshot.original)
      if (!snapshot.wasMoving) snapshot.element.classList.remove('mw-node-moving')
    }
  }
}
