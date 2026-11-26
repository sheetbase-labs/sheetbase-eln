/**
 * The filter control every record list shares: a Filter button that opens the
 * builder (column, then operator, then value), and one chip per condition under
 * the toolbar that edits or removes itself. The tree it edits is the one in the
 * list's `filter` URL parameter (`useListFilter`).
 */
import { useMemo, useState } from 'react'
import {
  FilterBuilder,
  FilterChips,
} from '@sheetbase-labs/sheetbase-advanced-search'
import { emptyCondition, emptyRoot } from '@sheetbase-labs/sheetbase-shared'
import type {
  GroupNode,
  SheetbaseField,
} from '@sheetbase-labs/sheetbase-shared'

import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { t } from '#/copy'
import { countConditions } from '#/lib/search-filter'
import { activeFilter } from '#/lib/list-filter'
import { withoutNode } from '#/lib/search-filter'

export interface ListFilter {
  /** The columns a person can filter by, with their types and options. */
  fields: readonly SheetbaseField[]
  /** The filter now set, from the URL. */
  tree: GroupNode | undefined
  onChange: (tree: GroupNode | undefined) => void
}

/** The builder's open state, shared by the button and the chips. */
export function useFilterPopover() {
  const [open, setOpen] = useState(false)
  const [focusId, setFocusId] = useState<string>()

  return {
    open,
    focusId,
    setOpen: (next: boolean) => {
      setOpen(next)
      if (!next) setFocusId(undefined)
    },
    edit: (id: string) => {
      setFocusId(id)
      setOpen(true)
    },
  }
}

export type FilterPopover = ReturnType<typeof useFilterPopover>

export function ListFilterButton({
  filter,
  popover,
}: {
  filter: ListFilter
  popover: FilterPopover
}) {
  const count = filter.tree ? countConditions(filter.tree) : 0

  // With nothing set the builder opens on one blank row: pick a column, then
  // an operator, then a value, with no "add a rule" step first.
  const start = useMemo<GroupNode>(
    () => ({ ...emptyRoot(), children: [emptyCondition()] }),
    [],
  )

  return (
    <Popover open={popover.open} onOpenChange={popover.setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="quiet"
            size="sm"
            icon="filter"
            className={count ? 'bg-selection hover:bg-selection' : undefined}
          />
        }
      >
        {count
          ? t('library.listFilter.addCount', { count })
          : t('library.listFilter.add')}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="sheetbase-scope w-[min(560px,calc(100vw-1rem))] p-3"
        aria-label={t('library.listFilter.title')}
      >
        <FilterBuilder
          variant="inline"
          node={filter.tree ?? start}
          fields={filter.fields}
          focusId={popover.focusId}
          onApply={(tree) => {
            filter.onChange(activeFilter(tree))
            popover.setOpen(false)
          }}
          onClear={() => {
            filter.onChange(undefined)
            popover.setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The chips for what is set; nothing at all while the filter is empty. */
export function ListFilterChips({
  filter,
  popover,
}: {
  filter: ListFilter
  popover: FilterPopover
}) {
  const tree = filter.tree

  if (!tree || countConditions(tree) === 0) return null

  return (
    <div
      role="group"
      aria-label={t('library.listFilter.chipsLabel')}
      className="sheetbase-scope flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6"
    >
      <FilterChips
        node={tree}
        fields={filter.fields}
        onRemove={(id) => filter.onChange(activeFilter(withoutNode(tree, id)))}
        onEdit={popover.edit}
        onAdd={() => popover.setOpen(true)}
      />
    </div>
  )
}
