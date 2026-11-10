import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { SemanticHit } from '#/lib/ai-embeddings'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import {
  getSemanticSettingsFn,
  hybridSearchFn,
  pluginSearchFn,
} from '#/lib/semantic-search-actions'
import {
  executeSearch,
  fetchSearchFacets,
  summariseSearchFacets,
  filterSearchResults,
  searchDidYouMean,
  searchQueryKeys,
  searchResultGroup,
  SEARCH_PAGE_SIZE,
  SEARCH_RESULT_GROUPS,
  urlFiltersToSearchFilters,
} from '#/lib/search'
import type { SearchResultGroup } from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'
import { typeSearchFields } from '#/lib/search-fields'
import { countConditions, decodeFilter } from '#/lib/search-filter'
import type { FilterParam, SearchSort } from '#/lib/search-filter'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'

/** The URL's search facets, as the page and its model read them. */
export interface SearchPageSearch {
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

const MEANING_KEY = 'sheetbase.search.byMeaning'

export function readMeaningPreference(): boolean {
  try {
    return window.localStorage.getItem(MEANING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeMeaningPreference(on: boolean): void {
  try {
    window.localStorage.setItem(MEANING_KEY, on ? 'on' : 'off')
  } catch {
    // The choice just won't be remembered.
  }
}

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

/** The RPC filters and the loaded results, facets and did-you-mean behind them. */
export function useSearchResults({
  search,
  active,
  q,
  treeFilter,
}: {
  search: SearchPageSearch
  active: boolean
  q: string
  treeFilter: GroupNode | undefined
}) {
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

  const searchType = search.type ?? []

  // Fields only one kind of thing carries are offered once the search is
  // narrowed to that kind, from the values its results returned. The type facet
  // is written only from these groups (the result tabs), so a value outside
  // them narrows nothing, exactly as an absent facet does.
  const group =
    searchType.length === 1
      ? z.enum(SEARCH_RESULT_GROUPS).safeParse(searchType[0]).data
      : undefined

  const typeFields = useMemo(
    () => typeSearchFields(loaded, group),
    [loaded, group],
  )

  return {
    baseFilters,
    facetFilters,
    query,
    results,
    matchCount,
    facets,
    partial,
    morePending,
    suggestionQuery,
    typeFields,
  }
}

/** Search by meaning: on by default wherever the lab has turned it on. */
export function useSearchMeaning({
  workspaceId,
  q,
  filterCount,
  meaningOn,
}: {
  workspaceId: string
  q: string
  filterCount: number
  /** The reader's switch, held by the page so the toggle and the read agree. */
  meaningOn: boolean
}) {
  const semanticSettings = useQuery({
    queryKey: ['semantic-settings', workspaceId],
    queryFn: () => getSemanticSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const meaningAvailable = semanticSettings.data?.settings.enabled === true

  const showMeaning =
    meaningAvailable && meaningOn && q.trim().length > 0 && filterCount === 0

  const meaningQuery = useQuery({
    queryKey: ['semantic-hits', workspaceId, q.trim()],
    queryFn: () =>
      hybridSearchFn({ data: { workspaceId, query: q.trim(), limit: 20 } }),
    enabled: showMeaning,
    staleTime: 30_000,
  })

  const meaningExtras = useMemo<SemanticHit[]>(
    () =>
      (meaningQuery.data?.hits ?? [])
        .filter((hit) => hit.byMeaning && !hit.byWords)
        .map((hit) => ({
          type: hit.type,
          id: hit.id,
          title: hit.title,
          identifier: hit.identifier,
          kind: hit.kind,
          status: hit.status,
          archived: hit.archived,
          deepLink: hit.deepLink,
          projectId: null,
          parentType: null,
          parentId: null,
          passage: hit.context,
          similarity: hit.similarity ?? 0,
        })),
    [meaningQuery.data],
  )

  return {
    meaningAvailable,
    showMeaning,
    meaningQuery,
    meaningExtras,
  }
}

/** Search tools that plugins add. Shown only where one is switched on. */
export function useSearchPlugins({
  workspaceId,
  q,
  filterCount,
}: {
  workspaceId: string
  q: string
  filterCount: number
}) {
  const pluginPoints = useExtensionPoints()

  const showPlugins =
    pluginPoints.data['search-providers'].length > 0 &&
    q.trim().length > 0 &&
    filterCount === 0

  const pluginQuery = useQuery({
    queryKey: ['plugin-search-hits', workspaceId, q.trim()],
    queryFn: () => pluginSearchFn({ data: { workspaceId, query: q.trim() } }),
    enabled: showPlugins && Boolean(workspaceId),
    staleTime: 30_000,
    retry: false,
  })

  return { showPlugins, pluginQuery }
}

/** The URL facets as the page reads them, and how many of them narrow the list. */
export function useSearchFacets(search: SearchPageSearch) {
  const treeFilter = useMemo(() => decodeFilter(search.filter), [search.filter])
  const filterCount = treeFilter ? countConditions(treeFilter) : 0
  const sort = search.sort ?? 'relevance'
  const q = search.q ?? ''
  // A search is a question: words, filters, or both. A page with neither has
  // nothing to ask yet.
  const active = q.trim().length > 0 || filterCount > 0
  const typeFilter = search.type ?? []
  const projectFilter = search.project ?? []
  const updatedFilter = search.updated ?? 'any'
  // QA3-search-1 — only the type, project and updated facets narrow the
  // results. "Include archived" widens the *query*, so ticking it alone must
  // not make the empty state blame filters (nor offer a Clear filters button
  // that resets facets which are already unset).
  const dateRangeSet = Boolean(search.from || search.to)

  return {
    q,
    treeFilter,
    filterCount,
    sort,
    active,
    typeFilter,
    projectFilter,
    updatedFilter,
    dateRangeSet,
    activeType: typeFilter.length === 1 ? typeFilter[0] : undefined,
    facetFilterCount:
      filterCount +
      typeFilter.length +
      projectFilter.length +
      (updatedFilter === '7d' ? 1 : 0) +
      (search.owner ? 1 : 0) +
      (dateRangeSet ? 1 : 0),
  }
}
