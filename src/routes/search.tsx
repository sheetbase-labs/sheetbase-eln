/**
 * SCI-008 — Knowledge Search route.
 *
 * A dense, full-width search surface for finding records, file metadata and
 * notebook content across a workspace. Follows the "Knowledge Search"
 * mockup: a prominent search bar, type tabs, a faceted filter bar, a left
 * column of recent searches, a divider-separated result list with type
 * indicator, highlighted matched context and inline metadata (identifier,
 * project, last updated), server-side pagination, and a read-only inspector
 * preview for the selected result.
 *
 * Search goes through the same-origin `/api/db/rpc/search` boundary;
 * PostgreSQL and RLS remain authoritative (decision 0033). The route owns
 * its data and passes typed inspector content, reusing the shared
 * Inspector/StatusBadge patterns (ADRs 0010/0011).
 *
 * Design (DESIGN.md / PRODUCT.md): dense never cramped, context stays
 * visible, status never by colour alone, Instrument Sans headings / Inter
 * body, semantic tokens, keyboard accessible (arrow keys + Enter).
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FlaskConical,
  History,
  LayoutTemplate,
  Microscope,
  Beaker,
  ScrollText,
  File as FileIcon,
  Search as SearchIcon,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { Inspector } from '#/components/record/inspector'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusDomain } from '#/components/scientific/status-badge'
import { Badge, Button, Input, Skeleton } from '#/components/ui'
import { cn } from '#/lib/utils'
import { createDataClient, DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  fetchRecord,
  fetchLinksForRecord,
  notebookDataClient,
  notebookQueryKeys,
  recordKindLabel,
  toProject,
} from '#/lib/notebook-data'
import type { ProjectWire } from '#/lib/notebook-data'
import {
  executeSearch,
  matchedFieldLabel,
  parseMatchedContext,
  searchQueryKeys,
  SEARCHABLE_KINDS,
} from '#/lib/search'
import type { SearchFilters, SearchResult } from '#/lib/search'

// ---------------------------------------------------------------------------
// Auth context (same pattern as /templates).
// ---------------------------------------------------------------------------

const getSearchContext = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  return getCurrentContext(getRequestHeaders())
})

export const Route = createFileRoute('/search')({
  beforeLoad: async () => {
    const context = await getSearchContext()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SearchRoute,
})

// ---------------------------------------------------------------------------
// Kind → icon / status-domain / label maps.
// ---------------------------------------------------------------------------

const KIND_ICON: Record<string, LucideIcon> = {
  experiment: FlaskConical,
  sample: Microscope,
  reagent: Beaker,
  protocol_template: ScrollText,
  report: FileText,
  file: FileIcon,
  notebook_template: LayoutTemplate,
}

const KIND_STATUS_DOMAIN: Partial<Record<string, StatusDomain>> = {
  experiment: 'experiment',
  sample: 'sample',
  reagent: 'reagent',
  protocol_template: 'protocol',
  notebook_template: 'notebook_template',
  report: 'experiment',
  file: 'dataset',
}

const KIND_FILTER_LABELS: Record<string, string> = {
  experiment: 'Experiments',
  sample: 'Samples',
  reagent: 'Reagents',
  protocol_template: 'Protocols',
  report: 'Reports',
  file: 'Files',
  notebook_template: 'Templates',
}

const DEBOUNCE_MS = 300
const PAGE_SIZE = 20

export type SortKey = 'relevance' | 'updated'

// ---------------------------------------------------------------------------
// Recent searches (client-side, localStorage).
// ---------------------------------------------------------------------------

interface RecentSearch {
  q: string
  ts: number
}

const RECENT_KEY = 'sheetbase-recent-searches'
const RECENT_MAX = 8

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (r) => r && typeof r.q === 'string' && typeof r.ts === 'number',
          )
          .slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function useRecentSearches() {
  const [recent, setRecent] = useState<RecentSearch[]>([])

  useEffect(() => {
    setRecent(loadRecentSearches())
  }, [])

  const add = useCallback((q: string) => {
    const query = q.trim()
    if (!query) return
    setRecent((prev) => {
      const next = [
        { q: query, ts: Date.now() },
        ...prev.filter((r) => r.q !== query),
      ].slice(0, RECENT_MAX)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* ignore: private mode / disabled storage */
      }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  return { recent, add, clear }
}

// ---------------------------------------------------------------------------
// Time formatting.
// ---------------------------------------------------------------------------

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString()
}

function relativeUpdatedAt(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  return `Updated ${relativeTime(ts)}`
}

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

function SearchRoute() {
  const { context } = Route.useRouteContext()
  const client = useMemo(() => createDataClient(), [])

  // Query + filter state.
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [projectId, setProjectId] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Pagination + sort.
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<SortKey>('relevance')

  // Selected result for inspector preview.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // Keyboard navigation.
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    recent,
    add: addRecentSearch,
    clear: clearRecentSearches,
  } = useRecentSearches()

  // Debounce the query so we don't fire an RPC per keystroke.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(
      () => setDebouncedQuery(query),
      DEBOUNCE_MS,
    )
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [query])

  // Reset to the first page whenever a filter dimension changes.
  useEffect(() => {
    setPage(0)
  }, [debouncedQuery, projectId, kind, status, dateFrom, dateTo])

  const filters: SearchFilters = useMemo(
    () => ({
      query: debouncedQuery,
      projectId: projectId || undefined,
      kind: kind || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedQuery, projectId, kind, status, dateFrom, dateTo, page],
  )

  // Search query.
  const searchQuery = useQuery({
    queryKey: searchQueryKeys.search(filters),
    queryFn: () => executeSearch(client, filters),
    // Keep results fresh; search is real-time (no stale index).
    staleTime: 0,
  })

  // Projects list for the project filter + name resolution.
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: async () => {
      return notebookDataClient
        .list<ProjectWire>('projects', '?order=created_at.desc')
        .then((rows) => rows.map(toProject))
    },
  })

  const projectNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projectsQuery.data ?? []) map.set(p.id, p.title)
    return map
  }, [projectsQuery.data])

  const results = searchQuery.data ?? []
  const totalCount = results[0]?.totalCount ?? 0
  const hasQuery = debouncedQuery.trim() !== ''
  const projects = projectsQuery.data ?? []

  // Reset active index when results change.
  useEffect(() => {
    setActiveIndex(0)
  }, [searchQuery.data])

  const selectedResult = selectedId
    ? (results.find((r) => r.recordId === selectedId) ?? null)
    : null

  function selectResult(result: SearchResult) {
    setSelectedId(result.recordId)
    setInspectorOpen(true)
  }

  // Submit the query immediately (Search button / Enter) and record it.
  function submitQuery() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    setDebouncedQuery(query)
    if (query.trim()) addRecentSearch(query)
  }

  // Keyboard navigation within the results list.
  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex < results.length) selectResult(results[activeIndex])
    }
  }

  function clearFilters() {
    setProjectId('')
    setKind('')
    setStatus('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = projectId || kind || status || dateFrom || dateTo

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  const inspector = selectedResult ? (
    <SearchResultInspector
      result={selectedResult}
      client={notebookDataClient}
      projectName={projectNames.get(selectedResult.projectId) ?? null}
      onClose={() => {
        setSelectedId(null)
        setInspectorOpen(false)
      }}
    />
  ) : null

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Search' }]}
      inspector={inspector}
      inspectorLabel={inspectorOpen ? 'Search preview' : 'Inspector'}
    >
      <div className="flex flex-col gap-4">
        {/* Page heading — compact, per DESIGN.md (no marketing-scale type). */}
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
              Knowledge search
            </h1>
            <p className="text-sm text-muted-foreground">
              Find records, files and notebook content across your workspace.
            </p>
          </div>
        </header>

        {/* Prominent search bar */}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitQuery()
          }}
        >
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Let the form submit handler run (records recent search).
                  return
                }
                if (e.key === 'ArrowDown' && results.length > 0) {
                  e.preventDefault()
                  listRef.current?.focus()
                }
              }}
              placeholder="Search by title, identifier, notebook text, file name…"
              aria-label="Search query"
              className="h-12 pl-11 pr-9 text-base shadow-xs"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <Button type="submit" className="h-12 px-5">
            <SearchIcon className="size-4" />
            Search
          </Button>
        </form>

        {/* Type tabs */}
        <div
          role="tablist"
          aria-label="Filter by type"
          className="flex flex-wrap items-center gap-1 border-b border-border"
        >
          <TypeTab
            label="All"
            active={kind === ''}
            onClick={() => setKind('')}
          />
          {SEARCHABLE_KINDS.map((k) => (
            <TypeTab
              key={k}
              label={KIND_FILTER_LABELS[k] ?? k}
              active={kind === k}
              onClick={() => setKind(k)}
            />
          ))}
        </div>

        {/* Filter bar + results / facets split */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Left facets column: recent searches */}
          <aside className="hidden w-56 shrink-0 lg:block">
            <RecentSearches
              recent={recent}
              onPick={(q) => {
                setQuery(q)
                if (debounceTimer.current) clearTimeout(debounceTimer.current)
                setDebouncedQuery(q)
              }}
              onClear={clearRecentSearches}
            />
          </aside>

          {/* Results column */}
          <div className="min-w-0 flex-1">
            {/* Filter bar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FilterSelect
                id="filter-project"
                label="Filter by project"
                placeholder="Project: All"
                value={projectId}
                onChange={setProjectId}
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.title,
                }))}
              />
              <FilterSelect
                id="filter-status"
                label="Filter by status"
                placeholder="Status: All"
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
              <label htmlFor="filter-date-from" className="sr-only">
                Date from
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Date from"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <label htmlFor="filter-date-to" className="sr-only">
                Date to
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Date to"
              />
              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9"
                >
                  Clear filters
                </Button>
              ) : null}
            </div>

            <SearchResults
              query={searchQuery}
              queryString={debouncedQuery}
              hasQuery={hasQuery}
              totalCount={totalCount}
              results={results}
              selectedId={selectedId}
              activeIndex={activeIndex}
              onSelect={selectResult}
              listRef={listRef}
              onKeyDown={handleListKeyDown}
              projectNames={projectNames}
              sort={sort}
              onSortChange={setSort}
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Type tab.
// ---------------------------------------------------------------------------

function TypeTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Filter select (styled native select — accessible, keyboard friendly).
// ---------------------------------------------------------------------------

function FilterSelect({
  id,
  label,
  placeholder,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  )
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'planned', label: 'Planned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'locked', label: 'Locked' },
  { value: 'available', label: 'Available' },
  { value: 'active', label: 'Active' },
  { value: 'validated', label: 'Validated' },
  { value: 'consumed', label: 'Consumed' },
  { value: 'expired', label: 'Expired' },
  { value: 'quarantined', label: 'Quarantined' },
  { value: 'paused', label: 'Paused' },
  { value: 'failed', label: 'Failed' },
]

// ---------------------------------------------------------------------------
// Recent searches facet.
// ---------------------------------------------------------------------------

function RecentSearches({
  recent,
  onPick,
  onClear,
}: {
  recent: RecentSearch[]
  onPick: (q: string) => void
  onClear: () => void
}) {
  if (recent.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-sidebar p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <History className="size-3.5" aria-hidden /> Recent searches
        </div>
        <p className="text-xs text-muted-foreground">
          No recent searches yet. Your searched terms appear here for quick
          reuse.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <History className="size-3.5" aria-hidden /> Recent searches
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>
      <ul className="space-y-0.5">
        {recent.map((r) => (
          <li key={`${r.q}-${r.ts}`}>
            <button
              type="button"
              onClick={() => onPick(r.q)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-sidebar-accent/60"
            >
              <Clock
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{r.q}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {relativeTime(r.ts)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results list with loading/empty/error states, sort and pagination.
// ---------------------------------------------------------------------------

export interface SearchResultsProps {
  query: ReturnType<typeof useQuery<SearchResult[], Error>>
  queryString: string
  hasQuery: boolean
  totalCount: number
  results: SearchResult[]
  selectedId: string | null
  activeIndex: number
  onSelect: (result: SearchResult) => void
  listRef: React.RefObject<HTMLUListElement | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  /** Optional project-id → title map for the result metadata footer. */
  projectNames?: Map<string, string>
  /** Optional sort control. */
  sort?: SortKey
  onSortChange?: (sort: SortKey) => void
  /** Optional pagination control. */
  page?: number
  pageSize?: number
  onPageChange?: (page: number) => void
}

export function SearchResults({
  query: searchQuery,
  queryString,
  hasQuery,
  totalCount,
  results,
  selectedId,
  activeIndex,
  onSelect,
  listRef,
  onKeyDown,
  projectNames,
  sort,
  onSortChange,
  page = 0,
  pageSize = PAGE_SIZE,
  onPageChange,
}: SearchResultsProps) {
  if (searchQuery.isLoading) {
    return (
      <div
        className="divide-y divide-border rounded-lg border border-border"
        aria-label="Loading search results"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 p-3">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (searchQuery.error) {
    const message =
      searchQuery.error instanceof DataClientError
        ? searchQuery.error.code === 'permission_denied' ||
          searchQuery.error.code === 'unauthenticated'
          ? 'You do not have permission to search this workspace. Sign in and try again.'
          : searchQuery.error.message
        : 'Search failed. Try again.'
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        <AlertCircle className="size-5 shrink-0" />
        <span>{message}</span>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <SearchIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">
          {hasQuery ? 'No results found' : 'Start typing to search'}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasQuery
            ? 'Try different keywords or clear filters.'
            : 'Search records, files and notebook content across your workspace.'}
        </p>
      </div>
    )
  }

  // Client-side sort of the current page. The RPC returns rank; in browse
  // mode rank is 0 so "recently updated" is the useful default there.
  const sorted = sortResults(results, sort, hasQuery)

  const showingFrom = page * pageSize + 1
  const showingTo = Math.min((page + 1) * pageSize, totalCount)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{totalCount}</span>{' '}
          {totalCount === 1 ? 'result' : 'results'}
          {hasQuery ? ' for ' : ' in workspace'}
          {hasQuery ? (
            <span className="font-medium text-foreground">
              &quot;{queryString}&quot;
            </span>
          ) : null}
        </p>
        {onSortChange ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort by
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Sort results"
            >
              <option value="relevance">Relevance</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
        ) : null}
      </div>
      <ul
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label="Search results"
        onKeyDown={onKeyDown}
        className="divide-y divide-border rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {sorted.map((result, index) => (
          <SearchResultRow
            key={result.recordId}
            result={result}
            selected={result.recordId === selectedId}
            active={index === activeIndex}
            onSelect={() => onSelect(result)}
            projectName={projectNames?.get(result.projectId)}
          />
        ))}
      </ul>
      {onPageChange ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          showingFrom={showingFrom}
          showingTo={showingTo}
          totalCount={totalCount}
          onPageChange={onPageChange}
        />
      ) : null}
    </div>
  )
}

function sortResults(
  results: SearchResult[],
  sort: SortKey | undefined,
  hasQuery: boolean,
): SearchResult[] {
  if (sort === 'updated' || (!hasQuery && sort !== 'relevance')) {
    return [...results].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }
  // relevance: rank desc (RPC already orders by rank, but keep stable).
  return [...results].sort((a, b) => b.rank - a.rank)
}

// ---------------------------------------------------------------------------
// Pagination.
// ---------------------------------------------------------------------------

function Pagination({
  page,
  totalPages,
  showingFrom,
  showingTo,
  totalCount,
  onPageChange,
}: {
  page: number
  totalPages: number
  showingFrom: number
  showingTo: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <p className="text-xs text-muted-foreground">
        Showing {showingFrom}–{showingTo} of {totalCount} results
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <span className="px-2 text-xs text-muted-foreground">
          Page {page + 1} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result row — dense, divider-separated.
// ---------------------------------------------------------------------------

export function SearchResultRow({
  result,
  selected,
  active,
  onSelect,
  projectName,
}: {
  result: SearchResult
  selected: boolean
  active: boolean
  onSelect: () => void
  projectName?: string
}) {
  const Icon = KIND_ICON[result.kind] ?? FileText
  const domain = KIND_STATUS_DOMAIN[result.kind]
  const segments = parseMatchedContext(result.matchedContext)
  const updated = relativeUpdatedAt(result.updatedAt)

  return (
    <li role="option" aria-selected={selected}>
      <Link
        to={result.deepLink}
        onClick={(e) => {
          // Plain click opens the inspector preview; the deep link still
          // navigates on explicit open (middle-click / open-in-new-tab).
          e.preventDefault()
          onSelect()
        }}
        className={cn(
          'flex items-start gap-3 p-3 no-underline transition-colors',
          selected
            ? 'bg-primary/5 ring-1 ring-inset ring-primary/30'
            : active
              ? 'bg-primary/5'
              : 'hover:bg-muted/40',
        )}
      >
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
            selected ? 'bg-primary/10' : 'bg-muted',
          )}
        >
          <Icon
            className={cn(
              'size-4',
              selected ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {/* Type label + status */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {recordKindLabel(result.kind)}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {result.archived ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Archive className="size-3" aria-hidden /> Archived
                </span>
              ) : null}
              {domain ? (
                <StatusBadge domain={domain} status={result.status} size="sm" />
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {result.status}
                </Badge>
              )}
            </div>
          </div>
          {/* Title */}
          <p className="truncate font-medium text-foreground">{result.title}</p>
          {/* Matched context with highlights */}
          {segments.length > 0 ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {segments.map((seg, i) => (
                <span
                  key={i}
                  className={
                    seg.highlighted ? 'font-semibold text-foreground' : ''
                  }
                >
                  {seg.text}
                </span>
              ))}
            </p>
          ) : null}
          {/* Metadata footer: identifier · project · updated · matched field */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{result.identifier}</span>
            {projectName ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{projectName}</span>
              </>
            ) : null}
            {updated ? (
              <>
                <span aria-hidden>·</span>
                <span>{updated}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{matchedFieldLabel(result.matchedField)}</span>
          </div>
        </div>
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Inspector preview — read-only metadata only, no restricted fields.
// ---------------------------------------------------------------------------

function SearchResultInspector({
  result,
  client,
  projectName,
  onClose,
}: {
  result: SearchResult
  client: DataClient
  projectName: string | null
  onClose: () => void
}) {
  // Fetch the live record (RLS-guarded) for the inspector header. This is
  // the same metadata a user sees on the record's own page; no restricted
  // file bytes or block payloads are rendered here.
  const recordQuery = useQuery({
    queryKey: notebookQueryKeys.record(result.recordId),
    queryFn: () => fetchRecord(client, result.recordId),
    enabled: Boolean(result.recordId),
  })
  const linksQuery = useQuery({
    queryKey: notebookQueryKeys.links(result.recordId),
    queryFn: () => fetchLinksForRecord(client, result.recordId),
    enabled: Boolean(result.recordId),
  })

  const record = recordQuery.data
  const links = linksQuery.data ?? []
  const domain = KIND_STATUS_DOMAIN[result.kind]

  const propertiesTab = (
    <dl className="space-y-1.5">
      <InspectorProp label="Identifier" mono>
        {result.identifier}
      </InspectorProp>
      <InspectorProp label="Kind">{recordKindLabel(result.kind)}</InspectorProp>
      <InspectorProp label="Status">
        {domain ? (
          <StatusBadge domain={domain} status={result.status} size="sm" />
        ) : (
          <Badge variant="outline" className="text-[10px]">
            {result.status}
          </Badge>
        )}
      </InspectorProp>
      <InspectorProp label="Project">
        {projectName ?? result.projectId}
      </InspectorProp>
      <InspectorProp label="Owner">
        <span className="font-mono text-xs">{result.createdByUserId}</span>
      </InspectorProp>
      <InspectorProp label="Created">
        {new Date(result.createdAt).toLocaleString()}
      </InspectorProp>
      <InspectorProp label="Updated">
        {new Date(result.updatedAt).toLocaleString()}
      </InspectorProp>
      {result.archived ? (
        <InspectorProp label="Archived">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Archive className="size-3" aria-hidden /> This record is archived
          </span>
        </InspectorProp>
      ) : null}
      {record?.tags && record.tags.length > 0 ? (
        <InspectorProp label="Tags">
          <span className="flex flex-wrap gap-1">
            {record.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px]"
              >
                {tag}
              </span>
            ))}
          </span>
        </InspectorProp>
      ) : null}
    </dl>
  )

  const linksTab = linksQuery.isLoading ? (
    <p className="text-sm text-muted-foreground">Loading links…</p>
  ) : links.length === 0 ? (
    <p className="text-sm text-muted-foreground">No outgoing links.</p>
  ) : (
    <ul className="space-y-1">
      {links.map((link) => (
        <li key={link.id} className="flex items-center justify-between text-sm">
          <span className="font-mono text-xs text-muted-foreground">
            {link.targetIdentifier}
          </span>
          <span className="text-xs text-muted-foreground">{link.linkType}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <Inspector
      recordType={recordKindLabel(result.kind)}
      title={result.title}
      state={recordQuery.isLoading && !record ? 'skeleton' : 'loaded'}
      onClose={onClose}
      tabs={[
        { id: 'properties', label: 'Properties', content: propertiesTab },
        { id: 'links', label: 'Links', badge: links.length, content: linksTab },
      ]}
    />
  )
}

function InspectorProp({
  label,
  mono,
  children,
}: {
  label: string
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right', mono && 'font-mono text-xs')}>
        {children}
      </dd>
    </div>
  )
}
