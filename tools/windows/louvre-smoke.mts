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
      if (!decoration.flashing) assert.equal(decoration.color, 'rgb(219, 234, 254)')
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
  const originalGroups = await evaluate(`Array.from(document.querySelectorAll('g.cluster')).map(el => el.id.replace(document.querySelector('.canvas svg').id+'-','')).sort()`)
  const originalNodes = await evaluate(`Array.from(document.querySelectorAll('g.node')).map(el => el.id.replace(document.querySelector('.canvas svg').id+'-flowchart-','').replace(/-\\d+$/,'')).sort()`)
  for (const [id, action, count] of [['decor', 'menu', 34], ['orch', 'key', 37]] as const) {
    await waitUntil(() => evaluate(`!!document.querySelector('[data-mw-entity="subgraph:${id}"] .cluster-label')`), '解散前分组对应')
    await evaluate(`document.querySelector('[data-mw-entity="subgraph:${id}"] .cluster-label').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    assert(await evaluate(`!!document.querySelector('[aria-label="解散分组"]')`))
    if (action === 'menu') await click('解散分组')
    else await evaluate(`document.querySelector('.canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`)
    const after = await copiedCode()
    const expected = new MermaidWysiwygEditor({ code })
    expected.dispatch({ type: 'ungroup', id })
    assert.equal(after, expected.code)
    await waitUntil(() => evaluate(`document.querySelectorAll('g.cluster').length === 2 && document.querySelectorAll('path.flowchart-link').length === ${count}`), '解散后真实 Mermaid 重绘')
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('g.cluster')).map(el => el.id.replace(document.querySelector('.canvas svg').id+'-','')).sort()`), originalGroups.filter((group: string) => group !== id))
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('g.node')).map(el => el.id.replace(document.querySelector('.canvas svg').id+'-flowchart-','').replace(/-\\d+$/,'')).sort()`), originalNodes)
    assert.equal(await evaluate(`document.querySelector('.mw-toast span')?.textContent`), id === 'decor'
      ? '已解散分组「自动装饰」，同时删除了 3 条连到该分组的线' : '已解散分组「Louvre 场景编排」，组内内容已保留')
    await evaluate(`document.querySelector('.mw-toast button[aria-label="撤销"]').click()`)
    assert.equal(await copiedCode(), code)
    await waitUntil(() => evaluate(`document.querySelectorAll('g.cluster').length === 3 && document.querySelectorAll('path.flowchart-link').length === 37`), '一步撤销恢复分组 SVG')
    console.log(`通过：真实 exe 解散 ${id}，只去一层、无新增节点/分组、提示、按钮撤销及原始字节`)
  }
  async function dragNew(source: string, target: string) {
    return evaluate(`(() => {
      const source=document.querySelector('[data-mw-entity="node:${source}"]');
      source.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      const target=document.querySelector(${JSON.stringify(target)}), original=document.elementFromPoint;
      document.elementFromPoint=()=>target;
      try {
        document.querySelector('.mw-ports button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));
        document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:90,pointerId:1}));
        const highlighted=!!target.closest('[data-mw-entity^="node:"]')?.classList.contains('mw-connect-target');
        document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:90,pointerId:1}));
        return highlighted;
      } finally { document.elementFromPoint=original; }
    })()`)
  }
  for (const [source, target, clips] of [['goods','floor',true],['floor','output',true],['select','result',false]] as const) {
    const highlighted = await dragNew(source, `[data-mw-entity="node:${target}"] .label`)
    assert(highlighted)
    const connected = await copiedCode()
    const updated = new MermaidWysiwygEditor({ code: connected }).result.flowchart!
    assert.equal(updated.edges.length, 38)
    assert(updated.edges.some(edge => edge.source === source && edge.target === target))
    assert.equal(await evaluate(`!!document.querySelector('.mw-new-node-menu')`), false)
    if (clips) {
      assert.equal(await evaluate(`document.querySelector('.mw-toast span')?.textContent`), '分组「自动装饰」设置了排列方向，连进组内的线只会画到分组边框。')
      await click('去掉方向设置')
      assert.equal(await copiedCode(), connected.replace('            direction LR\n',''))
      await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 38 && !document.querySelector('.sync-status.error')`), '去方向后真实 SVG')
      await click('撤销'); assert.equal(await copiedCode(), connected)
    } else assert.equal(await evaluate(`document.querySelector('.mw-toast')?.textContent`), '')
    await click('撤销'); assert.equal(await copiedCode(), code)
    await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 37`), '拖线撤销原图')
    console.log(`通过：真实 exe ${source}→${target}，节点优先/蓝边、方向提示与移除/撤销`)
  }
  for (const target of ['rect', '.cluster-label']) {
    assert.equal(await dragNew('goods', `[data-mw-entity="subgraph:decor"] ${target}`), false)
    assert(await evaluate(`!!document.querySelector('.mw-new-node-menu')`))
    assert.equal(await copiedCode(), code)
    await click('新建节点')
    const after = await copiedCode(), graph = new MermaidWysiwygEditor({ code: after }).result.flowchart!
    assert.equal(graph.nodes.find(node => node.label === '新建节点')?.subgraph, 'decor')
    await waitUntil(() => evaluate(`document.querySelectorAll('g.node').length === ${originalNodes.length + 1}`), '新节点在分组内真实渲染')
    await click('撤销'); assert.equal(await copiedCode(), code)
    await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 37`), '新节点撤销原图')
  }
  console.log('通过：真实 exe 落在分组空白/标题均弹出新节点菜单，节点建在该组，一步撤销')
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
