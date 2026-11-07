// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, t } from '../src'

const CODE = 'flowchart TD\n A[甲] --> B[乙]\n'
const SVG = '<svg id="dismiss" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g class="nodes"><g class="node" id="dismiss-flowchart-A-0"><rect/><text>甲</text></g><g class="node" id="dismiss-flowchart-B-0"><rect/><text>乙</text></g></g><g class="edgePaths"><path id="dismiss-L_A_B_0"/></g></svg>'
const event = (target: Element, type: string, extra: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }))

describe.each([false, true])('画布缩放平移：%s', panZoom => {
  let host: HTMLElement, outside: HTMLElement, control: HTMLElement, editor: MermaidWysiwygEditor, view: MermaidCanvasView
  beforeEach(async () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, char => `\\${char}`) })
    host = document.createElement('div'); outside = document.createElement('div'); control = document.createElement('button')
    document.body.append(host, outside, control)
    Object.defineProperties(host, { clientWidth: { value: 500 }, clientHeight: { value: 300 } })
    editor = new MermaidWysiwygEditor({ code: CODE })
    view = new MermaidCanvasView({ editor, container: host, panZoom, selectionControls: [control],
      mermaid: { initialize() {}, async parse() {}, async render() { return { svg: SVG } } } })
    await view.render()
  })
  afterEach(() => { view.destroy(); host.remove(); outside.remove(); control.remove(); vi.unstubAllGlobals() })

  const select = () => {
    const node = host.querySelector('[data-mw-entity="node:A"]')!
    event(node, 'pointerover'); event(node, 'click')
    expect(host.querySelector('.mw-popover')).not.toBeNull()
  }

  it.each(['wrapper', 'canvas', 'svg', 'outside'])('点击 %s 空白处收起工具条和连接点，后续缩放也不重新弹出', area => {
    select()
    const target = area === 'wrapper' ? host.querySelector('.mw-svg-host')!
      : area === 'canvas' ? host : area === 'svg' ? host.querySelector('svg')! : outside
    event(target, 'pointerdown'); event(target, 'pointerup'); event(target, 'click')
    expect(host.querySelector('.mw-popover')).toBeNull()
    expect(host.querySelector('.mw-ports')?.children).toHaveLength(0)
    expect(editor.selection).toEqual([])
    view.zoomBy(1.25)
    expect(host.querySelector('.mw-popover')).toBeNull()
    expect(editor.code).toBe(CODE); expect(editor.canUndo).toBe(false)
  })

  it('点击工具条及形状面板仍能操作，点击另一个节点则切换选中对象', () => {
    select()
    const shape = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('ui.nodeShape')}"]`)!
    event(shape, 'pointerdown'); shape.click()
    expect(host.querySelector('.mw-popover-panel')).not.toBeNull()
    expect(editor.selection).toEqual(['node:A'])
    const circle = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('shape.circle')}"]`)!
    event(circle, 'pointerdown'); circle.click()
    expect(editor.result.flowchart!.nodeById.get('A')?.shape).toBe('circle')
    const other = host.querySelector('[data-mw-entity="node:B"]')!
    event(other, 'pointerdown'); event(other, 'pointerup'); event(other, 'click')
    expect(editor.selection).toEqual(['node:B'])
    expect(host.querySelector('.mw-popover')).not.toBeNull()
  })

  it('追加框选和分组按钮保留选区，同时收起悬浮工具条', () => {
    select()
    event(host.querySelector('.mw-svg-host')!, 'pointerdown', { shiftKey: true })
    expect(editor.selection).toEqual(['node:A'])
    expect(host.querySelector('.mw-popover')).toBeNull()
    event(document.body, 'pointerup')
    select(); event(control, 'pointerdown')
    expect(editor.selection).toEqual(['node:A'])
    expect(host.querySelector('.mw-popover')).toBeNull()
  })
})
