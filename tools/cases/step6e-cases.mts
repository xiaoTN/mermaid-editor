import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MermaidWysiwygEditor } from '../../packages/core/src/index.js'
import { MermaidCanvasView, t } from '../../packages/dom/src/index.js'

type Case = [string, string, (document: Document) => Promise<void>]
let serial = 0

/** Render every before/after through the installed Mermaid, rather than a mock SVG. */
export async function createStep6eCases(root: string, document: Document): Promise<Case[]> {
  Object.assign(globalThis, { CSSStyleSheet: document.defaultView!.CSSStyleSheet })
  const prototype = document.defaultView!.SVGElement.prototype
  if (!('getBBox' in prototype)) Object.defineProperty(prototype, 'getBBox', { configurable: true, value() {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 8), height: 20 }
  } })
  if (!('getComputedTextLength' in prototype)) Object.defineProperty(prototype, 'getComputedTextLength', {
    configurable: true, value() { return (this.textContent ?? '').length * 8 },
  })
  const modulePath = '../../apps/playground/node_modules/mermaid/dist/mermaid.core.mjs'
  const { default: mermaid }: typeof import('../../apps/playground/node_modules/mermaid') = await import(modulePath)
  const louvre = readFileSync(join(root, 'packages/core/test/fixtures/louvre.mmd'), 'utf8')
  const nested = 'flowchart TB\r\n\tX[Outside]\r\n\tsubgraph outer[Outer]\r\n\t\tdirection TB\r\n\t\t%% keep  \r\n\t\tsubgraph inner[Inner]\r\n\t\t\tdirection LR\r\n\t\t\tA[Alpha] & B(Beta) --> C[Gamma]  \r\n\t\tend\r\n\t\tD[Delta]\r\n\tend\r\n\tX --> inner & D\r\n\tinner --> X\r\n\tclassDef marked fill:lightgreen;\r\n\tclass A,inner,D marked;\r\n\tclass inner marked;\r\n\tstyle inner fill:lightgreen;\r\n\tstyle outer fill:gainsboro;\r\n\tlinkStyle 0,2 stroke:#f00,stroke-width:2px;\r\n'
  async function rendered(code: string) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } })
    const host = document.createElement('div')
    host.innerHTML = (await mermaid.render(`step6e-${serial++}`, code)).svg
    return host.querySelector('svg')!
  }
  function identities(svg: SVGSVGElement) {
    return {
      nodes: [...svg.querySelectorAll('g.node')].map(el => el.id.replace(`${svg.id}-flowchart-`, '').replace(/-\d+$/, '')).sort(),
      groups: [...svg.querySelectorAll('g.cluster')].map(el => el.id.slice(svg.id.length + 1)).sort(),
      edges: [...svg.querySelectorAll('path.flowchart-link')].map(el => el.getAttribute('data-id')).sort(),
    }
  }
  async function canvas(code = louvre) {
    const editor = new MermaidWysiwygEditor({ code })
    const host = document.createElement('div'); document.body.append(host)
    const view = new MermaidCanvasView({ editor, container: host, debounceMs: 10000, mermaid })
    await view.render(); assert.equal(view.renderError, null)
    const pointer = (target: EventTarget, type: string, x = 0) => target.dispatchEvent(
      new document.defaultView!.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 30 }))
    const entity = (id: string) => {
      const el = [...host.querySelectorAll('[data-mw-entity]')].find(el => el.getAttribute('data-mw-entity') === id)
      assert(el, `missing real SVG entity ${id}`); return el
    }
    const button = (key: string) => {
      const el = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.getAttribute('aria-label') === t(key))
      assert(el, `missing action ${key}`); return el
    }
    const drag = (source: string, target: Element, inspect?: () => void) => {
      pointer(entity(`node:${source}`), 'pointerover')
      const port = host.querySelector('.mw-ports button'); assert(port)
      pointer(port, 'pointerdown')
      const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
      try { pointer(document, 'pointermove', 90); inspect?.(); pointer(document, 'pointerup', 90) }
      finally { if (previous) Object.defineProperty(document, 'elementFromPoint', previous); else Reflect.deleteProperty(document, 'elementFromPoint') }
    }
    return { editor, host, view, pointer, entity, button, drag, destroy() { view.destroy(); host.remove() } }
  }
  function undo(editor: MermaidWysiwygEditor, before: string) {
    const after = editor.code
    assert.notEqual(after, before); assert(editor.undo()); assert.equal(editor.code, before)
    assert(!editor.canUndo); assert(editor.redo()); assert.equal(editor.code, after)
  }
  return [
    ['70', '6e：真实 Louvre 标题/边框选中，样式条立即解散 decor，Delete 同效', async () => {
      for (const [target, action] of [['.cluster-label', 'menu'], ['rect', 'key']]) {
        const c = await canvas()
        try {
          c.pointer(c.entity('subgraph:decor').querySelector(target)!, 'click')
          assert.deepEqual(c.editor.selection, ['subgraph:decor'])
          assert.equal(c.host.querySelector('[aria-label="' + t('edge.delete') + '"]'), null)
          if (action === 'menu') c.button('group.ungroup').click()
          else c.host.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
          assert(!c.editor.result.flowchart!.subgraphs.some(g => g.id === 'decor'))
          assert.equal(c.host.querySelector('.mw-toast span')?.textContent, t('toast.ungroupedEdges', { name: '自动装饰', n: 3 }))
          assert(c.button('toast.undo')); undo(c.editor, louvre)
        } finally { c.destroy() }
      }
    }],
    ['71', '6e：只解散一层，内层分组与方向保留，内容归外层；无连边提示', async () => {
      const editor = new MermaidWysiwygEditor({ code: nested })
      const result = editor.dispatch({ type: 'ungroup', id: 'outer' })!
      assert.equal(result.warnings?.[0].key, 'toast.ungrouped')
      assert.equal(editor.result.flowchart!.subgraphs.find(g => g.id === 'inner')?.parent, null)
      assert.equal(editor.result.flowchart!.subgraphs.find(g => g.id === 'inner')?.directionLines.length, 1)
      assert.equal(editor.result.flowchart!.nodeById.get('A')?.subgraph, 'inner')
      assert.equal(editor.result.flowchart!.nodeById.get('D')?.subgraph, null)
      const expected = nested.replace('\tsubgraph outer[Outer]\r\n', '').replace('\t\tdirection TB\r\n', '')
        .replace(/^\tend\r\n/m, '').replace('\tstyle outer fill:gainsboro;\r\n', '')
        .replace(/^\t\t/gm, '\t')
      assert.equal(editor.code, expected)
      await rendered(editor.code); undo(editor, nested)
    }],
    ['72', '6e：CRLF/tab/注释/行尾空格、style/class、嵌套方向逐字保留，仅减一级缩进', async () => {
      const editor = new MermaidWysiwygEditor({ code: nested })
      editor.dispatch({ type: 'ungroup', id: 'inner' })
      const expected = nested.replace('\t\tsubgraph inner[Inner]\r\n', '').replace('\t\t\tdirection LR\r\n', '')
        .replace('\t\tend\r\n', '').replace('\t\t\tA[Alpha]', '\t\tA[Alpha]')
        .replace('X --> inner & D', 'X --> D').replace('\tinner --> X\r\n', '')
        .replace('class A,inner,D', 'class A,D').replace('\tclass inner marked;\r\n', '')
        .replace('\tstyle inner fill:lightgreen;\r\n', '').replace('linkStyle 0,2 ', 'linkStyle 0 ')
      assert.equal(editor.code, expected)
      assert.equal(editor.result.flowchart!.nodeById.get('A')?.subgraph, 'outer')
      await rendered(editor.code); undo(editor, nested)
      for (const code of [
        'flowchart TB\nsubgraph gone %% wrapper\n  direction LR %% direction\n  A[Alpha]  \nend %% close',
        'flowchart TB\nsubgraph gone\nA[Alpha]\nsubgraph keep\n  B[Beta]\nend\nend',
      ]) {
        const editor = new MermaidWysiwygEditor({ code })
        editor.dispatch({ type: 'ungroup', id: 'gone' })
        assert.equal(editor.code, code.includes('%% wrapper') ? 'flowchart TB\nA[Alpha]  '
          : 'flowchart TB\nA[Alpha]\nsubgraph keep\n  B[Beta]\nend')
        await rendered(editor.code); undo(editor, code)
      }
    }],
    ['73', '6e：& 两侧及链式仅去分组项，计数按展开边；自定义边属性/linkStyle 随删', async () => {
      const code = 'flowchart LR\n  subgraph gone[Group]\n    A[Alpha]\n  end\n  X[Outside] & gone --> Y[End] & Z[Other]\n  X --> gone --> Z\n  gone e1@--> Y\n  e1@{animate:true}\n  linkStyle 0,2,6 stroke:red;\n'
      const editor = new MermaidWysiwygEditor({ code })
      const result = editor.dispatch({ type: 'ungroup', id: 'gone' })!
      assert.equal(result.warnings?.[0].params?.n, 5)
      assert(editor.code.includes('X[Outside] --> Y[End] & Z[Other]'))
      assert(!editor.code.includes('gone')); assert(!editor.code.includes('e1'))
      assert(editor.code.includes('linkStyle 0 stroke:red;'))
      assert.deepEqual(editor.result.flowchart!.edges.map(e => [e.source, e.target]), [['X', 'Y'], ['X', 'Z']])
      await rendered(editor.code); undo(editor, code)
    }],
    ['74', '6e：真实 Mermaid 重绘 Louvre decor/外层和带嵌套样例，没有任何新增节点或分组', async () => {
      for (const [code, id] of [[louvre, 'decor'], [louvre, 'orch'], [nested, 'inner'], [nested, 'outer']]) {
        const before = identities(await rendered(code))
        const editor = new MermaidWysiwygEditor({ code })
        const removed = editor.result.flowchart!.edges.filter(e => e.source === id || e.target === id)
        editor.dispatch({ type: 'ungroup', id })
        const after = identities(await rendered(editor.code))
        assert.deepEqual(after.nodes, before.nodes)
        assert.deepEqual(after.groups, before.groups.filter(group => group !== id))
        assert.equal(after.edges.length, before.edges.length - removed.length)
        assert(after.edges.every(edge => before.edges.includes(edge)))
        editor.undo(); assert.equal(editor.code, code)
        assert.deepEqual(identities(await rendered(editor.code)), before)
      }
    }],
    ['75', '6e：右下角撤销按钮一步恢复原字节和真实 SVG；后续编辑使旧动作失效', async () => {
      const c = await canvas()
      try {
        const before = identities(c.host.querySelector('svg')!)
        c.pointer(c.entity('subgraph:decor'), 'click'); c.button('group.ungroup').click()
        await c.view.render()
        assert.equal(c.host.querySelectorAll('g.cluster').length, 2)
        c.button('toast.undo').click(); assert.equal(c.editor.code, louvre); assert(!c.editor.canUndo)
        await c.view.render(); assert.deepEqual(identities(c.host.querySelector('svg')!), before)
        c.pointer(c.entity('subgraph:decor'), 'click'); c.button('group.ungroup').click()
        c.editor.dispatch({ type: 'renameNode', id: 'floor', label: 'New floor' })
        assert.equal(c.host.querySelector('.mw-toast button'), null)
      } finally { c.destroy() }
    }],
    ['76', '6e：分组须精确对应；前缀组单独解散，重复组不能操作、不产生历史', async () => {
      const code = 'flowchart LR\n subgraph s\n  A\n end\n subgraph s2\n  B\n end\n'
      const c = await canvas(code)
      try {
        c.pointer(c.entity('subgraph:s2').querySelector('.cluster-label')!, 'click')
        c.button('group.ungroup').click()
        assert.equal(c.editor.code, 'flowchart LR\n subgraph s\n  A\n end\n B\n')
        undo(c.editor, code)
      } finally { c.destroy() }
      const duplicate = code.replace('subgraph s2', 'subgraph s')
      const editor = new MermaidWysiwygEditor({ code: duplicate })
      assert.equal(editor.dispatch({ type: 'ungroup', id: 's' }), null)
      assert.equal(editor.dispatch({ type: 'ungroup', id: 'missing' }), null)
      assert.equal(editor.code, duplicate); assert(!editor.canUndo)
      const broken = new MermaidWysiwygEditor({ code: 'flowchart TB\n subgraph open\n  A' })
      assert.equal(broken.dispatch({ type: 'ungroup', id: 'open' }), null)
    }],
    ['6e-drag', '6e 拖线：真实 Louvre 节点优先、蓝边，跨方向组双向提示；同组连线无提示且写在组内', async () => {
      for (const [source, target, clip] of [['goods', 'floor', true], ['floor', 'output', true], ['select', 'result', false]] as const) {
        const c = await canvas()
        try {
          assert.equal(c.host.querySelector('.mw-toast')?.textContent, '', '打开已有跨组边不得提示')
          const targetEl = c.entity(`node:${target}`)
          c.drag(source, targetEl.querySelector('.label') ?? targetEl, () => {
            assert(targetEl.classList.contains('mw-connect-target'))
            assert(!c.entity('subgraph:decor').classList.contains('mw-connect-target'))
          })
          assert(!targetEl.classList.contains('mw-connect-target'))
          assert(c.editor.result.flowchart!.edges.some(e => e.source === source && e.target === target))
          assert.equal(c.editor.result.flowchart!.edges.length, 38)
          assert.equal(c.host.querySelector('.mw-new-node-menu'), null)
          const graph = c.editor.result.flowchart!, decor = graph.subgraphs.find(g => g.id === 'decor')!
          const edge = graph.edges.find(e => e.source === source && e.target === target)!
          assert(clip ? edge.lineIndex > graph.subgraphs.find(g => g.id === 'orch')!.endLine
            : edge.lineIndex > decor.openLine && edge.lineIndex < decor.endLine)
          if (clip) {
            assert.equal(c.host.querySelector('.mw-toast span')?.textContent, t('toast.directionClip', { name: '自动装饰' }))
            const withEdge = c.editor.code
            c.button('toast.removeDirection').click()
            assert.equal(c.editor.code, withEdge.replace('            direction LR\n', ''))
            await c.view.render(); assert.equal(c.view.renderError, null)
            c.editor.undo(); assert.equal(c.editor.code, withEdge)
            c.editor.undo(); assert.equal(c.editor.code, louvre); assert(!c.editor.canUndo)
          } else {
            assert.equal(c.host.querySelector('.mw-toast')?.textContent, '')
            await c.view.render(); assert.equal(c.view.renderError, null); undo(c.editor, louvre)
          }
        } finally { c.destroy() }
      }
      const code = readFileSync(join(root, 'testdata/samples/03-subgraph.mmd'), 'utf8')
      const c = await canvas(code)
      try {
        c.drag('DB', c.entity('node:Cache'))
        const graph = c.editor.result.flowchart!, storage = graph.subgraphs.find(group => group.id === '存储')!
        const edge = graph.edges.find(edge => edge.source === 'DB' && edge.target === 'Cache')!
        assert(edge.lineIndex > storage.openLine && edge.lineIndex < storage.endLine)
        assert.equal(c.host.querySelector('.mw-toast')?.textContent, '')
        const connected = c.editor.code
        c.drag('DB', c.entity('node:Cache'))
        assert.equal(c.editor.code, connected)
        assert.equal(c.host.querySelector('.mw-toast')?.textContent, t('toast.dupEdge'))
        await c.view.render(); assert.equal(c.view.renderError, null)
        undo(c.editor, code)
      } finally { c.destroy() }
    }],
    ['6e-drag-menu', '6e 拖线：落在分组空白/标题弹新节点菜单，在该组建节点，可取消或一步撤销', async () => {
      for (const target of ['rect', '.cluster-label']) {
        const c = await canvas()
        try {
          const group = c.entity('subgraph:decor')
          const nodeCount = c.host.querySelectorAll('g.node').length
          c.drag('goods', group.querySelector(target)!)
          assert(c.host.querySelector('.mw-new-node-menu')); assert.equal(c.editor.code, louvre)
          c.button('menu.cancel').click(); assert(!c.editor.canUndo)
          c.drag('goods', group.querySelector(target)!)
          c.button('drag.newNode').click()
          const graph = c.editor.result.flowchart!, node = graph.nodes.find(n => n.label === t('drag.newNode'))!
          assert(node); assert.equal(node.subgraph, 'decor')
          assert(graph.edges.some(e => e.source === 'goods' && e.target === node.id))
          assert.equal(graph.edges.filter(e => e.source === 'goods' && e.target === 'decor').length, 1)
          await c.view.render(); assert.equal(c.view.renderError, null)
          assert.equal(c.host.querySelectorAll('g.node').length, nodeCount + 1)
          undo(c.editor, louvre)
        } finally { c.destroy() }
      }
    }],
  ]
}
