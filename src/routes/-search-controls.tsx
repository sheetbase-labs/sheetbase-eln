import type {
  SearchPageSearch,
  useSearchFacets,
  useSearchResults,
} from './-search-page-model'
import { encodeFilter } from '#/lib/search-filter'
import type { WorkspaceMemberIdentity } from '#/components/projects/project-data'
import { SearchAiNote, SearchToolbar } from './-search-toolbar'
import { SearchBuilderPanel, SearchChipsRow } from './-search-filters'
import type { useSearchAi } from './-search-ai'
import type { useSearchFields } from '#/components/search/use-search-fields'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import type { UseQueryResult } from '@tanstack/react-query'

/** The state the page holds for the controls it renders. */
export interface SearchControlsModel {
  draft: string
  setDraft: (value: string) => void
  builderOpen: boolean
  focusId: string | undefined
  setFocusId: (id: string) => void
  draftTree: GroupNode | null
  setDraftTree: (tree: GroupNode | null) => void
  filterFields: ReturnType<typeof useSearchFields>
  draftEncoded: ReturnType<typeof encodeFilter> | undefined
  draftCount: UseQueryResult<number>
  ai: ReturnType<typeof useSearchAi>
  closeBuilder: () => void
  openBuilder: () => void
  toggleBuilder: () => void
}

/**
 * The search controls: the words box, the sort and facet menus, the
 * by-meaning switch, the assistant, the filter chips and the rule builder.
 */
export function SearchControls({
  search,
  setSearch,
  facetsState,
  results,
  projectNames,
  members,
  meaningAvailable,
  meaningOn,
  onMeaningChange,
  controls,
}: {
  search: SearchPageSearch
  setSearch: (patch: Partial<SearchPageSearch>) => void
  facetsState: ReturnType<typeof useSearchFacets>
  results: ReturnType<typeof useSearchResults>
  projectNames: ReadonlyMap<string, string> | undefined
  members: WorkspaceMemberIdentity[] | undefined
  meaningAvailable: boolean
  meaningOn: boolean
  onMeaningChange: (on: boolean) => void
  controls: SearchControlsModel
}) {
  return (
    <>
      <SearchToolbar
        search={search}
        setSearch={setSearch}
        draft={controls.draft}
        setDraft={controls.setDraft}
        treeFilter={facetsState.treeFilter}
        filterFields={controls.filterFields}
        active={facetsState.active}
        sort={facetsState.sort}
        facets={results.facets}
        projectFilter={facetsState.projectFilter}
        projectNames={projectNames}
        partial={results.partial}
        updatedFilter={facetsState.updatedFilter}
        members={members}
        meaningAvailable={meaningAvailable}
        meaningOn={meaningOn}
        onMeaningChange={onMeaningChange}
        builderOpen={controls.builderOpen}
        onBuilderToggle={controls.toggleBuilder}
        ai={controls.ai.ai}
        aiPhase={controls.ai.state.phase}
        onAskAi={() => void controls.ai.ask()}
      />
      <SearchAiNote
        phase={controls.ai.state.phase}
        count={controls.ai.state.phase === 'done' ? controls.ai.state.count : 0}
        skipped={
          controls.ai.state.phase === 'done' ? controls.ai.state.skipped : []
        }
        message={
          controls.ai.state.phase === 'failed' ? controls.ai.state.message : ''
        }
      />
      <SearchChipsRow
        search={search}
        treeFilter={facetsState.treeFilter}
        builderOpen={controls.builderOpen}
        filterFields={controls.filterFields}
        setSearch={setSearch}
        onEditFilter={(id) => {
          controls.setFocusId(id)
          controls.openBuilder()
        }}
      />
      {controls.builderOpen ? (
        <SearchBuilderPanel
          treeFilter={facetsState.treeFilter}
          filterFields={controls.filterFields}
          focusId={controls.focusId}
          matchCount={
            controls.draftEncoded ? (controls.draftCount.data ?? null) : null
          }
          onChange={controls.setDraftTree}
          onApply={(tree) => {
            setSearch({ filter: encodeFilter(tree) })
            controls.closeBuilder()
          }}
          onClear={() => setSearch({ filter: undefined })}
        />
      ) : null}
    </>
  )
}
