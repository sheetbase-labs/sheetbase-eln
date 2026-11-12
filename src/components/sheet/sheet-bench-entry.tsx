/**
 * Bench entry: one run of the sheet at a time, as a strip of large fields
 * above the grid. It is the same table and the same values as the grid; the
 * mode only changes how a row is typed. Tab moves between fields, Enter saves
 * the row, Ctrl/⌘ ↓ and ↑ move to the next or previous run, Esc discards.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { BoardButton } from '#/features/pipelines/board/board'
import './sheet-board.css'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { cn } from '#/lib/utils'
import {
  benchInputText,
  benchRange,
  benchRangeBreach,
  benchReadOnlyReason,
} from './sheet-bench-fields'
import type {
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
} from './sheetbase-grid'

export interface SheetBenchChange {
  columnId: string
  previous: SheetbaseGridCellValue
  next: string
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

/** The run on the strip, as the board names it: its number in a chip, then its first
 * column's value ("9 · C-150"), with where it sits among the runs. */
function BenchRunTitle({
  number,
  count,
  name,
}: {
  number: number
  count: number
  name: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="tx-esr">{number}</span>
      {name ? (
        <b className="truncate text-[14px] font-semibold text-fg">{name}</b>
      ) : null}
      <span className="shrink-0 text-label text-fg-muted">
        {t('notebook.sheetBench.rowOf', { row: number, count })}
      </span>
    </span>
  )
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
    () => columns.map((_, index) => benchInputText(values[index])),
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
      className="pb-scope tx-es shrink-0"
      onKeyDown={onKeyDown}
    >
      <div className="tx-est flex-wrap">
        {isNew ? (
          <b className="text-[14px] font-semibold text-fg">
            {t('notebook.sheetBench.newRun')}
          </b>
        ) : (
          <BenchRunTitle
            number={rowIndex + 1}
            count={rowCount}
            name={cellText(values[0], gridColumns[0])}
          />
        )}
        <BoardButton
          size="sm"
          variant="quiet"
          iconOnly
          icon="chevronUp"
          aria-label={t('notebook.sheetBench.previous')}
          disabled={rowIndex === 0}
          onClick={() => move(-1)}
        />
        <BoardButton
          size="sm"
          variant="quiet"
          iconOnly
          icon="chevronDown"
          aria-label={t('notebook.sheetBench.next')}
          disabled={isNew}
          onClick={() => move(1)}
        />
        <span className="flex-1" />
        {dirty ? (
          <span className="tx-sv" role="status">
            <i className="tx-dot" aria-hidden="true" />
            {t('notebook.sheetBench.unsaved', { count: changes.length })}
          </span>
        ) : null}
        <BoardButton
          size="sm"
          variant="quiet"
          disabled={!dirty}
          onClick={discard}
        >
          {t('notebook.sheetBench.discard')}
        </BoardButton>
        <BoardButton
          size="sm"
          variant="primary"
          disabled={!dirty || saving}
          onClick={save}
        >
          {t('notebook.sheetBench.saveRow')}
        </BoardButton>
      </div>
      <div className="tx-esf">
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
            <div key={column.id} className="tx-ef">
              <label htmlFor={id} className="tx-efl truncate">
                {column.label}
              </label>
              {reason === null ? (
                <div className="tx-efi">
                  <input
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
                    className={cn('tx-ei', breach && 'bad')}
                    onChange={(event) => {
                      const next = [...draft]
                      next[index] = event.target.value
                      setDraft(next)
                    }}
                  />
                  {unit ? <span className="tx-eu">{unit}</span> : null}
                  {range ? <span className="tx-rule">{range}</span> : null}
                </div>
              ) : (
                <div className="tx-efi">
                  <div id={id} className="tx-ei ro" title={reason}>
                    {shown || '—'}
                  </div>
                </div>
              )}
              {breach ? (
                <p id={`${id}-breach`} className="tx-efm">
                  <Icon name="warn" size={12} aria-hidden="true" />
                  <span>{breach}</span>
                </p>
              ) : reason ? (
                <span className="tx-ew">{reason}</span>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className="tx-keys max-md:hidden">
        <span>
          <kbd className="mx-kbd">{t('notebook.sheetBench.keyTab')}</kbd>
          {t('notebook.sheetBench.keyNextField')}
        </span>
        <span>
          <kbd className="mx-kbd">{t('notebook.sheetBench.keyEnter')}</kbd>
          {t('notebook.sheetBench.keySave')}
        </span>
        <span>
          <kbd className="mx-kbd">{t('notebook.sheetBench.keyCtrlDown')}</kbd>
          {t('notebook.sheetBench.keyNextRow')}
        </span>
        <span>
          <kbd className="mx-kbd">{t('notebook.sheetBench.keyEsc')}</kbd>
          {t('notebook.sheetBench.keyDiscard')}
        </span>
      </p>
    </section>
  )
}
