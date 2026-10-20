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
// Keep restart checks on one isolated profile even if another QA copy holds
// the global app mutex and the shell would otherwise choose per-process data.
const env = { ...process.env, LOCALAPPDATA: data, WEBVIEW2_USER_DATA_FOLDER: join(data, 'WebView2'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }
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
  args = [...args]
  if (method === 'meOpen' && args.length === 2) args.push('所有文件 (*.*)')
  if ((method === 'meSave' || method === 'meSaveAs') && args.length === 2) args.push('所有文件 (*.*)', {
    title: '文件已在外部修改', body: `${args[0].name} 已在外部修改`, overwrite: '覆盖', reload: '重新载入', cancel: '取消',
  })
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
function nativeInput(args) {
  const helper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tools/windows/native-input.ps1'),
    '-ProcessId', String(child.pid), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let error = ''; helper.stderr.on('data', data => { error += data }); helper.once('exit', code => code === 0 ? resolve() : reject(new Error(error)))
  })
}
const answerConflict = button => nativeInput(['-DialogTitle', '文件已在外部修改', '-Button', String(button)])
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
  assert((await evaluate(`document.querySelector('.draft-notice')?.textContent`)).includes('发现上次未保存的修改'))
  assert(!await evaluate(`document.title.endsWith(' *')`))
  await click('恢复')
  await titleIncludes(' *')
  await stop()
  check('直接启动只显示草稿提示，明确恢复才应用')

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
  await Promise.all([answerConflict(6), native('meSave', [{ ...mdFile, code: mdFile.code.replace('乙', '丙') }, 'Mermaid 文件'])])
  assert.equal(await readFile(mdPath, 'utf8'), externalMd.replace('乙', '丙'))
  await chmod(path, 0o444)
  const latest = await native('meOpen', [path, 'Mermaid 文件'])
  await assert.rejects(native('meSave', [{ ...latest, code: 'overwrite' }, 'Mermaid 文件']), /只读/)
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

  const external = (await readFile(path, 'utf8')).replace('起点', '外部起点')
  await writeFile(path, external)
  await nativeInput(['-Activate'])
  await waitUntil(() => evaluate(`document.querySelector('.app-toast')?.textContent === '文件已在外部修改，已重新载入'`), '原生重新聚焦自动载入')
  assert(!await evaluate(`document.title.endsWith(' *')`))
  await click('+ 分组')
  const local = await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('mermaid-editor.draft:')).map(key => JSON.parse(localStorage.getItem(key))).find(draft => draft.path === ${JSON.stringify(path)}).code`)
  const newer = external.replace('外部起点', '第二次外部起点')
  await writeFile(path, newer); await nativeInput(['-Activate'])
  await waitUntil(() => evaluate(`!!document.querySelector('.file-conflict')`), '脏文件外部修改提示条')
  await click('保留我的修改')
  await Promise.all([answerConflict(2), click('保存')])
  assert.equal(await readFile(path, 'utf8'), newer)
  assert(await evaluate(`document.title.endsWith(' *')`))
  await Promise.all([answerConflict(7), click('保存')])
  await waitUntil(() => evaluate(`!document.title.endsWith(' *')`), '保存冲突选择重新载入')
  assert.equal(await readFile(path, 'utf8'), newer)
  assert.equal(await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('mermaid-editor.draft:')).map(key=>JSON.parse(localStorage.getItem(key))).filter(draft=>draft.path===${JSON.stringify(path)}).length`), 0)
  await click('+ 分组')
  const overwrite = await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('mermaid-editor.draft:')).map(key => JSON.parse(localStorage.getItem(key))).find(draft => draft.path === ${JSON.stringify(path)}).code`)
  await writeFile(path, newer + '\n%% newer on disk\n')
  await Promise.all([answerConflict(6), click('保存')])
  await waitUntil(() => evaluate(`!document.title.endsWith(' *')`), '保存冲突明确覆盖')
  assert.equal(await readFile(path, 'utf8'), overwrite)
  assert.notEqual(overwrite, local)
  check('原生焦点自动重载、脏提示保留本地、实际系统保存冲突的取消/重新载入/覆盖')

  await click('+ 分组')
  const current = child, exited = new Promise(resolve => current.once('exit', resolve))
  await Promise.all([nativeInput(['-DialogTitle', '有未保存的修改', '-Button', '7']), evaluate(`window.onMe({type:'close'})`)])
  await Promise.race([exited, delay(3000).then(() => { throw new Error('不保存关闭未退出') })])
  socket.close(); socket = null; child = null
  await launch(path)
  assert(!await evaluate(`document.title.endsWith(' *')`))
  assert.equal(await evaluate(`document.querySelector('.draft-notice')`), null)
  assert.equal(await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('mermaid-editor.draft:')).map(key=>JSON.parse(localStorage.getItem(key))).filter(draft=>draft.path===${JSON.stringify(path)}).length`), 0)
  check('实际关闭选择不保存，重启后没有草稿和星号')

  const louvrePath = join(data, 'louvre.mmd')
  await writeFile(louvrePath, await readFile(join(root, 'packages/core/test/fixtures/louvre.mmd')))
  await nativeInput(['-DropPath', louvrePath])
  await titleIncludes('louvre.mmd')
  await waitUntil(() => evaluate(`document.querySelectorAll('path.flowchart-link').length === 37`), 'WM_DROPFILES 真路径打开 Louvre')
  await evaluate(`Object.assign(document.querySelector('.canvas').style,{width:'400px',height:'260px'})`)
  await click('适应画布')
  const viewport = await evaluate(`(() => { const host=document.querySelector('.mw-svg-host'); return {transform:host.querySelector('svg').style.transform, height:host.clientHeight, scroll:host.scrollHeight, overflow:getComputedStyle(host).overflow} })()`)
  assert(viewport.transform.includes('scale(0.6)')); assert(viewport.scroll > viewport.height); assert.equal(viewport.overflow, 'auto')
  await evaluate(`document.querySelector('.mw-svg-host').scrollTop=100000`)
  assert(await evaluate(`document.querySelector('.mw-svg-host').scrollTop > 0`))
  assert(!(await readFile(join(data, 'mermaid-editor/mermaid-editor.log'), 'utf8')).includes('native OLE drop unavailable'))
  check('原生 PostMessage WM_DROPFILES 获取真实路径，无额外确认；OLE 注册成功；Louvre 60% 并实际滚动')

  await evaluate('window.meCopy = async text => { window.__copiedCode = text }')
  for (const name of ['class', 'state', 'er', 'sequence', 'gantt', 'pie', 'members']) {
    const previewPath = join(data, `${name}.mmd`)
    const previewCode = await readFile(join(root, `packages/core/test/fixtures/preview-${name}.mmd`), 'utf8')
    const previousSvg = await evaluate(`document.querySelector('.mw-svg-host > svg')?.id`)
    await writeFile(previewPath, previewCode); await nativeInput(['-DropPath', previewPath]); await titleIncludes(`${name}.mmd`)
    await waitUntil(() => evaluate(`document.querySelector('.mw-readonly-hint')?.textContent.includes('暂只支持预览')`), `${name} 常驻预览条`)
    // The banner follows the parsed code synchronously; Mermaid replaces the
    // old SVG asynchronously. Assert against the newly rendered preview SVG.
    await waitUntil(() => evaluate(`(() => { const svg=document.querySelector('.mw-svg-host > svg'); return svg && svg.id !== ${JSON.stringify(previousSvg)} && !!svg.querySelector('g, path, text') && !document.querySelector('.sync-status.error') })()`), `${name} SVG 完成替换`)
    await evaluate(`(() => { const canvas=document.querySelector('.canvas'); canvas.focus(); for (const target of canvas.querySelectorAll('svg g, svg path, svg text, svg rect, svg line')) {
      for(const type of ['pointerover','pointerdown','pointermove','pointerup','click','dblclick']) target.dispatchEvent(new MouseEvent(type,{bubbles:true}));
    } canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})); })()`)
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
    assert(!await evaluate(`document.title.endsWith(' *')`))
    assert.equal(await evaluate(`document.querySelectorAll('[data-mw-entity],.mw-selected,.mw-popover,.mw-handle,.mw-lifeline-insert,.mw-lifeline-menu,[contenteditable="true"]:not(.cm-content)').length`), 0)
    assert.equal(await evaluate(`document.querySelector('.canvas .mw-toast')?.textContent`), '')
    assert(await evaluate(`document.querySelector('button[aria-label="+ 节点"]').disabled && document.querySelector('button[aria-label="+ 分组"]').disabled`))
    assert(await evaluate(`document.querySelector('button[aria-label="撤销"]').disabled && document.querySelector('button[aria-label="重做"]').disabled`))
    await click('复制代码'); assert.equal(await evaluate('window.__copiedCode'), previewCode)
    assert.equal(await readFile(previewPath, 'utf8'), previewCode)
    check(`实际 WebView2 ${name} 只预览，点击/双击/拖动/Delete 无改动、无历史、无编辑操作`)
  }
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
