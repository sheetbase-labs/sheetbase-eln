import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { FilterMenu } from '#/components/ui/filter-menu'
import { PHONE_SCROLL_ROW } from '#/components/inventory/list'
import { andFilters, encodeFilter, SEARCH_SORTS } from '#/lib/search-filter'
import type { SearchSort } from '#/lib/search-filter'
import { parseTypedSearch } from '#/lib/search-query'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import type { useSearchFields } from '#/components/search/use-search-fields'
import type { usePageAi } from '#/lib/use-page-ai'
import type { WorkspaceMemberIdentity } from '#/components/projects/project-data'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

import type { SearchPageSearch } from './-search-page-model'

const SORT_LABELS = {
  relevance: 'projects.searchFilter.sortRelevance',
  updated: 'projects.searchFilter.sortUpdated',
  created: 'projects.searchFilter.sortCreated',
} as const

type PageAi = ReturnType<typeof usePageAi>

/**
 * The search toolbar: the words, sort, the quick filters, the by-meaning
 * switch and the rule builder.
 */
export function SearchToolbar({
  search,
  setSearch,
  draft,
  setDraft,
  treeFilter,
  filterFields,
  active,
  sort,
  facets,
  projectFilter,
  projectNames,
  partial,
  updatedFilter,
  members,
  meaningAvailable,
  meaningOn,
  onMeaningChange,
  builderOpen,
  onBuilderToggle,
  ai,
  aiPhase,
  onAskAi,
}: {
  search: SearchPageSearch
  setSearch: (patch: Partial<SearchPageSearch>) => void
  draft: string
  setDraft: (value: string) => void
  treeFilter: GroupNode | undefined
  filterFields: ReturnType<typeof useSearchFields>
  active: boolean
  sort: SearchSort
  facets: { projects: Map<string, number> }
  projectFilter: string[]
  projectNames: ReadonlyMap<string, string> | undefined
  partial: (count: number) => string
  updatedFilter: 'any' | '7d'
  members: WorkspaceMemberIdentity[] | undefined
  meaningAvailable: boolean
  meaningOn: boolean
  onMeaningChange: (on: boolean) => void
  builderOpen: boolean
  onBuilderToggle: () => void
  ai: PageAi
  aiPhase: 'idle' | 'running' | 'done' | 'failed'
  onAskAi: () => void
}) {
  return (
    <div
      role="group"
      aria-label={t('projects.searchFilter.filtersLabel')}
      className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6"
    >
      <SearchForm
        draft={draft}
        onDraftChange={setDraft}
        treeFilter={treeFilter}
        filterFields={filterFields}
        setSearch={setSearch}
      />
      <div className={PHONE_SCROLL_ROW}>
        {ai.live && draft.trim().split(/\s+/).length > 2 ? (
          <Button
            variant="secondary"
            size="sm"
            icon="spark"
            disabled={aiPhase === 'running'}
            data-testid="search-ai-ask"
            title={t('projects.searchAi.hint')}
            onClick={onAskAi}
          >
            {aiPhase === 'running'
              ? t('projects.searchAi.working')
              : t('projects.searchAi.button')}
          </Button>
        ) : null}
        {active ? (
          <SearchFacetMenus
            search={search}
            setSearch={setSearch}
            sort={sort}
            facets={facets}
            projectFilter={projectFilter}
            projectNames={projectNames}
            partial={partial}
            updatedFilter={updatedFilter}
            members={members}
          />
        ) : null}
        {meaningAvailable ? (
          <Button
            variant="quiet"
            size="sm"
            aria-pressed={meaningOn}
            icon={meaningOn ? 'check' : undefined}
            title={t('projects.searchMeaning.toggleTip')}
            className={cn(meaningOn && 'bg-selection hover:bg-selection')}
            onClick={() => onMeaningChange(!meaningOn)}
          >
            {t('projects.searchMeaning.toggle')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={builderOpen ? 'secondary' : 'quiet'}
          icon={builderOpen ? 'chevronDown' : 'filter'}
          aria-expanded={builderOpen}
          aria-controls="search-filter-builder"
          onClick={onBuilderToggle}
        >
          {builderOpen
            ? t('projects.searchFilter.hideFilters')
            : treeFilter
              ? t('projects.searchFilter.editFilters')
              : t('projects.searchFilter.addFilter')}
        </Button>
      </div>
    </div>
  )
}

/** The words box: a typed query becomes filters on submit. */
function SearchForm({
  draft,
  onDraftChange,
  treeFilter,
  filterFields,
  setSearch,
}: {
  draft: string
  onDraftChange: (value: string) => void
  treeFilter: GroupNode | undefined
  filterFields: ReturnType<typeof useSearchFields>
  setSearch: (patch: Partial<SearchPageSearch>) => void
}) {
  return (
    // react-doctor-disable-next-line react-doctor/no-prevent-default -- The typed search runs in place: the form has no action to post to, and a native submit would reload the page.
    <form
      role="search"
      className="relative order-first min-w-0 flex-1 max-lg:basis-full lg:order-none lg:w-[320px] lg:flex-none"
      onSubmit={async (event) => {
        event.preventDefault()

        // `type:sample -project:"AAV8 TFF"` becomes filters; the rest stays text.
        try {
          const typed = await parseTypedSearch(draft, filterFields)
          const merged = andFilters(treeFilter, typed.filter)
          setSearch({
            q: typed.q || undefined,
            filter: encodeFilter(merged),
          })
        } catch {
          // The typed query stays as it is; the person can correct it and submit again.
        }
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
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={t('projects.searchPage.placeholder')}
        title={t('projects.searchFilter.syntaxHint')}
      />
    </form>
  )
}

/** Sort, project, updated, owner and the archived switch — the narrowing facets. */
function SearchFacetMenus({
  search,
  setSearch,
  sort,
  facets,
  projectFilter,
  projectNames,
  partial,
  updatedFilter,
  members,
}: {
  search: SearchPageSearch
  setSearch: (patch: Partial<SearchPageSearch>) => void
  sort: SearchSort
  facets: { projects: Map<string, number> }
  projectFilter: string[]
  projectNames: ReadonlyMap<string, string> | undefined
  partial: (count: number) => string
  updatedFilter: 'any' | '7d'
  members: WorkspaceMemberIdentity[] | undefined
}) {
  return (
    <>
      <SearchSortMenu sort={sort} setSearch={setSearch} />
      {facets.projects.size || projectFilter.length ? (
        <FilterMenu
          label={t('projects.searchPage.project')}
          anyLabel={t('projects.searchPage.anyProject')}
          value={projectFilter.length === 1 ? projectFilter[0] : undefined}
          options={[...facets.projects.entries()].map(([id, count]) => ({
            value: id,
            label: `${projectNames?.get(id) ?? id} (${partial(count)})`,
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
        options={(members ?? []).map((m) => ({
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
  )
}

/** The sort order, named by what it sorts on. */
function SearchSortMenu({
  sort,
  setSearch,
}: {
  sort: SearchSort
  setSearch: (patch: Partial<SearchPageSearch>) => void
}) {
  return (
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
  )
}

/** What the assistant's last filter run said, or nothing while it is idle. */
export function SearchAiNote({
  phase,
  count,
  skipped,
  message,
}: {
  phase: 'idle' | 'running' | 'done' | 'failed'
  count: number
  skipped: string[]
  message: string
}) {
  if (phase === 'done') {
    return (
      <p
        role="status"
        className="m-0 border-b border-border-subtle px-4 py-2 text-label text-fg-muted md:px-6"
        data-testid="search-ai-note"
      >
        {t('projects.searchAi.done', { count })}
        {skipped.length > 0
          ? ` ${t('projects.searchAi.skipped', {
              items: skipped.join('; '),
            })}`
          : ''}
      </p>
    )
  }

  if (phase === 'failed') {
    return (
      <p
        role="status"
        className="m-0 border-b border-border-subtle px-4 py-2 text-label text-fg-muted md:px-6"
      >
        {t('projects.searchAi.failed', { message })}
      </p>
    )
  }

  return null
}
