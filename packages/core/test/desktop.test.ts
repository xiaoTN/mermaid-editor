/// <reference lib="dom" />
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readDocument, writeDocument, supportedFile, windowTitle } from '../../../apps/playground/src/documentFile'
import { DraftStore, draftKey, type DraftStorage } from '../../../apps/playground/src/draft'
import { DesktopFiles, detectDesktop, closeLabels, conflictLabels, type ShellBindings } from '../../../apps/playground/src/desktop'
import { mayLeaveDocument } from '../../../apps/playground/src/lifecycle'
import { LosslessText } from '../../codemirror/src/lossless'
import { MermaidWysiwygEditor, bindTextPane } from '../src'
import { setLocale } from '../../dom/src/i18n'
import zh from '../../dom/src/i18n/zh-CN'
import en from '../../dom/src/i18n/en'

const source = '\uFEFF# 标题  \r\n\t说明\r\n```mermaid  \r\nflowchart TD\r\n\t甲 --> 乙  %% 注释\r\n```  \r\n\r\n```mermaid\nA --> B\n```\n尾部\t '
const code = 'flowchart TD\r\n\t甲 --> 乙  %% 注释'

describe('桌面文件字节边界', () => {
  it.each(['mmd', 'mermaid', 'txt'])('%s 原样保留 BOM、混合换行、tab、末尾空格和空文件', ext => {
    for (const text of ['', '\uFEFFflowchart TD\r\n\t甲 --> 乙  \n%% 注释\r']) {
      expect(writeDocument(readDocument(`图.${ext}`, text))).toBe(text)
    }
  })
  it('Markdown 只修改首个 Mermaid 代码块，其余字节及第二块完全一致', () => {
    const file = readDocument('流程.MD', source, 'D:\\目录\\流程.MD')
    expect(file.code).toBe(code)
    expect(writeDocument(file)).toBe(source)
    expect(writeDocument({ ...file, code: code.replace('乙', '丙') })).toBe(source.replace('乙', '丙'))
    expect(writeDocument({ ...file, code: '' })).toBe(source.replace(code, ''))
  })
  it('Markdown 跳过非 Mermaid 围栏内部的伪 Mermaid 块，支持较长及波浪线围栏', () => {
    const text = '````text\r\n```mermaid\r\n假块\r\n```\r\n````\r\n~~~mermaid\r\nflowchart LR\r\n~~~~\r\n'
    expect(readDocument('a.md', text).code).toBe('flowchart LR')
    expect(writeDocument(readDocument('a.md', text))).toBe(text)
  })
  it('空 Mermaid 块可插入代码；另存为 Markdown 自动创建围栏', () => {
    const file = readDocument('a.md', '# a\r\n```mermaid\r\n```\r\n')
    expect(writeDocument({ ...file, code: 'flowchart TD' })).toBe('# a\r\n```mermaid\r\nflowchart TD\r\n```\r\n')
    expect(writeDocument({ name: 'a.md', code: 'flowchart LR' })).toBe('```mermaid\nflowchart LR\n```\n')
  })
  it.each(['# 标题\n', '```mermaid\nflowchart TD', '```text\nA\n```'])('无完整 Mermaid 块时报错，不覆盖 Markdown', text => {
    expect(() => readDocument('a.md', text)).toThrow('Mermaid')
    expect(() => writeDocument({ name: 'a.md', code: '', source: text })).toThrow('Mermaid')
  })
  it('扩展名过滤同时覆盖打开、拖入、大小写和非法文件', () => {
    for (const name of ['a.mmd', 'a.MERMAID', '中文.MD', 'a.txt']) expect(supportedFile(name)).toBe(true)
    for (const name of ['a.svg', 'a.mmd.exe', 'a']) expect(supportedFile(name)).toBe(false)
    expect(() => readDocument('a.exe', '')).toThrow()
  })
  it('标题只在实际改动时显示星号，未命名文案和对话框语言逐字匹配', () => {
    expect(windowTitle(zh['app.title'], zh['app.untitled'], false)).toBe('Mermaid 编辑器 — 未命名.mmd')
    expect(windowTitle(zh['app.title'], '流程.md', true)).toBe('Mermaid 编辑器 — 流程.md *')
    const expected = {
      'app.untitled': ['未命名.mmd', 'untitled.mmd'], 'dlg.closeTitle': ['有未保存的修改', 'Unsaved changes'],
      'dlg.closeBody': ['关闭前，要保存对 {name} 的修改吗？', 'Save changes to {name} before closing?'], 'dlg.save': ['保存', 'Save'],
      'dlg.dontSave': ['不保存', "Don't save"], 'dlg.cancel': ['取消', 'Cancel'],
      'dlg.openFilter': ['Mermaid 文件', 'Mermaid files'], 'dlg.saveFilter': ['Mermaid 文件', 'Mermaid files'],
    }
    for (const [key, pair] of Object.entries(expected)) expect([zh[key as keyof typeof zh], en[key as keyof typeof en]]).toEqual(pair)
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    setLocale('zh-CN'); expect(closeLabels('订单.mmd')).toEqual({ title: expected['dlg.closeTitle'][0], body: '关闭前，要保存对 订单.mmd 的修改吗？', save: '保存', dontSave: '不保存', cancel: '取消' })
    expect(closeLabels('订单.mmd', 'open').body).toBe('打开其他文件前，要保存对 订单.mmd 的修改吗？')
    setLocale('en'); expect(closeLabels().dontSave).toBe("Don't save"); setLocale('zh-CN')
  })
})

function storageAdapter(): DraftStorage {
  const entries = new Map<string, string>()
  return { get length() { return entries.size }, key: i => [...entries.keys()][i] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value) },
    removeItem: key => { entries.delete(key) } }
}

describe('真实路径和完整文件哈希草稿', () => {
  it('Markdown 哈希覆盖完整打开字节，外部仅修改正文也提示', async () => {
    const storage = storageAdapter(), store = new DraftStore(storage)
    const file = readDocument('a.md', source, 'D:\\a.md')
    const original = await store.open(file); original.edit('flowchart LR')
    expect(storage.key(0)).toBe(draftKey(file.path!, createHash('sha256').update(source).digest('hex')))
    const external = await store.open(readDocument('a.md', source.replace('标题', '新标题'), file.path))
    expect(external.code).toBe(code); expect(external.prompt?.changedOutside).toBe(true)
    const resumed = store.resume()!
    expect(resumed.snapshot.source).toBe(source)
    expect(resumed.dirty).toBe(true)
    expect(external.restore()).toBe('flowchart LR')
  })
  it('另存为迁移真实路径、清除旧路径和目标草稿，保存期间的新编辑保留', async () => {
    const storage = storageAdapter(), store = new DraftStore(storage)
    const old = await store.open({ name: '未命名.mmd', code: '', untitled: true }); old.edit('flowchart TD')
    const target = await store.open({ name: '新文件.mmd', path: 'D:\\新文件.mmd', code: '' }); target.edit('旧目标草稿')
    old.edit('flowchart LR')
    await old.saved('flowchart TD', { name: '新文件.mmd', path: target.path, code: 'flowchart TD', untitled: false })
    expect(storage.length).toBe(1)
    expect(store.resume()?.snapshot).toMatchObject({ path: target.path, code: 'flowchart LR', untitled: false })
    expect(old.dirty).toBe(true)
    await old.saved(old.code, { ...old.snapshot, source: undefined }); expect(storage.length).toBe(0); expect(old.dirty).toBe(false)
  })
  it('Markdown 保存后的完整文档作为新哈希基线，撤销回原内容保持正确脏状态', async () => {
    const store = new DraftStore(storageAdapter()), file = readDocument('a.md', source, 'D:\\a.md')
    const session = await store.open(file)
    session.edit(code.replace('乙', '丙'))
    const saved = { ...session.snapshot, source: writeDocument(session.snapshot) }
    await session.saved(saved.code, saved)
    expect(session.dirty).toBe(false); expect(store.resume()).toBeNull()
    session.edit(code); expect(session.dirty).toBe(true)
    expect((await store.open(saved)).prompt?.changedOutside).toBe(false)
  })
  it('原生 JSON 省略 false/undefined 时，另存为清除未命名与 Markdown 元数据', async () => {
    const store = new DraftStore(storageAdapter())
    const session = await store.open({ name: '未命名.mmd', code: '', untitled: true, source })
    session.edit('flowchart TD')
    await session.saved(session.code, { name: '真实.mmd', path: 'D:\\真实.mmd', code: session.code })
    expect(session.snapshot.untitled).toBe(false)
    expect(session.snapshot.source).toBeUndefined()
    session.edit('flowchart LR')
    expect(store.resume()?.snapshot).toMatchObject({ name: '真实.mmd', untitled: false })
    expect((await store.open({ name: '真实.mmd', path: 'D:\\真实.mmd', code: 'flowchart TD' })).prompt?.changedOutside).toBe(false)
  })
})

function fakeHost(): ShellBindings {
  return { meOpen: vi.fn().mockResolvedValue(undefined), meSave: vi.fn().mockResolvedValue(undefined),
    meSaveAs: vi.fn().mockResolvedValue(undefined), meCopy: vi.fn().mockResolvedValue(undefined),
    meLog: vi.fn().mockResolvedValue(undefined), meState: vi.fn().mockResolvedValue(undefined),
    meConfirmClose: vi.fn().mockResolvedValue(undefined), meFinishClose: vi.fn().mockResolvedValue(undefined),
    meReady: vi.fn().mockResolvedValue(undefined) }
}

describe('异步桌面桥', () => {
  it('识别外壳并等待派发结果，允许多个请求乱序返回', async () => {
    expect(detectDesktop({})).toBeNull()
    const host = fakeHost(), bridge = detectDesktop(host)!
    expect(bridge).toBeInstanceOf(DesktopFiles)
    const first = bridge.open('D:\\a.mmd'), second = bridge.open('D:\\b.mmd')
    expect(host.meOpen).toHaveBeenCalledWith(1, 'D:\\a.mmd', 'Mermaid 文件', '所有文件 (*.*)')
    host.onMe!({ id: 2, value: { name: 'b.mmd', code: 'b', path: 'D:\\b.mmd' } })
    host.onMe!({ id: 1, value: null })
    expect(await first).toBeNull(); expect((await second)?.path).toBe('D:\\b.mmd')
  })
  it('保存/另存为使用原始快照，取消不算成功，错误上报', async () => {
    const host = fakeHost(), bridge = new DesktopFiles(host), file = { code, name: 'a.mmd', path: 'D:\\a.mmd' }
    const save = bridge.save(file)
    expect(host.meSave).toHaveBeenCalledWith(1, file, 'Mermaid 文件', '所有文件 (*.*)', conflictLabels(file.name))
    host.onMe!({ id: 1, value: null }); expect(await save).toBeNull()
    const as = bridge.saveAs(file)
    expect(host.meSaveAs).toHaveBeenCalledWith(2, file, 'Mermaid 文件', '所有文件 (*.*)', conflictLabels(file.name))
    host.onMe!({ id: 2, error: '磁盘只读' }); await expect(as).rejects.toThrow('磁盘只读')
    vi.mocked(host.meOpen).mockRejectedValueOnce(new Error('桥断开'))
    await expect(bridge.open()).rejects.toThrow('桥断开')
  })
  it('拖入/第二实例打开共用路径事件，关闭确认异步回传且可注销监听', async () => {
    const host = fakeHost(), bridge = new DesktopFiles(host), open = vi.fn(), close = vi.fn()
    const offOpen = bridge.onOpen(open), offClose = bridge.onClose(close)
    host.onMe!({ type: 'open', path: 'D:\\a.md' }); host.onMe!({ type: 'close' })
    expect(open).toHaveBeenCalledWith('D:\\a.md'); expect(close).toHaveBeenCalledTimes(1)
    offOpen(); offClose(); host.onMe!({ type: 'close' }); expect(close).toHaveBeenCalledTimes(1)
    const confirm = bridge.confirmClose(); host.onMe!({ id: 1, value: 'cancel' }); expect(await confirm).toBe('cancel')
    await bridge.copy(code); bridge.syncTitle('标题 *'); bridge.ready(); bridge.finishClose()
    expect(host.meCopy).toHaveBeenCalledWith(code); expect(host.meState).toHaveBeenCalledWith('标题 *')
    expect(host.meReady).toHaveBeenCalled(); expect(host.meFinishClose).toHaveBeenCalled()
  })
})

describe('关闭窗口的保存决定', () => {
  it('无改动直接退出且不弹框', async () => {
    const confirm = vi.fn(), save = vi.fn()
    expect(await mayLeaveDocument(() => false, confirm, save)).toBe(true)
    expect(confirm).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  })
  it.each([['discard', true], ['cancel', false]] as const)('%s 决定不调用保存', async (decision, allowed) => {
    const save = vi.fn(); expect(await mayLeaveDocument(() => true, async () => decision, save)).toBe(allowed)
    expect(save).not.toHaveBeenCalled()
  })
  it.each([false, true])('只有保存成功且没有新改动才允许退出：保存结果 %s', async success => {
    let dirty = true
    expect(await mayLeaveDocument(() => dirty, async () => 'save', async () => { if (success) dirty = false; return success })).toBe(success)
    expect(await mayLeaveDocument(() => true, async () => 'save', async () => true)).toBe(false)
  })
})

describe('CodeMirror 原始换行映射', () => {
  it('混合换行中编辑中文只产生该标签的文本改动，撤销字节一致', () => {
    const original = '\uFEFFflowchart TD\r\n\t甲[开始] --> 乙  \n%% 注释\r\n'
    const editor = new MermaidWysiwygEditor({ code: original }), raw = new LosslessText(original)
    const pane = bindTextPane(editor, { getText: () => raw.code, applyEdits: edits => raw.apply(edits),
      setText: text => { raw.code = text }, setHighlights: () => {} })
    const offset = original.indexOf('开始'), from = raw.paneOffset(offset)
    expect(raw.rawOffset(from)).toBe(offset)
    raw.editPane([{ from, to: from + 2, insert: '起点' }]); pane.notifyTextChange()
    expect(editor.code).toBe(original.replace('开始', '起点'))
    editor.undo(); expect(editor.code).toBe(original); expect(raw.code).toBe(original)
    pane.dispose()
  })
  it('多段编辑基于同一原文映射；新增行沿用原始 CRLF', () => {
    const raw = new LosslessText('甲\r\n乙\r\n丙  ')
    raw.editPane([{ from: 0, to: 1, insert: '丁' }, { from: 2, to: 3, insert: '戊\n己' }])
    expect(raw.code).toBe('丁\r\n戊\r\n己\r\n丙  ')
  })
})
