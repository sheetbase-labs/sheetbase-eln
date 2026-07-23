/**
 * SCI-008 — Scientific search route.
 *
 * Deep-linkable full-page search following the "Knowledge Search" mockup.
 * Lets a workspace member find records, file metadata and notebook content
 * by keyword, filtered by project, type, status, owner and date. Results show
 * a type badge, title, identifier, matched-context snippet, status badge and
 * archived marker. Selecting a result opens a read-only preview in the shared
 * inspector without leaking restricted fields.
 *
 * Search goes through the same-origin `/api/db/rpc/search` boundary; PostgreSQL
 * and RLS remain authoritative (decision 0033). The route owns its data and
 * passes typed inspector content, reusing the shared Inspector/StatusBadge
 * patterns (ADRs 0010/0011).
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  FileText,
  FlaskConical,
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

  // Selected result for inspector preview.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // Keyboard navigation.
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce the query so we don't fire an RPC per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const filters: SearchFilters = useMemo(
    () => ({
      query: debouncedQuery,
      projectId: projectId || undefined,
      kind: kind || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: 50,
    }),
    [debouncedQuery, projectId, kind, status, dateFrom, dateTo],
  )

  // Search query.
  const searchQuery = useQuery({
    queryKey: searchQueryKeys.search(filters),
    queryFn: () => executeSearch(client, filters),
    // Keep results fresh; search is real-time (no stale index).
    staleTime: 0,
  })

  // Projects list for the project filter.
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: async () => {
      return notebookDataClient
        .list<ProjectWire>('projects', '?order=created_at.desc')
        .then((rows) => rows.map(toProject))
    },
  })

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
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Find records, files and notebook content across your workspace.
            Results respect the same permissions as direct access.
          </p>
        </header>

        {/* Search input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && results.length > 0) {
                  e.preventDefault()
                  listRef.current?.focus()
                }
              }}
              placeholder="Search by title, identifier, notebook text, file name…"
              aria-label="Search query"
              className="pl-9 pr-9"
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
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="filter-project" className="sr-only">
            Filter by project
          </label>
          <select
            id="filter-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Project: All</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <label htmlFor="filter-type" className="sr-only">
            Filter by type
          </label>
          <select
            id="filter-type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Type: All</option>
            {SEARCHABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_FILTER_LABELS[k] ?? k}
              </option>
            ))}
          </select>

          <label htmlFor="filter-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Status: All</option>
            <option value="draft">Draft</option>
            <option value="in-progress">In progress</option>
            <option value="available">Available</option>
            <option value="validated">Validated</option>
            <option value="active">Active</option>
            <option value="approved">Approved</option>
            <option value="locked">Locked</option>
          </select>

          <label htmlFor="filter-date-from" className="sr-only">
            Date from
          </label>
          <input
            id="filter-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Date to"
          />

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {/* Results */}
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
        />
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Results list with loading/empty/error states.
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
}: SearchResultsProps) {
  if (searchQuery.isLoading) {
    return (
      <div className="space-y-2" aria-label="Loading search results">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border p-4"
          >
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{totalCount}</span>{' '}
          {totalCount === 1 ? 'result' : 'results'}
          {hasQuery ? ' for ' : ' in workspace'}
          {hasQuery ? (
            <span className="font-medium text-foreground">"{queryString}"</span>
          ) : null}
        </p>
      </div>
      <ul
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label="Search results"
        onKeyDown={onKeyDown}
        className="space-y-2 outline-none"
      >
        {results.map((result, index) => (
          <SearchResultRow
            key={result.recordId}
            result={result}
            selected={result.recordId === selectedId}
            active={index === activeIndex}
            onSelect={() => onSelect(result)}
          />
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result row.
// ---------------------------------------------------------------------------

export function SearchResultRow({
  result,
  selected,
  active,
  onSelect,
}: {
  result: SearchResult
  selected: boolean
  active: boolean
  onSelect: () => void
}) {
  const Icon = KIND_ICON[result.kind] ?? FileText
  const domain = KIND_STATUS_DOMAIN[result.kind]
  const segments = parseMatchedContext(result.matchedContext)

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
          'flex items-start gap-3 rounded-lg border p-4 no-underline transition-colors',
          selected
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
            : active
              ? 'border-primary/50 bg-primary/5'
              : 'border-border hover:bg-muted/50',
        )}
      >
        <div className="mt-0.5 shrink-0 rounded-md bg-muted p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {result.title}
            </span>
            {result.archived ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Archive className="size-3" aria-hidden /> Archived
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {result.identifier}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {recordKindLabel(result.kind)}
            </Badge>
            {domain ? (
              <StatusBadge domain={domain} status={result.status} size="sm" />
            ) : (
              <Badge variant="outline" className="text-[10px]">
                {result.status}
              </Badge>
            )}
          </div>
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
          <p className="text-[11px] text-muted-foreground">
            {matchedFieldLabel(result.matchedField)}
          </p>
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
  onClose,
}: {
  result: SearchResult
  client: DataClient
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
      <InspectorProp label="Project">{result.projectId}</InspectorProp>
      <InspectorProp label="Owner">{result.createdByUserId}</InspectorProp>
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
