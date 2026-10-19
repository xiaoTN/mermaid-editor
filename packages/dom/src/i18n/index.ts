import zhCN from './zh-CN'
import en from './en'

export const messages = { 'zh-CN': zhCN, en }
export type Locale = keyof typeof messages
export type MessageKey = keyof typeof en
const listeners = new Set<() => void>()
const storageKey = 'mermaid-editor.locale'
function savedLocale(): Locale {
  try { return globalThis.localStorage?.getItem(storageKey) === 'en' ? 'en' : 'zh-CN' } catch { return 'zh-CN' }
}
let locale = savedLocale()
export function getLocale(): Locale { return locale }
export function setLocale(next: Locale) {
  locale = next
  try { globalThis.localStorage?.setItem(storageKey, next) } catch { /* private browsing */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const listener of listeners) listener()
}
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function listKeys(): MessageKey[] { return Object.keys(en).sort() as MessageKey[] }
export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = messages[locale][key as MessageKey] ?? key
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}
