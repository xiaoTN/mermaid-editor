// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, setLocale, t } from '../src'
import { DEFAULT_EXAMPLE } from '../../../apps/playground/src/defaultExample'

let mermaid: typeof import('../../../apps/playground/node_modules/mermaid')['default']
let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView
const ORDER = 'flowchart TD\n X[入口]\n subgraph first[第一组]\n A --> B\n end\n subgraph second[第二组]\n C --> D\n end\n X --> A\n X --> C\n'
const NESTED = 'flowchart LR\n subgraph first[第一组]\n A --> B\n subgraph child[子组]\n C\n end\n end\n subgraph target[目标组]\n D\n end\n B --> D\n'
const find = (id: string) => host.querySelector<SVGGraphicsElement>(`[data-mw-entity="${id}"]`)!
const panel = () => host.querySelector<HTMLElement>('.mw-drag-preview')!
const pointer = (target: EventTarget, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
}
const ready = () => vi.waitFor(() => expect(panel().dataset.state).toBe('ready'), { timeout: 3000 })
const center = (element: Element) => { const box = element.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2] as const }
const groupRect = (id: string) => find(`subgraph:${id}`).querySelector(':scope > rect')!

beforeAll(async () => {
  vi.stubGlobal('CSSStyleSheet', window.CSSStyleSheet)
  vi.stubGlobal('CSS', { escape: (text: string) => text.replace(/[^\w-]/g, value => `\\${value}`) })
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() { return (this.textContent ?? '').length * 8 } })
  mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
})
afterAll(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
  Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
  vi.unstubAllGlobals()
})
afterEach(() => { view?.destroy(); host?.remove(); vi.restoreAllMocks(); setLocale('zh-CN') })

async function setup(code: string) {
  host = document.createElement('div'); document.body.append(host)
  Object.defineProperties(host, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } })
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 } as DOMRect)
  // jsdom 不计算 SVG 屏幕坐标，这里只补坐标读取，排版仍交给真实 Mermaid。
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    let x = Number(this.getAttribute('x') ?? 0), y = Number(this.getAttribute('y') ?? 0)
    let current: Element | null = this
    while (current) {
      for (const match of (current.getAttribute('transform') ?? '').matchAll(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/g)) { x += Number(match[1]); y += Number(match[2]) }
      current = current.parentElement
    }
    const width = Number(this.getAttribute('width') ?? 40), height = Number(this.getAttribute('height') ?? 20)
    return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} }
  })
  editor = new MermaidWysiwygEditor({ code })
  view = new MermaidCanvasView({ editor, container: host, mermaid, debounceMs: 10000,
    mermaidConfig: { startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } } })
  await view.render()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('.mw-svg-host > svg') })
}

it('拖动组边框时内部节点、子组和内部连线一起移动，Esc 恢复全部位置', async () => {
  await setup(NESTED)
  const entities = ['subgraph:first', 'subgraph:child', 'node:A', 'node:B', 'node:C', 'edge:A->B#0']
  const before = entities.map(id => find(id).getAttribute('transform'))
  const [x, y] = center(groupRect('first'))
  pointer(groupRect('first'), 'pointerdown', x, y)
  pointer(document, 'pointermove', x + 20, y + 20)
  for (const id of entities) {
    expect(find(id).classList.contains('mw-node-moving'), id).toBe(true)
    expect(find(id).getAttribute('transform'), id).toMatch(/^translate\(20,20\)/)
  }
  expect(find('node:D').classList.contains('mw-node-moving')).toBe(false)
  expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(entities.map(id => find(id).getAttribute('transform'))).toEqual(before)
  expect(host.querySelector('.mw-node-moving')).toBeNull()
  expect(panel().hidden).toBe(true)
})

it('整组拖进另一个组，预览完成前源码不变，松手应用且一次撤销恢复', async () => {
  await setup(NESTED)
  const source = groupRect('first'), [x, y] = center(source), [toX, toY] = center(groupRect('target'))
  pointer(source, 'pointerdown', x, y)
  pointer(document, 'pointermove', toX, toY)
  expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
  await ready()
  expect(panel().querySelector('svg')).not.toBeNull()
  expect(panel().querySelector('[data-mw-entity]')).toBeNull()
  pointer(document, 'pointerup', toX, toY)
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'first')?.parent).toBe('target')
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'child')?.parent).toBe('first')
  expect(editor.selection).toEqual(['subgraph:first'])
  expect(host.querySelector('.mw-node-moving')).toBeNull()
  editor.undo(); expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
})

it('子组可整体拖出父组，外层组和其他节点仍保留', async () => {
  await setup(NESTED)
  const source = groupRect('child'), [x, y] = center(source)
  const toX = Math.max(...['first', 'target'].map(id => groupRect(id).getBoundingClientRect().right)) + 60
  pointer(source, 'pointerdown', x, y)
  pointer(document, 'pointermove', toX, 700)
  await ready(); pointer(document, 'pointerup', toX, 700)
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'child')?.parent).toBeNull()
  expect(editor.result.flowchart!.subgraphs.find(group => group.id === 'first')).toBeDefined()
  expect(editor.result.flowchart!.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
  editor.undo(); expect(editor.code).toBe(NESTED)
})

it.each(['zh-CN', 'en'] as const)('%s 同层组拖动排序和菜单排序共用预览，保留边与撤销', async locale => {
  setLocale(locale); await setup(ORDER)
  const ids = ['first', 'second'].sort((a, b) => center(groupRect(a))[0] - center(groupRect(b))[0])
  const source = groupRect(ids[1]), peer = groupRect(ids[0]), [x, y] = center(source), peerBox = peer.getBoundingClientRect()
  pointer(source, 'pointerdown', x, y)
  pointer(document, 'pointermove', peerBox.left - 20, y)
  await ready(); pointer(document, 'pointerup', peerBox.left - 20, y)
  pointer(host.querySelector('.mw-svg-host > svg')!, 'click', peerBox.left - 20, y)
  expect(editor.code).not.toBe(ORDER)
  expect(editor.result.flowchart!.edges.map(edge => `${edge.source}->${edge.target}`).sort()).toEqual(['A->B', 'C->D', 'X->A', 'X->C'])
  editor.undo(); expect(editor.code).toBe(ORDER)
  await view.render()
  editor.setSelection([`subgraph:${ids[1]}`]); view.zoomBy(1)
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('group.orderEarlier')}"]`)!
  expect(button).not.toBeNull(); button.click()
  await ready(); expect(editor.code).toBe(ORDER)
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!.click()
  expect(editor.code).not.toBe(ORDER)
  editor.undo(); expect(editor.code).toBe(ORDER)
})

it('分组菜单可选择目标，取消或只读不改变源码，自己的子组不作为目标', async () => {
  await setup(NESTED)
  editor.setSelection(['subgraph:first'])
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('group.move')}"]`)!.click()
  expect(host.querySelector('.mw-popover-destinations')?.textContent).toContain(t('group.moveInto', { name: '目标组' }))
  expect(host.querySelector(`button[aria-label="${t('group.moveInto', { name: '子组' })}"]`)).toBeNull()
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('group.moveInto', { name: '目标组' })}"]`)!.click()
  await ready()
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.cancel')}"]`)!.click()
  expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
  view.setReadOnly(true)
  const source = groupRect('first'), [x, y] = center(source)
  pointer(source, 'pointerdown', x, y); pointer(document, 'pointermove', x + 100, y + 100)
  expect(host.querySelector('.mw-node-moving')).toBeNull(); expect(panel().hidden).toBe(true)
})

it('整组可从远离原行的画布空白处绕行排序，取消后源码和位置恢复', async () => {
  await setup(ORDER)
  const ids = ['first', 'second'].sort((a, b) => center(groupRect(a))[0] - center(groupRect(b))[0])
  const source = groupRect(ids[1]), [x, y] = center(source)
  const group = find(`subgraph:${ids[1]}`), original = group.getAttribute('transform')
  pointer(source, 'pointerdown', x, y)
  pointer(document, 'pointermove', groupRect(ids[0]).getBoundingClientRect().left - 20, 700)
  await ready()
  expect(editor.code).toBe(ORDER); expect(editor.canUndo).toBe(false)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(group.getAttribute('transform')).toBe(original)
  expect(panel().hidden).toBe(true)
  expect(editor.code).toBe(ORDER); expect(editor.canUndo).toBe(false)
})

it('快速松手和画布外松手不会应用未完成的整组预览', async () => {
  await setup(NESTED)
  const source = groupRect('first'), [x, y] = center(source), [toX, toY] = center(groupRect('target'))
  pointer(source, 'pointerdown', x, y); pointer(document, 'pointermove', toX, toY)
  expect(panel().dataset.state).toBe('loading')
  pointer(document, 'pointerup', toX, toY)
  expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
  pointer(source, 'pointerdown', x, y); pointer(document, 'pointermove', toX, toY)
  await ready()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
  pointer(document, 'pointerup', 2000, 2000)
  expect(editor.code).toBe(NESTED); expect(editor.canUndo).toBe(false)
})

it('默认示例里的两个通知组可以用实际 Mermaid 排版交换顺序', async () => {
  await setup(DEFAULT_EXAMPLE)
  const ids = ['email', 'client'].sort((a, b) => center(groupRect(a))[1] - center(groupRect(b))[1])
  editor.setSelection([`subgraph:${ids[1]}`])
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('group.orderEarlier')}"]`)!.click()
  await ready()
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!.click()
  expect(editor.code).not.toBe(DEFAULT_EXAMPLE)
  editor.undo(); expect(editor.code).toBe(DEFAULT_EXAMPLE)
})

it('实际排版始终无法达到组顺序时，两种源码提示都尝试后保留原图', async () => {
  await setup(ORDER)
  const render = mermaid.render.bind(mermaid)
  vi.spyOn(mermaid, 'render').mockImplementation(async (...args) => {
    const result = await render(...args)
    const scratch = document.createElement('div'); scratch.innerHTML = result.svg
    for (const rect of scratch.querySelectorAll('.cluster > rect')) rect.setAttribute('x', '0')
    return { ...result, svg: scratch.innerHTML }
  })
  const ids = ['first', 'second'].sort((a, b) => center(groupRect(a))[0] - center(groupRect(b))[0])
  editor.setSelection([`subgraph:${ids[1]}`])
  host.querySelector<HTMLButtonElement>(`button[aria-label="${t('group.orderEarlier')}"]`)!.click()
  await vi.waitFor(() => expect(panel().dataset.state).toBe('blocked'))
  expect(host.querySelector<HTMLButtonElement>(`button[aria-label="${t('preview.apply')}"]`)!.disabled).toBe(true)
  expect(editor.code).toBe(ORDER); expect(editor.canUndo).toBe(false)
})
