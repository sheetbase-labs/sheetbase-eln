import { Chip } from '#/components/ui/chip'
import {
  FilterBuilder,
  FilterChips,
} from '@sheetbase-labs/sheetbase-advanced-search'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'
import type { useSearchFields } from '#/components/search/use-search-fields'
import { encodeFilter, withoutNode } from '#/lib/search-filter'
import { t } from '#/copy'

import type { SearchPageSearch } from './-search-page-model'

/**
 * The chips under the toolbar: the record of what narrows the list, the way
 * the Experiments list shows its own.
 */
export function SearchChipsRow({
  search,
  treeFilter,
  builderOpen,
  filterFields,
  setSearch,
  onEditFilter,
}: {
  search: SearchPageSearch
  treeFilter: GroupNode | undefined
  builderOpen: boolean
  filterFields: ReturnType<typeof useSearchFields>
  setSearch: (patch: Partial<SearchPageSearch>) => void
  onEditFilter: (id: string) => void
}) {
  const dateRangeSet = Boolean(search.from || search.to)

  if (!((treeFilter && !builderOpen) || dateRangeSet)) return null

  return (
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
          onEdit={onEditFilter}
        />
      ) : null}
    </div>
  )
}

/**
 * The builder under the toolbar, full width, so a question with groups reads
 * as one block. Apply folds it back to the chips.
 */
export function SearchBuilderPanel({
  treeFilter,
  filterFields,
  focusId,
  matchCount,
  onChange,
  onApply,
  onClear,
}: {
  treeFilter: GroupNode | undefined
  filterFields: ReturnType<typeof useSearchFields>
  focusId: string | undefined
  matchCount: number | null
  onChange: (tree: GroupNode | null) => void
  onApply: (tree: GroupNode) => void
  onClear: () => void
}) {
  return (
    <div
      id="search-filter-builder"
      className="sheetbase-scope border-b border-border-subtle px-4 py-3 md:px-6"
    >
      <FilterBuilder
        variant="inline"
        node={treeFilter ?? null}
        fields={filterFields}
        focusId={focusId}
        matchCount={matchCount}
        onChange={onChange}
        onApply={onApply}
        onClear={onClear}
      />
    </div>
  )
}
