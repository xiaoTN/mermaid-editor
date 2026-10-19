import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDraft, writeDraft } from '../../../apps/playground/src/draft'

describe('应用文件和草稿边界', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('草稿保存并恢复文件名和全部原始字节，包括空文件', () => {
    for (const code of ['flowchart TD\r\n\t甲 --> 乙  %% 注释\r\n', '']) {
      const draft = { code, name: '订单流程.mmd' }
      writeDraft(draft)
      expect(JSON.parse(storage.get('mermaid-editor.draft')!)).toEqual(draft)
      expect(readDraft()).toEqual(draft)
    }
  })
  it.each(['null', '{', '{}', '{"code":2,"name":"a"}', '{"code":"","name":""}'])('无效草稿 %s 不影响加载', raw => {
    storage.set('mermaid-editor.draft', raw); expect(readDraft()).toBeNull()
  })
  it('存储不可用时仍能编辑', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } })
    expect(readDraft()).toBeNull()
    expect(() => writeDraft({ code: 'flowchart LR', name: 'a.mmd' })).not.toThrow()
  })
})
