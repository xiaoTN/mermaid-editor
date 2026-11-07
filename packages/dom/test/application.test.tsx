// @vitest-environment jsdom
import '../../core/test/dom-layout'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import App from '../../../apps/playground/src/App'
import { DEFAULT_EXAMPLE } from '../../../apps/playground/src/defaultExample'
import { DraftStore } from '../../../apps/playground/src/draft'
import { DraftNotice } from '../../../apps/playground/src/DraftNotice'
import { browserFiles, type FileAccess } from '../../../apps/playground/src/files'
import { MermaidCanvasView, setLocale, t } from '../src'
import { correlationSources } from '../../../tools/cases/correlation-sources.mts'
import mermaid from '../../../apps/playground/node_modules/mermaid'

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
  vi.stubGlobal('crypto', { subtle: { digest: async (_: string, data: Uint8Array) =>
    new Uint8Array(createHash('sha256').update(data).digest()).buffer } })
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
  it('文件操作、绘图工具和复制入口分区，状态唯一且语言选择可感知', async () => {
    await mount()
    const labels = [...host.querySelectorAll('.toolbar button')].map(b => b.getAttribute('aria-label'))
    expect(labels).toEqual(['撤销', '重做', '框选', '+ 节点', '+ 分组', '切换图表方向'])
    expect([...host.querySelectorAll('.file-actions button')].map(b => b.getAttribute('aria-label'))).toEqual(['新建', '示例', '打开', '保存'])
    expect(host.querySelector('.codepanel [aria-label="复制代码"]')).not.toBeNull()
    expect(host.querySelector('.canvas-footer .sync-status')).not.toBeNull()
    expect(host.querySelector('.brand-name')?.textContent).toBe('Mermaid编辑器')
    expect(host.querySelector('[data-user-content="filename"]')?.textContent).toBe('图表.mmd')
    expect(host.querySelectorAll('.sync-status')).toHaveLength(1)
    expect(host.querySelector('.hintbar .mw-first-hint')).not.toBeNull()
    expect(host.querySelector('.language-switch button[aria-pressed="true"]')?.textContent).toBe('中')
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.language-switch button')[1].click() })
    expect(host.querySelector('.language-switch button[aria-pressed="true"]')?.textContent).toBe('EN')
    expect(host.querySelector('.language-switch')?.getAttribute('aria-label')).toBe('Switch interface language')
    expect(host.querySelector('select')).toBeNull()
  })
  it.each(['zh-CN', 'en'] as const)('%s 一个方向按钮循环四向，保留节点连线和分组设置，撤销同步按钮', async locale => {
    setLocale(locale)
    const code = '%% 保留配置\r\nflowchart TB\r\n\tsubgraph G[分组]\r\n\t direction LR\r\n\t A[甲] --> B[乙]  \r\n\tend\r\n'
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    const fit = vi.spyOn(MermaidCanvasView.prototype, 'fitView')
    await mount({ open: async () => ({ name: '方向.mmd', code }), save: vi.fn() }); await open()
    expect(button('direction.change').textContent).toBe(`${t('direction.label')} ↓`)
    fit.mockClear()
    for (const [direction, arrow] of [['LR', '→'], ['BT', '↑'], ['RL', '←'], ['TD', '↓']]) {
      await click('direction.change')
      expect(view.editor.code).toBe(code.replace('flowchart TB', `flowchart ${direction}`))
      expect(button('direction.change').textContent).toBe(`${t('direction.label')} ${arrow}`)
    }
    expect(fit).toHaveBeenCalledTimes(4)
    for (let i = 0; i < 4; i++) await click('tb.undo')
    expect(view.editor.code).toBe(code)
    expect(button('direction.change').textContent).toBe(`${t('direction.label')} ↓`)
    await click('tb.redo')
    expect(button('direction.change').textContent).toBe(`${t('direction.label')} →`)
  })
  it('多选后按下工具栏分组按钮仍保留选区，创建分组后一次撤销恢复', async () => {
    vi.spyOn(mermaid, 'render').mockImplementation(async id => ({ svg:
      `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${['A', 'B', 'C', 'D', 'E'].map((node, i) =>
        `<g class="node" id="${id}-flowchart-${node}-${i}"><rect width="40" height="20"/><text>${node}</text></g>`).join('')}</svg>`,
    }))
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () {
      view = this
      await render.call(this)
    })
    const fixture = 'flowchart TD\n A([用户下单]) --> B{库存充足?}\n B -->|是| C[扣减库存]\n B -.->|否| D[通知补货]\n subgraph 支付\n C ==> E[发起支付]\n end\n'
    await mount({ open: async () => ({ name: '分组.mmd', code: fixture }), save: vi.fn() })
    await open()
    const original = view.editor.code
    const node = (id: string) => host.querySelector(`[data-mw-entity="node:${id}"]`)!
    await act(async () => {
      node('A').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      node('C').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })
    expect(view.editor.selection).toEqual(['node:A', 'node:C'])
    expect(button('tb.addGroup').title).toBe(t('tb.groupHint'))
    await act(async () => {
      button('tb.addGroup').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      expect(view.editor.selection).toEqual(['node:A', 'node:C'])
      button('tb.addGroup').click()
    })
    const graph = view.editor.result.flowchart!
    expect(graph.nodes.filter(n => n.subgraph === 'group1').map(n => n.id)).toEqual(['A', 'C'])
    expect(graph.nodeById.get('B')?.subgraph).toBeNull()
    expect(graph.nodeById.get('E')?.subgraph).toBe('支付')
    expect(new DraftStore().resume()?.code).toBe(view.editor.code)
    await click('tb.undo')
    expect(view.editor.code).toBe(original)
    expect(view.editor.selection).toEqual(['node:A', 'node:C'])
    await act(async () => {
      host.querySelector('.titlebar')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(view.editor.selection).toEqual([])
  })
  it('没有草稿时默认载入完整功能示例', async () => {
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount()
    expect(view.editor.code).toBe(DEFAULT_EXAMPLE)
    expect(view.editor.result.typeInfo?.id).toBe('flowchart')
    expect(view.editor.canUndo).toBe(false)
    expect(new DraftStore().resume()).toBeNull()
  })
  it.each(['zh-CN', 'en'] as const)('%s 从已有文件载入示例，保留草稿且能撤销重做，保存不覆盖原文件', async locale => {
    setLocale(locale)
    const opened = { name: '原文件.md', path: 'project/原文件.md', code: 'flowchart LR\n  甲 --> 乙\n',
      source: '# 原文\n```mermaid\nflowchart LR\n  甲 --> 乙\n```', diskHash: 'original-hash' }
    const fileAccess: FileAccess = { open: async () => opened, save: vi.fn(async () => {}) }
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount(fileAccess); await open()
    await act(async () => { view.editor.dispatch({ type: 'renameNode', id: '甲', label: '原来的未保存修改' }) })
    const previous = view.editor.code
    await click('tb.example')
    expect(view.editor.code).toBe(DEFAULT_EXAMPLE)
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('toast.exampleLoaded'))
    const exampleDraft = new DraftStore().resume()!
    expect(exampleDraft.path).not.toBe(opened.path)
    expect(exampleDraft.code).toBe(DEFAULT_EXAMPLE)
    expect((await new DraftStore().open(opened)).restore()).toBe(previous)
    await click('tb.undo'); expect(view.editor.code).toBe(previous)
    await click('tb.redo'); expect(view.editor.code).toBe(DEFAULT_EXAMPLE)
    await click('tb.save')
    expect(fileAccess.save).toHaveBeenLastCalledWith({ code: DEFAULT_EXAMPLE, name: t('app.untitled'), untitled: true })
  })
  it.each(['zh-CN', 'en'] as const)('%s 一键新建清空所有内容，可撤销、重做并继续添加节点', async locale => {
    setLocale(locale)
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () {
      view = this
      await render.call(this)
    })
    await mount()
    await click('tb.addGroup')
    const original = view.editor.code
    const previousDraft = new DraftStore().resume()!
    await click('tb.new')
    expect(view.editor.code).toBe('flowchart TD\n')
    expect(view.editor.result.flowchart?.nodes).toHaveLength(0)
    expect(view.editor.selection).toEqual([])
    expect(button('tb.addNode').disabled).toBe(false)
    expect(host.querySelector('.titlebar')?.textContent).toContain(t('app.untitled'))
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('toast.newDocument'))
    expect((await new DraftStore().open({ ...previousDraft.snapshot, code: previousDraft.baseCode })).restore()).toBe(original)
    await click('tb.undo')
    expect(view.editor.code).toBe(original)
    await click('tb.redo')
    expect(view.editor.code).toBe('flowchart TD\n')
    await click('tb.addNode')
    expect(view.editor.result.flowchart?.nodes).toHaveLength(1)
    expect(view.editor.result.flowchart?.edges).toHaveLength(0)
    const newCode = view.editor.code
    await act(async () => root.unmount()); root = createRoot(host); await mount()
    await click('draft.restore')
    expect(view.editor.code).toBe(newCode)
    expect(host.querySelector('.titlebar')?.textContent).toContain(t('app.untitled'))
  })
  it.each(['zh-CN', 'en'] as const)('%s 草稿写入失败时阻止切换并保留文件身份', async locale => {
    setLocale(locale)
    const file = { name: 'original.mmd', path: '/original.mmd', code: 'flowchart LR\n A --> B' }
    const fileAccess: FileAccess = { open: async () => file, save: vi.fn(async () => {}) }
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount(fileAccess); await open()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await click('tb.addGroup')
    const original = view.editor.code
    await click('tb.example')
    expect(view.editor.code).toBe(original)
    expect(host.querySelector('[data-user-content="filename"]')?.textContent).toBe(file.name)
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.draftNotSaved'))
    await click('tb.save')
    expect(fileAccess.save).toHaveBeenCalledWith({ ...file, code: original })
  })
  it.each(['unavailable', 'silent', 'read-error'] as const)('无题文档在存储 %s 时阻止新建', async failure => {
    if (failure === 'unavailable') vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('disabled') })
    const fileAccess: FileAccess = { open: vi.fn(), save: vi.fn(async () => {}) }
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount(fileAccess)
    // 没有未保存内容时，不依赖存储也可以切换。
    await click('tb.new')
    if (failure === 'silent') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    if (failure === 'read-error') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('read denied') })
    await click('tb.addGroup')
    const before = view.editor.code
    await click('tb.example')
    expect(view.editor.code).toBe(before)
    expect(host.querySelector('[data-user-content="filename"]')?.textContent).toBe(t('app.untitled'))
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.draftNotSaved'))
    await click('tb.save')
    expect(fileAccess.save).toHaveBeenLastCalledWith({ code: before, name: t('app.untitled'), untitled: true })
  })
  it('草稿已经持久化时写入失败仍允许切换；失败后恢复存储也可重试', async () => {
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount(); await click('tb.addGroup')
    const first = view.editor.code
    const stored = new DraftStore().resume()!
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await click('tb.example')
    expect(view.editor.code).toBe(DEFAULT_EXAMPLE)
    expect((await new DraftStore().open({ ...stored.snapshot, code: stored.baseCode })).restore()).toBe(first)
    await click('tb.addGroup')
    const latest = view.editor.code
    await click('tb.new')
    expect(view.editor.code).toBe(latest)
    denied.mockRestore()
    await click('tb.new')
    expect(view.editor.code).toBe('flowchart TD\n')
  })
  it('新建等待散列时发生编辑，切换前检查最新内容', async () => {
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    await mount()
    let finish!: () => Promise<void>
    const digest = crypto.subtle.digest
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, data) => new Promise(resolve => {
      finish = async () => resolve(await digest(algorithm, data))
    }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await click('tb.new')
    await click('tb.addGroup')
    const before = view.editor.code
    await act(async () => { await finish() })
    expect(view.editor.code).toBe(before)
    expect(host.querySelector('[data-user-content="filename"]')?.textContent).toBe(t('app.filename'))
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.draftNotSaved'))
  })
  it('初始化散列未完成时编辑并新建，仍检查旧文档草稿', async () => {
    let finish!: () => Promise<void>
    const digest = crypto.subtle.digest
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, data) => new Promise(resolve => {
      finish = async () => resolve(await digest(algorithm, data))
    }))
    let view!: MermaidCanvasView
    const render = MermaidCanvasView.prototype.render
    vi.spyOn(MermaidCanvasView.prototype, 'render').mockImplementation(async function () { view = this; await render.call(this) })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await mount(); await click('tb.addGroup')
    const before = view.editor.code
    await click('tb.new')
    await act(async () => { await finish() })
    expect(view.editor.code).toBe(before)
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.draftNotSaved'))
    expect(host.querySelector('[data-user-content="filename"]')?.textContent).toBe(t('app.filename'))
  })
  it('未恢复的历史草稿不会因切换干净文档被覆盖', async () => {
    const file = { name: 'pending.mmd', code: 'flowchart TD\n A' }
    const drafts = new DraftStore()
    const old = await drafts.open(file); old.edit('flowchart TD\n Old')
    await mount()
    expect(host.querySelector('.draft-notice')).not.toBeNull()
    await click('tb.new')
    expect((await drafts.open(file)).restore()).toBe('flowchart TD\n Old')
  })
  it('写入被静默丢弃时不删除同一文件的旧版本草稿', async () => {
    const drafts = new DraftStore()
    const file = { name: 'versions.mmd', code: 'flowchart TD\n A' }
    const old = await drafts.open(file); old.edit('flowchart TD\n Old')
    const newer = await drafts.open({ ...file, code: 'flowchart TD\n B' }, false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    newer.edit('flowchart TD\n New')
    expect(newer.ensurePersisted()).toBe(false)
    expect((await drafts.open(file)).restore()).toBe('flowchart TD\n Old')
  })
  it('从 Markdown 新建时移除原文件路径和包装内容，保存与撤销都不会覆盖原文件', async () => {
    const opened = { name: '项目.md', path: 'project/项目.md', code: 'flowchart LR\n A --> B',
      source: '# 项目说明\n```mermaid\nflowchart LR\n A --> B\n```', diskHash: 'old-hash' }
    const fileAccess: FileAccess = { open: async () => opened, save: vi.fn(async () => {}) }
    await mount(fileAccess); await open()
    await click('tb.new')
    await click('tb.save')
    expect(fileAccess.save).toHaveBeenLastCalledWith({ code: 'flowchart TD\n', name: t('app.untitled'), untitled: true })
    await click('tb.undo')
    await click('tb.save')
    const saved = vi.mocked(fileAccess.save).mock.lastCall![0]
    expect(saved.code).toBe(opened.code)
    expect(saved.name).toBe(t('app.untitled'))
    expect(saved.path).not.toBe(opened.path)
    expect(saved.source).toBeUndefined()
    expect(saved.diskHash).toBeUndefined()
  })
  it('恢复草稿原始字节，画布修改自动保存，撤销可恢复，重载仍有草稿', async () => {
    const draft = { code: 'flowchart TD\r\n\tA[甲] --> B[乙]  %% 保留\r\n', name: '原始.mmd' }
    const drafts = new DraftStore()
    const session = await drafts.open({ ...draft, code: '' }); session.edit(draft.code)
    await mount(); await click('draft.restore'); await click('tb.addGroup')
    const changed = drafts.resume()!
    expect(changed.name).toBe(draft.name)
    expect(changed.code).toContain('subgraph')
    await click('tb.undo')
    expect(drafts.resume()).toMatchObject(draft)
    await act(async () => root.unmount()); root = createRoot(host); await mount()
    expect(host.querySelector('.titlebar')?.textContent).toContain(draft.name)
    expect(drafts.resume()).toMatchObject(draft)
    expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.found'))
    expect(host.querySelector('.app-toast')).toBeNull()
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
    expect((await new DraftStore().open(opened)).prompt).toBeNull()
    expect(new DraftStore().resume()?.name).toBe('图表.mmd')
  })
  it.each(['zh-CN', 'en'] as const)('%s 打开保存失败和复制提示用产品 key，原因原文不翻译', async locale => {
    setLocale(locale)
    const fileAccess: FileAccess = { open: async () => { throw new Error('EACCES: denied') }, save: async () => { throw new Error('disk full') } }
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    await mount(fileAccess)
    await click('tb.addGroup')
    const before = new DraftStore().resume()
    expect(before).not.toBeNull()
    await open()
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.open', { reason: 'EACCES: denied' }))
    await click('tb.save')
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('err.save', { reason: 'disk full' }))
    expect(new DraftStore().resume()).toEqual(before)
    await click('tb.copy')
    expect(host.querySelector('.app-toast')?.textContent).toBe(t('toast.copied'))
  })
  it.each(Object.entries(correlationSources).filter(([name]) => name.startsWith('preview-')))(
    'E2: %s opens preview-only and disables node/group additions', async (name, code) => {
    await mount({ open: async () => ({ name: `${name}.mmd`, code }), save: vi.fn() })
    await open(`${name}.mmd`)
    expect(host.querySelector('.mw-readonly')).not.toBeNull()
    expect(host.querySelector('.mw-readonly-hint')?.textContent).toBe(t('canvas.previewOnly'))
    expect(button('tb.addNode').disabled).toBe(true)
    expect(button('tb.addGroup').disabled).toBe(true)
    expect(button('direction.change').disabled).toBe(true)
    expect(host.querySelector('.mw-popover')).toBeNull()
    expect(document.title.endsWith(' *')).toBe(false)
  })
  it.each(['zh-CN', 'en'] as const)('%s 刷新只提示，明确恢复后保存清除，再重开不恢复', async locale => {
    setLocale(locale)
    const fileAccess: FileAccess = { open: vi.fn(), save: vi.fn(async () => {}) }
    const drafts = new DraftStore()
    await mount(fileAccess)
    expect(host.querySelector('.app-toast')).toBeNull()
    expect(drafts.resume()).toBeNull()
    await click('tb.addGroup')
    const draft = drafts.resume()!
    expect(draft.code).toContain('subgraph')
    await act(async () => root.unmount()); root = createRoot(host); await mount(fileAccess)
    expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.found'))
    expect(host.querySelector('.cm-content')?.textContent).not.toContain('group1')
    await click('draft.restore')
    expect(host.querySelector('.cm-content')?.textContent).toContain('subgraph')
    await click('tb.save')
    expect(drafts.resume()).toBeNull()
    expect(host.querySelector('.app-toast')).toBeNull()
    await act(async () => root.unmount()); root = createRoot(host); await mount(fileAccess)
    expect(host.querySelector('.app-toast')).toBeNull()
    expect(drafts.resume()).toBeNull()
  })
  it('浏览器打开只显示文件内容，不接草稿提示，编辑后才替换该文件草稿', async () => {
    const file = { name: 'orders.mmd', code: 'flowchart LR\r\n\tA --> B  \r\n' }
    const drafts = new DraftStore()
    const old = await drafts.open(file); old.edit('flowchart LR\n X --> Y')
    await mount({ open: async () => file, save: async () => {} }); await open()
    expect(host.querySelector('.cm-content')?.textContent).toContain('A --> B')
    expect(host.querySelector('.cm-content')?.textContent).not.toContain('X --> Y')
    expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.found'))
    expect((await drafts.open(file)).restore()).toBe(old.code)
    await click('tb.addGroup')
    expect(drafts.resume()?.code).toContain('A --> B')
    expect(drafts.resume()?.code).not.toContain('X --> Y')
  })
  it('初始 SHA-256 尚未完成就编辑并保存，成功后不重新产生已保存草稿', async () => {
    let completeHash!: () => Promise<void>
    const digest = crypto.subtle.digest
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, data) => new Promise(resolve => {
      completeHash = async () => resolve(await digest(algorithm, data))
    }))
    const fileAccess: FileAccess = { open: vi.fn(), save: vi.fn(async () => {}) }
    await mount(fileAccess); await click('tb.addGroup'); await click('tb.save')
    await act(async () => { await completeHash() })
    expect(fileAccess.save).toHaveBeenCalledTimes(1)
    expect(new DraftStore().resume()).toBeNull()
  })
  it.each(['zh-CN', 'en'] as const)('%s 桌面提示栏不挡操作，恢复、丢弃和外部修改提示正确', async locale => {
    setLocale(locale)
    const file = { name: 'same.mmd', path: 'D:/one/same.mmd', code: 'flowchart LR\n A --> B' }
    const drafts = new DraftStore()
    const initial = await drafts.open(file); initial.edit('flowchart LR\n A --> C')
    const session = await drafts.open({ ...file, code: file.code + '\n C' })
    const render = async () => act(async () => { root.render(<>
      <DraftNotice prompt={session.prompt} onRestore={() => { session.restore(); void render() }}
        onDiscard={() => { session.discard(); void render() }} />
      <textarea value={session.code} readOnly />
    </>) })
    await render()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.querySelector('textarea')?.value).toBe(file.code + '\n C')
    expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.found'))
    expect(host.querySelector('.draft-notice')?.textContent).toContain(t('draft.changedOutside'))
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.draft-notice button')[0].click() })
    expect(host.querySelector('textarea')?.value).toBe(initial.code)
    expect(host.querySelector('.draft-notice')).toBeNull()
    const discard = await drafts.open(file)
    await act(async () => { root.render(<DraftNotice prompt={discard.prompt} onRestore={() => {}}
      onDiscard={() => { discard.discard(); root.render(<DraftNotice prompt={discard.prompt} onRestore={() => {}} onDiscard={() => {}} />) }} />) })
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('.draft-notice button')[1].click() })
    expect(host.querySelector('.draft-notice')).toBeNull()
    expect(discard.code).toBe(file.code); expect(drafts.resume()).toBeNull()
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
