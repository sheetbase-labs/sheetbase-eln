/**
 * SCI-008 — Knowledge Search route.
 *
 * A dense, full-width search surface for finding records, file metadata and
 * notebook content across a workspace. Follows the "Knowledge Search"
 * mockup: a prominent search bar, type tabs with per-type counts, a faceted
 * filter bar (project / status / owner / date range), a left column of recent
 * searches, a divider-separated result list with type indicator, highlighted
 * matched context and inline metadata (identifier, project, owner, last
 * updated), and a read-only inspector preview for the selected result.
 *
 * Filtering model: the route fires a single `api.search` RPC per query
 * (limit 200) and applies every facet — type, project, status, owner, date
 * range — client-side on the fetched set. This keeps per-type tab counts and
 * facet option lists consistent with the displayed results and avoids an RPC
 * round-trip per filter click. PostgreSQL and RLS remain authoritative
 * (decision 0033); the route owns its data and passes typed inspector
 * content, reusing the shared Inspector/StatusBadge patterns (ADRs 0010/0011).
 *
 * Design (DESIGN.md / PRODUCT.md): dense never cramped, context stays
 * visible, status never by colour alone, Instrument Sans headings / Inter
 * body, semantic tokens, keyboard accessible (arrow keys + Enter).
 */
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  FlaskConical,
  History,
  LayoutTemplate,
  Lightbulb,
  MessageSquare,
  Microscope,
  Pencil,
  Beaker,
  ScrollText,
  File as FileIcon,
  Search as SearchIcon,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { Inspector } from '#/components/record/inspector'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusDomain } from '#/components/scientific/status-badge'
import { Badge, Button, Input, Select, Skeleton } from '#/components/ui'
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
import type { NotebookLink, ProjectWire } from '#/lib/notebook-data'
import {
  deleteSavedQuery,
  deriveSuggestions,
  executeSearch,
  loadSavedQueries,
  matchedFieldLabel,
  parseMatchedContext,
  parseSearchUrl,
  rankByTier,
  saveQuery,
  searchQueryKeys,
  SEARCHABLE_KINDS,
  serializeSearchUrl,
} from '#/lib/search'
import type {
  SavedQuery,
  SearchFilters,
  SearchResult,
  SearchSuggestion,
  SearchUrlParams,
} from '#/lib/search'

export const Route = createFileRoute('/search')({
  // SEARCH-001: filter and query state lives in the URL so searches are
  // shareable. Only public filter dimensions are stored — no tokens, session
  // IDs, or secrets. Project/record IDs are already part of the public URL
  // space (project deep links use them).
  validateSearch: (search: Record<string, unknown>) => parseSearchUrl(search),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
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
const FETCH_LIMIT = 200
const PAGE_SIZE = 20

export type SortKey = 'relevance' | 'updated'

type DateRangeKey = '7d' | '30d' | 'year' | 'all'

const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
]

// ---------------------------------------------------------------------------
// Recent searches (client-side, localStorage).
// ---------------------------------------------------------------------------

interface RecentSearch {
  q: string
  ts: number
}

const RECENT_KEY = 'sheetbase-recent-searches'
const RECENT_MAX = 5

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
    const next = [
      { q: query, ts: Date.now() },
      ...recent.filter((r) => r.q !== query),
    ].slice(0, RECENT_MAX)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      /* ignore: private mode / disabled storage */
    }
  }, [recent])

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
// Time formatting + owner label helpers.
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
  if (day < 14) return 'Yesterday'
  return new Date(ts).toLocaleDateString()
}

function relativeUpdatedAt(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  return `Updated ${relativeTime(ts)}`
}

/**
 * Short, stable label for a user id when no directory lookup is available.
 * Falls back to a readable slice of the id.
 */
function ownerLabel(userId: string, name?: string): string {
  if (name) return name
  if (!userId) return 'Unknown'
  return userId.length <= 8 ? userId : userId.slice(0, 8)
}

/** Two-letter initials for an avatar, derived from a name or user id. */
function ownerInitials(userId: string, name?: string): string {
  if (name) {
    const parts = name.split(/[\s_.-]+/).filter(Boolean)
    const init = parts
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('')
    if (init) return init
  }
  if (!userId) return '?'
  const clean = userId.replace(/[^a-zA-Z0-9]/g, '')
  return clean.slice(0, 2).toUpperCase() || 'U'
}

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

function SearchRoute() {
  const { context } = Route.useRouteContext()
  const client = useMemo(() => createDataClient(), [])
  const navigate = useNavigate()

  // ---- URL-derived state (shareable, no secrets) -------------------------
  const urlSearch = Route.useSearch()
  const query = urlSearch.q
  const kind = urlSearch.kind
  const projectId = urlSearch.project
  const status = urlSearch.status
  const ownerId = urlSearch.owner
  const dateRange = urlSearch.date as DateRangeKey
  const sort = urlSearch.sort as SortKey
  const selectedId = urlSearch.selected || null

  // Local input state for the text field (debounced → URL).
  const [inputValue, setInputValue] = useState(query)
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local input when the URL q changes externally (saved query click,
  // recent search pick, back/forward navigation).
  useEffect(() => {
    setInputValue(query)
    setDebouncedQuery(query)
  }, [query])

  // Debounce input → update URL q (and thus the search query).
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    // Only debounce if the input differs from the URL (avoid loops).
    if (inputValue === query) return
    debounceTimer.current = setTimeout(() => {
      void navigate({
        to: '/search',
        search: serializeSearchUrl({
          ...urlSearch,
          q: inputValue,
          selected: '',
        }),
        replace: true,
      })
    }, DEBOUNCE_MS)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [inputValue, query, urlSearch, navigate])

  // Pagination (local state — reset on filter changes).
  const [page, setPage] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // Keyboard navigation.
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    recent,
    add: addRecentSearch,
    clear: clearRecentSearches,
  } = useRecentSearches()

  // ---- Saved queries (localStorage, per workspace) -----------------------
  const workspaceId = context.workspace?.id ?? 'default'
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])

  useEffect(() => {
    setSavedQueries(loadSavedQueries(workspaceId))
  }, [workspaceId])

  const handleSaveQuery = useCallback(() => {
    const name = query.trim() || 'Untitled search'
    const next = saveQuery(workspaceId, {
      name,
      query: query,
      kind,
      projectId,
      status,
      ownerId,
      dateRange: dateRange,
    })
    setSavedQueries(next)
  }, [workspaceId, query, kind, projectId, status, ownerId, dateRange])

  const handleDeleteSavedQuery = useCallback(
    (id: string) => {
      const next = deleteSavedQuery(workspaceId, id)
      setSavedQueries(next)
    },
    [workspaceId],
  )

  const handleApplySavedQuery = useCallback(
    (sq: SavedQuery) => {
      void navigate({
        to: '/search',
        search: serializeSearchUrl({
          q: sq.query,
          kind: sq.kind,
          project: sq.projectId,
          status: sq.status,
          owner: sq.ownerId,
          date: sq.dateRange,
          sort: 'relevance',
          selected: '',
        }),
        replace: false,
      })
    },
    [navigate],
  )

  // Helper: navigate to update a single filter dimension.
  function updateFilter(key: keyof SearchUrlParams, value: string) {
    void navigate({
      to: '/search',
      search: serializeSearchUrl({
        ...urlSearch,
        [key]: value,
        selected: key === 'selected' ? value : '',
      }),
      replace: false,
    })
  }

  // Reset to the first page whenever a filter dimension changes.
  useEffect(() => {
    setPage(0)
  }, [debouncedQuery, kind, projectId, status, ownerId, dateRange])

  const hasQuery = debouncedQuery.trim() !== ''

  // Single search fetch — no facet params; all filtering is client-side so
  // tab counts and facet options stay consistent with the displayed rows.
  const fetchFilters: SearchFilters = useMemo(
    () => ({ query: debouncedQuery, limit: FETCH_LIMIT, offset: 0 }),
    [debouncedQuery],
  )

  const searchQuery = useQuery({
    queryKey: searchQueryKeys.search(fetchFilters),
    queryFn: () => executeSearch(client, fetchFilters),
    // Keep results fresh; search is real-time (no stale index).
    // Use a short staleTime instead of 0 so navigating back to the search
    // tab doesn't force an instant refetch of the same query.
    staleTime: 10_000,
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

  // Owner name resolution. There is no client-side user directory, so the
  // only name we can resolve is the signed-in user's own — which covers the
  // common "my records" case and the seeded demo data. Other owners fall
  // back to a short id slice.
  const ownerNames = useMemo(() => {
    const map = new Map<string, string>()
    if (context.user.id) map.set(context.user.id, context.user.name)
    return map
  }, [context.user.id, context.user.name])

  const allResults = searchQuery.data ?? []

  // ---- Semantic suggestions (derived from RLS-filtered results) ----------
  const suggestions = useMemo(
    () => deriveSuggestions(allResults, debouncedQuery),
    [allResults, debouncedQuery],
  )

  // ---- Client-side derivations -------------------------------------------

  // Per-kind counts across the full fetched set (drive the type tabs).
  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of allResults) {
      counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
    }
    return counts
  }, [allResults])

  // Facet option lists, derived from the fetched results so they always
  // reflect what is actually available to filter.
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of allResults) {
      if (r.projectId && !seen.has(r.projectId)) {
        seen.set(r.projectId, projectNames.get(r.projectId) ?? r.projectId)
      }
    }
    return Array.from(seen, ([value, label]) => ({ value, label }))
  }, [allResults, projectNames])

  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allResults) if (r.status) seen.add(r.status)
    return Array.from(seen).sort()
  }, [allResults])

  const ownerOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allResults)
      if (r.createdByUserId) seen.add(r.createdByUserId)
    return Array.from(seen).sort()
  }, [allResults])

  // Apply every facet client-side.
  const filteredResults = useMemo(() => {
    const now = Date.now()
    const yearStart = new Date(now, 0, 1).getTime()
    const rangeMs: Record<Exclude<DateRangeKey, 'all'>, number> = {
      '7d': 7 * 86_400_000,
      '30d': 30 * 86_400_000,
      year: now - yearStart,
    }
    return allResults.filter((r) => {
      if (kind && r.kind !== kind) return false
      if (projectId && r.projectId !== projectId) return false
      if (status && r.status !== status) return false
      if (ownerId && r.createdByUserId !== ownerId) return false
      if (dateRange !== 'all') {
        const ts = new Date(r.updatedAt).getTime()
        if (Number.isNaN(ts)) return false
        if (dateRange === 'year') {
          if (ts < yearStart) return false
        } else if (now - ts > rangeMs[dateRange]) return false
      }
      return true
    })
  }, [allResults, kind, projectId, status, ownerId, dateRange])

  // SEARCH-001: rank by tier (exact identifier → structured → fuzzy) then
  // by ts_rank, guaranteeing predictable ordering regardless of score
  // variations. Falls back to updated_at sort when sorting by "updated".
  const sortedResults = useMemo(
    () =>
      sort === 'updated'
        ? sortResults(filteredResults, 'updated', hasQuery)
        : rankByTier(filteredResults, debouncedQuery),
    [filteredResults, sort, hasQuery, debouncedQuery],
  )

  const totalCount = sortedResults.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageResults = useMemo(() => {
    const start = page * PAGE_SIZE
    return sortedResults.slice(start, start + PAGE_SIZE)
  }, [sortedResults, page])

  // Reset active index when the displayed page changes.
  useEffect(() => {
    setActiveIndex(0)
  }, [pageResults])

  const selectedResult = selectedId
    ? (allResults.find((r) => r.recordId === selectedId) ?? null)
    : null

  function selectResult(result: SearchResult) {
    updateFilter('selected', result.recordId)
    setInspectorOpen(true)
  }

  // Submit the query immediately (Search button / Enter) and record it.
  function submitQuery() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    // Navigate immediately with the current input value.
    void navigate({
      to: '/search',
      search: serializeSearchUrl({ ...urlSearch, q: inputValue, selected: '' }),
      replace: false,
    })
    if (inputValue.trim()) addRecentSearch(inputValue)
  }

  // Keyboard navigation within the results list.
  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, pageResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex < pageResults.length)
        selectResult(pageResults[activeIndex])
    }
  }

  function clearFilters() {
    void navigate({
      to: '/search',
      search: serializeSearchUrl({
        ...urlSearch,
        kind: '',
        project: '',
        status: '',
        owner: '',
        date: 'all',
        selected: '',
      }),
      replace: false,
    })
  }

  const hasFilters =
    Boolean(kind) ||
    Boolean(projectId) ||
    Boolean(status) ||
    Boolean(ownerId) ||
    dateRange !== 'all'

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
      ownerName={ownerNames.get(selectedResult.createdByUserId) ?? null}
      onClose={() => {
        updateFilter('selected', '')
        setInspectorOpen(false)
      }}
    />
  ) : null

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Search' }],
    inspector: inspector,
    inspectorLabel: inspectorOpen ? 'Search preview' : 'Inspector',
  })

  return (
    <>
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

        {/* Prominent search bar + save query */}
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
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Let the form submit handler run (records recent search).
                  return
                }
                if (e.key === 'ArrowDown' && pageResults.length > 0) {
                  e.preventDefault()
                  listRef.current?.focus()
                }
              }}
              placeholder="Search by title, identifier, notebook text, file name…"
              aria-label="Search query"
              className="h-12 pl-11 pr-9 text-base shadow-xs"
            />
            {inputValue ? (
              <button
                type="button"
                onClick={() => {
                  setInputValue('')
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
          {hasQuery ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 px-3"
              onClick={handleSaveQuery}
              aria-label="Save current search query"
              title="Save query"
            >
              <Bookmark className="size-4" />
            </Button>
          ) : null}
        </form>

        {/* Type tabs with per-type counts */}
        <div
          role="tablist"
          aria-label="Filter by type"
          className="flex flex-wrap items-center gap-1 border-b border-border"
        >
          <TypeTab
            label="All"
            count={allResults.length}
            active={kind === ''}
            onClick={() => updateFilter('kind', '')}
          />
          {SEARCHABLE_KINDS.filter((k) => kindCounts.has(k)).map((k) => (
            <TypeTab
              key={k}
              label={KIND_FILTER_LABELS[k] ?? k}
              count={kindCounts.get(k) ?? 0}
              active={kind === k}
              onClick={() => updateFilter('kind', k)}
            />
          ))}
        </div>

        {/* Filter bar + results / facets split */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Left facets column: suggestions, saved queries, recent searches */}
          <aside className="hidden w-56 shrink-0 space-y-3 lg:block">
            <SemanticSuggestions
              suggestions={suggestions}
              onPick={(s) => {
                void navigate({
                  to: '/search',
                  search: serializeSearchUrl({
                    ...urlSearch,
                    q: s.applyQuery,
                    kind: s.applyKind ?? urlSearch.kind,
                    selected: '',
                  }),
                  replace: false,
                })
                if (s.applyQuery.trim()) addRecentSearch(s.applyQuery)
              }}
            />
            <SavedQueries
              queries={savedQueries}
              onApply={handleApplySavedQuery}
              onDelete={handleDeleteSavedQuery}
            />
            <RecentSearches
              recent={recent}
              onPick={(q) => {
                void navigate({
                  to: '/search',
                  search: serializeSearchUrl({
                    ...urlSearch,
                    q,
                    selected: '',
                  }),
                  replace: false,
                })
                if (q.trim()) addRecentSearch(q)
              }}
              onClear={clearRecentSearches}
            />
          </aside>

          {/* Results column */}
          <div className="min-w-0 flex-1">
            {/* Facet filter bar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FilterSelect
                id="filter-project"
                label="Filter by project"
                value={projectId}
                onChange={(v) => updateFilter('project', v)}
                placeholder="Project: All"
                options={projectOptions}
              />
              <FilterSelect
                id="filter-status"
                label="Filter by status"
                value={status}
                onChange={(v) => updateFilter('status', v)}
                placeholder="Status: All"
                options={statusOptions.map((s) => ({ value: s, label: s }))}
              />
              <FilterSelect
                id="filter-owner"
                label="Filter by owner"
                value={ownerId}
                onChange={(v) => updateFilter('owner', v)}
                placeholder="Owner: All"
                options={ownerOptions.map((o) => ({
                  value: o,
                  label: ownerLabel(o, ownerNames.get(o)),
                }))}
              />
              <FilterSelect
                id="filter-date"
                label="Filter by date range"
                value={dateRange}
                onChange={(v) => updateFilter('date', v)}
                placeholder="Date: Any time"
                options={DATE_RANGE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
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
              results={pageResults}
              selectedId={selectedId}
              activeIndex={activeIndex}
              onSelect={selectResult}
              listRef={listRef}
              onKeyDown={handleListKeyDown}
              projectNames={projectNames}
              ownerNames={ownerNames}
              sort={sort}
              onSortChange={(s) => updateFilter('sort', s)}
              page={page}
              pageSize={PAGE_SIZE}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Type tab with count.
// ---------------------------------------------------------------------------

function TypeTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
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
        '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
          active
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Filter select (styled native select — accessible, keyboard friendly).
// ---------------------------------------------------------------------------

function FilterSelect({
  id,
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  options: { value: string; label: string }[]
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-auto min-w-[9rem]"
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </>
  )
}

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
// SEARCH-001 — Semantic suggestions with clear provenance.
// ---------------------------------------------------------------------------

const SUGGESTION_ICON: Record<SearchSuggestion['kind'], LucideIcon> = {
  identifier: SearchIcon,
  tag: Bookmark,
  type: FlaskConical,
}

function SemanticSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: SearchSuggestion[]
  onPick: (suggestion: SearchSuggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <Lightbulb className="size-3.5" aria-hidden /> Suggestions
      </div>
      <ul className="space-y-0.5">
        {suggestions.map((s) => {
          const Icon = SUGGESTION_ICON[s.kind]
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/60"
                title={s.provenance}
              >
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Icon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                </span>
                <span className="pl-5 text-[11px] text-muted-foreground">
                  {s.provenance}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SEARCH-001 — Saved queries (localStorage, per workspace).
// ---------------------------------------------------------------------------

function SavedQueries({
  queries,
  onApply,
  onDelete,
}: {
  queries: SavedQuery[]
  onApply: (query: SavedQuery) => void
  onDelete: (id: string) => void
}) {
  if (queries.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <Bookmark className="size-3.5" aria-hidden /> Saved queries
      </div>
      <ul className="space-y-0.5">
        {queries.map((sq) => (
          <li key={sq.id} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => onApply(sq)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-sidebar-accent/60"
              title={sq.query || 'Browse all records'}
            >
              <Bookmark
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{sq.name}</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(sq.id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label={`Delete saved query "${sq.name}"`}
            >
              <Trash2 className="size-3" />
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
  /** Optional user-id → name map for owner labels/avatars. */
  ownerNames?: Map<string, string>
  /** Optional sort control. */
  sort?: SortKey
  onSortChange?: (sort: SortKey) => void
  /** Optional pagination control. */
  page?: number
  pageSize?: number
  totalPages?: number
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
  ownerNames,
  sort,
  onSortChange,
  page = 0,
  pageSize = PAGE_SIZE,
  totalPages,
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

  const showingFrom = page * pageSize + 1
  const showingTo = Math.min((page + 1) * pageSize, totalCount)

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
        {results.map((result, index) => (
          <SearchResultRow
            key={result.recordId}
            result={result}
            selected={result.recordId === selectedId}
            active={index === activeIndex}
            onSelect={() => onSelect(result)}
            projectName={projectNames?.get(result.projectId)}
            ownerName={ownerNames?.get(result.createdByUserId)}
          />
        ))}
      </ul>
      {onPageChange ? (
        <Pagination
          page={page}
          totalPages={totalPages ?? 1}
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
  ownerName,
}: {
  result: SearchResult
  selected: boolean
  active: boolean
  onSelect: () => void
  projectName?: string
  ownerName?: string
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
          {/* Title + status / type badges */}
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-foreground">
              {result.title}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] capitalize">
                {recordKindLabel(result.kind)}
              </Badge>
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
          {/* Matched context with highlights (description / excerpt) */}
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
          {/* Metadata footer: id · project · updated · matched field · owner */}
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
            <span aria-hidden className="ml-auto">
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary"
                aria-hidden
              >
                {ownerInitials(result.createdByUserId, ownerName)}
              </span>
              <span className={cn(!ownerName && 'font-mono')}>
                {ownerLabel(result.createdByUserId, ownerName)}
              </span>
            </span>
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
  ownerName,
  onClose,
}: {
  result: SearchResult
  client: DataClient
  projectName: string | null
  ownerName: string | null
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
  const segments = parseMatchedContext(result.matchedContext)

  // Linked-record counts by target kind, for the summary.
  const linkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const link of links) {
      counts.set(link.targetKind, (counts.get(link.targetKind) ?? 0) + 1)
    }
    return counts
  }, [links])

  const propertiesTab = (
    <div className="space-y-3">
      {/* Description / first text excerpt from the matched context. */}
      {segments.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Excerpt
          </p>
          <p className="text-sm text-foreground">
            {segments.map((seg, i) => (
              <span
                key={i}
                className={seg.highlighted ? 'font-semibold text-primary' : ''}
              >
                {seg.text}
              </span>
            ))}
          </p>
        </div>
      ) : null}
      <dl className="space-y-1.5">
        <InspectorProp label="Identifier" mono>
          {result.identifier}
        </InspectorProp>
        <InspectorProp label="Kind">
          {recordKindLabel(result.kind)}
        </InspectorProp>
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
          <span className="inline-flex items-center gap-1.5">
            <span
              className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
              aria-hidden
            >
              {ownerInitials(result.createdByUserId, ownerName ?? undefined)}
            </span>
            <span className={cn('text-xs', !ownerName && 'font-mono')}>
              {ownerLabel(result.createdByUserId, ownerName ?? undefined)}
            </span>
          </span>
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
            <span className="flex flex-wrap justify-end gap-1">
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

      {/* SEARCH-001: linked-record counts (permission-safe — derived from
          RLS-filtered links the caller can already see). */}
      {links.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Linked records
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(linkCounts.entries()).map(([kind, count]) => (
              <span
                key={kind}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground">
                  {KIND_FILTER_LABELS[kind] ?? kind}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {count}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* SEARCH-001: safe quick actions. Only show actions that navigate to
          the record or common operations — no restricted payloads or
          privileged mutations. */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Quick actions
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8" asChild>
            <Link to={result.deepLink}>
              <ExternalLink className="size-3.5" />
              Open
            </Link>
          </Button>
          {!result.archived ? (
            <Button variant="outline" size="sm" className="h-8" asChild>
              <Link to={result.deepLink}>
                <Pencil className="size-3.5" />
                Edit
              </Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="h-8" asChild>
            <Link to={result.deepLink}>
              <MessageSquare className="size-3.5" />
              Add comment
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )

  // SEARCH-001: Links tab with linked-record summary (mini node graph).
  // All links are RLS-filtered — restricted targets are simply absent.
  const linksTab = linksQuery.isLoading ? (
    <p className="text-sm text-muted-foreground">Loading links…</p>
  ) : links.length === 0 ? (
    <p className="text-sm text-muted-foreground">No outgoing links.</p>
  ) : (
    <div className="space-y-3">
      <LinkedRecordSummary
        centerIdentifier={result.identifier}
        centerKind={result.kind}
        links={links}
      />
      <ul className="space-y-1">
        {links.map((link) => (
          <li
            key={link.id}
            className="flex items-center justify-between text-sm"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {link.targetIdentifier}
            </span>
            <span className="text-xs text-muted-foreground">
              {link.linkType}
            </span>
          </li>
        ))}
      </ul>
    </div>
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

// ---------------------------------------------------------------------------
// SEARCH-001 — Linked-record summary: a compact node-link diagram showing
// the selected record at the center with its directly linked records around
// it. All data is RLS-filtered (inaccessible targets are absent, not
// revealed). This mirrors the mockup's "Linked records" graph in the
// inspector.
// ---------------------------------------------------------------------------

function LinkedRecordSummary({
  centerIdentifier,
  centerKind,
  links,
}: {
  centerIdentifier: string
  centerKind: string
  links: NotebookLink[]
}) {
  const CenterIcon = KIND_ICON[centerKind] ?? FileText
  const maxNodes = 8
  const visibleLinks = links.slice(0, maxNodes)

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-col items-center gap-2">
        {/* Center node */}
        <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 ring-1 ring-primary/20">
          <CenterIcon className="size-3.5 text-primary" aria-hidden />
          <span className="font-mono text-xs font-medium text-foreground">
            {centerIdentifier}
          </span>
        </div>
        {/* Connector lines (decorative) */}
        {visibleLinks.length > 0 ? (
          <div className="text-muted-foreground/40" aria-hidden>
            │
          </div>
        ) : null}
        {/* Linked nodes */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {visibleLinks.map((link) => {
            const Icon = KIND_ICON[link.targetKind] ?? FileText
            return (
              <div
                key={link.id}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1"
              >
                <Icon className="size-3 text-muted-foreground" aria-hidden />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {link.targetIdentifier}
                </span>
              </div>
            )
          })}
        </div>
        {links.length > maxNodes ? (
          <p className="text-[11px] text-muted-foreground">
            +{links.length - maxNodes} more
          </p>
        ) : null}
      </div>
    </div>
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
