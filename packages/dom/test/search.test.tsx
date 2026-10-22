// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { DiagramSearch } from '../../../apps/playground/src/DiagramSearch'
import { setLocale } from '../src'

it('查找中文、编号、分组和边文字，定位及关闭不修改源码', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setLocale('zh-CN')
  const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n subgraph G[支付流程]\n A[付款] -->|成功| B[完成]\n end\n G --> C[通知]\n' })
  const original = editor.code, locate = vi.fn(), close = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DiagramSearch graph={editor.result.flowchart} onLocate={locate} onClose={close} />))
    const input = host.querySelector('input')!
    const query = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await query('支付')
    expect(host.querySelectorAll('.search-results button')).toHaveLength(1)
    await act(async () => host.querySelector<HTMLButtonElement>('.search-results button')!.click())
    expect(locate).toHaveBeenLastCalledWith('subgraph:G')
    await query('成功')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(locate).toHaveBeenLastCalledWith('edge:A->B#0')
    await query('b')
    expect(host.querySelectorAll('.search-results button')).toHaveLength(2)
    await query('不存在')
    expect(host.textContent).toContain('没有匹配的内容')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledOnce()
    expect(editor.code).toBe(original); expect(editor.canUndo).toBe(false)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
