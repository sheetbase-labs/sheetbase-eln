import { useEffect, useRef, useState } from 'react'
import type { SpreadsheetCustomEditor } from 'sheetbase-table/dev'

export interface RecordPickerHit {
  id: string
  label: string
  hint?: string
}

export interface RecordPickerEditorOptions {
  search: (query: string) => Promise<readonly RecordPickerHit[]>
  placeholder?: string
  emptyText?: string
}

/**
 * Self-contained record-picker editor for reference columns: an inline
 * search-select whose commit writes the canonical record UUID through the
 * engine's normal edit pipeline. The ELN supplies the search backend.
 */
export function createRecordPickerEditor(
  options: RecordPickerEditorOptions,
): SpreadsheetCustomEditor {
  return {
    matches: ({ field }) => field?.dataType === 'relationship',
    render: ({ initialDraft, commit, cancel }) => (
      <RecordPickerInline
        options={options}
        initialDraft={initialDraft}
        commit={commit}
        cancel={cancel}
      />
    ),
  }
}

function RecordPickerInline({
  options,
  initialDraft,
  commit,
  cancel,
}: Readonly<{
  options: RecordPickerEditorOptions
  initialDraft: string
  commit(value: string): void
  cancel(): void
}>) {
  // The options object is caller-owned; keep it out of the effect deps so a
  // re-render with a fresh literal does not restart an in-flight search.
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [query, setQuery] = useState(initialDraft)
  const [hits, setHits] = useState<readonly RecordPickerHit[]>([])
  const [state, setState] = useState<'loading' | 'done'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    optionsRef.current
      .search(query)
      .then((results) => {
        if (!alive) return
        setHits(results)
        setState('done')
      })
      .catch(() => {
        if (!alive) return
        setHits([])
        setState('done')
      })
    return () => {
      alive = false
    }
  }, [query])

  return (
    <div className="eln-record-picker" role="listbox" aria-label="Record picker">
      <input
        autoFocus
        value={query}
        placeholder={options.placeholder ?? 'Search records…'}
        aria-label="Search records"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
        }}
      />
      {state === 'loading' ? (
        <p role="status">Searching…</p>
      ) : hits.length === 0 ? (
        <p role="status">{options.emptyText ?? 'No matches.'}</p>
      ) : (
        <ul>
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" onClick={() => commit(hit.id)}>
                <span>{hit.label}</span>
                {hit.hint ? <small>{hit.hint}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="eln-record-picker-cancel" onClick={cancel}>
        Cancel
      </button>
    </div>
  )
}
