export interface EditorFile { code: string; name: string }

const DRAFT_KEY = 'mermaid-editor.draft'
export function readDraft(): EditorFile | null {
  try {
    const draft: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
    if (draft && typeof draft === 'object' && 'code' in draft && typeof draft.code === 'string' &&
      'name' in draft && typeof draft.name === 'string' && draft.name) return { code: draft.code, name: draft.name }
  } catch { /* unavailable storage or an invalid previous draft */ }
  return null
}
export function writeDraft(file: EditorFile) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(file)) } catch { /* editing remains available without storage */ }
}
