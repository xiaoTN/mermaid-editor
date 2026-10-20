import { t } from '../../../packages/dom/src/i18n'
import type { EditorFile, FileAccess } from './files'

type Reply = { id: number; value?: unknown; error?: string } | { type: 'open'; path: string } | { type: 'close' }
export interface ShellBindings {
  meOpen(id: number, path: string, filter: string): Promise<void>
  meSave(id: number, file: EditorFile, filter: string): Promise<void>
  meSaveAs(id: number, file: EditorFile, filter: string): Promise<void>
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
export const closeLabels = (): CloseLabels => ({ title: t('dlg.closeTitle'), body: t('dlg.closeBody'),
  save: t('dlg.save'), dontSave: t('dlg.dontSave'), cancel: t('dlg.cancel') })

/** Bindings return immediately; native modal dialogs answer later via onMe. */
export class DesktopFiles implements FileAccess {
  readonly native = true
  readonly startupPath?: string
  private sequence = 0
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private openListeners = new Set<(path: string) => void>()
  private closeListeners = new Set<() => void>()
  constructor(private host: ShellBindings) {
    this.startupPath = host.meStartupPath
    host.onMe = event => {
      if ('id' in event) {
        const request = this.pending.get(event.id)
        this.pending.delete(event.id)
        if (event.error) request?.reject(new Error(event.error))
        else request?.resolve(event.value)
      } else if (event.type === 'open') for (const listener of this.openListeners) listener(event.path)
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
    return this.request(id => this.host.meOpen(id, typeof path === 'string' ? path : '', t('dlg.openFilter')))
  }
  save(file: EditorFile): Promise<EditorFile | null> {
    return this.request(id => this.host.meSave(id, file, t('dlg.saveFilter')))
  }
  saveAs(file: EditorFile): Promise<EditorFile | null> {
    return this.request(id => this.host.meSaveAs(id, file, t('dlg.saveFilter')))
  }
  copy(text: string): Promise<void> { return this.host.meCopy(text) }
  syncTitle(title: string): void { void this.host.meState(title) }
  confirmClose(): Promise<'save' | 'discard' | 'cancel'> {
    return this.request(id => this.host.meConfirmClose(id, closeLabels()))
  }
  finishClose(): void { void this.host.meFinishClose() }
  ready(): void { void this.host.meReady() }
  onOpen(listener: (path: string) => void): () => void {
    this.openListeners.add(listener); return () => { this.openListeners.delete(listener) }
  }
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener); return () => { this.closeListeners.delete(listener) }
  }
}

export function detectDesktop(host: Partial<ShellBindings> = globalThis as Partial<ShellBindings>): DesktopFiles | null {
  return typeof host.meOpen === 'function' && typeof host.meSave === 'function' && typeof host.meConfirmClose === 'function'
    ? new DesktopFiles(host as ShellBindings) : null
}
