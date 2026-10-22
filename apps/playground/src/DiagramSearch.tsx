import { useMemo, useState } from 'react'
import type { FlowGraph } from '@inkeep/mermaid-wysiwyg-core'
import { t } from '@inkeep/mermaid-wysiwyg-dom'

export function DiagramSearch({ graph, onLocate, onClose }: {
  graph: FlowGraph | null; onLocate: (id: string) => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => {
    if (!graph || !query.trim()) return []
    const groups = new Set(graph.subgraphs.map(group => group.id))
    const entries = [
      ...graph.nodes.filter(node => !groups.has(node.id)).map(node => ({ id: node.entityId, label: node.label, detail: node.id })),
      ...graph.subgraphs.map(group => ({ id: group.entityId, label: group.title ?? group.id, detail: group.id })),
      ...graph.edges.map(edge => ({ id: edge.entityId, label: edge.label ?? `${edge.source} → ${edge.target}`, detail: `${edge.source} → ${edge.target}` })),
    ]
    const text = query.trim().toLocaleLowerCase()
    return entries.filter(entry => `${entry.label} ${entry.detail}`.toLocaleLowerCase().includes(text))
  }, [graph, query])
  const active = Math.min(index, Math.max(0, results.length - 1))
  const locate = (next: number) => {
    if (!results.length) return
    next = (next + results.length) % results.length
    setIndex(next); onLocate(results[next].id)
  }
  return <section className="diagram-search" aria-label={t('search.title')}>
    <div className="search-controls">
      <input autoFocus type="search" aria-label={t('search.input')} placeholder={t('search.input')}
        value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); locate(active + (event.shiftKey ? -1 : 0)) }
          if (event.key === 'ArrowDown') { event.preventDefault(); locate(active + 1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); locate(active - 1) }
          if (event.key === 'Escape') { event.preventDefault(); onClose() }
        }} />
      <span role="status">{t('search.count', { n: results.length })}</span>
      <button type="button" onClick={onClose} aria-label={t('search.close')}>×</button>
    </div>
    {query.trim() && <div className="search-results">
      {!results.length && <p>{t('search.empty')}</p>}
      {results.map((result, i) => <button type="button" key={result.id} aria-pressed={active === i}
        onClick={() => locate(i)}><span>{result.label}</span><small>{result.detail}</small></button>)}
    </div>}
  </section>
}
