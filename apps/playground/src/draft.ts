export interface EditorFile { code: string; name: string; path?: string; source?: string; untitled?: boolean; diskHash?: string; reloaded?: boolean }

export interface DraftStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface Draft extends EditorFile {
  path: string
  baseCode: string
  baseHash: string
  updatedAt: number
}

export interface DraftPrompt {
  key: 'draft.found'
  restore: 'draft.restore'
  discard: 'draft.discard'
  changedOutside: boolean
}

export const DRAFT_PREFIX = 'mermaid-editor.draft:'
export const draftKey = (path: string, hash: string) => `${DRAFT_PREFIX}${encodeURIComponent(path)}:${hash}`
export async function hashContent(code: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function browserStorage(): DraftStorage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

/** The shell can supply a real path in EditorFile.path; browsers fall back to the filename. */
export class DraftStore {
  constructor(private readonly storage: DraftStorage | undefined = browserStorage()) {}

  private entries(): Draft[] {
    const drafts: Draft[] = []
    try {
      if (!this.storage) return drafts
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i)
        if (!key?.startsWith(DRAFT_PREFIX)) continue
        try {
          const draft = JSON.parse(this.storage.getItem(key) ?? 'null') as Partial<Draft> | null
          if (draft && typeof draft.code === 'string' && typeof draft.name === 'string' && draft.name &&
            typeof draft.path === 'string' && draft.path && typeof draft.baseCode === 'string' &&
            typeof draft.baseHash === 'string' && /^[a-f0-9]{64}$/.test(draft.baseHash) &&
            typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) &&
            draft.code !== draft.baseCode && key === draftKey(draft.path, draft.baseHash)) drafts.push(draft as Draft)
        } catch { /* Ignore one damaged entry without hiding other drafts. */ }
      }
    } catch { /* Storage can be disabled while the editor is open. */ }
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async open(file: EditorFile, offerDraft = true): Promise<DraftSession> {
    const path = file.path || file.name
    const baseHash = await hashContent(file.source ?? file.code)
    const matches = offerDraft ? this.entries().filter(draft => draft.path === path) : []
    const candidate = matches.find(draft => draft.baseHash === baseHash) ?? matches[0]
    return new DraftSession(this, { ...file, path }, baseHash, candidate)
  }

  resume(): DraftSession | null {
    const draft = this.entries()[0]
    return draft ? new DraftSession(this, { code: draft.baseCode, name: draft.name, path: draft.path,
      source: draft.source, untitled: draft.untitled },
      draft.baseHash, undefined, draft.code) : null
  }

  /** Startup offers the latest draft without applying its unsaved contents. */
  pending(): DraftSession | null {
    const draft = this.entries()[0]
    return draft ? new DraftSession(this, { code: draft.baseCode, name: draft.name, path: draft.path,
      source: draft.source, untitled: draft.untitled }, draft.baseHash, draft) : null
  }

  write(file: EditorFile & { path: string }, baseHash: string, code: string): void {
    try {
      const previous = this.entries()
      const draft: Draft = { ...file, code, baseCode: file.code, baseHash,
        updatedAt: Math.max(Date.now(), (previous[0]?.updatedAt ?? 0) + 1) }
      this.storage?.setItem(draftKey(file.path, baseHash), JSON.stringify(draft))
      for (const old of previous) {
        if (old.path === file.path && old.baseHash !== baseHash) this.remove(old.path, old.baseHash)
      }
    } catch { /* A failed write must leave the previous draft intact. */ }
  }

  remove(path: string, hash: string): void {
    try { this.storage?.removeItem(draftKey(path, hash)) } catch { /* Editing remains available without storage. */ }
  }

  removeFile(path: string): void {
    for (const draft of this.entries()) if (draft.path === path) this.remove(path, draft.baseHash)
  }
}

/** File opening only offers a candidate. The host decides whether to mount a prompt. */
export class DraftSession {
  private current: string
  constructor(private readonly store: DraftStore, private file: EditorFile & { path: string },
    private baseHash: string, private candidate?: Draft, restoredCode?: string) {
    this.current = restoredCode ?? file.code
  }

  get code(): string { return this.current }
  get name(): string { return this.file.name }
  get baseCode(): string { return this.file.code }
  get path(): string { return this.file.path }
  get snapshot(): EditorFile { return { ...this.file, code: this.current } }
  get dirty(): boolean { return this.current !== this.file.code }
  get prompt(): DraftPrompt | null {
    return this.candidate ? { key: 'draft.found', restore: 'draft.restore', discard: 'draft.discard',
      changedOutside: this.candidate.baseHash !== this.baseHash } : null
  }

  edit(code: string): void {
    if (code === this.current) return
    this.current = code
    if (code === this.file.code) {
      this.discard()
      this.store.remove(this.path, this.baseHash)
    } else {
      this.store.write(this.file, this.baseHash, code)
      this.candidate = undefined
    }
  }

  restore(): string {
    const code = this.candidate?.code
    if (code !== undefined) this.edit(code)
    // A draft can equal an externally modified file; accepting it still resolves the prompt.
    if (this.candidate) this.discard()
    return this.current
  }

  discard(): void {
    this.store.removeFile(this.path)
    this.candidate = undefined
  }

  /** Track the current disk bytes for drafts while retaining the last opened/
   * saved hash for the native overwrite confirmation. */
  async observeDisk(file: EditorFile): Promise<void> {
    const hash = await hashContent(file.source ?? file.code)
    this.file = { ...file, path: this.path, diskHash: this.file.diskHash }
    this.baseHash = hash
    this.candidate = undefined
    this.store.removeFile(this.path)
    if (this.current !== file.code) this.store.write(this.file, hash, this.current)
  }

  /** Call only after the file adapter reports success, with the exact saved snapshot. */
  async saved(savedCode: string, savedFile?: EditorFile): Promise<void> {
    const hash = await hashContent(savedFile?.source ?? savedCode)
    this.discard()
    this.store.removeFile(this.path)
    if (savedFile?.path) this.store.removeFile(savedFile.path)
    this.file = { ...this.file, ...savedFile, path: savedFile?.path ?? this.path, code: savedCode,
      source: savedFile ? savedFile.source : this.file.source,
      untitled: savedFile ? !!savedFile.untitled : this.file.untitled }
    this.baseHash = hash
    if (this.current !== savedCode) this.store.write(this.file, hash, this.current)
  }
}
