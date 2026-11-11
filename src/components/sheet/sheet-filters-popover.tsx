/**
 * The toolbar's Filters button: every filter on the sheet in one place. It
 * edits the same filters the column menus set, so the two always agree.
 */
import { useRef, useState } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Select } from '#/components/ui/select'

import type { SheetbaseGridColumn, SheetbaseGridFilter } from './sheetbase-grid'

type FilterOperator = SheetbaseGridFilter['operator']

const OPERATORS: readonly FilterOperator[] = [
  'equals',
  'not-equals',
  'is-empty',
  'is-not-empty',
]

/** A filter row while it is being written; the value is still typed text. */
interface FilterDraft {
  key: number
  columnId: string
  operator: FilterOperator
  text: string
}

function needsValue(operator: FilterOperator): boolean {
  return operator === 'equals' || operator === 'not-equals'
}

function operatorLabel(operator: FilterOperator): string {
  return {
    equals: t('notebook.sheetFilters.is'),
    'not-equals': t('notebook.sheetFilters.isNot'),
    'is-empty': t('notebook.sheetFilters.isEmpty'),
    'is-not-empty': t('notebook.sheetFilters.isNotEmpty'),
  }[operator]
}

function draftText(value: SheetbaseGridFilter['value']): string {
  return value === undefined || value === null ? '' : String(value)
}

/** The stored value for typed text: numbers stay numbers in number columns. */
function filterValue(
  column: SheetbaseGridColumn | undefined,
  text: string,
): string | number | boolean {
  if (column?.type === 'number') {
    const number = Number(text)

    if (text.trim() !== '' && Number.isFinite(number)) return number
  }

  if (column?.type === 'checkbox') return text === 'true'

  return text
}

/** Drafts that say enough to filter by, as the sheet stores them. */
function completeFilters(
  drafts: readonly FilterDraft[],
  columns: readonly SheetbaseGridColumn[],
): SheetbaseGridFilter[] {
  return drafts.flatMap((draft) => {
    if (!needsValue(draft.operator))
      return [{ columnId: draft.columnId, operator: draft.operator }]

    if (draft.text.trim() === '') return []

    const column = columns.find((entry) => entry.id === draft.columnId)

    return [
      {
        columnId: draft.columnId,
        operator: draft.operator,
        value: filterValue(column, draft.text.trim()),
      },
    ]
  })
}

function FilterValueControl({
  column,
  draft,
  onText,
  onCommit,
}: {
  column: SheetbaseGridColumn | undefined
  draft: FilterDraft
  onText: (text: string) => void
  onCommit: (text: string) => void
}) {
  const label = t('notebook.sheetFilters.value')

  if (column?.options?.length || column?.type === 'checkbox') {
    const options = column.options ?? ['true', 'false']

    return (
      <Select
        size="sm"
        aria-label={label}
        className="min-w-0 flex-1"
        value={draft.text}
        onChange={(event) => onCommit(event.target.value)}
      >
        <option value="">{t('notebook.sheetFilters.choose')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {column.type === 'checkbox'
              ? option === 'true'
                ? t('notebook.sheetFilters.ticked')
                : t('notebook.sheetFilters.notTicked')
              : option}
          </option>
        ))}
      </Select>
    )
  }

  return (
    <Input
      aria-label={label}
      placeholder={label}
      inputMode={column?.type === 'number' ? 'decimal' : undefined}
      className="h-[26px] min-w-0 flex-1 text-label max-md:h-8"
      value={draft.text}
      onChange={(event) => onText(event.target.value)}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(event.currentTarget.value)
      }}
    />
  )
}

export function SheetFiltersButton({
  columns,
  filters,
  onChange,
  compact = false,
}: {
  columns: readonly SheetbaseGridColumn[]
  filters: readonly SheetbaseGridFilter[]
  onChange: (filters: SheetbaseGridFilter[]) => void
  /** Icon only, for a phone toolbar. */
  compact?: boolean
}) {
  const [drafts, setDrafts] = useState<FilterDraft[]>([])
  const nextKey = useRef(0)
  const columnIds = new Set(columns.map((column) => column.id))
  const shown = filters.filter((filter) => columnIds.has(filter.columnId))

  const open = (isOpen: boolean) => {
    if (!isOpen) return

    setDrafts(
      shown.map((filter, index) => ({
        key: index,
        columnId: filter.columnId,
        operator: filter.operator,
        text: draftText(filter.value),
      })),
    )
    nextKey.current = shown.length
  }

  // Filters on columns this view does not show are kept as they are.
  const hiddenFilters = filters.filter(
    (filter) => !columnIds.has(filter.columnId),
  )

  const commit = (next: FilterDraft[]) => {
    setDrafts(next)
    onChange([...hiddenFilters, ...completeFilters(next, columns)])
  }

  const update = (key: number, change: Partial<FilterDraft>, save = true) => {
    const next = drafts.map((draft) =>
      draft.key === key ? { ...draft, ...change } : draft,
    )

    if (save) commit(next)
    else setDrafts(next)
  }

  const add = () => {
    const column = columns.at(0)

    if (!column) return

    const key = nextKey.current
    nextKey.current += 1
    setDrafts([
      ...drafts,
      { key, columnId: column.id, operator: 'equals', text: '' },
    ])
  }

  const label =
    shown.length > 0
      ? t('notebook.sheetToolbar.filters', { count: shown.length })
      : t('notebook.sheetFilters.button')

  return (
    <Popover onOpenChange={open}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="filter"
            aria-label={compact ? label : undefined}
            title={compact ? label : undefined}
            className={
              shown.length > 0
                ? 'border-border-strong text-primary-text'
                : undefined
            }
          />
        }
      >
        {compact ? null : (
          <>
            {/* A narrow toolbar keeps the icon and the count. */}
            <span className="@max-[75rem]:sr-only">{label}</span>
            {shown.length > 0 ? (
              <span aria-hidden="true" className="@min-[75rem]:hidden">
                {shown.length}
              </span>
            ) : null}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(26rem,calc(100vw-1rem))] p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <PopoverTitle className="text-label font-semibold text-fg">
            {t('notebook.sheetFilters.title')}
          </PopoverTitle>
          {drafts.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => commit([])}
            >
              {t('notebook.sheetFilters.clearAll')}
            </Button>
          ) : null}
        </div>
        {drafts.length === 0 ? (
          <p className="mb-2 text-label text-fg-muted">
            {t('notebook.sheetFilters.none')}
          </p>
        ) : (
          <ul className="mb-2 flex flex-col gap-2">
            {drafts.map((draft) => {
              const column = columns.find(
                (entry) => entry.id === draft.columnId,
              )

              return (
                <li
                  key={draft.key}
                  className="flex items-center gap-1.5 max-md:flex-wrap"
                >
                  <Select
                    size="sm"
                    aria-label={t('notebook.sheetFilters.column')}
                    className="w-32 shrink-0 max-md:w-full"
                    value={draft.columnId}
                    onChange={(event) =>
                      update(draft.key, {
                        columnId: event.target.value,
                        text: '',
                      })
                    }
                  >
                    {columns.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label={t('notebook.sheetFilters.condition')}
                    className="w-28 shrink-0"
                    value={draft.operator}
                    onChange={(event) => {
                      const operator = OPERATORS.find(
                        (entry) => entry === event.target.value,
                      )

                      if (operator) update(draft.key, { operator })
                    }}
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operatorLabel(operator)}
                      </option>
                    ))}
                  </Select>
                  {needsValue(draft.operator) ? (
                    <FilterValueControl
                      column={column}
                      draft={draft}
                      onText={(text) => update(draft.key, { text }, false)}
                      onCommit={(text) => update(draft.key, { text })}
                    />
                  ) : (
                    <span className="flex-1" />
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="quiet"
                    aria-label={t('notebook.sheetFilters.remove')}
                    title={t('notebook.sheetFilters.remove')}
                    onClick={() =>
                      commit(drafts.filter((entry) => entry.key !== draft.key))
                    }
                  >
                    <Icon name="x" size={13} />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <Button
          type="button"
          size="sm"
          variant="quiet"
          icon="plus"
          disabled={columns.length === 0}
          onClick={add}
        >
          {t('notebook.sheetFilters.add')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
