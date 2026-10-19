// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../apps/playground/src/App'
import { browserFiles, type FileAccess } from '../../../apps/playground/src/files'
import { MermaidCanvasView, setLocale, t } from '../src'

vi.mock('../../../apps/playground/node_modules/mermaid', () => ({ default: { initialize() {}, async parse() {}, async render() {
  return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" />' }
} } }))

let host: HTMLElement, root: Root
const button = (key: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === t(key))!
const click = async (key: string) => act(async () => { button(key).click() })
const mount = async (fileAccess?: FileAccess) => act(async () => { root.render(<App fileAccess={fileAccess} />) })
const open = async (name = 'orders.mmd') => act(async () => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name }] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
})

beforeEach(() => {
  localStorage.clear(); setLocale('zh-CN')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  localStorage.clear(); setLocale('zh-CN')
})

describe('应用线框和文件交互', () => {
  it('浏览器打开保留文件名、CRLF、tab 和行尾空格', async () => {
    const code = 'flowchart LR\r\n\t甲 --> 乙  \r\n'
    const file = { name: '订单.mmd', text: async () => code } as File
    expect(await browserFiles.open(file)).toEqual({ code, name: file.name })
  })
  it('工具栏顺序、标题、单一同步状态、底栏提示和语言高亮符合产品布局', async () => {
    await mount()
    const labels = [...host.querySelectorAll('.toolbar button')].map(b => b.getAttribute('aria-label'))
    expect(labels.slice(0, 7)).toEqual(['打开', '保存', '撤销', '重做', '+ 节点', '+ 分组', '复制代码'])
    expect(host.querySelector('.titlebar')?.textContent).toBe('Mermaid 编辑器 — 图表.mmd')
    expect(host.querySelectorAll('.sync-status')).toHaveLength(1)
    expect(host.querySelector('.hintbar .mw-first-hint')).not.toBeNull()
    expect(host.querySelector('.language-switch button.active')?.textContent).toBe('中')
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.language-switch button')[1].click() })
    expect(host.querySelector('.language-switch button.active')?.textContent).toBe('EN')
    expect(host.querySelector('.language-switch')?.getAttribute('aria-label')).toBe('Switch interface language')
    expect(host.querySelector('select')).toBeNull()
  })
  it('恢复草稿原始字节，画布修改自动保存，撤销可恢复，重载仍有草稿', async () => {
    const draft = { code: 'flowchart TD\r\n\tA[甲] --> B[乙]  %% 保留\r\n', name: '原始.mmd' }
    localStorage.setItem('mermaid-editor.draft', JSON.stringify(draft))
    await mount(); await click('tb.addGroup')
    const changed = JSON.parse(localStorage.getItem('mermaid-editor.draft')!)
    expect(changed.name).toBe(draft.name)
    expect(changed.code).toContain('subgraph')
    await click('tb.undo')
    expect(JSON.parse(localStorage.getItem('mermaid-editor.draft')!)).toEqual(draft)
    await act(async () => root.unmount()); root = createRoot(host); await mount()
    expect(host.querySelector('.titlebar')?.textContent).toContain(draft.name)
    expect(JSON.parse(localStorage.getItem('mermaid-editor.draft')!)).toEqual(draft)
  })
  it('打开沿用文件名，保存原字节；初次打开 fit，之后手动缩放不被编辑打断', async () => {
    const render = MermaidCanvasView.prototype.render
    const errors: unknown[] = []
    let rendered: MermaidCanvasView
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () {
      await render.call(this); errors.push(this.renderError); rendered = this
    })
    const fit = vi.spyOn(MermaidCanvasView.prototype, 'fitView')
    const opened = { name: '订单流程.mmd', code: 'flowchart LR\r\n\tA --> B  \r\n' }
    const fileAccess: FileAccess = { open: vi.fn(async () => opened), save: vi.fn(async () => {}) }
    await mount(fileAccess)
    expect(errors).toEqual([null])
    expect(fit).toHaveBeenCalled()
    rendered!.zoomBy(1.25)
    const transform = host.querySelector<SVGSVGElement>('.mw-svg-host svg')!.style.transform
    fit.mockClear()
    await click('tb.addGroup')
    await act(async () => { await rendered!.render() })
    expect(fit).not.toHaveBeenCalled()
    expect(host.querySelector<SVGSVGElement>('.mw-svg-host svg')!.style.transform).toBe(transform)
    fit.mockClear(); await open()
    expect(fit).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.titlebar')?.textContent).toContain(opened.name)
    await click('tb.save'); expect(fileAccess.save).toHaveBeenCalledWith(opened)
    expect(JSON.parse(localStorage.getItem('mermaid-editor.draft')!)).toEqual({ code: opened.code, name: opened.name })
  })
  it.each(['zh-CN', 'en'] as const)('%s 打开保存失败和复制提示用产品 key，原因原文不翻译', async locale => {
    setLocale(locale)
    const fileAccess: FileAccess = { open: async () => { throw new Error('EACCES: denied') }, save: async () => { throw new Error('disk full') } }
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    await mount(fileAccess)
    const before = localStorage.getItem('mermaid-editor.draft')
    await open()
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.open', { reason: 'EACCES: denied' }))
    await click('tb.save')
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.save', { reason: 'disk full' }))
    expect(localStorage.getItem('mermaid-editor.draft')).toBe(before)
    await click('tb.copy')
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('toast.copied'))
  })
  it('非流程图只读预览，禁止节点和分组操作', async () => {
    localStorage.setItem('mermaid-editor.draft', JSON.stringify({ code: 'classDiagram\n class A', name: 'classes.mmd' }))
    await mount()
    expect(host.querySelector('.mw-readonly')).not.toBeNull()
    expect(host.querySelector('.mw-readonly-hint')?.textContent).toBe(t('toast.readonly'))
    expect(button('tb.addNode').disabled).toBe(true)
    expect(button('tb.addGroup').disabled).toBe(true)
    expect(host.querySelector('.mw-popover')).toBeNull()
  })
  it('浏览器下载保存使用原文件名和原始内容，释放临时对象 URL', async () => {
    const create = vi.fn(() => 'blob:test'), revoke = vi.fn(), clickLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const file = { code: 'flowchart LR\r\n\tA --> B  \r\n', name: '订单.mmd' }
      await browserFiles.save(file)
      expect(clickLink.mock.instances[0].download).toBe(file.name)
      const blob = create.mock.calls[0][0] as Blob
      expect(blob.size).toBe(new TextEncoder().encode(file.code).length)
      expect(document.querySelector('a[download]')).toBeNull()
      await vi.advanceTimersByTimeAsync(1000); expect(revoke).toHaveBeenCalledWith('blob:test')
    } finally { vi.useRealTimers() }
  })
})
