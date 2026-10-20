import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes } from 'react'
import mermaid from 'mermaid'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, t, getLocale, setLocale, onLocaleChange } from '@inkeep/mermaid-wysiwyg-dom'
import { MermaidCodeMirror } from '@inkeep/mermaid-wysiwyg-codemirror'
import { changedLines, flashField, flashLines } from './changedLines'
import { DEFAULT_EXAMPLE } from './defaultExample'
import { browserFiles, type FileAccess } from './files'
import { DraftStore, type DraftSession } from './draft'

const canvasConfig = {
  securityLevel: 'loose', theme: 'base',
  themeVariables: {
    fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    primaryColor: '#eef2ff', primaryTextColor: '#1f2937', primaryBorderColor: '#6b7280',
    lineColor: '#374151', secondaryColor: '#fffbeb', tertiaryColor: '#ffffff',
    clusterBkg: '#ffffff', clusterBorder: '#9ca3af', edgeLabelBackground: '#ffffff',
  },
}

export default function App({ fileAccess = browserFiles }: { fileAccess?: FileAccess }) {
  const locale = useSyncExternalStore(onLocaleChange, getLocale)
  const [drafts] = useState(() => new DraftStore())
  const [resumed] = useState(() => drafts.resume())
  const [initial] = useState(() => resumed ?? { code: DEFAULT_EXAMPLE, name: t('app.filename') })
  const [editor] = useState(() => new MermaidWysiwygEditor({ code: initial.code }))
  const code = useSyncExternalStore(cb => editor.on('change', cb), () => editor.code)
  const [filename, setFilename] = useState(initial.name)
  const [changed, setChanged] = useState(0)
  const [parseError, setParseError] = useState(false)
  const [toast, setToast] = useState<{ key: string; reason?: string } | null>(() => resumed ? { key: 'draft.restored' } : null)
  const session = useRef<DraftSession | null>(resumed)
  const initializing = useRef<Promise<DraftSession> | null>(null)
  const [ready, setReady] = useState(!!resumed)
  const canvas = useRef<HTMLDivElement>(null)
  const hint = useRef<HTMLElement>(null)
  const view = useRef<MermaidCanvasView | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileVersion = useRef(0)
  const editable = editor.result.typeInfo?.id === 'flowchart'

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = `${t('app.title')} — ${filename}`
  }, [locale, filename])
  useEffect(() => {
    if (session.current) return
    let cancelled = false
    initializing.current = drafts.open(initial)
    void initializing.current.then(opened => {
      if (!cancelled && !session.current) { session.current = opened; setReady(true) }
    })
    return () => { cancelled = true }
  }, [drafts, initial])
  useEffect(() => { if (ready) session.current?.edit(code) }, [code, ready])
  useEffect(() => editor.on('change', event => setChanged(changedLines(event).length)), [editor])
  useEffect(() => {
    if (!canvas.current) return
    const next = new MermaidCanvasView({ editor, container: canvas.current, mermaid,
      mermaidConfig: canvasConfig, accentColor: '#2563eb', panZoom: true,
      readOnly: editor.result.typeInfo?.id !== 'flowchart', hintContainer: hint.current ?? undefined })
    view.current = next
    const off = next.on('render', () => setParseError(!!next.renderError))
    return () => { off(); next.destroy(); view.current = null }
  }, [editor])
  useEffect(() => { view.current?.setReadOnly(!editable) }, [editable])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const open = async (file: File) => {
    const version = ++fileVersion.current
    try {
      const opened = await fileAccess.open(file)
      const nextSession = await drafts.open(opened)
      if (version !== fileVersion.current) return
      session.current = nextSession; setReady(true)
      view.current?.fitView()
      editor.setCode(opened.code, 'external')
      setFilename(opened.name); setChanged(0); setToast(null)
    } catch (error) { setToast({ key: 'err.open', reason: error instanceof Error ? error.message : String(error) }) }
  }
  const save = async () => {
    const savedCode = editor.code
    try {
      const current = session.current ?? await initializing.current
      current?.edit(savedCode)
      await fileAccess.save({ code: savedCode, name: filename, ...(current && current.path !== filename ? { path: current.path } : {}) })
      await current?.saved(savedCode)
      if (session.current === current) setToast(null)
    }
    catch (error) { setToast({ key: 'err.save', reason: error instanceof Error ? error.message : String(error) }) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(editor.code); setToast({ key: 'toast.copied' }) }
    catch { setToast({ key: 'toast.copyFailed' }) }
  }

  return <div className="app">
    <header className="titlebar">{t('app.title')} — <span data-user-content="filename">{filename}</span></header>
    <div className="toolbar">
      <input ref={fileInput} type="file" hidden accept=".mmd,.mermaid,.txt" aria-label={t('app.fileInput')}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void open(file) }} />
      <div className="tool-group">
        <Button onClick={() => fileInput.current?.click()}>{t('tb.open')}</Button>
        <Button onClick={() => void save()}>{t('tb.save')}</Button>
      </div>
      <div className="tool-group">
        <Button disabled={!editor.canUndo} onClick={() => editor.undo()}>{t('tb.undo')}</Button>
        <Button disabled={!editor.canRedo} onClick={() => editor.redo()}>{t('tb.redo')}</Button>
      </div>
      <div className="tool-group additions">
        <Button disabled={!editable} onClick={() => editor.dispatch({ type: 'addNode', label: t('drag.newNode') })}>{t('tb.addNode')}</Button>
        <Button disabled={!editable} onClick={() => editor.dispatch({ type: 'addSubgraph', title: t('ui.newGroup') })}>{t('tb.addGroup')}</Button>
      </div>
      <div className="toolbar-right">
        <span className={`sync-status${parseError ? ' error' : ''}`} role="status" aria-live="polite">
          {t(parseError ? 'status.parseError' : 'status.synced', { n: changed })}
        </span>
        <Button className="primary" onClick={() => void copy()}>{t('tb.copy')}</Button>
        <div className="language-switch" role="group" aria-label={t('aria.langSwitch')}>
          <Button aria-label={t('aria.langSwitch')} aria-pressed={locale === 'zh-CN'} className={locale === 'zh-CN' ? 'active' : ''} onClick={() => setLocale('zh-CN')}>{t('app.zh')}</Button>
          <Button aria-label={t('aria.langSwitch')} aria-pressed={locale === 'en'} className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>{t('app.en')}</Button>
        </div>
      </div>
    </div>
    <main className="workspace">
      <section className="codepanel" aria-label={t('app.source')}><CodePane editor={editor} /></section>
      <section className="canvas-panel" aria-label={t('app.canvas')}>
        <div ref={canvas} className="canvas" />
        {toast && <div className="app-toast" role="status" aria-live="polite">{t(toast.key, { reason: toast.reason ?? '' })}</div>}
      </section>
    </main>
    <footer ref={hint} className="hintbar" />
  </div>
}

function CodePane({ editor }: { editor: MermaidWysiwygEditor }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const cm = new MermaidCodeMirror(ref.current, editor, [flashField])
    const updateLabel = () => cm.view.contentDOM.setAttribute('aria-label', t('app.codeEditor'))
    updateLabel()
    const offLocale = onLocaleChange(updateLabel)
    let timer: ReturnType<typeof setTimeout>
    const off = editor.on('change', event => {
      if (event.origin !== 'canvas' && event.origin !== 'history') return
      cm.view.dispatch({ effects: flashLines.of(changedLines(event)) })
      clearTimeout(timer)
      timer = setTimeout(() => cm.view.dispatch({ effects: flashLines.of([]) }), 2000)
    })
    return () => { clearTimeout(timer); offLocale(); off(); cm.destroy() }
  }, [editor])
  return <div className="codepane" ref={ref} />
}

function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = props['aria-label'] ?? (typeof props.children === 'string' ? props.children : undefined)
  return <button type="button" {...props} aria-label={label} title={props.title ?? label} />
}
