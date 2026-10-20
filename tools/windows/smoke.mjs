// 实际 Windows exe + WebView2 集成验收；只使用独立测试目录。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const exe = join(root, 'dist/mermaid-editor.exe')
const data = join(root, 'out', `windows-smoke-${Date.now()}`)
const port = 19264
await mkdir(data, { recursive: true })
const env = { ...process.env, LOCALAPPDATA: data, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }
let child, socket, next = 0
const pending = new Map()
function check(name) { console.log(`通过：${name}`) }
async function waitUntil(probe, label, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { const result = await probe(); if (result) return result } catch {}
    await delay(100)
  }
  throw new Error(`等待超时：${label}`)
}
function cdp(method, params = {}) {
  const id = ++next
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }, 20000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
  return reply.result.value
}
async function launch(path) {
  child = spawn(exe, path ? [path] : [], { env, windowsHide: false, stdio: 'ignore' })
  const page = await waitUntil(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    return targets.find(target => target.type === 'page' && target.url.includes('mermaid-editor.local'))
  }, 'WebView2 页面')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id); pending.delete(message.id)
    if (message.error) request?.reject(new Error(JSON.stringify(message.error)))
    else request?.resolve(message.result)
  }
  socket.onclose = () => { for (const request of pending.values()) request.reject(new Error('页面已关闭')); pending.clear() }
  await waitUntil(() => evaluate(`!!document.querySelector('.cm-content') && typeof window.onMe === 'function'`), '编辑器挂载')
  await delay(300)
}
async function stop() {
  const current = child
  const done = new Promise(resolve => current.once('exit', resolve))
  const start = Date.now()
  void evaluate('void window.meFinishClose()').catch(() => {})
  await Promise.race([done, delay(1900).then(() => { throw new Error('关闭后未在两秒内退出') })])
  assert(Date.now() - start < 2000)
  socket.close(); socket = null; child = null
  check(`关闭进程耗时 ${Date.now() - start} ms（小于两秒）`)
  await delay(400)
}
async function native(method, args) {
  return evaluate(`new Promise((resolve, reject) => {
    const id = 900000 + Math.floor(Math.random() * 100000);
    const previous = window.onMe;
    window.onMe = event => {
      if (event.id !== id) return previous(event);
      window.onMe = previous;
      event.error ? reject(new Error(event.error)) : resolve(event.value);
    };
    window[${JSON.stringify(method)}](id, ...${JSON.stringify(args)}).catch(reject);
  })`)
}
async function titleIncludes(text) { await waitUntil(() => evaluate(`document.title.includes(${JSON.stringify(text)})`), `标题 ${text}`) }
async function click(label) {
  assert(await evaluate(`!!document.querySelector('button[aria-label=${JSON.stringify(label)}]')`))
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`)
  await delay(150)
}
const hash = text => createHash('sha256').update(text).digest('hex')
const draftKey = (path, source) => `mermaid-editor.draft:${encodeURIComponent(path)}:${hash(source)}`

try {
  const binary = await readFile(exe)
  assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c) + 24 + 68), 2)
  assert(binary.length < 15 * 1024 * 1024)
  check(`GUI 子系统，无控制台，exe ${binary.length} 字节`)
  await launch()
  assert.equal(await evaluate('document.title'), 'Mermaid 编辑器 — 未命名.mmd')
  await click('+ 分组'); await titleIncludes(' *')
  assert(await evaluate(`Object.keys(localStorage).some(key => key.startsWith('mermaid-editor.draft:'))`))
  await stop()
  await launch()
  assert.equal(await evaluate(`document.querySelector('.app-toast')?.textContent`), '已恢复上次未保存的编辑')
  await titleIncludes(' *')
  await stop()
  check('直接启动自动恢复最近草稿及 toast')

  const path = resolve(data, '真实路径.mmd')
  const original = '\uFEFFflowchart TD\r\n\t%% 保留\t \r\n\t甲[开始] --> 乙[结束]  \r\n'
  await writeFile(path, original)
  await launch(path)
  await waitUntil(() => evaluate(`!document.querySelector('.sync-status.error') && document.querySelector('.canvas svg')?.textContent.includes('开始')`), '文件画布渲染')
  assert.equal(await evaluate('document.title'), 'Mermaid 编辑器 — 真实路径.mmd')
  assert.equal(await evaluate(`document.querySelector('.app-toast')?.textContent ?? ''`), '')
  const opened = await native('meOpen', [path, 'Mermaid 文件'])
  assert.equal(opened.path, path); assert.equal(opened.code, original)
  const edited = original.replace('开始', '起点')
  const draft = { ...opened, code: edited, baseCode: original, baseHash: hash(original), updatedAt: Date.now() }
  await evaluate(`localStorage.setItem(${JSON.stringify(draftKey(path, original))}, ${JSON.stringify(JSON.stringify(draft))})`)
  const second = spawn(exe, [path], { env, windowsHide: true, stdio: 'ignore' })
  await Promise.race([new Promise(resolve => second.once('exit', resolve)), delay(3000).then(() => { second.kill(); throw new Error('第二实例没有及时退出') })])
  await waitUntil(() => evaluate(`document.querySelector('.draft-notice')?.textContent.includes('发现上次未保存的修改')`), '真实路径草稿提示')
  assert(!await evaluate(`document.title.endsWith(' *')`))
  const before = await readFile(path)
  await click('恢复'); await titleIncludes(' *')
  assert((await readFile(path)).equals(before))
  await click('撤销')
  await waitUntil(() => evaluate(`!document.title.endsWith(' *')`), '恢复操作撤销回原始文件')
  await click('重做'); await titleIncludes(' *')
  await click('保存')
  await waitUntil(() => evaluate(`!document.title.endsWith(' *')`), '保存清除 dirty')
  assert.equal(await readFile(path, 'utf8'), edited)
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(draftKey(path, original))})`), null)
  check('单实例转交真实路径、顶部草稿恢复、原生保存保留原始字节并清草稿')

  const outside = edited.replace('结束', '外部修改')
  await writeFile(path, outside)
  const externalDraft = { ...draft, baseCode: edited, baseHash: hash(edited), code: edited.replace('起点', '草稿起点') }
  await evaluate(`localStorage.setItem(${JSON.stringify(draftKey(path, edited))}, ${JSON.stringify(JSON.stringify(externalDraft))}); window.onMe({type:'open',path:${JSON.stringify(path)}})`)
  await waitUntil(() => evaluate(`document.querySelector('.draft-notice')?.textContent.includes('文件已在外部修改')`), '外部修改提示')
  await click('丢弃')
  assert.equal(await evaluate(`document.querySelector('.draft-notice')`), null)
  assert.equal(await readFile(path, 'utf8'), outside)
  check('拖入共用打开事件、外部哈希变化提示、丢弃草稿保留磁盘内容')

  const mdPath = resolve(data, '文档.md')
  const md = '\uFEFF# 正文  \r\n```mermaid\r\nflowchart TD\r\n\t甲 --> 乙  \r\n```  \r\n```mermaid\nA --> B\n```\n尾部\t '
  await writeFile(mdPath, md)
  const mdFile = await native('meOpen', [mdPath, 'Mermaid 文件'])
  assert.equal(mdFile.source, md)
  const externalMd = md.replace('正文', '外部正文')
  await writeFile(mdPath, externalMd)
  await native('meSave', [{ ...mdFile, code: mdFile.code.replace('乙', '丙') }, 'Mermaid 文件'])
  assert.equal(await readFile(mdPath, 'utf8'), externalMd.replace('乙', '丙'))
  await chmod(path, 0o444)
  await assert.rejects(native('meSave', [{ ...opened, code: 'overwrite' }, 'Mermaid 文件']), /只读/)
  assert.equal(await readFile(path, 'utf8'), outside)
  await chmod(path, 0o644)
  check('Markdown 仅替换第一块并保留块外变动；保存失败不截断文件')

  await click('+ 分组'); await titleIncludes(' *')
  const expectedReopened = await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('mermaid-editor.draft:')).map(key => JSON.parse(localStorage.getItem(key))).find(draft => draft.path === ${JSON.stringify(path)}).code`)
  // 浏览器端代答确认决定；仍调用实际 Go 保存、再读磁盘及草稿逻辑。
  await evaluate(`window.originalConfirmClose = window.meConfirmClose; window.meConfirmClose = async id => window.onMe({id,value:'save'}); window.onMe({type:'open',path:${JSON.stringify(path)}})`)
  await waitUntil(() => evaluate(`!document.title.endsWith(' *') && document.querySelector('.cm-content')?.textContent.includes('subgraph')`), '保存后重新读取同一文件')
  assert.equal(await readFile(path, 'utf8'), expectedReopened)
  await evaluate('window.meConfirmClose = window.originalConfirmClose')
  check('打开同一脏文件选择保存后，重新读取成功保存的字节')

  await evaluate(`document.querySelectorAll('.language-switch button')[1].click()`)
  await titleIncludes('Mermaid Editor')
  assert(await evaluate(`!!document.querySelector('[aria-label="Save as"]')`))
  await evaluate(`document.querySelectorAll('.language-switch button')[0].click()`)
  await evaluate(`window.meCopy(${JSON.stringify('中文\u3000原生剪贴板\r\n')})`)
  check('中英切换与原生剪贴板调用')
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(data, '编辑器验收.png'), Buffer.from(screenshot.data, 'base64'))
  console.log(`集成验收全部通过；产物：${data}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (child && socket) {
    try { await stop() } catch { child.kill() }
  } else if (child) child.kill()
}
