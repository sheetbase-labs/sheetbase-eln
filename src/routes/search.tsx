import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Radio, RadioGroup } from '#/components/v3/ui/radio-group'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Icon } from '#/components/v3/icons'
import { Sheet, SheetContent, SheetTrigger } from '#/components/v3/ui/sheet'
import { Highlight } from '#/components/v3/search/highlight'
import {
  searchResultContext,
  searchResultLabel,
} from '#/components/v3/search/result-text'
import { useProjectNameMap } from '#/components/v3/experiments/experiments-data'
import { cn } from '#/lib/utils'
import {
  executeSearch,
  filterSearchResults,
  searchDidYouMean,
  searchQueryKeys,
  searchResultGroup,
  urlFiltersToSearchFilters,
  SEARCH_PAGE_SIZE,
  SEARCH_RESULT_GROUPS,
} from '#/lib/search'
import type { SearchResult, SearchResultGroup } from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the Search results page, wired to the real
 * `search` RPC (records, cell values, comments and file contents) with
 * did-you-mean from `search_did_you_mean`. SRCH-02 pushes the URL facets
 * (type, project, updated) into the RPC and pages with `p_limit`/`p_offset`
 * instead of fetching a fixed 100 rows and slicing locally. */

interface SearchSearch {
  q?: string
  type?: string[]
  project?: string[]
  updated?: 'any' | '7d'
  archived?: boolean
}

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): SearchSearch => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    type: Array.isArray(search.type)
      ? search.type.filter((x): x is string => typeof x === 'string')
      : undefined,
    project: Array.isArray(search.project)
      ? search.project.filter((x): x is string => typeof x === 'string')
      : undefined,
    updated: search.updated === '7d' ? '7d' : undefined,
    archived:
      search.archived === true || search.archived === 'true' || undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SearchPage,
})

/**
 * QA3-search-2 — the number of matches to state. The service's `total_count`
 * is the whole match set for the query and the facets it was given; when a
 * client-side facet has already dropped rows from the loaded page, only the
 * rows in hand can be counted, so the page states that instead of a number it
 * cannot back.
 */
export function searchMatchCount(
  loadedCount: number,
  shownCount: number,
  total: number | undefined,
): number {
  return total !== undefined && loadedCount === shownCount
    ? total
    : shownCount
}

function statusTone(status: string): Tone {
  switch (status) {
    case 'approved':
      return 'ok'
    case 'in_review':
      return 'review'
    case 'in_progress':
      return 'progress'
    case 'archived':
      return 'stored'
    default:
      return 'none'
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function SearchPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const q = search.q ?? ''
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const projectNames = useProjectNameMap()

  // The RPC filters are derived from the URL on every render; TanStack Query
  // hashes the key structurally, so an equal filter set never refetches.
  const baseFilters = urlFiltersToSearchFilters(
    {
      q,
      type: search.type,
      project: search.project,
      updated: search.updated,
      archived: search.archived,
    },
    0,
    SEARCH_PAGE_SIZE,
  )

  const query = useInfiniteQuery({
    queryKey: searchQueryKeys.search(baseFilters),
    queryFn: ({ pageParam }) =>
      executeSearch(notebookDataClient, { ...baseFilters, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // `.at(0)` is typed as possibly-undefined, unlike `[0]`, so the empty
      // final page ends pagination without an unsafe index read.
      const total = lastPage.at(0)?.totalCount
      const loaded = allPages.reduce((sum, page) => sum + page.length, 0)
      return total !== undefined && loaded < total ? loaded : undefined
    },
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  })

  const loaded = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  // QA3-search-2 — the service's own total, not just the page in hand, is the
  // number of matches the heading and the "All" facet state.
  const totalCount = query.data?.pages.at(-1)?.at(0)?.totalCount
  // Archived is pushed to the RPC as p_include_archived (via
  // urlFiltersToSearchFilters); the remaining facets are still applied here as
  // the authoritative client filter because the RPC narrowing may be a
  // superset (a Records facet still returns samples).
  const results = filterSearchResults(loaded, {
    type: search.type,
    project: search.project,
    updated: search.updated,
  })
  const matchCount = searchMatchCount(
    loaded.length,
    results.length,
    totalCount,
  )

  const suggestionQuery = useQuery({
    queryKey: ['did-you-mean', q],
    queryFn: () => searchDidYouMean(notebookDataClient, q),
    // A failed search is not a miss, so it must not produce a correction for
    // a query that was never run.
    enabled:
      q.trim().length > 0 &&
      results.length === 0 &&
      !query.isLoading &&
      !query.isError,
    staleTime: 30_000,
  })

  const facets = useMemo(() => {
    const types = new Map<SearchResultGroup, number>()
    const projects = new Map<string, number>()
    for (const r of results) {
      const g = searchResultGroup(r)
      types.set(g, (types.get(g) ?? 0) + 1)
      if (r.projectId)
        projects.set(r.projectId, (projects.get(r.projectId) ?? 0) + 1)
    }
    return { types, projects }
  }, [results])

  const typeFilter = search.type ?? []
  const projectFilter = search.project ?? []
  const updatedFilter = search.updated ?? 'any'

  // A query or facet change is a new place in the history: Back returns to the
  // previous query rather than skipping past it.
  const setSearch = (patch: Partial<SearchSearch>) =>
    void navigate({
      to: '/search',
      search: (s) => ({ ...s, ...patch }),
    })
  const toggleType = (g: SearchResultGroup, on: boolean) =>
    setSearch({
      type: on
        ? [...typeFilter, g]
        : typeFilter.filter((t) => t !== g).length
          ? typeFilter.filter((t) => t !== g)
          : undefined,
    })
  const toggleProject = (id: string, on: boolean) =>
    setSearch({
      project: on
        ? [...projectFilter, id]
        : projectFilter.filter((p) => p !== id).length
          ? projectFilter.filter((p) => p !== id)
          : undefined,
    })

  // QA3-search-1 — only the type, project and updated facets narrow the
  // results. "Include archived" widens the *query*, so ticking it alone must
  // not make the empty state blame filters (nor offer a Clear filters button
  // that resets facets which are already unset).
  const facetFilterCount =
    typeFilter.length +
    projectFilter.length +
    (updatedFilter === '7d' ? 1 : 0)
  const activeFilters = facetFilterCount + (search.archived ? 1 : 0)

  const facetsEl = q ? (
    <>
      <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
        <legend className="px-1.5 pb-1 text-label font-medium text-fg-muted">
          Type
        </legend>
        <FacetRow
          label="All"
          count={matchCount}
          checked={!typeFilter.length}
          onChange={() => setSearch({ type: undefined })}
        />
        {SEARCH_RESULT_GROUPS.filter((g) => facets.types.get(g)).map((g) => (
          <FacetRow
            key={g}
            label={g}
            count={facets.types.get(g) ?? 0}
            checked={typeFilter.includes(g)}
            onChange={(on) => toggleType(g, on)}
          />
        ))}
      </fieldset>
      {facets.projects.size ? (
        <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
          <legend className="px-1.5 pb-1 text-label font-medium text-fg-muted">
            Project
          </legend>
          {[...facets.projects.entries()].map(([id, count]) => (
            <FacetRow
              key={id}
              label={projectNames.data?.get(id) ?? id}
              count={count}
              checked={projectFilter.includes(id)}
              onChange={(on) => toggleProject(id, on)}
            />
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <div className="px-1.5 pb-1 text-label font-medium text-fg-muted">
          Updated
        </div>
        <RadioGroup
          aria-label="Updated"
          value={updatedFilter}
          onValueChange={(v) =>
            setSearch({ updated: v === '7d' ? '7d' : undefined })
          }
          className="gap-0.5"
        >
          <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover max-lg:h-10">
            <Radio value="any" />
            Any time
          </label>
          <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover max-lg:h-10">
            <Radio value="7d" />
            Last 7 days
          </label>
        </RadioGroup>
      </div>
      <label className="flex cursor-pointer items-center gap-2 px-1.5 text-label max-lg:h-10 max-lg:text-body">
        <Checkbox
          checked={Boolean(search.archived)}
          onCheckedChange={(on) => setSearch({ archived: on || undefined })}
        />
        Include archived
      </label>
    </>
  ) : null

  const searchForm = (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        setSearch({ q: draft.trim() || undefined })
      }}
    >
      <label>
        <span className="sr-only">Search Sheetbase</span>
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search everything"
        />
      </label>
    </form>
  )

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Filters"
        className="hidden w-[220px] shrink-0 flex-col gap-[18px] overflow-auto border-r border-border-subtle px-3.5 py-[18px] text-body lg:flex"
      >
        {searchForm}
        {facetsEl}
      </aside>
      <div className="relative min-w-0 flex-1 overflow-auto px-4 py-[18px] md:px-7">
        <div className="mb-4 flex items-center gap-2 lg:hidden">
          <div className="min-w-0 flex-1">{searchForm}</div>
          {q ? (
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger
                render={
                  <Button icon="filter">
                    {`Filters${activeFilters ? ` · ${activeFilters}` : ''}`}
                  </Button>
                }
              />
              <SheetContent title="Filters">
                <div className="flex flex-col gap-[18px] p-4 text-body">
                  {facetsEl}
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
        </div>

        {!q ? (
          <>
            <h1 className="text-title">Search</h1>
            <EmptyState
              icon="search"
              title="Search names, IDs, cell values, comments and files"
              body="Type an ID like EXP-0142 or a value like C-150. Press ⌘K anywhere to search without leaving the page."
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-title max-md:text-[18px] max-md:leading-6">
                Results for “{q}”
              </h1>
              <span className="num text-body text-fg-muted">
                {matchCount}
              </span>
              <span className="flex-1" />
              {/* The `search` RPC ranks by relevance and takes no sort
                  parameter, so the page states the ordering instead of
                  offering a control that could not change it. */}
              <span className="text-label text-fg-muted max-md:hidden">
                Ranked by relevance
              </span>
            </div>
            <div className="mt-0.5 text-label text-fg-muted">
              Matched names, IDs, cell values, comments and file names you can
              access
            </div>

            {query.isError ? (
              <Notice
                tone="bad"
                title="Search could not run"
                className="mt-3"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void query.refetch()}
                  >
                    Try again
                  </Button>
                }
              >
                The search service did not answer. This is not a result of
                nothing matching.
              </Notice>
            ) : null}

            {!query.isError &&
            !query.isLoading &&
            results.length === 0 &&
            !query.hasNextPage ? (
              <NoResults
                q={q}
                archived={Boolean(search.archived)}
                filtered={facetFilterCount > 0}
                suggestions={(suggestionQuery.data ?? []).filter(
                  (s) => s.identifier.toLowerCase() !== q.trim().toLowerCase(),
                )}
                onArchivedChange={(on) =>
                  setSearch({ archived: on || undefined })
                }
                onClear={() =>
                  setSearch({
                    type: undefined,
                    project: undefined,
                    updated: undefined,
                  })
                }
              />
            ) : null}

            {SEARCH_RESULT_GROUPS.map((group) => {
              const items = results.filter(
                (r) => searchResultGroup(r) === group,
              )
              if (!items.length) return null
              return (
                <section key={group} aria-label={group}>
                  <div className="mt-4 flex items-baseline gap-2 border-b border-border pb-2">
                    <h2 className="text-[14px]">{group}</h2>
                    <span className="num text-label text-fg-muted">
                      {items.length}
                    </span>
                  </div>
                  {items.map((r) => (
                    <Result
                      key={`${r.resultType}-${r.recordId}`}
                      result={r}
                      q={q}
                    />
                  ))}
                </section>
              )
            })}

            {query.hasNextPage ? (
              <div className="mt-4">
                <Button
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function FacetRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string
  count: number
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="grid h-7 cursor-pointer grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover max-lg:h-10">
      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on)} />
      <span className="truncate">{label}</span>
      <span className="num text-label text-fg-muted">{count}</span>
    </label>
  )
}

function Result({ result, q }: { result: SearchResult; q: string }) {
  const context = searchResultContext(result, result.matchedContext)
  // `identifier` is the object's own id for sheets and datasets; such a row
  // leads with its title instead of a UUID.
  const label = searchResultLabel(result)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border-subtle py-2.5 md:grid-cols-[minmax(0,1fr)_200px_90px] xl:grid-cols-[minmax(0,1fr)_260px_90px]">
      <div className="min-w-0">
        <Link to={result.deepLink} className="text-body">
          {label ? <span className="mono mr-1.5">{label}</span> : null}
          <Highlight text={result.title} q={q} />
        </Link>
        <div className="text-label text-fg-muted">
          {context.map((segment, i) =>
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
        </div>
        <div className="text-label text-fg-muted">
          {result.matchedField.replace(/_/g, ' ')}
        </div>
      </div>
      <span className="text-label max-md:order-3 max-md:col-span-2">
        {result.status ? (
          <Status tone={statusTone(result.status)}>
            {statusLabel(result.status)}
          </Status>
        ) : null}
      </span>
      <span className="num text-right text-label text-fg-muted">
        {result.updatedAt.slice(0, 10)}
      </span>
    </div>
  )
}

function NoResults({
  q,
  archived,
  filtered,
  suggestions,
  onArchivedChange,
  onClear,
}: {
  q: string
  archived: boolean
  filtered: boolean
  suggestions: { kind: string; identifier: string; title: string }[]
  onArchivedChange: (on: boolean) => void
  onClear: () => void
}) {
  return (
    <div role="status" className="mt-6 flex max-w-[560px] flex-col gap-2.5">
      <div className="flex items-center gap-2 font-semibold">
        <Icon name="search" size={14} className="text-fg-muted" />
        No matches for “{q}”
      </div>
      <p className="m-0 text-body leading-[19px] text-fg-muted">
        {filtered
          ? 'Nothing matches with these filters.'
          : 'Nothing in names, IDs, cell values, comments or files you can access.'}
      </p>
      {suggestions.length ? (
        <p className="m-0 text-body">
          Did you mean{' '}
          {suggestions.map((s, i) => (
            <span key={s.identifier}>
              {i > 0 ? ', ' : ''}
              <Link
                to="/search"
                search={{ q: s.identifier }}
                className={cn('font-medium')}
              >
                {s.identifier}
              </Link>
              <span className="text-fg-muted"> {s.title}</span>
            </span>
          ))}
          ?
        </p>
      ) : null}
      {filtered ? (
        <div>
          <Button onClick={onClear}>Clear filters</Button>
        </div>
      ) : null}
      <p className="m-0 text-label text-fg-muted">
        {archived ? (
          <>
            Archived projects searched too: still no matches for “{q}”.{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(false)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              Search active work only
            </button>
          </>
        ) : (
          <>
            Archived projects and other workspaces aren’t searched.{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(true)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              Include archived
            </button>
          </>
        )}
      </p>
    </div>
  )
}
