import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes } from 'react'
import mermaid from 'mermaid'
import { MermaidWysiwygEditor } from '@inkeep/mermaid-wysiwyg-core'
import { MermaidCanvasView, t, getLocale, setLocale, onLocaleChange } from '@inkeep/mermaid-wysiwyg-dom'
import { MermaidCodeMirror } from '@inkeep/mermaid-wysiwyg-codemirror'
import { changedLines, flashField, flashLines } from './changedLines'
import { DEFAULT_EXAMPLE } from './defaultExample'
import { browserFiles, type FileAccess } from './files'
import { DraftStore, type DraftSession } from './draft'
import { DraftNotice } from './DraftNotice'
import { DesktopFiles, detectDesktop } from './desktop'
import { supportedFile, windowTitle } from './documentFile'
import { mayLeaveDocument } from './lifecycle'

const desktop = detectDesktop()

const canvasConfig = {
  securityLevel: 'loose', theme: 'base',
  themeVariables: {
    fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    primaryColor: '#eef2ff', primaryTextColor: '#1f2937', primaryBorderColor: '#6b7280',
    lineColor: '#374151', secondaryColor: '#fffbeb', tertiaryColor: '#ffffff',
    clusterBkg: '#ffffff', clusterBorder: '#9ca3af', edgeLabelBackground: '#ffffff',
  },
}

export default function App({ fileAccess = desktop ?? browserFiles }: { fileAccess?: FileAccess }) {
  const locale = useSyncExternalStore(onLocaleChange, getLocale)
  const [drafts] = useState(() => new DraftStore())
  const native = fileAccess instanceof DesktopFiles ? fileAccess : null
  const [resumed] = useState(() => fileAccess.startupPath ? null : drafts.resume())
  const [initial] = useState(() => resumed?.snapshot ?? { code: DEFAULT_EXAMPLE,
    name: t(native ? 'app.untitled' : 'app.filename'), untitled: !!native })
  const [editor] = useState(() => new MermaidWysiwygEditor({ code: initial.code }))
  const code = useSyncExternalStore(cb => editor.on('change', cb), () => editor.code)
  const [filename, setFilename] = useState(initial.name)
  const [untitled, setUntitled] = useState(resumed ? !!resumed.snapshot.untitled : !!native)
  const [baseline, setBaseline] = useState(resumed?.baseCode ?? initial.code)
  const [prompt, setPrompt] = useState<DraftSession['prompt']>(null)
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
  const saving = useRef<Promise<boolean> | null>(null)
  const closing = useRef(false)
  const actions = useRef({ open: (_path: string) => {}, close: () => {} })
  const editable = editor.result.typeInfo?.id === 'flowchart'
  const dirty = code !== baseline
  const displayName = untitled ? t('app.untitled') : filename

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = windowTitle(t('app.title'), displayName, dirty)
    native?.syncTitle(document.title)
  }, [locale, displayName, dirty, native])
  useEffect(() => {
    if (session.current) return
    let cancelled = false
    initializing.current = drafts.open(initial)
    void initializing.current.then(opened => {
      if (!cancelled && !session.current) { session.current = opened; setReady(true) }
    })
    return () => { cancelled = true }
  }, [drafts, initial])
  useEffect(() => {
    if (ready) { session.current?.edit(code); setPrompt(session.current?.prompt ?? null) }
  }, [code, ready])
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

  const mayLeave = () => native ? mayLeaveDocument(() => {
    session.current?.edit(editor.code)
    return session.current?.dirty ?? editor.code !== baseline
  }, () => native.confirmClose(), () => save()) : Promise.resolve(true)

  const open = async (file?: File | string) => {
    const version = ++fileVersion.current
    try {
      let opened = await fileAccess.open(file)
      if (!opened || version !== fileVersion.current || !await mayLeave()) return
      // Saving in the confirmation may have changed the selected file itself.
      if (native && opened.path) opened = await fileAccess.open(opened.path)
      if (!opened || version !== fileVersion.current) return
      const nextSession = await drafts.open(opened)
      if (version !== fileVersion.current) return
      session.current = nextSession; setReady(true)
      setBaseline(opened.code); setUntitled(false); setPrompt(native ? nextSession.prompt : null)
      view.current?.fitView()
      editor.setCode(opened.code, 'external')
      setFilename(opened.name); setChanged(0); setToast(null)
    } catch (error) { setToast({ key: 'err.open', reason: error instanceof Error ? error.message : String(error) }) }
  }
  const performSave = async (saveAs: boolean): Promise<boolean> => {
    const savedCode = editor.code
    try {
      const current = session.current ?? await initializing.current
      current?.edit(savedCode)
      const snapshot = { ...current?.snapshot, code: savedCode, name: displayName }
      if (!native && snapshot.path === snapshot.name) delete snapshot.path
      const saved = await (saveAs && fileAccess.saveAs ? fileAccess.saveAs(snapshot) : fileAccess.save(snapshot))
      if (saved === null) return false
      if (session.current === current) current?.edit(editor.code)
      await current?.saved(savedCode, saved ?? { ...snapshot, untitled: false })
      if (session.current === current) {
        setBaseline(savedCode); setUntitled(false); setFilename(saved?.name ?? displayName)
        setPrompt(null); setToast(null)
      }
      return session.current === current && editor.code === savedCode
    }
    catch (error) { setToast({ key: 'err.save', reason: error instanceof Error ? error.message : String(error) }); return false }
  }
  const save = (saveAs = false): Promise<boolean> => {
    if (saving.current) return saving.current
    saving.current = performSave(saveAs).finally(() => { saving.current = null })
    return saving.current
  }
  const copy = async () => {
    try { await (native ? native.copy(editor.code) : navigator.clipboard.writeText(editor.code)); setToast({ key: 'toast.copied' }) }
    catch { setToast({ key: 'toast.copyFailed' }) }
  }
  actions.current = {
    open: path => { void open(path) },
    close: () => {
      if (closing.current) return
      closing.current = true
      void mayLeave().then(allowed => { if (allowed) native?.finishClose() })
        .finally(() => { closing.current = false })
    },
  }
  useEffect(() => {
    if (!native) return
    const offOpen = native.onOpen(path => actions.current.open(path))
    const offClose = native.onClose(() => actions.current.close())
    native.ready()
    return () => { offOpen(); offClose() }
  }, [native])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(event.shiftKey) }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); native ? void open() : fileInput.current?.click() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return <div className="app" onDragOver={event => { if (!native) event.preventDefault() }}
    onDrop={event => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (!native && file && supportedFile(file.name)) void open(file)
    }}>
    <header className="titlebar">{t('app.title')} — <span data-user-content="filename">{displayName}{dirty ? ' *' : ''}</span></header>
    <div className="toolbar">
      <input ref={fileInput} type="file" hidden accept=".mmd,.mermaid,.md,.txt" aria-label={t('app.fileInput')}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void open(file) }} />
      <div className="tool-group">
        <Button onClick={() => native ? void open() : fileInput.current?.click()}>{t('tb.open')}</Button>
        <Button onClick={() => void save()}>{t('tb.save')}</Button>
        {native && <Button onClick={() => void save(true)}>{t('tb.saveAs')}</Button>}
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
    {native && <DraftNotice prompt={prompt} onRestore={() => {
      const restored = session.current?.restore()
      if (restored !== undefined) editor.setCode(restored, 'api')
      setPrompt(null)
    }} onDiscard={() => { session.current?.discard(); setPrompt(null) }} />}
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
