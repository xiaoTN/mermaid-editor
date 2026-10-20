import { useSyncExternalStore } from 'react'
import { getLocale, onLocaleChange, t } from '@inkeep/mermaid-wysiwyg-dom'
import type { DraftPrompt } from './draft'

/** Optional desktop prompt. Browser file opening deliberately does not mount this component. */
export function DraftNotice({ prompt, onRestore, onDiscard }: {
  prompt: DraftPrompt | null; onRestore: () => void; onDiscard: () => void
}) {
  useSyncExternalStore(onLocaleChange, getLocale)
  if (!prompt) return null
  return <aside className="draft-notice" role="status" aria-live="polite">
    <span>{t(prompt.key)}</span>{' '}
    {prompt.changedOutside && <span>{t('draft.changedOutside')} </span>}
    <button type="button" onClick={onRestore}>{t(prompt.restore)}</button>{' '}
    <button type="button" onClick={onDiscard}>{t(prompt.discard)}</button>
  </aside>
}
