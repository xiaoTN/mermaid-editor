import { t } from '../../../packages/dom/src/i18n'
import type { EditorFile, FileAccess } from './files'

type Reply = { id: number; value?: unknown; error?: string } | { type: 'open'; path: string } | { type: 'close' } | { type: 'focus' }
export interface ShellBindings {
  meOpen(id: number, path: string, filter: string, allFiles: string): Promise<void>
  meSave(id: number, file: EditorFile, filter: string, allFiles: string, conflict: ConflictLabels): Promise<void>
  meSaveAs(id: number, file: EditorFile, filter: string, allFiles: string, conflict: ConflictLabels): Promise<void>
  meCheck?(id: number, path: string): Promise<void>
  meCopy(text: string): Promise<void>
  meLog(message: string): Promise<void>
  meState(title: string): Promise<void>
  meConfirmClose(id: number, labels: CloseLabels): Promise<void>
  meFinishClose(): Promise<void>
  meReady(): Promise<void>
  meStartupPath?: string
  onMe?: (event: Reply) => void
}
export interface CloseLabels { title: string; body: string; save: string; dontSave: string; cancel: string }
export interface ConflictLabels { title: string; body: string; overwrite: string; reload: string; cancel: string }
export const conflictLabels = (name: string): ConflictLabels => ({ title: t('dlg.conflictTitle'), body: t('dlg.conflictBody', { name }),
  overwrite: t('dlg.overwrite'), reload: t('file.reload'), cancel: t('dlg.cancel') })
export const closeLabels = (name = t('app.untitled'), reason: 'close' | 'open' = 'close'): CloseLabels => ({ title: t('dlg.closeTitle'), body: t(reason === 'open' ? 'dlg.openBody' : 'dlg.closeBody', { name }),
  save: t('dlg.save'), dontSave: t('dlg.dontSave'), cancel: t('dlg.cancel') })

/** Bindings return immediately; native modal dialogs answer later via onMe. */
export class DesktopFiles implements FileAccess {
  readonly native = true
  readonly startupPath?: string
  private sequence = 0
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private openListeners = new Set<(path: string) => void>()
  private closeListeners = new Set<() => void>()
  private focusListeners = new Set<() => void>()
  constructor(private host: ShellBindings) {
    this.startupPath = host.meStartupPath
    host.onMe = event => {
      if ('id' in event) {
        const request = this.pending.get(event.id)
        this.pending.delete(event.id)
        if (event.error) request?.reject(new Error(event.error))
        else request?.resolve(event.value)
      } else if (event.type === 'open') for (const listener of this.openListeners) listener(event.path)
      else if (event.type === 'focus') for (const listener of this.focusListeners) listener()
      else for (const listener of this.closeListeners) listener()
    }
  }
  private request<T>(send: (id: number) => Promise<void>): Promise<T> {
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      void send(id).catch(error => { this.pending.delete(id); reject(error) })
    })
  }
  open(path?: File | string): Promise<EditorFile | null> {
    return this.request(id => this.host.meOpen(id, typeof path === 'string' ? path : '', t('dlg.openFilter'), t('dlg.allFiles')))
  }
  save(file: EditorFile): Promise<EditorFile | null> {
    return this.request(id => this.host.meSave(id, file, t('dlg.saveFilter'), t('dlg.allFiles'), conflictLabels(file.name)))
  }
  saveAs(file: EditorFile): Promise<EditorFile | null> {
    return this.request(id => this.host.meSaveAs(id, file, t('dlg.saveFilter'), t('dlg.allFiles'), conflictLabels(file.name)))
  }
  copy(text: string): Promise<void> { return this.host.meCopy(text) }
  syncTitle(title: string): void { void this.host.meState(title) }
  check(path: string): Promise<EditorFile | null> {
    return this.host.meCheck ? this.request(id => this.host.meCheck!(id, path)) : Promise.resolve(null)
  }
  confirmClose(name?: string, reason: 'close' | 'open' = 'close'): Promise<'save' | 'discard' | 'cancel'> {
    return this.request(id => this.host.meConfirmClose(id, closeLabels(name, reason)))
  }
  finishClose(): void { void this.host.meFinishClose() }
  ready(): void { void this.host.meReady() }
  onOpen(listener: (path: string) => void): () => void {
    this.openListeners.add(listener); return () => { this.openListeners.delete(listener) }
  }
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener); return () => { this.closeListeners.delete(listener) }
  }
  onFocus(listener: () => void): () => void {
    this.focusListeners.add(listener); return () => { this.focusListeners.delete(listener) }
  }
}

export function detectDesktop(host: Partial<ShellBindings> = globalThis as Partial<ShellBindings>): DesktopFiles | null {
  return typeof host.meOpen === 'function' && typeof host.meSave === 'function' && typeof host.meConfirmClose === 'function'
    ? new DesktopFiles(host as ShellBindings) : null
}
