// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, setLocale, t, messages, type MermaidLike } from '../src'

const CODE = '%% 保留  \r\nflowchart LR\r\n\tA[甲] --> B[乙]  \r\n\tC[丙]\r\n'
const fake: MermaidLike = {
  initialize() {}, async parse() {},
  async render(_id, code) {
    const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
    return { svg: `<svg id="fixture" xmlns="http://www.w3.org/2000/svg"><g class="nodes">${graph.nodes.map((n, i) => `<g class="node" id="fixture-flowchart-${n.id}-${i}"><text>${n.label}</text></g>`).join('')}</g><g class="edgePaths">${graph.edges.map((e, i) => `<path id="L_${e.source}_${e.target}_${i}" d="M0 0L100 100"/>`).join('')}</g></svg>` }
  },
}
let host: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView
const pointer = (el: EventTarget, type: string, x = 0) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 30, button: 0 }))
const find = (id: string) => host.querySelector(`[data-mw-entity="${id}"]`)!
const handle = (label: string) => {
  if (label === '拖动箭头终点') return host.querySelector('[data-end="target"]')!
  const key = Object.entries(messages['zh-CN']).find(([, value]) => value === label)?.[0]
  return host.querySelector(`[aria-label="${key ? t(key) : label}"]`)!
}
const drop = (el: Element | null) => { Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => el }); pointer(document, 'pointermove', 90); pointer(document, 'pointerup', 90) }

beforeEach(async () => {
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) })
  editor = new MermaidWysiwygEditor({ code: CODE })
  host = document.createElement('div'); document.body.append(host)
  view = new MermaidCanvasView({ editor, container: host, mermaid: fake, debounceMs: 0 })
  await view.render()
})
afterEach(() => { view.destroy(); host.remove(); vi.unstubAllGlobals(); setLocale('zh-CN') })

describe.each(['zh-CN', 'en'] as const)('%s 画布手势', locale => {
  beforeEach(() => setLocale(locale))
  it('多选浮层批量改形状、颜色、删除，一次撤销恢复全部节点', () => {
    const clickTitle = (title: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.title === title)!.click()
    editor.setSelection(['node:A', 'node:C'])
    expect(host.querySelector('.mw-popover')?.textContent).toContain(t('selection.count', { n: 2 }))
    clickTitle(t('ui.nodeShape')); clickTitle(t('shape.diamond'))
    expect(editor.result.flowchart!.nodeById.get('A')!.shape).toBe('diamond')
    expect(editor.result.flowchart!.nodeById.get('C')!.shape).toBe('diamond')
    expect(editor.result.flowchart!.nodeById.get('B')!.shape).toBe('rect')
    editor.undo(); expect(editor.code).toBe(CODE)
    clickTitle(t('ui.colors'))
    clickTitle(t('ui.colorValue', { name: t('ui.fill'), value: '#ef4444' }))
    expect(editor.code).toContain('style A fill:#ef4444')
    expect(editor.code).toContain('style C fill:#ef4444')
    editor.undo(); expect(editor.code).toBe(CODE)
    clickTitle(t('selection.delete'))
    expect(editor.result.flowchart!.nodeById.has('A')).toBe(false)
    expect(editor.result.flowchart!.nodeById.has('C')).toBe(false)
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  })
  it('端点松在空白处取消，字节和历史不变，保留 Mermaid id', () => {
    pointer(find('edge:A->B#0'), 'click')
    expect(host.querySelector('#L_A_B_0')).not.toBeNull()
    pointer(handle('拖动箭头终点'), 'pointerdown'); drop(null)
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    pointer(find('edge:A->B#0'), 'click')
    expect(host.querySelectorAll('.mw-endpoints button')).toHaveLength(2)
  })
  it('端点松在节点只替换一个 ID，可撤销重做', () => {
    pointer(find('edge:A->B#0'), 'click'); pointer(handle('拖动箭头终点'), 'pointerdown'); drop(find('node:C'))
    // The old inline definition is preserved by the core operation.
    expect(editor.code).toBe(CODE.replace('B[乙]', 'C').replace('\tA[甲]', '\tB[乙]\r\n\tA[甲]'))
    const after = editor.code
    editor.undo(); expect(editor.code).toBe(CODE)
    editor.redo(); expect(editor.code).toBe(after)
  })
  it('旧节点另有声明时仅改一个端点 ID，并显示目标高亮', () => {
    const code = CODE.replace('B[乙]', 'B').replace('\tC[丙]', '\tB[乙]\r\n\tC[丙]')
    editor.setCode(code, 'api')
    const changes: unknown[] = []
    editor.on('change', event => changes.push(event.edits))
    pointer(find('edge:A->B#0'), 'click'); pointer(handle('拖动箭头终点'), 'pointerdown')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => find('node:C') })
    pointer(document, 'pointermove', 90)
    expect(find('node:C').classList.contains('mw-connect-target')).toBe(true)
    pointer(document, 'pointerup', 90)
    expect(editor.code).toBe(code.replace(' --> B ', ' --> C '))
    const start = code.indexOf(' --> B') + 5
    expect(changes).toEqual([[{ start, end: start + 1, text: 'C' }]])
    editor.undo(); expect(editor.code).toBe(code)
  })
  it('直接从四边连接点拖到节点，默认实线箭头', () => {
    pointer(find('node:A'), 'pointerover')
    expect(host.querySelectorAll('.mw-ports button')).toHaveLength(4)
    pointer(host.querySelector('.mw-ports button')!, 'pointerdown'); drop(find('node:C'))
    expect(editor.result.flowchart!.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B', 'A->C'])
    editor.undo(); expect(editor.code).toBe(CODE)
  })
  it('拖出重复连线时提示、代码与历史不变，四边圆点有产品 aria', () => {
    pointer(find('node:A'), 'pointerover')
    const dots = host.querySelectorAll('.mw-ports button')
    expect(dots).toHaveLength(4)
    for (const dot of dots) expect(dot.getAttribute('aria-label')).toBe(t('aria.connectDot'))
    pointer(dots[0], 'pointerdown'); drop(find('node:B'))
    expect(editor.code).toBe(CODE)
    expect(editor.canUndo).toBe(false)
    expect(host.querySelector('.mw-toast')?.textContent).toBe(t('toast.dupEdge'))
  })
  it('宽命中路径可选中箭头、悬停变色，两端蓝点共用产品 aria', () => {
    const hit = host.querySelector('.mw-edge-hit')!
    expect(hit.getAttribute('stroke-width')).toBe('12')
    expect(hit.getAttribute('pointer-events')).toBe('stroke')
    expect(hit.hasAttribute('id')).toBe(false)
    hit.dispatchEvent(new Event('pointerenter'))
    expect(host.querySelector('#L_A_B_0')?.classList.contains('mw-edge-hover')).toBe(true)
    pointer(hit, 'click')
    expect(editor.selection).toEqual(['edge:A->B#0'])
    expect(host.querySelectorAll('.mw-endpoints button')).toHaveLength(2)
    for (const dot of host.querySelectorAll('.mw-endpoints button')) expect(dot.getAttribute('aria-label')).toBe(t('aria.edgeEndDot'))
  })
  it('空白连线菜单可取消且不改代码，切换语言立即刷新', () => {
    pointer(find('node:A'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown'); drop(null)
    setLocale(locale === 'en' ? 'zh-CN' : 'en')
    const cancel = host.querySelector<HTMLButtonElement>('.mw-new-node-menu button:last-child')!
    expect(cancel.textContent).toBe(t('menu.cancel'))
    pointer(cancel, 'click')
    expect(host.querySelector('.mw-new-node-menu')).toBeNull()
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  })
  it('空白处菜单新建节点并连线，一次撤销回到原始字节', () => {
    pointer(find('node:A'), 'pointerover'); pointer(host.querySelector('.mw-ports button')!, 'pointerdown'); drop(null)
    expect(editor.code).toBe(CODE)
    pointer(handle('新建节点'), 'click')
    expect(editor.result.flowchart!.nodes).toHaveLength(4)
    expect(editor.result.flowchart!.edges).toHaveLength(2)
    const after = editor.code
    editor.undo(); expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
    editor.redo(); expect(editor.code).toBe(after)
  })
  it.each([['实线', '-->'], ['虚线', '-.->'], ['粗线', '==>']])('点击箭头切换%s，只改符号', (label, token) => {
    if (token === '-->') editor.setCode(CODE.replace('-->', '-.->'), 'api')
    const before = editor.code
    pointer(find('edge:A->B#0'), 'click'); pointer(handle(label), 'click')
    expect(editor.code).toBe(CODE.replace('-->', token))
    editor.undo(); expect(editor.code).toBe(before)
  })
})
