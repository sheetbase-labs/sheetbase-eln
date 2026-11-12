/**
 * Show changes: the change list under the grid and one cell's history beside
 * it. Both read the same recorded changes; showing them is optional, keeping
 * them is not.
 */
import { t } from '#/copy'
import { cn } from '#/lib/utils'
import './sheet-board.css'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'

export interface SheetChangeRow {
  id: string
  /** The cell the change is on, as `cellAddressKey` names it. */
  cellKey: string
  who: string
  when: string
  /** "Row 9 · Load" */
  cell: string
  before: string
  after: string
  /** False for the first change after a sheet was made with values in it. */
  beforeKnown: boolean
  reason: string | null
  /** Whether the change is written. Recorded changes always are. */
  save?: 'saved' | 'saving' | 'failed'
  /** Try a failed change again. */
  onRetry?: () => void
}

/** The change's own save state: a small mark and a word. */
function SaveState({ row }: { row: SheetChangeRow }) {
  const save = row.save ?? 'saved'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        save === 'failed' && 'text-danger-text',
        save === 'saving' && 'text-fg-muted',
      )}
    >
      <SheetWriteMark state={save} />
      {save === 'saved'
        ? t('notebook.sheetToolbar.saved')
        : save === 'saving'
          ? t('notebook.sheetToolbar.saving')
          : t('notebook.sheetToolbar.saveFailed')}
      {save === 'failed' && row.onRetry ? (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            title={t('notebook.sheetChanges.retryHint')}
            className="text-primary-text hover:underline"
            onClick={(event) => {
              event.stopPropagation()
              row.onRetry?.()
            }}
          >
            {t('notebook.sheetChanges.retry')}
          </button>
        </>
      ) : null}
    </span>
  )
}

/** The 7px write mark: filled when saved or failed, a ring while saving. */
export function SheetWriteMark({
  state,
}: {
  state: 'saved' | 'saving' | 'failed'
}) {
  return (
    <span
      aria-hidden="true"
      data-write-mark={state}
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        state === 'saved' && 'bg-success',
        state === 'failed' && 'bg-danger',
        state === 'saving' && 'border border-fg-muted',
      )}
    />
  )
}

/** Before → after, with the old value struck through. */
function BeforeAfter({ row }: { row: SheetChangeRow }) {
  if (!row.beforeKnown) return <span>{row.after || '—'}</span>

  if (row.before === '')
    return (
      <span>{t('notebook.sheetChanges.entered', { value: row.after })}</span>
    )

  return (
    <span>
      <del>{row.before}</del>
      <span aria-hidden="true" className="ar">
        →
      </span>
      <span className="sr-only">{t('notebook.sheetChanges.to')}</span>
      {row.after || t('notebook.sheetChanges.cleared')}
    </span>
  )
}

export function SheetChangeList({
  rows,
  todayCount,
  selectedCellKey,
  onSelect,
}: {
  rows: readonly SheetChangeRow[]
  todayCount: number
  selectedCellKey: string | null
  onSelect: (row: SheetChangeRow) => void
}) {
  const columns: RegistryColumn<SheetChangeRow>[] = [
    {
      id: 'who',
      header: t('notebook.sheetChanges.who'),
      accessorFn: (row) => row.who,
      cell: ({ row }) => (
        <>
          {row.original.who}
          <span className="text-fg-muted"> · {row.original.when}</span>
        </>
      ),
    },
    {
      id: 'cell',
      header: t('notebook.sheetChanges.cell'),
      accessorFn: (row) => row.cell,
    },
    {
      id: 'beforeAfter',
      header: t('notebook.sheetChanges.beforeAfter'),
      enableSorting: false,
      cell: ({ row }) => <BeforeAfter row={row.original} />,
    },
    {
      id: 'reason',
      header: t('notebook.sheetChanges.reason'),
      accessorFn: (row) => row.reason ?? '',
      cell: ({ row }) => (
        <span className="block max-w-80 truncate text-fg-muted">
          {row.original.reason
            ? t('notebook.sheetChanges.reasonQuoted', {
                reason: row.original.reason,
              })
            : '—'}
        </span>
      ),
    },
    {
      id: 'save',
      header: t('notebook.sheetChanges.save'),
      enableSorting: false,
      cell: ({ row }) => <SaveState row={row.original} />,
    },
  ]

  return (
    <section
      aria-label={t('notebook.sheetChanges.listAriaLabel')}
      className="flex max-h-56 shrink-0 flex-col"
    >
      <div className="tx-lh">
        <b>{t('notebook.sheetChanges.title')}</b>
        <span>
          {todayCount === 0
            ? t('notebook.sheetChanges.noneToday')
            : t('notebook.sheetChanges.today', { count: todayCount })}
        </span>
        <span className="flex-1" />
        <span className="max-md:hidden">
          {t('notebook.sheetChanges.alwaysRecorded')}
        </span>
      </div>
      <div className="tx-lt min-h-0 overflow-auto">
        <RegistryGrid
          label={t('notebook.sheetChanges.listAriaLabel')}
          rows={[...rows]}
          columns={columns}
          getRowId={(row) => row.id}
          rowSelection={Object.fromEntries(
            rows
              .filter((row) => row.cellKey === selectedCellKey)
              .map((row) => [row.id, true]),
          )}
          onRowClick={(row) => onSelect(row)}
          empty={t('notebook.sheetChanges.none')}
        />
      </div>
    </section>
  )
}

export function SheetCellHistory({
  cell,
}: {
  cell: { title: string; value: string; rows: readonly SheetChangeRow[] } | null
}) {
  return (
    <aside
      aria-label={t('notebook.sheetChanges.historyAriaLabel')}
      className="tx-side max-md:w-full max-md:flex-none max-md:border-t max-md:border-l-0"
    >
      {cell ? (
        <>
          <div>
            <div className="tx-sk">{cell.title}</div>
            <div className="tx-big">{cell.value || '—'}</div>
          </div>
          <div>
            <h4>{t('notebook.sheetChanges.historyTitle')}</h4>
            {cell.rows.length === 0 ? (
              <p className="tx-sk">
                {t('notebook.sheetChanges.noCellChanges')}
              </p>
            ) : (
              <ul className="tx-trail">
                {cell.rows.map((row) => (
                  <li key={row.id}>
                    <span className="t">{row.when}</span>
                    <span>
                      {row.who} · <BeforeAfter row={row} />
                      {row.reason ? (
                        <span className="q">
                          {t('notebook.sheetChanges.reasonQuoted', {
                            reason: row.reason,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="tx-sk">{t('notebook.sheetChanges.selectCell')}</p>
      )}
    </aside>
  )
}
