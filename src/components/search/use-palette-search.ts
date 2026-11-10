import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectNameMap } from '#/components/experiments/experiments-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { executeSearch, searchDidYouMean, SEARCH_SCOPE_ALL } from '#/lib/search'
import type { DidYouMeanSuggestion, SearchResult } from '#/lib/search'
import { parseTypedSearch } from '#/lib/search-query'
import type { TypedSearch } from '#/lib/search-query'
import { useSearchFields } from './use-search-fields'

/** Debounced canonical search and correction requests, guarded against stale completion. */
export function usePaletteSearch({
  open,
  initialQuery,
}: {
  open: boolean
  initialQuery: string
}) {
  const [q, setQ] = useState(initialQuery)
  const [scope, setScope] = useState<string>(SEARCH_SCOPE_ALL)
  const [archived, setArchived] = useState(false)
  const [res, setRes] = useState<SearchResult[] | null>(null)
  const [typed, setTyped] = useState<TypedSearch | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [searching, setSearching] = useState(false)

  const [suggestion, setSuggestion] = useState<DidYouMeanSuggestion | null>(
    null,
  )

  const searchGeneration = useRef(0)
  const fields = useSearchFields()
  const projects = useProjectNameMap()

  const reset = () => {
    searchGeneration.current += 1
    setQ(initialQuery)
    setScope(SEARCH_SCOPE_ALL)
    setArchived(false)
    setRes(null)
    setTyped(null)
    setError(null)
    setSearching(false)
    setSuggestion(null)
  }

  const runSearch = useCallback(
    (
      term: string,
      nextScope: string,
      nextArchived: boolean,
      parsed: TypedSearch | null,
    ) => {
      const generation = (searchGeneration.current += 1)
      setSearching(true)
      setError(null)
      void executeSearch(notebookDataClient, {
        query: parsed ? parsed.q : term,
        filter: parsed?.filter,
        limit: 24,
        projectId: nextScope === SEARCH_SCOPE_ALL ? undefined : nextScope,
        includeArchived: nextArchived,
      })
        .then((rows) => {
          if (generation !== searchGeneration.current) return
          setRes(rows)
          setSearching(false)
        })
        .catch((cause: unknown) => {
          if (generation !== searchGeneration.current) return
          setRes(null)
          setSearching(false)
          setError(cause)
        })
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    const term = q.trim()

    if (!term) {
      setRes(null)
      setError(null)
      setSearching(false)

      return
    }

    setSuggestion(null)
    setSearching(true)
    let live = true

    const timer = setTimeout(() => {
      void parseTypedSearch(term, fields)
        .catch((): TypedSearch => ({ q: term }))
        .then((parsed) => {
          if (!live) return
          setTyped(parsed)
          runSearch(term, scope, archived, parsed)
        })
    }, 120)

    return () => {
      live = false
      searchGeneration.current += 1
      clearTimeout(timer)
    }
  }, [q, open, scope, archived, runSearch, fields])

  useEffect(() => {
    if (!open) return
    const term = q.trim()

    if (!term || res === null || res.length > 0) {
      setSuggestion(null)

      return
    }

    let live = true

    const timer = setTimeout(() => {
      void searchDidYouMean(notebookDataClient, term, archived).then((rows) => {
        if (live) setSuggestion(rows[0] ?? null)
      })
    }, 150)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, open, res, archived])

  return {
    q,
    setQ,
    scope,
    setScope,
    archived,
    setArchived,
    res,
    typed,
    error: Boolean(error),
    searching,
    suggestion,
    projects,
    reset,
    runSearch,
  }
}
