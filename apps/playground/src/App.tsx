import { createPortal } from 'react-dom'
import { t, getLocale, setLocale, onLocaleChange } from '@inkeep/mermaid-wysiwyg-dom'
import { changedLines, flashField, flashLines } from './changedLines'
import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes } from 'react'
import mermaid from 'mermaid'
import {
  DIAGRAM_TYPES,
  PARTICIPANT_TYPES,
  type MermaidWysiwygEditor,
  type ParticipantType,
  type ShapeId,
} from '@inkeep/mermaid-wysiwyg-core'
import type { MermaidCanvasView, Tool } from '@inkeep/mermaid-wysiwyg-dom'
import { MermaidCanvas, useMermaidEditor } from '@inkeep/mermaid-wysiwyg-react'
import { MermaidCodeMirror } from '@inkeep/mermaid-wysiwyg-codemirror'
import { MonacoPane } from './MonacoPane'
import { SAMPLES } from '../../js-playground/src/samples'

let zenumlReady: Promise<boolean> | null = null
function ensureZenuml(): Promise<boolean> {
  zenumlReady ??= import('@mermaid-js/mermaid-zenuml')
    .then(async (m) => (await mermaid.registerExternalDiagrams([m.default]), true))
    .catch(() => false)
  return zenumlReady
}

/** the playground's dark mermaid theme, built on mermaid's `base` theme */
const INK_THEME = {
  darkMode: true,
  background: '#000000',
  fontFamily: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
  // core nodes and edges
  primaryColor: '#111111',
  primaryTextColor: '#ededed',
  primaryBorderColor: '#3f3f3f',
  secondaryColor: '#1a1a1a',
  secondaryBorderColor: '#333333',
  secondaryTextColor: '#ededed',
  tertiaryColor: '#0a0a0a',
  tertiaryBorderColor: '#262626',
  tertiaryTextColor: '#a1a1a1',
  mainBkg: '#111111',
  nodeBorder: '#3f3f3f',
  nodeTextColor: '#ededed',
  lineColor: '#8f8f8f',
  textColor: '#ededed',
  titleColor: '#ededed',
  clusterBkg: '#0a0a0a',
  clusterBorder: '#333333',
  edgeLabelBackground: '#1a1a1a',
  // sequence
  actorBkg: '#111111',
  actorBorder: '#3f3f3f',
  actorTextColor: '#ededed',
  actorLineColor: '#333333',
  signalColor: '#8f8f8f',
  signalTextColor: '#a1a1a1',
  labelBoxBkgColor: '#111111',
  labelBoxBorderColor: '#3f3f3f',
  labelTextColor: '#ededed',
  loopTextColor: '#a1a1a1',
  noteBkgColor: '#1a1a1a',
  noteBorderColor: '#3f3f3f',
  noteTextColor: '#ededed',
  activationBkgColor: '#1f1f1f',
  activationBorderColor: '#454545',
  sequenceNumberColor: '#ffffff',
   // pie and categorical scales
  pie1: '#3784ff',
  pie2: '#a78bfa',
  pie3: '#4fae72',
  pie4: '#d9a13c',
  pie5: '#d97757',
  pie6: '#69a3ff',
  pie7: '#f0716b',
  pie8: '#8fb8ff',
  pieTitleTextColor: '#ededed',
  pieSectionTextColor: '#ffffff',
  pieLegendTextColor: '#a1a1a1',
  pieStrokeColor: '#000000',
  pieOuterStrokeColor: '#000000',
  cScale0: '#3784ff',
  cScale1: '#a78bfa',
  cScale2: '#4fae72',
  cScale3: '#d9a13c',
  cScale4: '#d97757',
  cScale5: '#69a3ff',
  cScale6: '#f0716b',
  cScale7: '#8fb8ff',
  // gantt
  sectionBkgColor: '#0a0a0a',
  sectionBkgColor2: '#111111',
  altSectionBkgColor: '#000000',
  gridColor: '#262626',
  todayLineColor: '#d97757',
  taskBkgColor: '#3784ff',
  taskBorderColor: '#3784ff',
  taskTextColor: '#ffffff',
  taskTextLightColor: '#ffffff',
  taskTextOutsideColor: '#ededed',
  activeTaskBkgColor: '#a78bfa',
  activeTaskBorderColor: '#a78bfa',
  doneTaskBkgColor: '#333333',
  doneTaskBorderColor: '#454545',
  critBkgColor: '#d97757',
  critBorderColor: '#d97757',
  excludeBkgColor: '#111111',
  // er / class
  attributeBackgroundColorOdd: '#0a0a0a',
  attributeBackgroundColorEven: '#111111',
  classText: '#ededed',
  // gitgraph
  git0: '#3784ff',
  git1: '#a78bfa',
  git2: '#4fae72',
  git3: '#d9a13c',
  git4: '#d97757',
  git5: '#69a3ff',
  git6: '#f0716b',
  git7: '#8fb8ff',
  commitLabelColor: '#ededed',
  commitLabelBackground: '#111111',
}

function themeConfig(theme: string) {
  return theme === 'ink'
    ? { theme: 'base', themeVariables: INK_THEME }
    : { theme, themeVariables: {} }
}

const SHAPES: ShapeId[] = ['rect', 'round', 'stadium', 'diamond', 'hexagon', 'circle', 'cylinder', 'subroutine']

export default function App() {
  useSyncExternalStore(onLocaleChange, getLocale)
  useEffect(() => { document.documentElement.lang = getLocale(); document.title = t('app.title') })
  const [sampleIndex, setSampleIndex] = useState(0)
  const [theme, setTheme] = useState('ink')
  const [readOnly, setReadOnly] = useState(false)
  const [zenumlOk, setZenumlOk] = useState(false)

  const sample = SAMPLES[sampleIndex]
  useEffect(() => {
    if (sample.typeId === 'zenuml') void ensureZenuml().then(setZenumlOk)
  }, [sample])

  const waitForZenuml = sample.typeId === 'zenuml' && !zenumlOk

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          {t('app.title')}
          <span className="sep">/</span>
          <span className="sub">{t('app.playground')}</span>
        </div>
        <div className="controls">
          <select value={theme} onChange={(e) => setTheme(e.target.value)} title={t('app.theme')} aria-label={t('app.theme')}>
            {['ink', 'dark', 'default', 'forest', 'neutral'].map((themeId) => (
              <option key={themeId} value={themeId}>{t(`theme.${themeId}`)}</option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" aria-label={t('app.readonly')} checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            {t('app.readonly')}
          </label>
          <a href="https://github.com/inkeep/mermaid-wysiwyg" target="_blank" rel="noreferrer">{t('app.github')}</a>
          <span id="workspace-actions" />
          <Button aria-label={t('app.language')} onClick={() => setLocale(getLocale() === 'en' ? 'zh-CN' : 'en')}>{t('app.zh')} / {t('app.en')}</Button>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar">
          <div className="side-label">{t('app.diagrams')}</div>
          {SAMPLES.map((s, i) => {
            const info = DIAGRAM_TYPES.find((d) => d.id === s.typeId)
            return (
              <Button key={`${s.typeId}-${i}`} aria-label={t(i === 0 ? 'sample.orders' : i === 1 ? 'sample.architecture' : `diagram.${s.typeId}`)} className={`side-item${i === sampleIndex ? ' active' : ''}`} onClick={() => setSampleIndex(i)}>
                <i className={`dot ${info?.capability ?? 'render'}`} />
                {t(i === 0 ? 'sample.orders' : i === 1 ? 'sample.architecture' : `diagram.${s.typeId}`)}
              </Button>
            )
          })}
          <div className="legend">
            <span><i className="dot edit" /> {t('app.editable')}</span>
            <span><i className="dot render" /> {t('app.render')}</span>
          </div>
        </aside>
        {!waitForZenuml && <Workspace key={sampleIndex} code={sample.code} theme={theme} readOnly={readOnly} />}
      </div>
    </div>
  )
}

function Workspace({ code, theme, readOnly }: { code: string; theme: string; readOnly: boolean }) {
  const { editor } = useMermaidEditor(code)
  const [view, setView] = useState<MermaidCanvasView | null>(null)
  const [tool, setToolState] = useState<Tool>('select')
  const fileInput = useRef<HTMLInputElement>(null)
  const [changed, setChanged] = useState(0)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pane, setPane] = useState<'codemirror' | 'monaco'>('codemirror')

  // theme changes flow through the MermaidCanvas mermaidConfig prop

  // subscribe to the editor so toolbar state (undo/redo/selection) stays live
  useEditorCode(editor)
  useEffect(() => editor.on('change', event => setChanged(changedLines(event).length)), [editor])
  const save = () => {
    const url = URL.createObjectURL(new Blob([editor.code], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = t('app.filename'); a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(editor.code); setCopyStatus('toast.copied') }
    catch { setCopyStatus('toast.copyFailed') }
  }
  // status tracks render outcomes; the view emits after every (debounced)
  // render, including the undo-back-to-last-good path
  useEffect(() => {
    if (!view) return
    setStatus(view.renderError)
    return view.on('render', () => setStatus(view.renderError))
  }, [view])

  const setTool = (t: Tool) => {
    view?.setTool(t)
    setToolState(t)
  }

  const typeInfo = editor.result.typeInfo
  const canvasReadOnly = readOnly || typeInfo?.capability !== 'edit' || ['sequence', 'gantt'].includes(typeInfo?.id ?? '')
  const editable = !canvasReadOnly

  return (
    <>
      {document.getElementById('workspace-actions') && createPortal(<>
        <span role="status">{t(status ? 'status.parseError' : 'status.synced', { n: changed })}</span>
        <Button aria-label={t('tb.copy')} onClick={copy}>{t('tb.copy')}</Button>
      </>, document.getElementById('workspace-actions')!)}
      {copyStatus && <div className="copy-toast" role="status" onClick={() => setCopyStatus(null)}>{t(copyStatus)}</div>}
      <main className="main">
        <div className="toolbar">
          <input ref={fileInput} type="file" hidden accept=".mmd,.mermaid,.txt" aria-label={t('app.fileInput')} onChange={async e => {
            const file = e.target.files?.[0]
            if (file) editor.setCode(await file.text(), 'external')
            e.target.value = ''
          }} />
          <Button aria-label={t('tb.open')} onClick={() => fileInput.current?.click()}>{t('tb.open')}</Button>
          <Button aria-label={t('tb.save')} onClick={save}>{t('tb.save')}</Button>
          <Button className={tool === 'select' ? 'primary' : ''} disabled={!editable} onClick={() => setTool('select')}>{t('app.select')}</Button>
          <Button className={tool === 'connect' ? 'primary' : ''} disabled={!editable} onClick={() => setTool('connect')}>{t('app.connect')}</Button>
          {editable && <TypeTools editor={editor} view={view} />}
          <span className="spacer" />
          <Button disabled={!editable || !editor.selection.length} className="danger" onClick={() => editor.deleteEntities(editor.selection)}>{t('edge.delete')}</Button>
          <Button disabled={!editor.canUndo} onClick={() => editor.undo()}>{t('tb.undo')}</Button>
          <Button disabled={!editor.canRedo} onClick={() => editor.redo()}>{t('tb.redo')}</Button>
        </div>
        <MermaidCanvas
          editor={editor}
          mermaid={mermaid}
          mermaidConfig={{ securityLevel: 'loose', ...themeConfig(theme) }}
          accentColor="#69a3ff"
          readOnly={canvasReadOnly}
          onReady={setView}
          className="canvas"
          style={{ height: '100%' }}
        />
      </main>
      <section className="codepanel">
        <div className="panel-title">
          <span className="panel-title-left">
            {t('app.source')}
            <span className="seg">
              <Button className={pane === 'codemirror' ? 'on' : ''} onClick={() => setPane('codemirror')}>
                {t('app.codemirror')}
              </Button>
              <Button className={pane === 'monaco' ? 'on' : ''} onClick={() => setPane('monaco')}>
                {t('app.monaco')}
              </Button>
            </span>
          </span>
          {typeInfo && (
            <span className={`badge${typeInfo.capability === 'edit' ? ' edit' : ''}`}>
              {t(`diagram.${typeInfo.id}`)} · {t(editable ? 'app.editable' : 'app.render')}
            </span>
          )}
        </div>
        {pane === 'monaco' ? <MonacoPane editor={editor} /> : <CodePane editor={editor} />}
        <div className="statusbar">
          {status ? <span className="err">✕ {t('status.parseError')}</span> : <span className="ok">✓ {t('status.synced', { n: changed })}</span>}
        </div>
      </section>
    </>
  )
}

/** re-render on document changes */
function useEditorCode(editor: MermaidWysiwygEditor) {
  const [code, setCode] = useState(editor.code)
  useEffect(() => editor.on('change', ({ code: next }) => setCode(next)), [editor])
  return code
}

function TypeTools({ editor, view }: { editor: MermaidWysiwygEditor; view: MermaidCanvasView | null }) {
  const typeId = editor.result.typeInfo?.id
  const openEditorSoon = (created?: string[]) => {
    const id = created?.[0]
    if (id) setTimeout(() => view?.editEntityLabel(id), 350)
  }

  if (typeId === 'flowchart') {
    return (
      <>
        <select value="" title={t('tb.addNode')} aria-label={t('tb.addNode')} onChange={(e) => e.target.value && view?.addNode(e.target.value as ShapeId)}>
          <option value="">{t('tb.addNode')}</option>
          {SHAPES.map((s) => (
            <option key={s} value={s}>{t(`shape.${s}`)}</option>
          ))}
        </select>
        <Button onClick={() => editor.dispatch({ type: 'addSubgraph', title: t('ui.newGroup') })}>{t('tb.addGroup')}</Button>
        <DirectionSelect
          value={editor.result.flowchart?.direction ?? 'TD'}
          options={['TD', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'sequence') {
    return (
      <>
        <select value="" title={t('app.addParticipant')} aria-label={t('app.addParticipant')} onChange={(e) => e.target.value && editor.dispatch({ type: 'seq.addParticipant', ptype: e.target.value as ParticipantType })}>
          <option value="">{t('app.addParticipant')}</option>
          {PARTICIPANT_TYPES.map((pt) => (
            <option key={pt} value={pt}>{t(`participant.${pt}`)}</option>
          ))}
        </select>
        <Button
          className={editor.result.sequence?.autonumber.enabled ? 'primary' : ''}
          onClick={() => editor.dispatch({ type: 'seq.toggleAutonumber' })}
        >
          {t('app.autonumber')}
        </Button>
      </>
    )
  }
  if (typeId === 'state') {
    return (
      <>
        <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'st.addState', label: t('app.newState') })?.created)}>{t('app.addState')}</Button>
        <DirectionSelect
          value={editor.result.state?.direction?.value ?? 'TB'}
          options={['TB', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'st.setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'class') {
    return (
      <>
        <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'cl.addClass' })?.created)}>{t('app.addClass')}</Button>
        <DirectionSelect
          value={editor.result.classGraph?.direction?.value ?? 'TB'}
          options={['TB', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'cl.setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'er') {
    return <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'er.addEntity' })?.created)}>{t('app.addEntity')}</Button>
  }
  if (typeId === 'pie') {
    return <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'pie.addSlice' })?.created)}>{t('app.addSlice')}</Button>
  }
  if (typeId === 'gantt') {
    return <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'gantt.addTask' })?.created)}>{t('app.addTask')}</Button>
  }
  if (editor.result.lineItems) {
    return <Button onClick={() => openEditorSoon(editor.dispatch({ type: 'li.addItem' })?.created)}>{t('app.addItem')}</Button>
  }
  return null
}

function DirectionSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (d: string) => void }) {
  const normalized = value === 'TD' && options.includes('TB') ? 'TB' : value === 'TB' && options.includes('TD') ? 'TD' : value
  return (
    <select value={normalized} title={t('app.direction')} aria-label={t('app.direction')} onChange={(e) => onChange(e.target.value)}>
      {options.map((d) => (
        <option key={d} value={d}>{t(`direction.${d}`)}</option>
      ))}
    </select>
  )
}

function CodePane({ editor }: { editor: MermaidWysiwygEditor }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const cm = new MermaidCodeMirror(ref.current, editor, [flashField])
    cm.view.contentDOM.setAttribute('aria-label', t('app.codeEditor'))
    const offLocale = onLocaleChange(() => cm.view.contentDOM.setAttribute('aria-label', t('app.codeEditor')))
    let timer: ReturnType<typeof setTimeout>
    const off = editor.on('change', event => {
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
