import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Dialog, DialogContent } from '#/components/v3/ui/dialog'
import { Button } from '#/components/v3/ui/button'
import { Kbd } from '#/components/v3/ui/kbd'
import { NativeSelect } from '#/components/v3/projects/select'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { useProjectNameMap } from '#/components/v3/experiments/experiments-data'
import { Highlight } from './highlight'
import { searchResultContext, searchResultLabel } from './result-text'
import {
  contextualSearchActions,
  executeSearch,
  filterBySearchScope,
  groupSearchResults,
  rankByTier,
  searchActionHref,
  searchDidYouMean,
  searchResultGroup,
  searchResultNewTabUrl,
  SEARCH_SCOPE_ALL,
} from '#/lib/search'
import type {
  DidYouMeanSuggestion,
  SearchContextAction,
  SearchResult,
  SearchResultGroup,
} from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

/**
 * UI port (roadmap-4/ui-app3): the ⌘K search palette. Mounted once in the
 * shell; opens on ⌘K / Ctrl+K and from the top-bar search box. SRCH-02 adds
 * the design's scope selector, grouped and truncated results, contextual
 * actions, and keyboard parity: ↑↓ move, ↵ open, ⌘↵ open in a new tab, Esc
 * closes and returns focus. The shell owns the Cmd-K shortcut, so this
 * component installs no global key listener.
 *
 * R5-SHELL-04 adds the archived scope (pushed to the search boundary as
 * `p_include_archived`, never filtered here) and a "Did you mean {id}?"
 * correction from `api.search_did_you_mean` when a query finds nothing.
 */
const MAX_PER_GROUP = 3
const FETCH_LIMIT = 24

const GROUP_ICONS: Record<SearchResultGroup, IconName> = {
  Samples: 'tube',
  'Sheet and dataset rows': 'table',
  'Notebook text and comments': 'comment',
  Records: 'box',
  Files: 'download',
  Templates: 'template',
}

/** Human type of a record kind, for the identifier suggestion line. */
const SUGGESTION_KIND_LABELS: Record<string, string> = {
  sample: 'Sample',
  material: 'Material',
  experiment: 'Experiment',
  protocol_template: 'Protocol',
  report: 'Report',
  study: 'Study',
  file: 'File',
}

type PaletteEntry =
  | { type: 'result'; result: SearchResult }
  | { type: 'action'; action: SearchContextAction }

type PaletteRow =
  | { kind: 'header'; label: string; count?: number }
  | {
      kind: 'result'
      entry: PaletteEntry
      index: number
      group: SearchResultGroup
    }
  | { kind: 'action'; entry: PaletteEntry; index: number }

export function SearchPalette({
  open: openProp,
  onOpenChange,
  initialQuery = '',
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialQuery?: string
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const navigate = useNavigate()
  const listId = useId()
  const [q, setQ] = useState(initialQuery)
  const [scope, setScope] = useState<string>(SEARCH_SCOPE_ALL)
  // Archived scope: pushed to the search boundary, never a browser-side
  // filter. Off by default, matching the results page.
  const [archived, setArchived] = useState(false)
  const [res, setRes] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [searching, setSearching] = useState(false)
  const [suggestion, setSuggestion] = useState<DidYouMeanSuggestion | null>(
    null,
  )
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // A response must not write into the palette once a newer search, or the
  // close that follows it, has superseded it.
  const searchGeneration = useRef(0)
  const projects = useProjectNameMap()

  const reset = () => {
    searchGeneration.current += 1
    setQ(initialQuery)
    setScope(SEARCH_SCOPE_ALL)
    setArchived(false)
    setRes(null)
    setError(null)
    setSearching(false)
    setSuggestion(null)
  }

  const setOpen = (o: boolean) => {
    onOpenChange?.(o)
    if (openProp === undefined) setOpenState(o)
    if (!o) reset()
  }

  // The palette's search: the failure is kept so the palette can say what
  // happened and offer the retry, rather than leaving an empty listbox.
  const runSearch = useCallback(
    (term: string, nextScope: string, nextArchived: boolean) => {
      const generation = (searchGeneration.current += 1)
      setSearching(true)
      setError(null)
      void executeSearch(notebookDataClient, {
        query: term,
        limit: FETCH_LIMIT,
        projectId: nextScope === SEARCH_SCOPE_ALL ? undefined : nextScope,
        includeArchived: nextArchived,
      })
        .then((rows) => {
          if (generation !== searchGeneration.current) return
          setRes(rows)
          setSearching(false)
          setActive(0)
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

  // Esc is owned by the Dialog primitive, which calls onOpenChange(false).
  // Capture the previously focused element before moving focus into the
  // search input, then restore it when the palette closes. The input has no
  // `autoFocus` so this capture still sees the pre-open element.
  useEffect(() => {
    if (open) {
      const el = document.activeElement
      restoreFocusRef.current =
        el instanceof HTMLElement && el !== inputRef.current ? el : null
      inputRef.current?.focus()
    } else {
      restoreFocusRef.current?.focus()
    }
  }, [open])

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
    const t = setTimeout(() => runSearch(term, scope, archived), 120)
    return () => {
      searchGeneration.current += 1
      clearTimeout(t)
    }
  }, [q, open, scope, archived, runSearch])

  // When a query genuinely finds nothing the palette offers a corrected
  // identifier, resolved at the canonical search boundary
  // (`api.search_did_you_mean`), so a suggestion never names an object the
  // person cannot see. Accepting it navigates through `/records/$recordId`,
  // where the existing identifier resolver turns the display id into its row.
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term || res === null || res.length > 0) {
      setSuggestion(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      void searchDidYouMean(notebookDataClient, term, archived).then((rows) => {
        if (live) setSuggestion(rows[0] ?? null)
      })
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open, res, archived])

  const items = res ?? []
  // The chosen project's name, so the empty state can name the scope rather
  // than the id it was chosen by.
  const scopeLabel =
    scope === SEARCH_SCOPE_ALL ? null : (projects.data?.get(scope) ?? null)
  const scoped = useMemo(
    () =>
      filterBySearchScope(
        items,
        scope === SEARCH_SCOPE_ALL ? undefined : scope,
      ),
    [items, scope],
  )
  const buckets = useMemo(() => {
    // The palette is a jump list, so its rows follow relevance, not the results
    // page's fixed section order: grouping a weak sheet or dataset hit into the
    // second section would put it above the record that matched the query best.
    // The list is ranked by the canonical tiers (exact identifier, then title,
    // then structured, then text) and each section sits where its best row
    // does, with the canonical order left as the tie-break.
    const ranked = rankByTier(scoped, q.trim())
    const grouped = groupSearchResults(ranked, MAX_PER_GROUP)
    const sectionAt = new Map<SearchResultGroup, number>()
    ranked.forEach((result, index) => {
      const group = searchResultGroup(result)
      if (!sectionAt.has(group)) sectionAt.set(group, index)
    })
    return [...grouped].sort(
      (a, b) => (sectionAt.get(a.group) ?? 0) - (sectionAt.get(b.group) ?? 0),
    )
  }, [scoped, q])
  const actions = useMemo(() => contextualSearchActions(scoped), [scoped])
  const rows = useMemo<PaletteRow[]>(() => {
    const out: PaletteRow[] = []
    let index = 0
    for (const bucket of buckets) {
      out.push({ kind: 'header', label: bucket.group, count: bucket.total })
      for (const result of bucket.results) {
        out.push({
          kind: 'result',
          entry: { type: 'result', result },
          index: index++,
          group: bucket.group,
        })
      }
    }
    if (actions.length) {
      out.push({ kind: 'header', label: 'Actions' })
      for (const action of actions) {
        out.push({
          kind: 'action',
          entry: { type: 'action', action },
          index: index++,
        })
      }
    }
    return out
  }, [buckets, actions])
  const entryCount = rows.reduce(
    (n, row) => (row.kind === 'header' ? n : n + 1),
    0,
  )
  const entries = useMemo(
    () => rows.flatMap((row) => (row.kind === 'header' ? [] : [row.entry])),
    [rows],
  )
  const activeIndex = entryCount ? active % entryCount : 0

  const go = (result: SearchResult, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(result.deepLink, window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    setOpen(false)
    void navigate({ to: result.deepLink as never })
  }

  const runAction = (action: SearchContextAction, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(searchActionHref(action), window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    setOpen(false)
    void navigate({
      to: action.to as never,
      search: action.search as never,
    })
  }

  const activate = (entry: PaletteEntry | undefined, newTab = false) => {
    if (!entry) return
    if (entry.type === 'result') go(entry.result, newTab)
    else runAction(entry.action, newTab)
  }

  const seeAll = () => {
    setOpen(false)
    void navigate({ to: '/search', search: { q: q.trim() } })
  }

  // Accepting the correction navigates by display identifier; the record route
  // resolves it through the canonical identifier resolver (`/records/$recordId`
  // → resolveIdentifierParam), so a mistyped id lands on the real object or on
  // nothing at all — never on a different one.
  const acceptSuggestion = (s: DidYouMeanSuggestion) => {
    setOpen(false)
    void navigate({
      to: '/records/$recordId',
      params: { recordId: s.identifier },
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!entryCount) return
      const n =
        (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + entryCount) %
        entryCount
      setActive(n)
      listRef.current
        ?.querySelector(`[data-index="${n}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (entryCount) activate(entries[activeIndex], e.metaKey || e.ctrlKey)
      else if (q.trim()) seeAll()
    }
  }

  const totalCount = items[0]?.totalCount
  const seeAllLabel =
    scope === SEARCH_SCOPE_ALL && totalCount
      ? `See all ${totalCount} results`
      : 'See all results'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-20 w-[min(640px,calc(100vw-32px))] max-md:inset-0 max-md:max-h-dvh max-md:rounded-none max-md:border-0"
        aria-label="Search"
      >
        <DialogPrimitive.Title className="sr-only">
          Search Sheetbase
        </DialogPrimitive.Title>
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle px-3.5 max-md:h-14">
          <Icon name="search" size={16} className="text-fg-muted" />
          <label className="flex-1">
            <span className="sr-only">Search</span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search experiments, samples, datasets"
              role="combobox"
              aria-expanded={entryCount > 0}
              aria-controls={listId}
              aria-activedescendant={
                entryCount ? `${listId}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              className="w-full border-0 bg-transparent font-sans text-[15px] text-fg outline-none placeholder:text-fg-faint"
            />
          </label>
          <label className="shrink-0">
            <span className="sr-only">Scope</span>
            <NativeSelect
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Search scope"
              className="w-[150px] max-md:w-[128px]"
            >
              <option value={SEARCH_SCOPE_ALL}>In: all projects</option>
              {[...(projects.data ?? new Map()).entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  In: {name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <button
            type="button"
            aria-pressed={archived}
            onClick={() => setArchived((a) => !a)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-label text-fg hover:bg-surface-hover max-md:hidden [&_svg]:text-fg-muted',
              archived &&
                'border-selection-border bg-selection font-medium hover:bg-selection',
            )}
          >
            <Icon name="archive" size={12} />
            Include archived
          </button>
          <DialogPrimitive.Close className="inline-flex h-9 cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-body text-link md:hidden">
            Cancel
          </DialogPrimitive.Close>
        </div>
        {error ? (
          <div role="alert" className="flex flex-col gap-2.5 px-5 py-7">
            <div className="font-semibold">Search could not run</div>
            <div className="text-body leading-[19px] text-fg-muted">
              The search service did not answer, so nothing was searched.
            </div>
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => runSearch(q.trim(), scope, archived)}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : res !== null && q.trim() && entryCount === 0 && !searching ? (
          <div role="status" className="flex flex-col gap-2.5 px-5 py-7">
            {items.length > 0 ? (
              <>
                <div className="font-semibold">
                  No matches in {scopeLabel ?? 'this project'}
                </div>
                <div className="text-body leading-[19px] text-fg-muted">
                  {items.length}{' '}
                  {items.length === 1 ? 'match is' : 'matches are'} for “
                  {q.trim()}” outside {scopeLabel ?? 'it'}.
                </div>
                <div className="text-body">
                  <button
                    type="button"
                    onClick={() => setScope(SEARCH_SCOPE_ALL)}
                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
                  >
                    Search all projects
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">No matches for “{q.trim()}”</div>
                <div className="text-body leading-[19px] text-fg-muted">
                  Nothing in names, IDs, cell values, comments or files you can
                  access.
                </div>
                {suggestion ? (
                  <div className="text-body">
                    Did you mean{' '}
                    <button
                      type="button"
                      onClick={() => acceptSuggestion(suggestion)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-medium text-link hover:underline"
                    >
                      {suggestion.identifier}
                    </button>
                    ?{' '}
                    <span className="text-fg-muted">
                      {suggestion.title} ·{' '}
                      {SUGGESTION_KIND_LABELS[suggestion.kind] ??
                        suggestion.kind}
                    </span>
                  </div>
                ) : null}
                <div className="text-label text-fg-muted">
                  {archived ? (
                    <>
                      Archived work searched too: still no matches for “
                      {q.trim()}”.
                    </>
                  ) : (
                    <>
                      Archived work isn’t searched.{' '}
                      <button
                        type="button"
                        onClick={() => setArchived(true)}
                        className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
                      >
                        Include archived
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            aria-busy={searching}
            className="max-h-[440px] overflow-auto pb-2 pt-1 max-md:max-h-none max-md:min-h-0 max-md:flex-1"
          >
            {!q.trim() ? (
              <div className="px-3.5 py-6 text-body text-fg-muted">
                Type an ID like <span className="mono">EXP-0001</span>, a name,
                or a value like <span className="mono">C-150</span>.
              </div>
            ) : null}
            {searching ? (
              <div role="status" className="px-3.5 py-3 text-body text-fg-muted">
                Searching…
              </div>
            ) : null}
            {rows.map((row) => {
              if (row.kind === 'header') {
                return (
                  <div
                    key={`header-${row.label}`}
                    role="presentation"
                    className="flex justify-between px-3.5 pb-1 pt-2 text-[11px] font-medium text-fg-muted"
                  >
                    <span>{row.label}</span>
                    {row.count !== undefined ? (
                      <span className="num">{row.count}</span>
                    ) : null}
                  </div>
                )
              }
              const isActive = row.index === activeIndex
              const result =
                row.entry.type === 'result' ? row.entry.result : null
              const action =
                row.entry.type === 'action' ? row.entry.action : null
              const group = row.kind === 'result' ? row.group : null
              const label = result ? searchResultLabel(result) : null
              return (
                <div
                  key={
                    result
                      ? `${result.resultType}-${result.recordId}`
                      : action?.id
                  }
                  id={`${listId}-${row.index}`}
                  data-index={row.index}
                  role="option"
                  aria-selected={isActive}
                  onMouseMove={() => setActive(row.index)}
                  onClick={() => activate(row.entry)}
                  className={cn(
                    'mx-1 grid cursor-pointer grid-cols-[20px_1fr_auto] items-start gap-2.5 rounded-md px-2.5 py-1.5 text-body max-md:min-h-12 max-md:py-2',
                    isActive && 'bg-selection',
                  )}
                >
                  <span className="pt-px text-fg-muted">
                    <Icon
                      name={group ? GROUP_ICONS[group] : 'plus'}
                      size={14}
                    />
                  </span>
                  <span className="min-w-0">
                    {result ? (
                      <>
                        {label ? (
                          <span className="mono mr-1.5 text-fg-muted">
                            {label}
                          </span>
                        ) : null}
                        {result.archived ? (
                          <span className="mr-1.5 rounded-sm border border-border px-1 align-middle text-label text-fg-muted">
                            Archived
                          </span>
                        ) : null}
                        <Highlight text={result.title} q={q.trim()} />
                        <span className="block truncate text-label text-fg-muted">
                          {searchResultContext(
                            result,
                            result.matchedContext,
                          ).map((segment, i) =>
                            segment.highlighted ? (
                              <mark
                                key={i}
                                className="rounded-[2px] bg-highlight px-px text-fg"
                              >
                                {segment.text}
                              </mark>
                            ) : (
                              <span key={i}>{segment.text}</span>
                            ),
                          )}
                        </span>
                      </>
                    ) : (
                      <span>{action?.label}</span>
                    )}
                  </span>
                  {isActive ? <Kbd>↵</Kbd> : <span />}
                </div>
              )
            })}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3.5 border-t border-border-subtle bg-surface-muted px-3.5 py-2 text-label text-fg-muted max-md:min-h-12 max-md:pb-[max(8px,env(safe-area-inset-bottom))]">
          <span className="max-md:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span className="max-md:hidden">
            <Kbd>↵</Kbd> open
          </span>
          <span className="max-md:hidden">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> open in new tab
          </span>
          <span className="max-md:hidden">
            <Kbd>Esc</Kbd> close
          </span>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={seeAll}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {seeAllLabel}
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
