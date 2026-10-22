// @vitest-environment jsdom
import './dom-layout'
import { expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor, mermaidSource } from '../src'
import { MermaidCanvasView } from '../../dom/src'

const body = `flowchart TD
    A["装饰模型来源"] --> B["现成GLB"]
    A --> C["V-Ray模型"]
    A --> D["完整家具模型"]

    C --> E["转换为GLB"]
    D --> F["平面识别"]
    F --> G["提取摆件GLB"]

    B --> H["GLB压缩<br/>摆件作为辅助装饰，适度降低贴图精度"]
    E --> H
    G --> H

    H --> I["统一上传资源服务器<br/>供自动选品与场景摆放使用"]

    style A fill:#EAF2FF,stroke:#7096CC
    style H fill:#FFF3DF,stroke:#D6A454
    style I fill:#E8F3EE,stroke:#6B9D83
`
const wrapped = '```mermaid\n' + body + '```'

it.each([body, wrapped])('中文、HTML 换行及带 Markdown 包装的图都可识别并编辑', code => {
  const editor = new MermaidWysiwygEditor({ code })
  expect(editor.result.typeInfo?.id).toBe('flowchart')
  expect(editor.result.flowchart?.nodes).toHaveLength(9)
  expect(editor.result.flowchart?.edges).toHaveLength(10)
  editor.dispatch({ type: 'renameNode', id: 'H', label: '压缩GLB<br/>保留主要细节' })
  expect(editor.code).toBe(code.replace('GLB压缩<br/>摆件作为辅助装饰，适度降低贴图精度', '压缩GLB<br/>保留主要细节'))
  editor.undo(); expect(editor.code).toBe(code)
})

it.each(['```', '~~~~'])('保留 %s 包装、CRLF 和源码位置，新增节点和样式留在代码块内部', fence => {
  const source = '\uFEFF  ' + fence + 'MeRmAiD\r\nflowchart TB\r\n\tA[甲] --> B[乙]  \r\n' + fence + '\r\n'
  const editor = new MermaidWysiwygEditor({ code: source })
  const position = source.indexOf('A[甲]')
  expect(editor.entityAt(position + 1)).toBe('node:A')
  editor.setSelection(['node:A'])
  expect(editor.selectionSpans()[0].start).toBe(position)
  editor.dispatch({ type: 'setDirection', direction: 'LR' })
  expect(editor.code).toBe(source.replace('flowchart TB', 'flowchart LR'))
  editor.dispatch({ type: 'addNode', label: '新节点' })
  editor.dispatch({ type: 'setNodeColor', id: 'A', prop: 'fill', value: '#ef4444' })
  expect(editor.code.endsWith(fence + '\r\n')).toBe(true)
  expect(mermaidSource(editor.code)).toContain('新节点')
  expect(mermaidSource(editor.code)).toContain('style A fill:#ef4444')
  editor.undo(); editor.undo(); editor.undo(); expect(editor.code).toBe(source)
})

it.each(['```js\n' + body + '```', '```mermaid\n' + body,
  wrapped + '\n说明文字', wrapped + '\n' + wrapped])('不误剥离非 Mermaid、不完整或包含多段内容的输入', code => {
  expect(mermaidSource(code)).toBe(code)
})

it('用户完整示例经真实画布渲染后可选中、改字、切换方向并撤销', async () => {
  // jsdom 不提供 SVG 文字测量，使用与现有真实渲染测试一致的布局替身。
  const previousBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox')
  const previousLength = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getComputedTextLength')
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', { configurable: true, value() {
    return (this.textContent ?? '').length * 8
  } })
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, char => `\\${char}`) })
  const mermaid = (await import('../../../apps/playground/node_modules/mermaid')).default
  const editor = new MermaidWysiwygEditor({ code: wrapped })
  const host = document.createElement('div'); document.body.append(host)
  const view = new MermaidCanvasView({ editor, container: host, mermaid,
    mermaidConfig: { securityLevel: 'loose', flowchart: { htmlLabels: false } } })
  try {
    await view.render()
    expect(view.renderError).toBeNull()
    expect(await view.validate()).toBe(true)
    expect(host.querySelectorAll('[data-mw-entity^="node:"]')).toHaveLength(9)
    expect(host.textContent).toContain('适度降低贴图精度')
    editor.dispatch({ type: 'renameNode', id: 'B', label: '已有资源' })
    editor.dispatch({ type: 'setDirection', direction: 'LR' })
    await view.render()
    expect(view.renderError).toBeNull()
    expect(host.textContent).toContain('已有资源')
    expect(editor.code.startsWith('```mermaid\nflowchart LR')).toBe(true)
    editor.undo(); editor.undo(); await view.render()
    expect(view.renderError).toBeNull(); expect(editor.code).toBe(wrapped)
  } finally {
    view.destroy(); host.remove(); vi.unstubAllGlobals()
    if (previousBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', previousBBox)
    else Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
    if (previousLength) Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', previousLength)
    else Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength')
  }
})
