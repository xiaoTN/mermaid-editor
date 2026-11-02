// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { NodeMovePreview } from '../src/nodeMovePreview'
import { correlateFlowchart } from '../src/correlate'
import { setLocale, t, type MermaidLike } from '../src'

const CODE = 'flowchart TD\n A[入口]\n B[乙]\n C[丙]\n A --> B\n A --> C\n linkStyle 0 stroke:red\n'
const markup = (id: string, code: string, respectsOrder = true, reverseOrder = false) => {
  const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
  const ids = respectsOrder ? graph.edges.map(edge => edge.target) : ['B', 'C']
  if (reverseOrder) ids.reverse()
  return `<svg id="${id}" viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg"><g class="nodes">${graph.nodes.map(node =>
    `<g class="node" id="${id}-flowchart-${node.id}-0" data-x="${node.id === 'A' ? 100 : 50 + ids.indexOf(node.id) * 130}" data-y="${node.id === 'A' ? 20 : 100}"><rect width="40" height="20"/><text>${node.label}</text></g>`).join('')}</g><g class="edgePaths">${graph.edges.map(edge =>
    `<path id="${id}-L_${edge.source}_${edge.target}_0"/>`).join('')}</g></svg>`
}
let editor: MermaidWysiwygEditor, host: HTMLElement, svg: SVGSVGElement, preview: NodeMovePreview
let respectsOrder: boolean, failed: boolean, renderer: MermaidLike, readonly: boolean
const notices = vi.fn()
const panel = () => host.querySelector<HTMLElement>('.mw-drag-preview')!
const settle = () => vi.advanceTimersByTimeAsync(140)
const start = () => { preview.begin('C', svg); preview.move(null, true, 20, 100) }

beforeEach(() => {
  vi.useFakeTimers(); setLocale('zh-CN'); notices.mockClear()
  respectsOrder = true; failed = false; readonly = false
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const x = Number(this.getAttribute('data-x') ?? 0), y = Number(this.getAttribute('data-y') ?? 0)
    const width = this.hasAttribute('data-x') ? 40 : 800, height = this.hasAttribute('data-x') ? 20 : 600
    return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2,
      x: x - width / 2, y: y - height / 2, width, height, toJSON() {} }
  })
  editor = new MermaidWysiwygEditor({ code: CODE })
  host = document.createElement('div'); document.body.append(host)
  host.innerHTML = markup('original', CODE); svg = host.querySelector('svg')!
  correlateFlowchart(svg, editor.result.flowchart!)
  renderer = { initialize() {}, async parse() {}, render: vi.fn(async (id, code) => {
    if (failed) throw new Error('模拟渲染失败')
    return { svg: markup(id, code, respectsOrder) }
  }) }
  preview = new NodeMovePreview(editor, host, renderer, () => svg, () => readonly, notices)
})
afterEach(() => { preview.destroy(); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); setLocale('zh-CN') })

it.each(['zh-CN', 'en'] as const)('%s 拖动期间显示真实候选结果，源码和历史不变，松手一次提交且可撤销', async locale => {
  setLocale(locale); start()
  expect(panel().hidden).toBe(false)
  expect(panel().textContent).toContain(t('preview.loading'))
  expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  await settle()
  expect(panel().dataset.state).toBe('ready')
  expect(panel().querySelector('svg')).not.toBeNull()
  expect(panel().querySelector('[data-mw-entity]')).toBeNull()
  expect(panel().querySelector('.mw-compare-before')).not.toBeNull()
  expect(panel().querySelector('.mw-compare-after')).not.toBeNull()
  expect(svg.classList.contains('mw-preview-source')).toBe(true)
  expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  preview.drop()
  expect(editor.code).toBe(vi.mocked(renderer.render).mock.calls[0][1])
  expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
  expect(panel().hidden).toBe(true)
  expect(svg.classList.contains('mw-preview-source')).toBe(false)
  editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
})

it.each(['pending', 'blocked', 'failed', 'readonly', 'cancel', 'change'] as const)('%s 不应用未确认的结果', async reason => {
  if (reason === 'blocked') respectsOrder = false
  if (reason === 'failed') failed = true
  start()
  if (reason !== 'pending') await settle()
  if (reason === 'readonly') readonly = true
  if (reason === 'cancel') preview.cancel()
  if (reason === 'change') editor.setCode(CODE + ' D[新的输入]\n', 'code')
  const expected = editor.code
  preview.drop(); await settle()
  expect(editor.code).toBe(expected)
  expect(panel().hidden).toBe(true)
  expect(svg.classList.contains('mw-preview-source')).toBe(false)
})

it('多个指针事件不会重复渲染同一个候选，返回原位时隐藏旧结果', async () => {
  start()
  for (let i = 0; i < 12; i++) preview.move(null, true, 20 + i, 100)
  await settle()
  expect(renderer.render).toHaveBeenCalledTimes(1)
  preview.move(null, true, 200, 100)
  expect(panel().querySelector('svg')).toBeNull()
  preview.drop(); expect(editor.code).toBe(CODE)
})

it('在可见画布内横向分支可以从远处绕行拖到另一侧，不受原有窄条范围限制', async () => {
  preview.begin('C', svg)
  preview.move(null, true, 20, 360)
  await settle()
  expect(panel().dataset.state).toBe('ready')
  preview.drop()
  expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
  editor.undo(); expect(editor.code).toBe(CODE)
})

it('较慢的旧预览在取消后到达，也不能重新打开窗口或改动文档', async () => {
  let complete!: (result: { svg: string }) => void
  vi.mocked(renderer.render).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  start(); await settle(); preview.cancel()
  complete({ svg: markup('late-preview', CODE) }); await settle()
  expect(panel().hidden).toBe(true)
  expect(editor.code).toBe(CODE)
  expect(document.querySelector('#late-preview')).toBeNull()
})

it('非拖动入口同样先检查实际排版，再移动分支', async () => {
  expect(preview.canNudge('C', -1)).toBe(true)
  expect(preview.canNudge('C', 1)).toBe(false)
  preview.nudge('C', -1)
  expect(editor.code).toBe(CODE)
  await settle()
  expect(editor.code).toBe(CODE)
  panel().querySelectorAll<HTMLButtonElement>('button')[1].click()
  expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
  editor.undo(); expect(editor.code).toBe(CODE)
})

it('切换仅看移动后不提交源码，回到无效落点时禁用应用并恢复原图', async () => {
  preview.nudge('C', -1); await settle()
  const checkbox = panel().querySelector<HTMLInputElement>(`input[aria-label="${t('preview.onlyAfter')}"]`)!
  checkbox.click()
  expect(panel().querySelector('.mw-compare-only-after')).not.toBeNull()
  expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  preview.move(null, false, 0, 0)
  expect(svg.classList.contains('mw-preview-source')).toBe(false)
  expect(panel().querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!.disabled).toBe(true)
})

it('节点的画面顺序与源码相反时，仍按画面里的前后关系生成对照', async () => {
  preview.destroy(); host.innerHTML = markup('reversed', CODE, true, true); svg = host.querySelector('svg')!
  correlateFlowchart(svg, editor.result.flowchart!)
  vi.mocked(renderer.render).mockImplementation(async (id, code) => ({ svg: markup(id, code, true, true) }))
  preview = new NodeMovePreview(editor, host, renderer, () => svg, () => readonly, notices)
  expect(preview.canNudge('B', -1)).toBe(true)
  preview.nudge('B', -1); await settle()
  expect(panel().dataset.state).toBe('ready')
  const after = panel().querySelector('.mw-compare-after')!
  expect(Number(after.querySelector('[data-mw-preview-entity="node:B"]')?.getAttribute('data-x')))
    .toBeLessThan(Number(after.querySelector('[data-mw-preview-entity="node:C"]')?.getAttribute('data-x')))
  expect(editor.code).toBe(CODE)
  preview.drop(); expect(editor.result.flowchart!.edges.map(edge => edge.target)).toEqual(['C', 'B'])
  editor.undo(); expect(editor.code).toBe(CODE)
})
