// @vitest-environment jsdom
import '../../core/test/dom-layout'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../../apps/playground/src/App'
import { DesktopFiles, type ShellBindings } from '../../../apps/playground/src/desktop'
import { DraftStore, type EditorFile } from '../../../apps/playground/src/draft'
import { MermaidCanvasView, setLocale, t } from '../src'
import type { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'

vi.mock('../../../apps/playground/node_modules/mermaid', () => ({ default: { initialize() {}, async parse() {}, async render() {
  return { svg: '<svg id="test" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g class="node" id="test-flowchart-A-0"/><g class="node" id="test-flowchart-B-1"/><g class="edgePaths"><path id="L_A_B_0"/></g></svg>' }
} } }))

let root: Root, host: HTMLElement, editor: MermaidWysiwygEditor
let disk: EditorFile, chosen: EditorFile, shell: ShellBindings
let decision: 'save' | 'discard' | 'cancel', conflict: 'overwrite' | 'reload' | 'cancel'
const hash = (code: string) => createHash('sha256').update(code).digest('hex')
const file = (code: string, name = 'orders.mmd'): EditorFile => ({ name, path: `D:/${name}`, code, diskHash: hash(code) })
const base = 'flowchart LR\n A[one] --> B[two]\n B --> C\n'
const click = (key: string) => act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === t(key))!.click() })
const focus = () => act(async () => { shell.onMe!({ type: 'focus' }) })
const mount = () => act(async () => { root.render(<App fileAccess={new DesktopFiles(shell)} />) })
const close = () => act(async () => { shell.onMe!({ type: 'close' }) })

beforeEach(() => {
  localStorage.clear(); setLocale('zh-CN'); decision = 'cancel'; conflict = 'cancel'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { subtle: { digest: async (_: string, bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest()).buffer } })
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  disk = file(base); chosen = disk
  const reply = (id: number, value: unknown) => { shell.onMe!({ id, value }); return Promise.resolve() }
  shell = {
    meStartupPath: disk.path,
    meOpen: vi.fn((id, path) => reply(id, path === disk.path ? { ...disk } : { ...chosen })),
    meCheck: vi.fn(id => reply(id, { ...disk })),
    meSave: vi.fn((id, snapshot) => {
      if (snapshot.diskHash !== disk.diskHash) {
        if (conflict === 'cancel') return reply(id, null)
        if (conflict === 'reload') return reply(id, { ...disk, reloaded: true })
      }
      disk = file(snapshot.code); return reply(id, { ...disk })
    }),
    meSaveAs: vi.fn(async () => {}), meCopy: vi.fn(async () => {}), meLog: vi.fn(async () => {}), meState: vi.fn(async () => {}),
    meConfirmClose: vi.fn(id => reply(id, decision)), meFinishClose: vi.fn(async () => {}),
    meReady: vi.fn(async () => { shell.onMe!({ type: 'open', path: disk.path! }) }),
  }
  const render = MermaidCanvasView.prototype.render
  vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { editor = this.editor; await render.call(this) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it.each(['zh-CN', 'en'] as const)('%s focus reloads a clean file; dirty file offers reload/keep, save still carries original hash', async locale => {
  setLocale(locale); await mount()
  disk = file(base.replace('one', 'external'))
  await focus()
  expect(editor.code).toBe(disk.code); expect(editor.canUndo).toBe(false)
  expect(host.querySelector('.app-toast')?.textContent).toBe(t('file.reloaded'))
  expect(document.title.endsWith(' *')).toBe(false)
  const openedHash = disk.diskHash
  await act(async () => { editor.dispatch({ type: 'renameNode', id: 'A', label: 'mine' }) })
  const mine = editor.code
  disk = file(base.replace('two', 'outside'))
  await focus()
  expect(editor.code).toBe(mine)
  expect(host.querySelector('.file-conflict')?.textContent).toContain(t('file.changedOutside'))
  expect(document.title.endsWith(' *')).toBe(true)
  expect(host.querySelector('.sync-status')?.textContent).not.toBe(t('status.synced', { n: 0 }))
  await click('file.keepMine'); expect(host.querySelector('.file-conflict')).toBeNull()
  await focus(); expect(host.querySelector('.file-conflict')).toBeNull()
  await click('tb.save') // cancel the conflict
  expect(vi.mocked(shell.meSave).mock.calls[0][1].diskHash).toBe(openedHash)
  expect(editor.code).toBe(mine); expect(disk.code).not.toBe(mine)
  expect(new DraftStore().resume()?.code).toBe(mine)
  conflict = 'reload'; await click('tb.save')
  expect(editor.code).toBe(disk.code); expect(document.title.endsWith(' *')).toBe(false)
  expect(new DraftStore().resume()).toBeNull()
})

it('dirty banner reload reads the latest disk bytes, and timer checks within five seconds', async () => {
  await mount()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  // Remount so the actual subscription installs its interval under the fake clock.
  await act(async () => root.unmount()); root = createRoot(host); await mount()
  await act(async () => { editor.dispatch({ type: 'renameNode', id: 'A', label: 'mine' }) })
  disk = file(base.replace('one', 'external'))
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(host.querySelector('.file-conflict')).not.toBeNull()
  disk = file(base.replace('one', 'newest'))
  await click('file.reload')
  expect(editor.code).toBe(disk.code); expect(editor.canUndo).toBe(false)
  expect(new DraftStore().resume()).toBeNull()
})

it.each(['discard', 'save', 'cancel'] as const)('close %s cleans drafts only when leaving succeeds', async choice => {
  await mount(); await click('tb.addGroup'); decision = choice
  expect(new DraftStore().resume()).not.toBeNull()
  await close()
  expect(shell.meFinishClose).toHaveBeenCalledTimes(choice === 'cancel' ? 0 : 1)
  expect(new DraftStore().resume() === null).toBe(choice !== 'cancel')
  expect(vi.mocked(shell.meConfirmClose).mock.calls[0][1].body).toBe(t('dlg.closeBody', { name: disk.name }))
})

it.each(['zh-CN', 'en'] as const)('%s native drop/open uses a filename-specific open prompt and cancel leaves the document', async locale => {
  setLocale(locale); await mount(); await click('tb.addGroup')
  const mine = editor.code
  chosen = file('flowchart TD\n X --> Y', 'other.mmd')
  await act(async () => { shell.onMe!({ type: 'open', path: chosen.path! }) })
  expect(editor.code).toBe(mine)
  expect(vi.mocked(shell.meConfirmClose).mock.calls[0][1].body).toBe(t('dlg.openBody', { name: 'orders.mmd' }))
  decision = 'discard'
  await act(async () => { shell.onMe!({ type: 'open', path: chosen.path! }) })
  expect(editor.code).toBe(chosen.code)
  expect(new DraftStore().resume()).toBeNull()
})

it('startup reads disk and offers the draft without applying it; discard survives another launch', async () => {
  const draft = await new DraftStore().open(disk); draft.edit(base.replace('one', 'unsaved'))
  shell.meStartupPath = undefined
  await mount()
  expect(editor.code).toBe(base); expect(editor.canUndo).toBe(false)
  expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.found'))
  expect(document.title.endsWith(' *')).toBe(false)
  await click('draft.discard')
  await act(async () => root.unmount()); root = createRoot(host); await mount()
  expect(host.querySelector('.draft-notice')).toBeNull(); expect(editor.code).toBe(base)
})

it('changed lines persist across selection and time, overlap selection, and clear only on save/revert', async () => {
  await mount()
  await act(async () => { editor.dispatch({ type: 'renameNode', id: 'A', label: 'mine' }); editor.dispatch({ type: 'setEdgeLabel', edgeId: 'edge:B->C#0', label: 'new' }) })
  expect(host.querySelector('.sync-status')?.textContent).toBe(t('status.synced', { n: 2 }))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await act(async () => { editor.setSelection(['edge:A->B#0'], 'canvas'); await vi.advanceTimersByTimeAsync(5000) })
  expect(host.querySelector('.mw-changed-line.mw-cm-selected-line')).not.toBeNull()
  await act(async () => { editor.setSelection(['edge:B->C#0'], 'canvas') })
  expect(host.querySelectorAll('.mw-changed-line')).toHaveLength(2)
  expect(host.querySelector('.mw-changed-line.mw-cm-selected-line')).not.toBeNull()
  vi.useRealTimers(); await click('tb.save')
  expect(host.querySelector('.mw-changed-line')).toBeNull()
  expect(host.querySelector('.sync-status')?.textContent).toBe(t('status.synced', { n: 0 }))
  await act(async () => { editor.undo() })
  expect(document.title.endsWith(' *')).toBe(true)
  expect(host.querySelector('.sync-status')?.textContent).toBe(t('status.synced', { n: 1 }))
})
