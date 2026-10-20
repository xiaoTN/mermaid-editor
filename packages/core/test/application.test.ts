import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { DraftStore, draftKey, DRAFT_PREFIX, hashContent, type DraftStorage } from '../../../apps/playground/src/draft'
import en from '../../dom/src/i18n/en'
import zh from '../../dom/src/i18n/zh-CN'

describe('应用文件和草稿边界', () => {
  const storage = new Map<string, string>()
  const adapter: DraftStorage = {
    get length() { return storage.size }, key: index => [...storage.keys()][index] ?? null,
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) },
    removeItem: key => { storage.delete(key) },
  }
  let drafts: DraftStore
  const file = { code: 'flowchart TD\r\n\t甲 --> 乙  %% 注释\r\n', name: '订单流程.mmd', path: 'D:\\订单\\订单流程.mmd' }
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', adapter)
    drafts = new DraftStore()
  })
  afterEach(() => vi.unstubAllGlobals())
  it('草稿保存并恢复文件名和全部原始字节，包括空文件', async () => {
    for (const code of ['flowchart TD\r\n\t甲 --> 乙  %% 注释\r\n', '']) {
      const session = await drafts.open({ ...file, code: 'flowchart LR' })
      session.edit(code)
      expect(new DraftStore().resume()).toMatchObject({ code, name: file.name, path: file.path })
      expect([...storage.keys()]).toEqual([draftKey(file.path, await hashContent('flowchart LR'))])
    }
  })
  it.each(['null', '{', '{}', '{"code":2,"name":"a"}', '{"code":"","name":""}'])('无效草稿 %s 不影响加载', raw => {
    storage.set(DRAFT_PREFIX + 'broken', raw); expect(drafts.resume()).toBeNull()
  })
  it('存储不可用时仍能编辑', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } })
    const unavailable = new DraftStore()
    expect(unavailable.resume()).toBeNull()
    const session = await unavailable.open(file)
    expect(() => session.edit('')).not.toThrow()
    expect(session.code).toBe('')
  })
  it('键包含路径及打开内容的真实 SHA-256，不归一化换行或空白', async () => {
    const hash = await hashContent(file.code)
    expect(hash).toBe(createHash('sha256').update(file.code, 'utf8').digest('hex'))
    expect(await hashContent(file.code.replaceAll('\r\n', '\n'))).not.toBe(hash)
    const session = await drafts.open(file); session.edit('')
    expect(storage.has(draftKey(file.path, hash))).toBe(true)
  })
  it('打开文件默认保留磁盘字节、只提供提示；不点提示不改草稿', async () => {
    const original = await drafts.open(file); original.edit('flowchart LR\n A --> C\n')
    const before = [...storage]
    const opened = await drafts.open(file)
    expect(opened.code).toBe(file.code)
    expect(opened.prompt).toEqual({ key: 'draft.found', restore: 'draft.restore', discard: 'draft.discard', changedOutside: false })
    opened.edit(file.code)
    expect([...storage]).toEqual(before)
  })
  it('恢复草稿，撤销回磁盘内容后清除草稿；丢弃保留文件内容', async () => {
    const initial = await drafts.open(file); initial.edit('flowchart LR\r\n\tA --> C  \r\n')
    const opened = await drafts.open(file)
    expect(opened.restore()).toBe(initial.code); expect(opened.prompt).toBeNull()
    opened.edit(file.code); expect(drafts.resume()).toBeNull()
    initial.edit('flowchart LR\n A --> D')
    const discard = await drafts.open(file); discard.discard()
    expect(discard.code).toBe(file.code); expect(discard.prompt).toBeNull()
    expect(drafts.resume()).toBeNull()
  })
  it('外部修改只提示哈希不符；恢复后按新基线保存，再保存成功清理', async () => {
    const original = await drafts.open(file); original.edit('flowchart LR\n A --> C')
    const external = { ...file, code: 'flowchart TD\r\n\tB --> C  \r\n' }
    const opened = await drafts.open(external)
    expect(opened.prompt?.changedOutside).toBe(true)
    expect(opened.code).toBe(external.code)
    expect(opened.restore()).toBe(original.code)
    expect([...storage.keys()]).toEqual([draftKey(file.path, await hashContent(external.code))])
    await opened.saved(opened.code)
    expect(storage.size).toBe(0); expect(drafts.resume()).toBeNull()
  })
  it('不点提示直接编辑，以新草稿替换旧草稿', async () => {
    const initial = await drafts.open(file); initial.edit('old')
    const opened = await drafts.open({ ...file, code: 'external' }); opened.edit('new')
    expect(opened.prompt).toBeNull()
    expect(storage.size).toBe(1); expect(drafts.resume()?.code).toBe('new')
    expect(JSON.parse([...storage.values()][0]).baseCode).toBe('external')
  })
  it('同名不同路径互不串用，恢复最近草稿，保存仅清除当前文件', async () => {
    const first = await drafts.open(file); first.edit('first')
    const other = { ...file, path: 'D:\\其他\\订单流程.mmd' }
    const second = await drafts.open(other)
    expect(second.prompt).toBeNull(); expect(second.code).toBe(file.code)
    second.edit('second'); expect(drafts.resume()?.code).toBe('second')
    expect((await drafts.open(file)).restore()).toBe('first')
    await first.saved(first.code)
    expect(drafts.resume()?.path).toBe(other.path)
    expect((await drafts.open(file)).prompt).toBeNull()
  })
  it('无真实路径时用文件名隔离草稿', async () => {
    const session = await drafts.open({ name: 'one.mmd', code: '' }); session.edit('one')
    expect((await drafts.open({ name: 'two.mmd', code: '' })).prompt).toBeNull()
    expect([...storage.keys()]).toEqual([draftKey('one.mmd', await hashContent(''))])
  })
  it('保存期间的新编辑保留为以保存内容为基线的草稿', async () => {
    const session = await drafts.open(file); session.edit('saved')
    const snapshot = session.code
    session.edit('newer'); await session.saved(snapshot)
    expect(drafts.resume()?.code).toBe('newer')
    expect([...storage.keys()]).toEqual([draftKey(file.path, await hashContent(snapshot))])
    session.edit(snapshot); expect(drafts.resume()).toBeNull()
  })
  it('配额不足时不删除旧草稿，单个损坏条目不影响有效草稿', async () => {
    const session = await drafts.open(file); session.edit('old')
    storage.set(DRAFT_PREFIX + 'broken', '{')
    const opened = await drafts.open({ ...file, code: 'external' })
    vi.spyOn(adapter, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    opened.edit('new'); expect(drafts.resume()?.code).toBe('old')
    vi.restoreAllMocks()
  })
  it('五个草稿 key 中英逐字正确且语言包 key 一致', () => {
    const expected = {
      'draft.found': ['发现上次未保存的修改', 'Unsaved changes from last time'],
      'draft.restore': ['恢复', 'Restore'], 'draft.discard': ['丢弃', 'Discard'],
      'draft.restored': ['已恢复上次未保存的编辑', 'Restored your unsaved edits'],
      'draft.changedOutside': ['文件已在外部修改', 'File was changed outside the editor'],
    }
    for (const [key, pair] of Object.entries(expected)) expect([zh[key as keyof typeof zh], en[key as keyof typeof en]]).toEqual(pair)
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
