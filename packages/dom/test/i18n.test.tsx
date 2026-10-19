// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, getLocale, listKeys, messages, setLocale, t } from '../src'
import App from '../../../apps/playground/src/App'

vi.mock('mermaid', () => ({ default: { initialize() {}, async render() { return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }, async parse() {} } }))

const CJK = /[\u3400-\u9fff]/u
const before = 'flowchart LR\r\n\tA[甲] & B[乙] --> C  \r\n\tstyle A fill:red\r\n'
let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView

function assertEnglish(root: Element) {
  const clone = root.cloneNode(true) as Element
  // User-authored diagram labels and source code do not follow the UI locale.
  clone.querySelectorAll('.mw-svg-host, .codepane, style, script').forEach(el => el.remove())
  expect(clone.textContent).not.toMatch(CJK)
  for (const el of clone.querySelectorAll('*')) {
    expect(el.getAttribute('aria-label') ?? '').not.toMatch(CJK)
    expect(el.getAttribute('title') ?? '').not.toMatch(CJK)
  }
}
beforeEach(async () => {
  localStorage.clear(); setLocale('zh-CN')
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  editor = new MermaidWysiwygEditor({ code: before })
  host = document.createElement('div'); document.body.append(host)
  view = new MermaidCanvasView({ editor, container: host, panZoom: true, mermaid: {
    initialize() {}, async parse() {}, async render() {
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g class="node" id="flowchart-A-0"><text>甲</text></g><g class="node" id="flowchart-B-1"/><g class="node" id="flowchart-C-2"/><g class="edgePaths"><path id="L_A_C_0"/><path id="L_B_C_1"/></g></svg>' }
    },
  } })
  await view.render()
})
afterEach(() => { view.destroy(); host.remove(); vi.unstubAllGlobals(); setLocale('zh-CN'); localStorage.clear() })

describe('语言包和界面', () => {
  it('两套 key 完全一致、非空，listKeys 排序且产品文案可插值', () => {
    expect(listKeys()).toEqual(Object.keys(messages['zh-CN']).sort())
    expect(listKeys()).toEqual(Object.keys(messages.en).sort())
    expect(Object.values(messages).every(bundle => Object.values(bundle).every(text => text.trim()))).toBe(true)
    expect(t('status.synced', { n: 2 })).toBe('已同步，改动 2 行')
    setLocale('en'); expect(t('drag.dropOn', { name: 'Target' })).toBe('Release to connect to "Target"')
  })
  it('语言选择立即刷新已打开菜单、提示和 aria，代码及历史字节不变', () => {
    editor.setSelection(['edge:A->C#0'])
    expect(host.querySelector('[aria-label="实线"]')).not.toBeNull()
    setLocale('en')
    expect(host.querySelector('[aria-label="Solid"]')).not.toBeNull()
    assertEnglish(host)
    expect(editor.code).toBe(before); expect(editor.canUndo).toBe(false)
    expect(getLocale()).toBe('en'); expect(localStorage.getItem('mermaid-editor.locale')).toBe('en')
    setLocale('zh-CN'); expect(localStorage.getItem('mermaid-editor.locale')).toBe('zh-CN')
    expect(host.querySelector('[aria-label="实线"]')).not.toBeNull(); expect(editor.code).toBe(before)
  })
  it('英文工具栏、节点弹出菜单、颜色与形状面板、样式条、warning、只读和解析提示均无中文', async () => {
    setLocale('en')
    const page = document.createElement('div'); document.body.append(page)
    const root = createRoot(page)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    await act(async () => { root.render(<App />) })
    try {
      assertEnglish(page)
      for (const el of page.querySelectorAll('button, select')) expect(el.getAttribute('aria-label'), el.outerHTML).toBeTruthy()
      const addGroup = [...page.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '+ Group')
      expect(addGroup).toBeDefined()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(async () => { addGroup!.click() })
      expect(page.querySelector('.mw-changed-line')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(page.querySelector('.mw-changed-line')).toBeNull()
      vi.useRealTimers()
    } finally { vi.useRealTimers(); await act(async () => root.unmount()); page.remove() }
    editor.setSelection(['node:A'])
    for (const label of ['Node shape', 'Colors']) {
      const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      button.click(); assertEnglish(host); button.click()
    }
    editor.setSelection(['edge:A->C#0']); assertEnglish(host)
    editor.dispatch({ type: 'retargetEdge', edgeId: 'edge:A->C#0', end: 'source', nodeId: 'B' })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('That connection already exists')
    assertEnglish(host)
    editor.dispatch({ type: 'deleteNode', id: 'A' }); assertEnglish(host)
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Style lines for this node were kept')
    view.setReadOnly(true); assertEnglish(host)
  })
  it('首次提示可关闭，重建画布后不再出现', async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')!.click()
    expect(localStorage.getItem('mermaid-editor.hintDismissed')).toBe('1')
    expect(host.querySelector<HTMLElement>('.mw-first-hint')!.hidden).toBe(true)
    view.destroy()
    view = new MermaidCanvasView({ editor, container: host, mermaid: { initialize() {}, async parse() {}, async render() { throw new Error('中文错误详情') } } })
    await view.render(); setLocale('en'); assertEnglish(host)
    expect(host.querySelector<HTMLElement>('.mw-first-hint')!.hidden).toBe(true)
    expect(host.querySelector('.mw-error-badge')?.textContent).toBe('Code error, canvas paused')
  })
  it('重新载入语言模块读取上次保存的选择', async () => {
    localStorage.setItem('mermaid-editor.locale', 'en')
    vi.resetModules()
    const reloaded = await import('../src/i18n')
    expect(reloaded.getLocale()).toBe('en')
    reloaded.setLocale('zh-CN'); vi.resetModules()
    expect((await import('../src/i18n')).getLocale()).toBe('zh-CN')
  })
})
