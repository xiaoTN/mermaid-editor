import type { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'

/** 使用屏幕坐标框选节点，天然适配现有的缩放、平移和嵌套分组。 */
export function mountBoxSelection(editor: MermaidWysiwygEditor, host: HTMLElement, svgHost: HTMLElement,
  enabled: () => boolean, explicit: () => boolean, hidePopover: () => void, refresh: () => void) {
  let drag: { x: number; y: number; pointerId: number; before: string[]; append: boolean; moved: boolean } | null = null
  const box = document.createElement('div'); box.className = 'mw-selection-box'
  let blockClick = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (cancel = false) => {
    if (!drag) return
    const previous = drag; drag = null; box.remove()
    try { host.releasePointerCapture?.(previous.pointerId) } catch { /* 指针可能已经由浏览器释放。 */ }
    if (cancel) editor.setSelection(previous.before, 'canvas')
    if (previous.moved) {
      blockClick = true
      clearTimeout(timer); timer = setTimeout(() => { blockClick = false }, 0)
      host.focus({ preventScroll: true })
    }
    refresh()
  }
  const down = (event: PointerEvent) => {
    blockClick = false
    if (!enabled() || (!explicit() && !event.shiftKey) || event.button !== 0 || event.altKey) return
    const target = event.target as Element
    if (!svgHost.contains(target) || target.closest('input,textarea,[contenteditable="true"],[data-mw-ambiguous]')) return
    const entity = target.closest('[data-mw-entity]')?.getAttribute('data-mw-entity')
    if (!explicit() && entity && !entity.startsWith('subgraph:')) return
    drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      before: [...editor.selection], append: event.shiftKey || event.metaKey || event.ctrlKey, moved: false }
    event.stopPropagation()
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!enabled()) { finish(true); return }
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return
    if (!drag.moved) {
      drag.moved = true; host.appendChild(box)
      try { host.setPointerCapture?.(event.pointerId) } catch { /* 合成测试事件可能没有可捕获的指针。 */ }
    }
    event.preventDefault()
    const hostRect = host.getBoundingClientRect()
    const x = Math.max(hostRect.left, Math.min(hostRect.right, event.clientX))
    const y = Math.max(hostRect.top, Math.min(hostRect.bottom, event.clientY))
    const left = Math.min(drag.x, x), right = Math.max(drag.x, x)
    const top = Math.min(drag.y, y), bottom = Math.max(drag.y, y)
    Object.assign(box.style, { left: `${left - hostRect.left}px`, top: `${top - hostRect.top}px`,
      width: `${right - left}px`, height: `${bottom - top}px` })
    const selected = [...svgHost.querySelectorAll('[data-mw-entity^="node:"]')].filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom
    }).map(node => node.getAttribute('data-mw-entity')!)
    editor.setSelection([...new Set([...(drag.append ? drag.before : []), ...selected])], 'canvas')
    hidePopover()
  }
  const up = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) { move(event); finish(event.type === 'pointercancel') } }
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(true) } }
  const click = (event: MouseEvent) => { if (blockClick) { blockClick = false; event.preventDefault(); event.stopImmediatePropagation() } }
  host.addEventListener('pointerdown', down, true)
  host.addEventListener('click', click, true)
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
  document.addEventListener('pointercancel', up)
  document.addEventListener('keydown', key, true)
  const off = editor.on('change', () => finish(true))
  return { cancel: () => finish(true), destroy: () => {
    finish(true); clearTimeout(timer); off()
    host.removeEventListener('pointerdown', down, true); host.removeEventListener('click', click, true)
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', up); document.removeEventListener('keydown', key, true)
  } }
}

export const BOX_SELECTION_CSS = `
.mw-selection-box { position:absolute; z-index:15; pointer-events:none; border:1px solid #2563eb; background:#2563eb18; }
.mw-tool-box-select .mw-svg-host { cursor:crosshair; }
`
