import { sampleStatus } from '#/components/v3/samples/samples-data'
import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { LoadMore } from '#/components/v3/ui/load-more'
import { Notice } from '#/components/v3/ui/alert'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Radio, RadioGroup } from '#/components/v3/ui/radio-group'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Icon } from '#/components/v3/icons'
import { Sheet, SheetContent, SheetTrigger } from '#/components/v3/ui/sheet'
import { Highlight } from '#/components/v3/search/highlight'
import { SavedSearches } from '#/components/v3/search/saved-searches'
import {
  searchResultContext,
  searchResultLabel,
} from '#/components/v3/search/result-text'
import { useProjectNameMap } from '#/components/v3/experiments/experiments-data'
import type { WorkspaceMemberIdentity } from '#/components/v3/projects/project-data'
import { cn } from '#/lib/utils'
import {
  executeSearch,
  matchedFieldLabel,
  filterSearchResults,
  parseSearchDay,
  searchDidYouMean,
  searchQueryKeys,
  searchResultGroup,
  searchResultGroupLabel,
  urlFiltersToSearchFilters,
  SEARCH_PAGE_SIZE,
  SEARCH_RESULT_GROUPS,
} from '#/lib/search'
import type { SearchResult, SearchResultGroup } from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatDate } from '#/lib/format-date'
import { rich, t } from '#/copy'

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
  owner?: string
  from?: string
  to?: string
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
    owner:
      typeof search.owner === 'string' && search.owner
        ? search.owner
        : undefined,
    from: parseSearchDay(search.from),
    to: parseSearchDay(search.to),
    archived:
      search.archived === true || search.archived === 'true' || undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
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
  return total !== undefined && loadedCount === shownCount ? total : shownCount
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

function statusLabel(status: string, kind?: string): string {
  if (kind === 'sample') return sampleStatus(status).label
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function SearchPage() {
  const platform = usePlatform()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { context } = Route.useRouteContext()
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
      owner: search.owner,
      from: search.from,
      to: search.to,
      archived: search.archived,
    },
    0,
    SEARCH_PAGE_SIZE,
  )

  const query = useInfiniteQuery({
    queryKey: [...searchQueryKeys.search(baseFilters), search.type ?? []],
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
    owner: search.owner,
    from: search.from,
    to: search.to,
  })
  const matchCount = searchMatchCount(loaded.length, results.length, totalCount)
  // Only the rows fetched so far can be sorted into types, so while more are
  // waiting the per-type counts are a floor, not a total.
  const morePending = Boolean(query.hasNextPage)
  const partial = (count: number) => (morePending ? `${count}+` : String(count))

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
  const members = useQuery({
    queryKey: ['ui-port', 'workspace-members'],
    queryFn: () =>
      notebookDataClient.rpc<WorkspaceMemberIdentity[]>(
        'workspace_members_list',
        {},
      ),
    enabled: q.trim().length > 0,
    staleTime: 60_000,
  })
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
        : typeFilter.filter((name) => name !== g).length
          ? typeFilter.filter((name) => name !== g)
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
  const dateRangeSet = Boolean(search.from || search.to)
  const facetFilterCount =
    typeFilter.length +
    projectFilter.length +
    (updatedFilter === '7d' ? 1 : 0) +
    (search.owner ? 1 : 0) +
    (dateRangeSet ? 1 : 0)
  const activeFilters = facetFilterCount + (search.archived ? 1 : 0)

  const facetsEl = q ? (
    <>
      <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
        <legend className="px-1.5 pb-1 text-label font-medium text-fg-muted">
          {t('projects.searchPage.type')}
        </legend>
        <FacetRow
          label={t('projects.searchPage.all')}
          count={String(matchCount)}
          checked={!typeFilter.length}
          onChange={() => setSearch({ type: undefined })}
        />
        {SEARCH_RESULT_GROUPS.filter((g) => facets.types.get(g)).map((g) => (
          <FacetRow
            key={g}
            label={searchResultGroupLabel(g)}
            count={partial(facets.types.get(g) ?? 0)}
            checked={typeFilter.includes(g)}
            onChange={(on) => toggleType(g, on)}
          />
        ))}
      </fieldset>
      {facets.projects.size ? (
        <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
          <legend className="px-1.5 pb-1 text-label font-medium text-fg-muted">
            {t('projects.searchPage.project')}
          </legend>
          {[...facets.projects.entries()].map(([id, count]) => (
            <FacetRow
              key={id}
              label={projectNames.data?.get(id) ?? id}
              count={partial(count)}
              checked={projectFilter.includes(id)}
              onChange={(on) => toggleProject(id, on)}
            />
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <div className="px-1.5 pb-1 text-label font-medium text-fg-muted">
          {t('projects.searchPage.updated')}
        </div>
        <RadioGroup
          aria-label={t('projects.searchPage.updated')}
          value={updatedFilter}
          onValueChange={(v) =>
            setSearch({
              updated: v === '7d' ? '7d' : undefined,
              from: undefined,
              to: undefined,
            })
          }
          className="gap-0.5"
        >
          <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover max-lg:h-10">
            <Radio value="any" />
            {t('projects.searchPage.anyTime')}
          </label>
          <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover max-lg:h-10">
            <Radio value="7d" />
            {t('projects.searchPage.last7')}
          </label>
        </RadioGroup>
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="px-1.5 pb-1 text-label font-medium text-fg-muted">
          {t('projects.searchPage.dateRange')}
        </legend>
        <label className="flex flex-col gap-0.5 px-1.5 text-label">
          {t('projects.searchPage.from')}
          <Input
            type="date"
            value={search.from ?? ''}
            max={search.to}
            onChange={(e) =>
              setSearch({
                from: parseSearchDay(e.target.value),
                updated: undefined,
              })
            }
          />
        </label>
        <label className="flex flex-col gap-0.5 px-1.5 text-label">
          {t('projects.searchPage.to')}
          <Input
            type="date"
            value={search.to ?? ''}
            min={search.from}
            onChange={(e) =>
              setSearch({
                to: parseSearchDay(e.target.value),
                updated: undefined,
              })
            }
          />
        </label>
      </fieldset>
      <label className="flex flex-col gap-0.5 px-1.5 text-label">
        <span className="font-medium text-fg-muted">
          {t('projects.searchPage.owner')}
        </span>
        <Select
          value={search.owner ?? ''}
          onChange={(e) => setSearch({ owner: e.target.value || undefined })}
          aria-label={t('projects.searchPage.owner')}
        >
          <option value="">{t('projects.searchPage.anyone')}</option>
          {(members.data ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </Select>
        {search.owner ? (
          <span className="text-fg-muted">
            {t('projects.searchPage.ownerNote')}
          </span>
        ) : null}
      </label>
      <label className="flex cursor-pointer items-center gap-2 px-1.5 text-label max-lg:h-10 max-lg:text-body">
        <Checkbox
          checked={Boolean(search.archived)}
          onCheckedChange={(on) => setSearch({ archived: on || undefined })}
        />
        {t('projects.searchPalette.includeArchived')}
      </label>
    </>
  ) : null

  // Saved searches also work from an empty page, so they sit outside `facetsEl`.
  const savedEl = context.workspace ? (
    <SavedSearches
      workspaceId={context.workspace.id}
      current={{
        q,
        type: search.type,
        project: search.project,
        updated: search.updated === '7d' ? '7d' : undefined,
        owner: search.owner,
        from: search.from,
        to: search.to,
        archived: search.archived,
      }}
      onApply={(next) =>
        void navigate({
          to: '/search',
          search: next,
        })
      }
    />
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
        <span className="sr-only">{t('projects.searchPalette.title')}</span>
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('projects.searchPage.placeholder')}
        />
      </label>
    </form>
  )

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label={t('projects.searchPage.filters')}
        className="hidden w-[220px] shrink-0 flex-col gap-[18px] overflow-auto border-r border-border-subtle px-3.5 py-[18px] text-body lg:flex"
      >
        {searchForm}
        {facetsEl}
        {savedEl}
      </aside>
      <div className="relative min-w-0 flex-1 overflow-auto px-4 py-[18px] md:px-7">
        <div className="mb-4 flex items-center gap-2 lg:hidden">
          <div className="min-w-0 flex-1">{searchForm}</div>
          {q ? (
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger
                render={
                  <Button icon="filter">
                    {activeFilters
                      ? t('projects.searchPage.filtersCount', {
                          count: activeFilters,
                        })
                      : t('projects.searchPage.filters')}
                  </Button>
                }
              />
              <SheetContent title={t('projects.searchPage.filters')}>
                <div className="flex flex-col gap-[18px] p-4 text-body">
                  {facetsEl}
                  {savedEl}
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
        </div>

        {!q ? (
          <>
            <h1 className="text-title">{t('projects.searchPage.title')}</h1>
            <EmptyState
              icon="search"
              title={t('projects.searchPage.empty.title')}
              description={t('projects.searchPage.empty.body', {
                shortcut: formatShortcut('mod+k', platform),
              })}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-title max-md:text-[18px] max-md:leading-6">
                {t('projects.searchPage.results', { query: q })}
              </h1>
              <span className="num text-body text-fg-muted">
                {morePending && !typeFilter.length
                  ? t('projects.searchPage.shownOfTotal', {
                      shown: results.length,
                      total: matchCount,
                    })
                  : matchCount}
              </span>
              <span className="flex-1" />
              {/* The `search` RPC ranks by relevance and takes no sort
                  parameter, so the page states the ordering instead of
                  offering a control that could not change it. */}
              <span className="text-label text-fg-muted max-md:hidden">
                {t('projects.searchPage.ranked')}
              </span>
            </div>
            <div className="mt-0.5 text-label text-fg-muted">
              {t('projects.searchPage.matched')}
            </div>

            {query.isError ? (
              <Notice
                tone="bad"
                title={t('projects.searchPalette.error.title')}
                className="mt-3"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void query.refetch()}
                  >
                    {t('common.actions.tryAgain')}
                  </Button>
                }
              >
                {t('projects.searchPage.errorBody')}
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
                    owner: undefined,
                    from: undefined,
                    to: undefined,
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
                <section key={group} aria-label={searchResultGroupLabel(group)}>
                  <div className="mt-4 flex items-baseline gap-2 border-b border-border pb-2">
                    <h2 className="text-[14px]">
                      {searchResultGroupLabel(group)}
                    </h2>
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

            <LoadMore
              label={t('projects.searchPage.resultsLabel')}
              className="mt-4"
              hasMore={query.hasNextPage}
              loading={query.isFetchingNextPage}
              onLoadMore={() => void query.fetchNextPage()}
            />
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
  count: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="grid min-h-7 cursor-pointer grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-surface-hover max-lg:min-h-10">
      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on)} />
      <span className="break-words">{label}</span>
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
        <div className="line-clamp-2 text-label break-words text-fg-muted">
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
        {result.matchedField === 'title' ? null : (
          <div className="text-label text-fg-muted">
            {matchedFieldLabel(result.matchedField)}
          </div>
        )}
      </div>
      <span className="text-label max-md:order-3 max-md:col-span-2">
        {result.status ? (
          <Status tone={statusTone(result.status)}>
            {statusLabel(result.status, result.kind)}
          </Status>
        ) : null}
      </span>
      <span className="num text-right text-label text-fg-muted">
        {formatDate(result.updatedAt)}
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
        {t('projects.searchPage.noMatch', { query: q })}
      </div>
      <p className="m-0 text-body leading-[19px] text-fg-muted">
        {filtered
          ? t('projects.searchPage.noMatchFiltered')
          : t('projects.searchPage.noMatchBody')}
      </p>
      {suggestions.length ? (
        <p className="m-0 text-body">
          {rich('projects.searchPage.didYouMean', {
            list: suggestions.map((s, i) => (
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
            )),
          })}
        </p>
      ) : null}
      {filtered ? (
        <div>
          <Button onClick={onClear}>
            {t('projects.searchPage.clearFilters')}
          </Button>
        </div>
      ) : null}
      <p className="m-0 text-label text-fg-muted">
        {archived ? (
          <>
            {t('projects.searchPage.archivedSearched', { query: q })}{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(false)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {t('projects.searchPalette.activeOnly')}
            </button>
          </>
        ) : (
          <>
            {t('projects.searchPage.archivedNotSearched')}{' '}
            <button
              type="button"
              onClick={() => onArchivedChange(true)}
              className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {t('projects.searchPalette.includeArchived')}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
