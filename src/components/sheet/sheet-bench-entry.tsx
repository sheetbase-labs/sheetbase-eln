/**
 * Bench entry: one run of the sheet at a time, as a strip of large fields
 * above the grid. It is the same table and the same values as the grid; the
 * mode only changes how a row is typed. Tab moves between fields, Enter saves
 * the row, Ctrl/⌘ ↓ and ↑ move to the next or previous run, Esc discards.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Kbd } from '#/components/ui/kbd'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { cn } from '#/lib/utils'
import type {
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
} from './sheetbase-grid'

export interface SheetBenchChange {
  columnId: string
  previous: SheetbaseGridCellValue
  next: string
}

/** Why a field can't be typed into here, in a scientist's words. */
export function benchReadOnlyReason(
  column: CanonicalSheetGridColumn,
  canWrite: boolean,
): string | null {
  if (column.origin === 'calculation')
    return t('notebook.sheetBench.calculated')

  if (!canWrite) return t('notebook.sheetBench.viewOnly')

  if (column.presentation.kind === 'record-picker')
    return t('notebook.sheetBench.linkedRecord')

  if (!column.editable) return t('notebook.sheetBench.fromDataset')

  return null
}

/** The allowed range a field states, as text, or null when it states none. */
export function benchRange(column: CanonicalSheetGridColumn): string | null {
  const validation = column.field?.validation
  const unit = column.field?.quantity?.storageUnit
  const min = validation?.min
  const max = validation?.max

  if (min === undefined && max === undefined) return null

  const suffix = unit ? ` ${unit}` : ''

  if (min !== undefined && max !== undefined)
    return t('notebook.sheetBench.rangeBetween', {
      min,
      max,
      unit: suffix,
    })

  return min !== undefined
    ? t('notebook.sheetBench.rangeAtLeast', { min, unit: suffix })
    : t('notebook.sheetBench.rangeAtMost', { max: max ?? '', unit: suffix })
}

/** A typed value outside the field's range, explained; null when it fits. */
export function benchRangeBreach(
  column: CanonicalSheetGridColumn,
  text: string,
): string | null {
  const range = benchRange(column)

  if (!range || text.trim() === '') return null
  const value = Number(text)

  if (!Number.isFinite(value)) return null
  const { min, max } = column.field?.validation ?? {}

  if (min !== undefined && value < min)
    return t('notebook.sheetBench.belowRange', { range })

  if (max !== undefined && value > max)
    return t('notebook.sheetBench.aboveRange', { range })

  return null
}

/** A stored value outside its field's range: the grid shows it in danger text. */
export function outOfRange(
  column: CanonicalSheetGridColumn | undefined,
  value: SheetbaseGridCellValue | undefined,
): boolean {
  if (!column) return false

  return benchRangeBreach(column, inputText(value)) !== null
}

function cellText(
  value: SheetbaseGridCellValue | undefined,
  column: SheetbaseGridColumn | undefined,
): string {
  if (value === null || value === undefined) return ''

  const shown = column?.displayText?.(value)

  if (shown !== undefined) return shown

  if (value instanceof Date) return value.toISOString()

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function inputText(value: SheetbaseGridCellValue | undefined): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) return value.toISOString()

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  if (typeof value === 'number') {
    const size = Math.abs(value)

    // Very large or small magnitudes read as e-notation, which Number() takes back.
    return size !== 0 && (size >= 1e7 || size < 1e-4)
      ? value.toExponential().replace('e+', 'e')
      : String(value)
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A grid cell value is a closed union; typeof picks its member.
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function SheetBenchEntry({
  columns,
  gridColumns,
  rowIndex,
  rowCount,
  values,
  canWrite,
  saving,
  onSave,
  onMove,
}: {
  columns: readonly CanonicalSheetGridColumn[]
  /** The grid's own columns, for how a value is shown. */
  gridColumns: readonly SheetbaseGridColumn[]
  /** The run on the strip, counted from 0; `rowCount` is a new run. */
  rowIndex: number
  rowCount: number
  values: readonly SheetbaseGridCellValue[]
  canWrite: boolean
  saving: boolean
  onSave: (changes: SheetBenchChange[]) => void
  /** Move the strip to another run, or to the new-run row at `rowCount`. */
  onMove: (rowIndex: number) => void
}) {
  const baseId = useId()
  const isNew = rowIndex >= rowCount

  const initial = useMemo(
    () => columns.map((_, index) => inputText(values[index])),
    [columns, values],
  )

  const [draft, setDraft] = useState(initial)
  const firstInput = useRef<HTMLInputElement | null>(null)

  // A different run, or fresh values after a save, replaces the draft.
  useEffect(() => {
    setDraft(initial)
  }, [initial, rowIndex])

  const changes: SheetBenchChange[] = columns.flatMap((column, index) =>
    draft[index] !== initial[index] &&
    benchReadOnlyReason(column, canWrite) === null
      ? [
          {
            columnId: column.id,
            previous: values[index] ?? null,
            next: draft[index] ?? '',
          },
        ]
      : [],
  )

  const dirty = changes.length > 0

  function save() {
    if (!dirty) return
    onSave(changes)
  }

  function discard() {
    setDraft(initial)
  }

  function move(step: number) {
    const next = Math.min(Math.max(rowIndex + step, 0), rowCount)

    if (next === rowIndex) return

    if (dirty) save()
    onMove(next)
    firstInput.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      discard()
    } else if (
      (event.metaKey || event.ctrlKey) &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  let firstEditable = true

  return (
    <section
      aria-label={t('notebook.sheetBench.ariaLabel')}
      className="shrink-0 border-b bg-surface-muted/40 px-3 py-3"
      onKeyDown={onKeyDown}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-body font-medium">
          {isNew
            ? t('notebook.sheetBench.newRun')
            : t('notebook.sheetBench.rowOf', {
                row: rowIndex + 1,
                count: rowCount,
              })}
        </span>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          icon="chevronUp"
          aria-label={t('notebook.sheetBench.previous')}
          disabled={rowIndex === 0}
          onClick={() => move(-1)}
        />
        <Button
          type="button"
          size="sm"
          variant="quiet"
          icon="chevronDown"
          aria-label={t('notebook.sheetBench.next')}
          disabled={isNew}
          onClick={() => move(1)}
        />
        <span className="flex-1" />
        {dirty ? (
          <span className="text-label text-fg-muted" role="status">
            {t('notebook.sheetBench.unsaved', { count: changes.length })}
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={!dirty}
          onClick={discard}
        >
          {t('notebook.sheetBench.discard')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving}
          onClick={save}
        >
          {t('notebook.sheetBench.saveRow')}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-3 gap-y-2">
        {columns.map((column, index) => {
          const id = `${baseId}-${column.id}`
          const reason = benchReadOnlyReason(column, canWrite)
          const range = benchRange(column)
          const unit = column.field?.quantity?.storageUnit

          const breach =
            reason === null
              ? benchRangeBreach(column, draft[index] ?? '')
              : null

          const shown = cellText(values[index], gridColumns[index])
          const takesFocus = reason === null && firstEditable

          if (takesFocus) firstEditable = false

          return (
            <div key={column.id} className="min-w-0 space-y-1">
              <label
                htmlFor={id}
                className="flex items-baseline justify-between gap-2 text-label text-fg-muted"
              >
                <span className="truncate">{column.label}</span>
                {range ? (
                  <span className="shrink-0 text-xs">{range}</span>
                ) : null}
              </label>
              {reason === null ? (
                <div className="relative">
                  <Input
                    id={id}
                    ref={takesFocus ? firstInput : undefined}
                    value={draft[index] ?? ''}
                    inputMode={
                      column.presentation.kind === 'number'
                        ? 'decimal'
                        : undefined
                    }
                    aria-invalid={breach ? true : undefined}
                    aria-describedby={breach ? `${id}-breach` : undefined}
                    className={cn(
                      'h-10 text-[15px]',
                      unit && 'pr-14',
                      breach && 'border-danger text-danger-text',
                    )}
                    onChange={(event) => {
                      const next = [...draft]
                      next[index] = event.target.value
                      setDraft(next)
                    }}
                  />
                  {unit ? (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-label text-fg-muted">
                      {unit}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div
                  id={id}
                  className="flex h-10 items-center truncate rounded-md border border-border-subtle bg-surface-muted px-3 text-[15px] text-fg-muted"
                  title={reason}
                >
                  {shown || '—'}
                </div>
              )}
              {breach ? (
                <p id={`${id}-breach`} className="text-xs text-danger-text">
                  {breach}
                </p>
              ) : reason ? (
                <p className="text-xs text-fg-muted">{reason}</p>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted max-md:hidden">
        <span>
          <Kbd>{t('notebook.sheetBench.keyTab')}</Kbd>{' '}
          {t('notebook.sheetBench.keyNextField')}
        </span>
        <span>
          <Kbd>{t('notebook.sheetBench.keyEnter')}</Kbd>{' '}
          {t('notebook.sheetBench.keySave')}
        </span>
        <span>
          <Kbd>{t('notebook.sheetBench.keyCtrlDown')}</Kbd>{' '}
          {t('notebook.sheetBench.keyNextRow')}
        </span>
        <span>
          <Kbd>{t('notebook.sheetBench.keyEsc')}</Kbd>{' '}
          {t('notebook.sheetBench.keyDiscard')}
        </span>
      </p>
    </section>
  )
}
