// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LayoutComparison } from '../src/layoutComparison'

let host: HTMLElement, layer: HTMLElement, source: SVGSVGElement, target: SVGSVGElement, comparison: LayoutComparison
const markup = (id: string, shift = 0, moved = 0) => `<svg id="${id}" viewBox="0 0 400 200" data-left="100" data-top="60" data-width="400" data-height="200" xmlns="http://www.w3.org/2000/svg">
  <style>#${id} .node { fill:white }</style><defs><marker id="${id}-arrow"/></defs>
  <g data-mw-entity="node:A" class="node" id="${id}-A" data-left="${120 + shift}" data-top="80" data-width="40" data-height="20"><rect/><text>入口</text></g>
  <g data-mw-entity="node:B" class="node mw-selected" tabindex="0" id="${id}-B" data-left="${200 + shift + moved}" data-top="120" data-width="40" data-height="20"><rect/><a href="https://example.invalid"><text>拖动对象</text></a></g>
  <g data-mw-entity="node:C" class="node" id="${id}-C" data-left="${300 + shift + moved}" data-top="160" data-width="40" data-height="20"><rect/><text>其他内容</text></g>
  <path data-mw-entity="edge:A->B#0" id="${id}-edge" d="M0 0L${100 + moved} 80" marker-end="url(#${id}-arrow)" data-left="${160 + shift}" data-top="90" data-width="${40 + moved}" data-height="30"/>
  <path class="mw-edge-hit" data-mw-entity="edge:A->B#0"/>
</svg>`

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const left = Number(this.getAttribute('data-left') ?? 0), top = Number(this.getAttribute('data-top') ?? 0)
    const width = Number(this.getAttribute('data-width') ?? 0), height = Number(this.getAttribute('data-height') ?? 0)
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} }
  })
  host = document.createElement('div'); layer = document.createElement('div'); document.body.append(host)
  Object.defineProperties(host, { clientWidth: { value: 600 }, clientHeight: { value: 400 } })
  host.setAttribute('data-left', '50'); host.setAttribute('data-top', '20')
  host.innerHTML = markup('original'); host.append(layer); source = host.querySelector('svg')!
  const scratch = document.createElement('div'); scratch.innerHTML = markup('candidate', 50, 60); target = scratch.querySelector('svg')!
  comparison = new LayoutComparison(host, layer, source, new Set(['node:B']), 'node:A')
})
afterEach(() => { comparison.clear(); host.remove(); vi.restoreAllMocks() })

it('原图和新图在同一坐标系对齐，只有指定变化对象保留旧影子', () => {
  source.querySelector('[data-mw-entity="node:B"]')!.setAttribute('transform', 'translate(90,0)')
  comparison.show(target, new Set(['node:B', 'edge:A->B#0']))
  expect(source.classList.contains('mw-preview-source')).toBe(true)
  const before = layer.querySelector<SVGSVGElement>('.mw-compare-before')!, after = layer.querySelector<SVGSVGElement>('.mw-compare-after')!
  expect(layer.firstElementChild).toBe(after); expect(after.nextElementSibling).toBe(before)
  expect(before.style.left).toBe('50px'); expect(after.style.left).toBe('0px')
  expect(before.querySelector('[data-mw-preview-entity="node:B"]')?.hasAttribute('data-mw-preview-change')).toBe(true)
  expect(before.querySelector('[data-mw-preview-entity="node:B"]')?.getAttribute('transform')).toBeNull()
  expect(before.querySelector('[data-mw-preview-entity="node:A"]')?.hasAttribute('data-mw-preview-change')).toBe(false)
  expect(before.querySelector('[data-mw-preview-entity="node:C"]')?.hasAttribute('data-mw-preview-change')).toBe(false)
  expect(after.querySelector('[data-mw-preview-entity="edge:A->B#0"]')?.hasAttribute('data-mw-preview-change')).toBe(true)
  expect(layer.querySelectorAll('.mw-compare-tag')).toHaveLength(0)
  expect(before.querySelector<SVGElement>('[data-mw-preview-entity="node:B"] rect')!.style.getPropertyValue('stroke-dasharray')).toBe('6 4')
  expect(after.querySelector<SVGElement>('[data-mw-preview-entity="node:B"] rect')!.style.getPropertyValue('stroke-dasharray')).toBe('none')
  expect(source.querySelector<SVGElement>('[data-mw-entity="node:B"] rect')!.style.getPropertyValue('stroke')).toBe('')
  expect(before.querySelector<SVGElement>('[data-mw-preview-entity="node:B"] rect')!.style.getPropertyValue('fill')).toBe('none')
})

it('两层 SVG 的 ID、箭头和样式引用互不冲突，也不参与主画布命中', () => {
  comparison.show(target, new Set(['node:B']))
  const ids = [...host.querySelectorAll('[id]')].map(element => element.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(source.id).toBe('original')
  expect(layer.querySelector('[data-mw-entity], [data-mw-ambiguous], [tabindex], .mw-edge-hit, .mw-selected')).toBeNull()
  for (const svg of layer.querySelectorAll('svg')) {
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.hasAttribute('inert')).toBe(true)
    expect(svg.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(svg.querySelector('style')?.textContent).toContain(`#${svg.id}`)
    const marker = svg.querySelector('marker')!
    expect(svg.querySelector('path')?.getAttribute('marker-end')).toBe(`url(#${marker.id})`)
  }
  expect(source.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid')
})

it('新旧位置接近时旧轮廓仍可见，但标记为不重复显示文字', () => {
  const scratch = document.createElement('div'); scratch.innerHTML = markup('nearby', 50, 8)
  comparison.show(scratch.querySelector('svg')!, new Set(['node:B']))
  const old = layer.querySelector('[data-mw-preview-entity="node:B"]')!
  expect(old.closest('.mw-compare-before')).toBeNull()
  expect(layer.querySelector('.mw-compare-before [data-mw-preview-entity="node:B"]')?.classList.contains('mw-preview-overlap')).toBe(true)
  expect(layer.querySelector<SVGElement>('.mw-compare-before [data-mw-preview-entity="node:B"] rect')!.style.getPropertyValue('fill')).toBe('none')
})

it('仅看移动后保留真实候选，缩放平移同步更新，取消时完全恢复主画布', () => {
  comparison.show(target, new Set(['node:B']))
  comparison.setOnlyAfter(true)
  expect(layer.classList.contains('mw-compare-only-after')).toBe(true)
  expect(layer.children).toHaveLength(2)
  source.setAttribute('data-left', '140'); source.setAttribute('data-width', '800'); source.setAttribute('data-height', '400')
  comparison.updateViewport()
  expect(layer.querySelector<SVGSVGElement>('.mw-compare-before')!.style.left).toBe('90px')
  expect(layer.querySelector<SVGSVGElement>('.mw-compare-before')!.style.width).toBe('800px')
  expect(layer.querySelector<SVGSVGElement>('.mw-compare-after')!.style.left).toBe('-10px')
  comparison.clear()
  expect(layer.children).toHaveLength(0)
  expect(source.classList.contains('mw-preview-source')).toBe(false)
  expect(host.classList.contains('mw-layout-preview-active')).toBe(false)
  expect(source.querySelector('[data-mw-entity="node:B"]')).not.toBeNull()
})
