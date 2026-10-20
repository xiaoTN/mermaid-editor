import { useSyncExternalStore } from 'react'
import { getLocale, onLocaleChange, t } from '@inkeep/mermaid-wysiwyg-dom'
import type { DraftPrompt } from './draft'

/** Native file opening offers recovery without blocking the editor. */
export function DraftNotice({ prompt, onRestore, onDiscard }: {
  prompt: DraftPrompt | null; onRestore: () => void; onDiscard: () => void
}) {
  useSyncExternalStore(onLocaleChange, getLocale)
  if (!prompt) return null
  return <aside className="draft-notice" role="status" aria-live="polite">
    <span>{t(prompt.key)}</span>{' '}
    {prompt.changedOutside && <span>{t('draft.changedOutside')} </span>}
    <button type="button" aria-label={t(prompt.restore)} onClick={onRestore}>{t(prompt.restore)}</button>{' '}
    <button type="button" aria-label={t(prompt.discard)} onClick={onDiscard}>{t(prompt.discard)}</button>
  </aside>
}
