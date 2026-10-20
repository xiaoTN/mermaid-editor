// 在重新构建的 exe 中验收真实 Mermaid、画布菜单/端点及 CodeMirror。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { MermaidWysiwygEditor } from '../../packages/core/src/index.ts'
import { assertOnlyReplacesLine } from '../cases/line-diff.mts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const path = join(root, 'packages/core/test/fixtures/louvre.mmd')
const code = await readFile(path, 'utf8')
const graph = new MermaidWysiwygEditor({ code }).result.flowchart!
const output = join(root, 'out', `louvre-smoke-${Date.now()}`)
await mkdir(output, { recursive: true })
const port = 19265
// 可见窗口是本项 UI 验收的必要条件；隐藏 WebView2 会暂停布局测量。
const child = spawn(join(root, 'dist/mermaid-editor.exe'), [path], { windowsHide: false, stdio: 'ignore',
  env: { ...process.env, LOCALAPPDATA: output, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    `--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling` } })
let socket: WebSocket, next = 0
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>()
async function waitUntil(probe: () => Promise<any>, label: string) {
  for (let i = 0; i < 200; i++) {
    try { if (await probe()) return } catch {}
    await delay(100)
  }
  throw new Error(`等待超时：${label}`)
}
function cdp(method: string, params = {}): Promise<any> {
  const id = ++next
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression: string): Promise<any> {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const click = (label: string) => evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`)
async function copiedCode(): Promise<string> {
  await click('复制代码')
  return evaluate('window.__copiedCode')
}
try {
  let target: any
  await waitUntil(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    target = pages.find((page: any) => page.type === 'page' && page.url.includes('mermaid-editor.local'))
    return target
  }, 'WebView2 页面')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const reply = JSON.parse(String(event.data))
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    reply.error ? request.reject(new Error(JSON.stringify(reply.error))) : request.resolve(reply.result)
  }
  await cdp('Page.enable')
  await cdp('Page.bringToFront')
  await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 37`), 'Louvre 完整渲染')
  await evaluate('window.meCopy = async text => { window.__copiedCode = text }')
  assert.equal(await copiedCode(), code)
  for (const pair of ['entry->layout', 'goods->decor', 'decor->assembly', 'select->floor', 'floor->result', 'primary->ai']) {
    const edge = graph.edges.find(e => `${e.source}->${e.target}` === pair)!
    for (const action of ['delete', 'style', 'source', 'target']) {
      const nativeId = `L_${edge.source}_${edge.target}_0`
      await waitUntil(() => evaluate(`!!document.querySelector('path.flowchart-link[data-id=${JSON.stringify(nativeId)}]')`), '原图重新渲染')
      await evaluate(`document.querySelector('path.flowchart-link[data-id=${JSON.stringify(nativeId)}]').dispatchEvent(new MouseEvent('click', {bubbles:true}))`)
      assert.equal(await evaluate(`document.querySelector('path.flowchart-link.mw-selected')?.getAttribute('data-mw-entity')`), edge.entityId)
      try { await waitUntil(() => evaluate(`Array.from(document.querySelectorAll('.mw-cm-selected-line')).some(el => {
        const a = el.getBoundingClientRect(), b = document.querySelector('.cm-scroller').getBoundingClientRect();
        return el.textContent.includes(${JSON.stringify(code.split('\n')[edge.lineIndex].trim())}) && a.top >= b.top && a.bottom <= b.bottom;
      })`), '源码整行高亮并滚入可见区域') } catch (error) {
        console.log(await evaluate(`({lines:[...document.querySelectorAll('.mw-cm-selected-line')].map(el => ({text:el.textContent,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})),
          scroll:[...document.querySelectorAll('.cm-scroller')].map(el => ({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,scrollTop:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight}))})`))
        throw error
      }
      const decoration = await evaluate(`(() => {
        const line = document.querySelector('.mw-cm-selected-line'), style = getComputedStyle(line);
        return { color: style.backgroundColor, shadow: style.boxShadow, flashing: line.classList.contains('mw-changed-line') };
      })()`)
      assert(decoration.shadow.includes('rgb(96, 165, 250)'))
      if (!decoration.flashing) assert.equal(decoration.color, 'rgba(96, 165, 250, 0.18)')
      if (pair === 'entry->layout' && action === 'delete') {
        const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
        await writeFile(join(output, '选中边与源码高亮.png'), Buffer.from(screenshot.data, 'base64'))
      }
      if (action === 'delete') await click('删除')
      else if (action === 'style') await click('虚线')
      else await evaluate(`(() => {
        const original = document.elementFromPoint;
        document.elementFromPoint = () => document.querySelector('[data-mw-entity="node:output"]');
        document.querySelector('[data-end="${action}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button:0,pointerId:1}));
        document.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,clientX:90,pointerId:1}));
        document.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,clientX:90,pointerId:1}));
        document.elementFromPoint = original;
      })()`)
      const after = await copiedCode()
      assertOnlyReplacesLine(code, after, edge.lineIndex + 1)
      const expected = graph.edges.map(e => [e.source, e.target, e.seg.line])
      if (action === 'delete') expected.splice(edge.order, 1)
      else if (action === 'style') expected[edge.order][2] = 'dotted'
      else expected[edge.order][action === 'source' ? 0 : 1] = 'output'
      const actual = new MermaidWysiwygEditor({ code: after }).result.flowchart!
      assert.deepEqual(actual.edges.map(e => [e.source, e.target, e.seg.line]), expected)
      if (pair === 'entry->layout' && action === 'delete') assert.equal(after, code.replace('entry --> layout & hard', 'entry --> hard'))
      await click('撤销')
      assert.equal(await copiedCode(), code)
      await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 37`), '撤销后的原图')
      await evaluate(`document.querySelector('.canvas svg').dispatchEvent(new MouseEvent('click', {bubbles:true}))`)
      assert.equal(await evaluate(`document.querySelectorAll('.mw-cm-selected-line').length`), 0)
    }
    console.log(`通过：${pair}，真实 exe 的选中/高亮/滚动/删除/线型/起终点/撤销`)
  }
  assert.equal(await readFile(path, 'utf8'), code)
  console.log(`Louvre 桌面验收全部通过；截图：${output}`)
} finally {
  if (socket!) {
    try { await evaluate('void window.meFinishClose()') } catch {}
    socket.close()
  }
  if (child.exitCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1800)])
    if (child.exitCode === null) child.kill()
  }
}
