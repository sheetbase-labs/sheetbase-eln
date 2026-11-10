import { formatShortcut } from '#/lib/shortcuts'
import type { Platform } from '#/lib/shortcuts'

import { Button } from '#/components/ui/button'
import { LoadMore } from '#/components/ui/load-more'
import { Notice } from '#/components/ui/alert'
import { EmptyState } from '#/components/ui/empty-state'
import type { SearchResult } from '#/lib/search'
import { t } from '#/copy'

import { MeaningSection, PluginsSection } from './-search-hits'
import type {
  SearchPageSearch,
  useSearchMeaning,
  useSearchPlugins,
  useSearchResults,
} from './-search-page-model'
import { NoResults } from './-search-no-results'
import { SearchResultsTable } from './-search-results-table'

/** The results page's infinite query, as the table and its footer read it. */
type ResultsQuery = ReturnType<typeof useSearchResults>['query']

/** The page's by-meaning section, as the model returns it. */
type MeaningModel = ReturnType<typeof useSearchMeaning>

/** The page's plugin-hits section, as the model returns it. */
type PluginsModel = ReturnType<typeof useSearchPlugins>

/**
 * Everything under the toolbar: the empty prompt, the failed-search notice,
 * the miss state, the results table, paging, and the by-meaning and plugin
 * sections where they are switched on.
 */
export function SearchResultsSection({
  active,
  platform,
  q,
  search,
  results,
  query,
  suggestions,
  facetFilterCount,
  setSearch,
  projectNames,
  meaning,
  plugins,
}: {
  active: boolean
  platform: Platform
  q: string
  search: SearchPageSearch
  results: SearchResult[]
  query: ResultsQuery
  suggestions: { kind: string; identifier: string; title: string }[]
  facetFilterCount: number
  setSearch: (patch: Partial<SearchPageSearch>) => void
  projectNames: ReadonlyMap<string, string> | undefined
  meaning: MeaningModel
  plugins: PluginsModel
}) {
  if (!active) {
    return (
      <div className="px-4 md:px-6">
        <EmptyState
          icon="search"
          title={t('projects.searchPage.empty.title')}
          description={t('projects.searchPage.empty.body', {
            shortcut: formatShortcut('mod+k', platform),
          })}
        />
      </div>
    )
  }

  return (
    <>
      <SearchErrorNotice query={query} />

      <SearchMissState
        query={query}
        results={results}
        q={q}
        search={search}
        suggestions={suggestions}
        facetFilterCount={facetFilterCount}
        setSearch={setSearch}
      />

      <SearchWordResults
        results={results}
        query={query}
        q={q}
        projectNames={projectNames}
        showMeaning={meaning.showMeaning}
      />

      <LoadMore
        label={t('projects.searchPage.resultsLabel')}
        className="my-4 px-4 md:px-6"
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
      />

      {meaning.showMeaning ? (
        <MeaningSection
          pending={meaning.meaningQuery.isPending}
          extras={meaning.meaningExtras}
          used={meaning.meaningQuery.data?.meaning.used}
          message={
            meaning.meaningQuery.data?.meaning.used === false
              ? meaning.meaningQuery.data.meaning.message
              : undefined
          }
        />
      ) : null}

      {plugins.showPlugins ? (
        <PluginsSection
          pending={plugins.pluginQuery.isPending}
          hits={plugins.pluginQuery.data?.hits ?? []}
          problems={plugins.pluginQuery.data?.problems ?? []}
        />
      ) : null}
    </>
  )
}

/** A failed search, said once with the way to try it again. */
function SearchErrorNotice({ query }: { query: ResultsQuery }) {
  if (!query.isError) return null

  return (
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
  )
}

/** The miss state: shown only once the search has finished with nothing found. */
function SearchMissState({
  query,
  results,
  q,
  search,
  suggestions,
  facetFilterCount,
  setSearch,
}: {
  query: ResultsQuery
  results: SearchResult[]
  q: string
  search: SearchPageSearch
  suggestions: { kind: string; identifier: string; title: string }[]
  facetFilterCount: number
  setSearch: (patch: Partial<SearchPageSearch>) => void
}) {
  const nothingFound =
    !query.isError &&
    !query.isLoading &&
    results.length === 0 &&
    !query.hasNextPage

  if (!nothingFound) return null

  return (
    <div className="px-4 md:px-6">
      <NoResults
        q={q}
        archived={Boolean(search.archived)}
        filtered={facetFilterCount > 0}
        suggestions={suggestions.filter(
          (s) => s.identifier.toLowerCase() !== q.trim().toLowerCase(),
        )}
        onArchivedChange={(on) => setSearch({ archived: on || undefined })}
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
  )
}

/** The word results, sized to their rows when a by-meaning section follows. */
function SearchWordResults({
  results,
  query,
  q,
  projectNames,
  showMeaning,
}: {
  results: SearchResult[]
  query: ResultsQuery
  q: string
  projectNames: ReadonlyMap<string, string> | undefined
  showMeaning: boolean
}) {
  if (!results.length && !query.isLoading) return null

  return (
    // With a "Close in meaning" section below, the word results take just the
    // room their rows need instead of the whole pane.
    <div
      className={showMeaning ? 'shrink-0' : 'min-h-0 flex-1'}
      style={
        showMeaning
          ? {
              height: Math.min(results.length * 33 + 52, 420),
            }
          : undefined
      }
    >
      <SearchResultsTable
        results={results}
        q={q}
        projectNames={projectNames}
        isLoading={query.isLoading}
      />
    </div>
  )
}
