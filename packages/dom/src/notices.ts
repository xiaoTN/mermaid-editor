import type { MermaidWysiwygEditor, EditorNotice } from '@inkeep/mermaid-wysiwyg-core'
import { onLocaleChange, t } from './i18n'

export function mountNotices(host: HTMLElement, editor: MermaidWysiwygEditor, readonly: () => boolean) {
  const toast = document.createElement('div'), hint = document.createElement('div'), badge = document.createElement('div')
  toast.className = 'mw-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite')
  hint.className = 'mw-first-hint'; badge.className = 'mw-readonly-hint'
  const text = document.createElement('span'), close = document.createElement('button')
  close.type = 'button'; hint.append(text, close)
  let dismissed = false, notices: EditorNotice[] = [], timer: ReturnType<typeof setTimeout>
  try { dismissed = localStorage.getItem('mermaid-editor.hintDismissed') === '1' } catch { /* unavailable storage */ }
  const update = () => {
    toast.textContent = notices.map(n => t(n.key, n.params)).join(' ')
    text.textContent = t('hint.firstRun'); close.textContent = '×'; close.setAttribute('aria-label', t('hint.close')); close.title = t('hint.close')
    hint.hidden = dismissed || readonly()
    badge.hidden = !readonly(); badge.textContent = t('toast.readonly')
  }
  close.onclick = () => {
    dismissed = true
    try { localStorage.setItem('mermaid-editor.hintDismissed', '1') } catch { /* unavailable storage */ }
    update()
  }
  host.append(toast, hint, badge)
  const off = editor.on('warning', next => {
    notices = next; update(); clearTimeout(timer)
    timer = setTimeout(() => { notices = []; update() }, 4000)
  })
  const offLocale = onLocaleChange(update)
  update()
  return { update, destroy() { clearTimeout(timer); off(); offLocale(); toast.remove(); hint.remove(); badge.remove() } }
}

export const NOTICE_CSS = `
.mw-toast { position:absolute; bottom:12px; right:12px; z-index:30; background:var(--mw-chrome-bg,#18181b); color:var(--mw-chrome-fg,#eee); border-radius:6px; padding:8px; font:13px/1.4 system-ui; max-width:calc(100% - 40px); }
.mw-toast:empty { display:none; }
.mw-first-hint { position:absolute; bottom:8px; left:8px; right:8px; color:#69a3ff; font:12px/1.5 system-ui; }
.mw-first-hint button { color:inherit; background:none; border:0; cursor:pointer; }
.mw-readonly-hint { position:absolute; bottom:8px; left:8px; color:#a1a1a1; font:12px/1.5 system-ui; }
`
