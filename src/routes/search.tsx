import { sampleStatus } from '#/components/v3/samples/samples-data'
import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import {
  FilterBuilder,
  FilterChips,
} from '@sheetbase-labs/sheetbase-advanced-search'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { LoadMore } from '#/components/v3/ui/load-more'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Icon } from '#/components/v3/icons'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { FilterMenu } from '#/components/v3/ui/filter-menu'
import { Tabs } from '#/components/v3/ui/tabs'
import { Chip } from '#/components/v3/ui/chip'
import { ListHeader } from '#/components/v3/inventory/list'
import { SearchResultIcon } from '#/components/v3/search/result-icon'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { MobileList, stickyCol } from '#/components/v3/projects/mobile-list'
import { now } from '#/lib/clock'
import { formatListDate } from '#/lib/list-date'
import { useSearchFields } from '#/components/v3/search/use-search-fields'
import { Highlight } from '#/components/v3/search/highlight'
import { SavedSearches } from '#/components/v3/search/saved-searches'
import {
  searchResultContext,
  searchResultLabel,
  searchResultParentLine,
} from '#/components/v3/search/result-text'
import { useProjectNameMap } from '#/components/v3/experiments/experiments-data'
import type { WorkspaceMemberIdentity } from '#/components/v3/projects/project-data'
import { cn } from '#/lib/utils'
import {
  executeSearch,
  fetchSearchFacets,
  summariseSearchFacets,
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
import {
  SEARCH_SORTS,
  andFilters,
  countConditions,
  decodeFilter,
  encodeFilter,
  normaliseFilterParam,
  completeFilter,
  parseSearchSort,
  withoutNode,
} from '#/lib/search-filter'
import type { FilterParam, SearchSort } from '#/lib/search-filter'
import { parseTypedSearch } from '#/lib/search-query'
import { typeSearchFields } from '#/lib/search-fields'
import { signInRedirect } from '#/lib/sign-in-redirect'
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
  /** The builder's filter tree as compact JSON. */
  filter?: FilterParam
  sort?: SearchSort
  /** Open with the filter builder showing (the sidebar's Search link). */
  builder?: boolean
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
    filter: normaliseFilterParam(search.filter),
    sort: parseSearchSort(search.sort),
    builder: search.builder === true || search.builder === 'true' || undefined,
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

const SORT_LABELS = {
  relevance: 'projects.searchFilter.sortRelevance',
  updated: 'projects.searchFilter.sortUpdated',
  created: 'projects.searchFilter.sortCreated',
} as const

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
  const treeFilter = useMemo(() => decodeFilter(search.filter), [search.filter])
  const filterCount = treeFilter ? countConditions(treeFilter) : 0
  const sort = search.sort ?? 'relevance'
  // A search is a question: words, filters, or both. A page with neither has
  // nothing to ask yet.
  const active = q.trim().length > 0 || filterCount > 0
  const [builderOpen, setBuilderOpen] = useState(Boolean(search.builder))
  const [focusId, setFocusId] = useState<string | undefined>()
  // The sidebar's Search link asks for the builder; open it, then drop the ask
  // from the address so a reload or Back does not open it again.
  useEffect(() => {
    if (!search.builder) return
    setBuilderOpen(true)
    void navigate({
      to: '/search',
      search: (s) => ({ ...s, builder: undefined }),
      replace: true,
    })
  }, [search.builder, navigate])
  const [draftTree, setDraftTree] = useState<GroupNode | null>(null)
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
      filter: treeFilter,
      sort: search.sort,
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
    enabled: active,
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
  // The server counts every match by type and project, whatever page is
  // loaded. Until that answer arrives (or if it fails) the page falls back to
  // counting the rows it holds, which is a floor while more are waiting.
  const facetFilters = {
    ...baseFilters,
    projectId: undefined,
    kind: undefined,
    resultType: undefined,
    limit: undefined,
    offset: undefined,
  }
  const facetQuery = useQuery({
    queryKey: ['search-facets', ...searchQueryKeys.search(facetFilters)],
    queryFn: () => fetchSearchFacets(notebookDataClient, facetFilters),
    enabled: active,
    staleTime: 10_000,
  })
  const serverFacets = useMemo(
    () =>
      facetQuery.data
        ? summariseSearchFacets(facetQuery.data, {
            type: search.type,
            project: search.project,
          })
        : null,
    [facetQuery.data, search.type, search.project],
  )
  const morePending = Boolean(query.hasNextPage)
  const partial = (count: number) =>
    morePending && !serverFacets ? `${count}+` : String(count)

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

  const loadedFacets = useMemo(() => {
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
  const facets = serverFacets ?? loadedFacets

  const typeFilter = search.type ?? []
  // Fields only one kind of thing carries are offered once the search is
  // narrowed to that kind, from the values its results returned.
  const onlyGroup =
    typeFilter.length === 1 ? (typeFilter[0] as SearchResultGroup) : undefined
  const typeFields = useMemo(
    () => typeSearchFields(loaded, onlyGroup),
    [loaded, onlyGroup],
  )
  const filterFields = useSearchFields(typeFields)
  const draftComplete = draftTree ? completeFilter(draftTree) : undefined
  const draftEncoded = draftComplete ? encodeFilter(draftComplete) : undefined
  const draftCount = useQuery({
    queryKey: [
      'search-draft-count',
      ...searchQueryKeys.search(facetFilters),
      draftEncoded ?? null,
    ],
    queryFn: async () => {
      const rows = await fetchSearchFacets(notebookDataClient, {
        ...facetFilters,
        filter: draftComplete,
      })
      return rows.reduce((sum, row) => sum + row.count, 0)
    },
    enabled: builderOpen && Boolean(draftEncoded),
    staleTime: 10_000,
  })
  const projectFilter = search.project ?? []
  const members = useQuery({
    queryKey: ['ui-port', 'workspace-members'],
    queryFn: () =>
      notebookDataClient.rpc<WorkspaceMemberIdentity[]>(
        'workspace_members_list',
        {},
      ),
    enabled: active,
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
  // QA3-search-1 — only the type, project and updated facets narrow the
  // results. "Include archived" widens the *query*, so ticking it alone must
  // not make the empty state blame filters (nor offer a Clear filters button
  // that resets facets which are already unset).
  const dateRangeSet = Boolean(search.from || search.to)
  const facetFilterCount =
    filterCount +
    typeFilter.length +
    projectFilter.length +
    (updatedFilter === '7d' ? 1 : 0) +
    (search.owner ? 1 : 0) +
    (dateRangeSet ? 1 : 0)

  // Saved searches open from the header, the way a list's views do.
  const savedEl = context.workspace ? (
    <Popover>
      <PopoverTrigger render={<Button />}>
        {t('projects.savedSearches.title')}
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-3">
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
            filter: search.filter,
            sort: search.sort,
          }}
          onApply={(next) =>
            void navigate({
              to: '/search',
              search: next,
            })
          }
        />
      </PopoverContent>
    </Popover>
  ) : null

  const searchForm = (
    <form
      role="search"
      className="relative order-first min-w-0 flex-1 max-lg:basis-full lg:order-none lg:w-[320px] lg:flex-none"
      onSubmit={(e) => {
        e.preventDefault()
        // `type:sample -project:"AAV8 TFF"` becomes filters; the rest stays text.
        void parseTypedSearch(draft, filterFields).then((typed) => {
          const merged = andFilters(treeFilter, typed.filter)
          setSearch({
            q: typed.q || undefined,
            filter: encodeFilter(merged),
          })
        })
      }}
    >
      <label htmlFor="search-page-q" className="sr-only">
        {t('projects.searchPalette.title')}
      </label>
      <Icon
        name="search"
        size={14}
        className="pointer-events-none absolute left-[9px] top-[8px] text-fg-muted max-lg:top-[11px]"
      />
      <Input
        id="search-page-q"
        type="search"
        value={draft}
        className="h-7 pl-7 max-lg:h-9"
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('projects.searchPage.placeholder')}
        title={t('projects.searchFilter.syntaxHint')}
      />
    </form>
  )

  const closeBuilder = () => {
    setBuilderOpen(false)
    setFocusId(undefined)
    setDraftTree(null)
  }

  // One toolbar under the header, as on every list: the words, the quick
  // filters, sort, and the rule builder for anything more.
  const toolbar = (
    <div
      role="group"
      aria-label={t('projects.searchFilter.filtersLabel')}
      className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6"
    >
      {searchForm}
      {active ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="quiet" size="sm" />}>
              {t('projects.searchPage.sortBy', {
                by: t(SORT_LABELS[sort]),
              })}
              <Icon name="chevronDown" size={10} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
              {SEARCH_SORTS.map((value) => (
                <DropdownMenuItem
                  key={value}
                  icon={sort === value ? 'check' : undefined}
                  className={sort === value ? '' : 'pl-[30px]'}
                  onClick={() =>
                    setSearch({
                      sort: value === 'relevance' ? undefined : value,
                    })
                  }
                >
                  {t(SORT_LABELS[value])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {facets.projects.size || projectFilter.length ? (
            <FilterMenu
              label={t('projects.searchPage.project')}
              anyLabel={t('projects.searchPage.anyProject')}
              value={projectFilter.length === 1 ? projectFilter[0] : undefined}
              options={[...facets.projects.entries()].map(([id, count]) => ({
                value: id,
                label: `${projectNames.data?.get(id) ?? id} (${partial(count)})`,
              }))}
              onChange={(id) => setSearch({ project: id ? [id] : undefined })}
            />
          ) : null}
          <FilterMenu
            label={t('projects.searchPage.updated')}
            anyLabel={t('projects.searchPage.anyTimeMenu')}
            value={updatedFilter === '7d' ? '7d' : undefined}
            options={[{ value: '7d', label: t('projects.searchPage.last7') }]}
            onChange={(v) =>
              setSearch({
                updated: v === '7d' ? '7d' : undefined,
                from: undefined,
                to: undefined,
              })
            }
          />
          <FilterMenu
            label={t('projects.searchPage.owner')}
            anyLabel={t('projects.searchPage.anyoneMenu')}
            value={search.owner}
            options={(members.data ?? []).map((m) => ({
              value: m.user_id,
              label: m.name,
            }))}
            onChange={(v) => setSearch({ owner: v })}
          />
          <Button
            variant="quiet"
            size="sm"
            aria-pressed={Boolean(search.archived)}
            icon={search.archived ? 'check' : undefined}
            className={cn(search.archived && 'bg-selection hover:bg-selection')}
            onClick={() =>
              setSearch({ archived: search.archived ? undefined : true })
            }
          >
            {t('projects.searchPalette.includeArchived')}
          </Button>
        </>
      ) : null}
      <Button
        size="sm"
        variant={builderOpen ? 'secondary' : 'quiet'}
        icon={builderOpen ? 'chevronDown' : 'filter'}
        aria-expanded={builderOpen}
        aria-controls="search-filter-builder"
        onClick={() => (builderOpen ? closeBuilder() : setBuilderOpen(true))}
      >
        {builderOpen
          ? t('projects.searchFilter.hideFilters')
          : treeFilter
            ? t('projects.searchFilter.editFilters')
            : t('projects.searchFilter.addFilter')}
      </Button>
    </div>
  )

  // The chips are the record of what narrows the list, under the toolbar the
  // way the Experiments list shows its own.
  const chipsRow =
    (treeFilter && !builderOpen) || dateRangeSet ? (
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
        {dateRangeSet ? (
          <Chip
            variant="remove"
            removeLabel={t('projects.searchPage.clearDates')}
            onRemove={() => setSearch({ from: undefined, to: undefined })}
          >
            {t('projects.searchPage.dateChip', {
              from: search.from ?? '…',
              to: search.to ?? '…',
            })}
          </Chip>
        ) : null}
        {treeFilter && !builderOpen ? (
          <FilterChips
            node={treeFilter}
            fields={filterFields}
            onRemove={(id) =>
              setSearch({
                filter: encodeFilter(withoutNode(treeFilter, id)),
              })
            }
            onEdit={(id) => {
              setFocusId(id)
              setBuilderOpen(true)
            }}
          />
        ) : null}
      </div>
    ) : null

  // The builder opens under the toolbar, full width, so a question with
  // groups reads as one block. Apply folds it back to the chips.
  const builderPanel = builderOpen ? (
    <div
      id="search-filter-builder"
      className="sheetbase-scope border-b border-border-subtle px-4 py-3 md:px-6"
    >
      <FilterBuilder
        variant="inline"
        node={treeFilter ?? null}
        fields={filterFields}
        focusId={focusId}
        matchCount={draftEncoded ? (draftCount.data ?? null) : null}
        onChange={setDraftTree}
        onApply={(tree) => {
          setSearch({ filter: encodeFilter(tree) })
          closeBuilder()
        }}
        onClear={() => setSearch({ filter: undefined })}
      />
    </div>
  ) : null

  // The type tabs replace the old sidebar's Type facet: one kind at a time,
  // with how many of each the search found.
  const activeType = typeFilter.length === 1 ? typeFilter[0] : undefined
  const typeTabs = active ? (
    <Tabs
      mode="url"
      value={activeType ?? 'all'}
      label={t('projects.searchPage.type')}
      items={[
        {
          key: 'all',
          label: t('projects.searchPage.all'),
          count: String(matchCount),
          link: { to: '/search', search: { ...search, type: undefined } },
        },
        ...SEARCH_RESULT_GROUPS.filter(
          (g) => facets.types.get(g) || g === activeType,
        ).map((g) => ({
          key: g,
          label: searchResultGroupLabel(g),
          count: partial(facets.types.get(g) ?? 0),
          link: {
            to: '/search' as const,
            search: { ...search, type: [g] },
          },
        })),
      ]}
    />
  ) : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={
          !active
            ? t('projects.searchPage.title')
            : q
              ? t('projects.searchPage.results', { query: q })
              : t('projects.searchFilter.browseTitle')
        }
        total={active && !morePending ? matchCount : undefined}
        subtitle={
          active && morePending && !typeFilter.length
            ? t('projects.searchPage.shownOfTotal', {
                shown: results.length,
                total: matchCount,
              })
            : undefined
        }
        actions={savedEl}
        tabs={typeTabs}
      />
      {toolbar}
      {chipsRow}
      {builderPanel}

      <div className="min-h-0 flex-1 overflow-auto">
        {!active ? (
          <div className="px-4 md:px-6">
            <EmptyState
              icon="search"
              title={t('projects.searchPage.empty.title')}
              description={t('projects.searchPage.empty.body', {
                shortcut: formatShortcut('mod+k', platform),
              })}
            />
          </div>
        ) : (
          <>
            {query.isError ? (
              <Notice
                tone="bad"
                title={t('projects.searchPalette.error.title')}
                className="mx-4 mt-3 md:mx-6"
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
              <div className="px-4 md:px-6">
                <NoResults
                  q={q}
                  archived={Boolean(search.archived)}
                  filtered={facetFilterCount > 0}
                  suggestions={(suggestionQuery.data ?? []).filter(
                    (s) =>
                      s.identifier.toLowerCase() !== q.trim().toLowerCase(),
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
                      filter: undefined,
                    })
                  }
                />
              </div>
            ) : null}

            {results.length || query.isLoading ? (
              <SearchResultsTable
                results={results}
                q={q}
                projectNames={projectNames.data}
                isLoading={query.isLoading}
              />
            ) : null}

            <LoadMore
              label={t('projects.searchPage.resultsLabel')}
              className="my-4 px-4 md:px-6"
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

/** One line of matched text, with the match marked. */
function MatchText({ result }: { result: SearchResult }) {
  const context = searchResultContext(result, result.matchedContext)
  const parentLine = searchResultParentLine(result)
  if (!context.length && !parentLine) return null
  return (
    <span className="block max-w-[300px] truncate text-fg-muted">
      {parentLine ? <span>{parentLine} · </span> : null}
      {context.map((segment, i) =>
        segment.highlighted ? (
          <mark key={i} className="rounded-[2px] bg-highlight px-px text-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </span>
  )
}

const resultKey = (r: SearchResult) => `${r.resultType}-${r.recordId}`

/**
 * The results as the same table every list uses: one row per match, best
 * match first. The Type facet already splits records, notebook text and files.
 */
function SearchResultsTable({
  results,
  q,
  projectNames,
  isLoading,
}: {
  results: SearchResult[]
  q: string
  projectNames: ReadonlyMap<string, string> | undefined
  isLoading: boolean
}) {
  const navigate = useNavigate()
  const open = (r: SearchResult) => void navigate({ href: r.deepLink })
  const columns = useMemo<RegistryColumn<SearchResult>[]>(
    () => [
      {
        id: 'identifier',
        header: t('projects.searchPage.columns.id'),
        meta: {
          headerClassName: 'max-xl:hidden',
          cellClassName: 'max-xl:hidden',
        },
        cell: ({ row }) => (
          <span className="mono whitespace-nowrap">
            {searchResultLabel(row.original) ?? '—'}
          </span>
        ),
      },
      {
        id: 'title',
        header: t('projects.searchPage.columns.name'),
        meta: {
          headerClassName: stickyCol,
          cellClassName: `${stickyCol} max-xl:h-auto max-xl:py-1`,
        },
        cell: ({ row }) => (
          <>
            <Link
              to={row.original.deepLink}
              className="inline-flex max-w-full items-center gap-1.5 text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              <SearchResultIcon result={row.original} />
              <span className="truncate">
                <Highlight text={row.original.title} q={q} />
              </span>
            </Link>
            <span className="mono block text-[11px] text-fg-muted xl:hidden">
              {searchResultLabel(row.original)}
            </span>
          </>
        ),
      },
      {
        id: 'match',
        header: t('projects.searchPage.columns.match'),
        meta: {
          headerClassName: 'max-lg:hidden',
          cellClassName: 'max-lg:hidden',
        },
        cell: ({ row }) => <MatchText result={row.original} />,
      },
      {
        id: 'project',
        header: t('projects.searchPage.columns.project'),
        // The Project facet beside the table already names each project.
        meta: {
          headerClassName: 'max-2xl:hidden',
          cellClassName: 'max-2xl:hidden',
        },
        cell: ({ row }) =>
          row.original.projectId ? (
            <Link
              to="/projects/$projectId"
              params={{ projectId: row.original.projectId }}
              className="text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              {projectNames?.get(row.original.projectId) ?? '—'}
            </Link>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        id: 'status',
        header: t('projects.searchPage.columns.status'),
        cell: ({ row }) =>
          row.original.status ? (
            <Status tone={statusTone(row.original.status)}>
              {statusLabel(row.original.status, row.original.kind)}
            </Status>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        id: 'updated',
        header: t('projects.searchPage.columns.updated'),
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatListDate(row.original.updatedAt, now())}
          </span>
        ),
      },
    ],
    [q, projectNames],
  )
  return (
    <>
      <MobileList
        className="md:hidden"
        label={t('projects.searchPage.resultsLabel')}
        rows={results.map((r) => ({
          key: resultKey(r),
          title: r.title,
          meta: <MatchText result={r} />,
          status: r.status
            ? {
                tone: statusTone(r.status),
                label: statusLabel(r.status, r.kind),
              }
            : undefined,
          onClick: () => open(r),
        }))}
      />
      <RegistryGrid
        className="max-md:hidden"
        label={t('projects.searchPage.resultsLabel')}
        rows={results}
        columns={columns}
        getRowId={resultKey}
        selectable={false}
        onRowClick={open}
        isLoading={isLoading}
      />
    </>
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
