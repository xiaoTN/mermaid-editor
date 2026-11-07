/** Floating entity-action popover, anchored above a canvas element (mermaid.ai-style). */

import { ICONS } from './icons'

export interface PopoverAction {
  /** small text glyph shown on the button (fallback when no icon) */
  glyph?: string
  /** inline svg icon markup (see icons.ts); takes precedence over glyph */
  icon?: string
  title: string
  onClick?: () => void
  /** opens a secondary panel instead of firing directly */
  panel?: PopoverPanel
  active?: boolean
  danger?: boolean
}

export interface PopoverPanelItem {
  /** text glyph for the cell */
  glyph?: string
  /** color swatch cell (takes precedence over glyph) */
  swatch?: string
  title: string
  selected?: boolean
  onClick: () => void
}

export interface PopoverPanelSection {
  title?: string
  items: PopoverPanelItem[]
  /** grid columns for this section (default 3; swatch rows look best at 8) */
  columns?: number
}

export interface PopoverPanel {
  title: string
  /** 分组目标使用带完整名称的纵向列表，避免只显示相同的箭头图标。 */
  layout?: 'destinations'
  items?: PopoverPanelItem[]
  sections?: PopoverPanelSection[]
}

export class Popover {
  private host: HTMLElement
  private el: HTMLDivElement | null = null
  private panelEl: HTMLDivElement | null = null

  constructor(host: HTMLElement) {
    this.host = host
  }

  get isOpen(): boolean {
    return this.el !== null
  }

  /** anchorRect is in host-relative coordinates */
  show(anchorRect: { left: number; top: number; width: number; height?: number }, actions: PopoverAction[]) {
    this.hide()
    const el = document.createElement('div')
    el.className = 'mw-popover'
    el.addEventListener('pointerdown', (e) => e.stopPropagation())
    for (const action of actions) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mw-popover-btn' + (action.active ? ' active' : '') + (action.danger ? ' danger' : '')
      btn.title = action.title
      btn.setAttribute('aria-label', action.title)
      btn.setAttribute('aria-pressed', String(!!action.active))
      if (action.icon) btn.innerHTML = action.icon
      else {
        btn.classList.add('text')
        btn.textContent = action.glyph ?? ''
      }
      if (action.panel) {
        btn.classList.add('has-panel')
        const caret = document.createElement('span')
        caret.className = 'mw-caret'
        caret.innerHTML = ICONS.chevronDown
        btn.appendChild(caret)
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (action.panel) this.togglePanel(action.panel)
        else {
          this.hide()
          action.onClick?.()
        }
      })
      el.appendChild(btn)
    }
    this.host.appendChild(el)
    this.el = el
    // hosts commonly clip at their bounds (overflow: hidden) — keep the
    // toolbar inside them: clamp horizontally, and flip below the anchor
    // when there is no headroom above it
    const bounds = this.host.parentElement
    let centerX = anchorRect.left + anchorRect.width / 2
    const half = el.offsetWidth / 2
    if (bounds && bounds.clientWidth > el.offsetWidth + 8) {
      centerX = Math.min(Math.max(centerX, half + 4 + bounds.scrollLeft), bounds.scrollLeft + bounds.clientWidth - half - 4)
    }
    el.style.left = `${centerX}px`
    const above = anchorRect.top - 8
    if (above - el.offsetHeight < 4) {
      el.classList.add('mw-popover-below')
      el.style.top = `${anchorRect.top + (anchorRect.height ?? 0) + 8}px`
    } else {
      el.style.top = `${above}px`
    }
  }

  private togglePanel(panel: PopoverPanel) {
    if (this.panelEl) {
      this.panelEl.remove()
      this.panelEl = null
      return
    }
    const p = document.createElement('div')
    p.className = 'mw-popover-panel'
    if (panel.layout === 'destinations') p.classList.add('mw-popover-destinations')
    const title = document.createElement('div')
    title.className = 'mw-popover-panel-title'
    title.textContent = panel.title
    p.appendChild(title)

    const sections: PopoverPanelSection[] = panel.sections ?? [{ items: panel.items ?? [] }]
    for (const section of sections) {
      if (section.title) {
        const t = document.createElement('div')
        t.className = 'mw-popover-section-title'
        t.textContent = section.title
        p.appendChild(t)
      }
      const grid = document.createElement('div')
      grid.className = 'mw-popover-grid'
      grid.style.gridTemplateColumns = `repeat(${panel.layout === 'destinations' ? 1 : section.columns ?? 3}, 1fr)`
      for (const item of section.items) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'mw-popover-cell' + (item.selected ? ' selected' : '') + (item.swatch ? ' swatch' : '')
        b.title = item.title
        b.setAttribute('aria-label', item.title)
        if (panel.layout === 'destinations') {
          b.classList.add('destination')
          const icon = document.createElement('span'); icon.textContent = item.glyph ?? ''
          icon.setAttribute('aria-hidden', 'true')
          const label = document.createElement('span'); label.textContent = item.title
          b.append(icon, label)
        } else if (item.swatch) {
          const dot = document.createElement('span')
          dot.className = 'mw-swatch-dot'
          if (item.swatch === 'none') dot.classList.add('none')
          else dot.style.background = item.swatch
          b.appendChild(dot)
        } else {
          b.textContent = item.glyph ?? ''
        }
        b.addEventListener('click', (e) => {
          e.stopPropagation()
          this.hide()
          item.onClick()
        })
        grid.appendChild(b)
      }
      p.appendChild(grid)
    }

    this.el!.appendChild(p)
    this.panelEl = p
    // 面板上方空间不足时翻到工具条下方。
    const hostTop = this.host.getBoundingClientRect().top
    if (p.getBoundingClientRect().top < hostTop + 2) p.classList.add('below')
    if (panel.layout === 'destinations') {
      const bounds = this.host.parentElement!.getBoundingClientRect(), toolbar = this.el!.getBoundingClientRect()
      const above = toolbar.top - bounds.top - 12, below = bounds.bottom - toolbar.bottom - 12
      p.classList.toggle('below', below > above)
      p.style.width = `${Math.min(260, Math.max(140, bounds.width - 24))}px`
      p.style.maxHeight = `${Math.max(60, Math.min(280, Math.max(above, below)))}px`
      const box = p.getBoundingClientRect()
      const offset = box.left < bounds.left + 6 ? bounds.left + 6 - box.left : box.right > bounds.right - 6 ? bounds.right - 6 - box.right : 0
      p.style.transform = `translateX(calc(-50% + ${offset}px))`
    }
  }

  hide() {
    this.el?.remove()
    this.el = null
    this.panelEl = null
  }
}

export const POPOVER_CSS = `
.mw-popover.mw-popover-below { transform: translate(-50%, 0); }
.mw-popover {
  position: absolute; z-index: 20; transform: translate(-50%, -100%);
  display: flex; align-items: center; gap: 2px; padding: 4px;
  background: var(--mw-chrome-bg, #0a0a0a); border: 1px solid var(--mw-chrome-border, #333);
  border-radius: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 8px 30px rgba(0,0,0,0.45);
  font: 13px/1 -apple-system, "Geist", "Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}
.mw-popover-btn {
  border: none; background: none; border-radius: 6px; cursor: pointer;
  white-space: nowrap; flex-shrink: 0; height: 28px; min-width: 28px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  color: var(--mw-chrome-dim, #a1a1a1); line-height: 1;
  transition: background 0.12s, color 0.12s;
}
.mw-popover-btn svg { width: 15px; height: 15px; flex: none; }
.mw-popover-btn.text { font-size: 11.5px; font-weight: 500; letter-spacing: 0.01em; }
.mw-popover-btn .mw-caret { display: inline-flex; opacity: 0.55; margin-left: -1px; }
.mw-popover-btn .mw-caret svg { width: 9px; height: 9px; }
.mw-popover-btn:hover { background: var(--mw-chrome-hover, #1f1f1f); color: var(--mw-chrome-fg, #ededed); }
.mw-popover-btn.active { background: var(--mw-accent, #0070f3); color: #fff; }
.mw-popover-btn.danger:hover { background: rgba(255, 68, 68, 0.12); color: #ff4444; }
.mw-popover-panel {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: var(--mw-chrome-bg, #0a0a0a); border: 1px solid var(--mw-chrome-border, #333);
  border-radius: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 8px 30px rgba(0,0,0,0.45);
  padding: 6px; min-width: 140px;
}
.mw-popover-panel.below { bottom: auto; top: calc(100% + 6px); }
.mw-popover-destinations { box-sizing:border-box; overflow:auto; }
.mw-popover-cell.destination { display:flex; gap:8px; align-items:center; min-height:32px; text-align:left; white-space:normal; overflow-wrap:anywhere; }
.mw-popover-cell.destination:focus-visible { outline:2px solid var(--mw-accent,#315fd6); outline-offset:-2px; }
.mw-popover-panel-title {
  font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--mw-chrome-dim, #666); padding: 3px 5px 7px; white-space: nowrap;
}
.mw-popover-section-title {
  font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mw-chrome-dim, #666); padding: 6px 5px 4px; white-space: nowrap;
}
.mw-popover-grid { display: grid; gap: 2px; }
.mw-popover-cell {
  border: 1px solid transparent; background: none; border-radius: 6px; padding: 7px 8px;
  cursor: pointer; font-size: 12px; color: var(--mw-chrome-dim, #a1a1a1); white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.mw-popover-cell:hover { background: var(--mw-chrome-hover, #1f1f1f); color: var(--mw-chrome-fg, #ededed); }
.mw-popover-cell.selected {
  border-color: var(--mw-accent, #0070f3); color: var(--mw-chrome-fg, #ededed);
  background: color-mix(in srgb, var(--mw-accent, #0070f3) 12%, transparent);
}
.mw-popover-cell.swatch { padding: 5px; display: flex; align-items: center; justify-content: center; }
.mw-swatch-dot { width: 15px; height: 15px; border-radius: 99px; display: block; border: 1px solid rgba(255,255,255,0.18); }
.mw-swatch-dot.none {
  background: linear-gradient(to top left, transparent 45%, #ff4444 46%, #ff4444 54%, transparent 55%);
  border: 1px solid var(--mw-chrome-dim, #666);
}
.mw-lifeline-plus {
  position: absolute; z-index: 15; transform: translate(-50%, -50%);
  width: 18px; height: 18px; border-radius: 99px; border: none; cursor: pointer;
  background: var(--mw-accent, #0070f3); color: #fff; font-size: 13px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  transition: transform 0.12s;
}
.mw-lifeline-plus:hover { transform: translate(-50%, -50%) scale(1.15); }
.mw-plus-menu {
  position: absolute; z-index: 21; transform: translate(-50%, 4px);
  background: var(--mw-chrome-bg, #0a0a0a); border: 1px solid var(--mw-chrome-border, #333);
  border-radius: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 8px 30px rgba(0,0,0,0.45); padding: 4px;
  display: flex; flex-direction: column; min-width: 150px;
  font: 13px/1.2 -apple-system, "Geist", "Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}
.mw-plus-menu button {
  border: none; background: none; text-align: left; border-radius: 6px; padding: 7px 10px;
  cursor: pointer; color: var(--mw-chrome-dim, #a1a1a1); font-size: 12.5px;
  transition: background 0.12s, color 0.12s;
}
.mw-plus-menu button:hover { background: var(--mw-chrome-hover, #1f1f1f); color: var(--mw-chrome-fg, #ededed); }
`
