import type { MermaidWysiwygEditor, EditorNotice } from '@inkeep/mermaid-wysiwyg-core'
import { onLocaleChange, t } from './i18n'

export function mountNotices(host: HTMLElement, editor: MermaidWysiwygEditor, readonly: () => boolean, hintContainer: HTMLElement = host) {
  const toast = document.createElement('div'), hint = document.createElement('div'), badge = document.createElement('div')
  toast.className = 'mw-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite')
  hint.className = 'mw-first-hint'; badge.className = 'mw-readonly-hint'
  const text = document.createElement('span'), close = document.createElement('button')
  close.type = 'button'; hint.append(text, close)
  let dismissed = false, notices: EditorNotice[] = [], timer: ReturnType<typeof setTimeout>
  try { dismissed = localStorage.getItem('mermaid-editor.hintDismissed') === '1' } catch { /* unavailable storage */ }
  const update = () => {
    toast.replaceChildren()
    for (const notice of notices) {
      if (toast.childNodes.length) toast.append(document.createTextNode(' '))
      const message = document.createElement('span')
      message.textContent = t(notice.key, notice.params)
      toast.append(message)
      if (notice.action) {
        const button = document.createElement('button')
        button.type = 'button'; button.textContent = t(notice.action.key)
        button.setAttribute('aria-label', t(notice.action.key)); button.title = t(notice.action.key)
        button.onclick = () => {
          if (readonly()) return
          if (notice.action?.op) editor.dispatch(notice.action.op)
          else editor.undo()
        }
        toast.append(button)
      }
    }
    text.textContent = t('hint.firstRun'); close.textContent = '×'; close.setAttribute('aria-label', t('hint.close')); close.title = t('hint.close')
    hint.hidden = dismissed || readonly()
    badge.hidden = !readonly(); badge.textContent = t(editor.result.typeInfo?.id !== 'flowchart' ? 'canvas.previewOnly' : 'toast.readonly')
  }
  close.onclick = () => {
    dismissed = true
    try { localStorage.setItem('mermaid-editor.hintDismissed', '1') } catch { /* unavailable storage */ }
    update()
  }
  host.append(toast, badge)
  hintContainer.append(hint)
  const show = (next: EditorNotice[]) => {
    notices = next; update(); clearTimeout(timer)
    timer = setTimeout(() => { notices = []; update() }, 4000)
  }
  const off = editor.on('warning', show)
  // Actions refer to the current transaction/document; never undo a later edit.
  const offChange = editor.on('change', () => { notices = []; clearTimeout(timer); update() })
  const offLocale = onLocaleChange(update)
  update()
  return { update, show, destroy() { clearTimeout(timer); off(); offChange(); offLocale(); toast.remove(); hint.remove(); badge.remove() } }
}

export const NOTICE_CSS = `
.mw-toast { position:absolute; bottom:12px; right:12px; z-index:30; background:var(--mw-chrome-bg,#18181b); color:var(--mw-chrome-fg,#eee); border-radius:6px; padding:8px; font:13px/1.4 system-ui; max-width:calc(100% - 40px); }
.mw-toast:empty { display:none; }
.mw-toast button { margin-left:10px; border:0; border-radius:4px; padding:3px 6px; background:#dbeafe; color:#1d4ed8; cursor:pointer; font:inherit; }
.mw-first-hint { position:absolute; bottom:8px; left:8px; right:8px; color:#69a3ff; font:12px/1.5 system-ui; }
.mw-first-hint button { color:inherit; background:none; border:0; cursor:pointer; }
.mw-readonly-hint { position:absolute; top:0; left:0; right:0; z-index:7; padding:9px 12px; border-bottom:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; font:13px/1.5 system-ui; pointer-events:none; }
`
