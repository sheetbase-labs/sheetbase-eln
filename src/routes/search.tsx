import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '#/lib/use-platform'
import { createFileRoute, redirect } from '@tanstack/react-router'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { useProjectNameMap } from '#/components/experiments/experiments-data'
import type { WorkspaceMemberIdentity } from '#/components/projects/project-data'
import {
  fetchSearchFacets,
  parseSearchDay,
  searchQueryKeys,
} from '#/lib/search'
import {
  completeFilter,
  encodeFilter,
  normaliseFilterParam,
  parseSearchSort,
} from '#/lib/search-filter'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useSearchFields } from '#/components/search/use-search-fields'
import { useSearchAi } from './-search-ai'

import {
  readMeaningPreference,
  writeMeaningPreference,
  useSearchFacets,
  useSearchMeaning,
  useSearchPlugins,
  useSearchResults,
} from './-search-page-model'
import type { SearchPageSearch } from './-search-page-model'
import { SearchControls } from './-search-controls'
import {
  SavedSearchesPopover,
  SearchHeader,
  SearchTypeTabs,
} from './-search-header'
import { SearchResultsSection } from './-search-results'

/**
 * QA3-search-2 — the number of matches to state. The service's `total_count`
 * is the whole match set for the query and the facets it was given; when a
 * client-side facet has already dropped rows from the loaded page, only the
 * rows in hand can be counted, so the page states that instead of a number it
 * cannot back.
 */
export { searchMatchCount } from './-search-page-model'

/** UI port (roadmap-4/ui-app3): the Search results page, wired to the real
 * `search` RPC (records, cell values, comments and file contents) with
 * did-you-mean from `search_did_you_mean`. SRCH-02 pushes the URL facets
 * (type, project, updated) into the RPC and pages with `p_limit`/`p_offset`
 * instead of fetching a fixed 100 rows and slicing locally. */

/** One URL value as text, or nothing when the URL carried something else. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- URL search values arrive unparsed; this is the decoder that yields text or nothing.
function urlText(value: unknown): string | undefined {
  const parsed = z.string().safeParse(value)

  return parsed.success ? parsed.data : undefined
}

/** A repeated URL value, keeping only the entries that are text. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- URL search values arrive unparsed; this is the decoder that yields the text entries.
function urlTextList(value: unknown): string[] | undefined {
  const parsed = z.array(z.unknown()).safeParse(value)

  if (!parsed.success) return undefined

  return parsed.data.flatMap((entry) => {
    const text = z.string().safeParse(entry)

    return text.success ? [text.data] : []
  })
}

export const Route = createFileRoute('/search')({
  validateSearch: (search): SearchPageSearch => ({
    q: urlText(search.q),
    type: urlTextList(search.type),
    project: urlTextList(search.project),
    updated: search.updated === '7d' ? '7d' : undefined,
    owner: urlText(search.owner) || undefined,
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

function SearchPage() {
  const platform = usePlatform()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { context } = Route.useRouteContext()
  const q = search.q ?? ''

  const facetsState = useSearchFacets(search)

  const projectNames = useProjectNameMap()

  const resultsModel = useSearchResults({
    search,
    active: facetsState.active,
    q,
    treeFilter: facetsState.treeFilter,
  })

  // Search by meaning: on by default wherever the lab has turned it on, and a
  // per-person switch. It adds what the words missed; it never hides a result.
  const workspaceId = context.workspace?.id ?? ''
  const [meaningOn, setMeaningOn] = useState(readMeaningPreference)

  const meaning = useSearchMeaning({
    workspaceId,
    q,
    filterCount: facetsState.filterCount,
    meaningOn,
  })

  const plugins = useSearchPlugins({
    workspaceId,
    q,
    filterCount: facetsState.filterCount,
  })

  const members = useQuery({
    queryKey: ['ui-port', 'workspace-members'],
    queryFn: () =>
      notebookDataClient.rpc<WorkspaceMemberIdentity[]>(
        'workspace_members_list',
        {},
      ),
    enabled: facetsState.active,
    staleTime: 60_000,
  })

  // A query or facet change is a new place in the history: Back returns to the
  // previous query rather than skipping past it. A callback, so the controls
  // that call it keep one identity across renders.
  const setSearch = useCallback(
    (patch: Partial<SearchPageSearch>) =>
      void navigate({
        to: '/search',
        search: (s) => ({ ...s, ...patch }),
      }),
    [navigate],
  )

  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])

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

  const filterFields = useSearchFields(resultsModel.typeFields)
  const draftComplete = draftTree ? completeFilter(draftTree) : undefined
  const draftEncoded = draftComplete ? encodeFilter(draftComplete) : undefined

  const draftCount = useQuery({
    queryKey: [
      'search-draft-count',
      ...searchQueryKeys.search(resultsModel.facetFilters),
      draftEncoded ?? null,
    ],
    queryFn: async () => {
      const rows = await fetchSearchFacets(notebookDataClient, {
        ...resultsModel.facetFilters,
        filter: draftComplete,
      })

      return rows.reduce((sum, row) => sum + row.count, 0)
    },
    enabled: builderOpen && Boolean(draftEncoded),
    staleTime: 10_000,
  })

  const ai = useSearchAi({
    draft,
    setDraft,
    filterFields,
    setSearch,
    onOpenBuilder: () => setBuilderOpen(true),
  })

  const closeBuilder = () => {
    setBuilderOpen(false)
    setFocusId(undefined)
    setDraftTree(null)
  }

  const savedEl = context.workspace ? (
    <SavedSearchesPopover
      workspaceId={context.workspace.id}
      userId={context.user.id}
      role={context.workspace.role}
      q={q}
      search={search}
    />
  ) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SearchHeader
        active={facetsState.active}
        q={q}
        matchCount={resultsModel.matchCount}
        morePending={resultsModel.morePending}
        shownCount={resultsModel.results.length}
        typeFilterCount={facetsState.typeFilter.length}
        saved={savedEl}
        typeTabs={
          facetsState.active ? (
            <SearchTypeTabs
              search={search}
              facets={resultsModel.facets}
              matchCount={resultsModel.matchCount}
              activeType={facetsState.activeType}
              partial={resultsModel.partial}
            />
          ) : undefined
        }
      />
      <SearchControls
        search={search}
        setSearch={setSearch}
        results={resultsModel}
        facetsState={facetsState}
        projectNames={projectNames.data}
        members={members.data}
        meaningAvailable={meaning.meaningAvailable}
        meaningOn={meaningOn}
        onMeaningChange={(on) => {
          setMeaningOn(on)
          writeMeaningPreference(on)
        }}
        controls={{
          draft,
          setDraft,
          builderOpen,
          focusId,
          setFocusId,
          draftTree,
          setDraftTree,
          filterFields,
          draftEncoded,
          draftCount,
          ai,
          closeBuilder,
          openBuilder: () => setBuilderOpen(true),
          toggleBuilder: () =>
            builderOpen ? closeBuilder() : setBuilderOpen(true),
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        <SearchResultsSection
          active={facetsState.active}
          platform={platform}
          q={q}
          search={search}
          results={resultsModel.results}
          query={resultsModel.query}
          suggestions={resultsModel.suggestionQuery.data ?? []}
          facetFilterCount={facetsState.facetFilterCount}
          setSearch={setSearch}
          projectNames={projectNames.data}
          meaning={meaning}
          plugins={plugins}
        />
      </div>
    </div>
  )
}
