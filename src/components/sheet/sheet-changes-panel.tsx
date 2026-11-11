/**
 * Show changes: the change list under the grid and one cell's history beside
 * it. Both read the same recorded changes; showing them is optional, keeping
 * them is not.
 */
import { t } from '#/copy'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

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
      <del className="text-fg-muted">{row.before}</del>
      <span aria-hidden="true" className="px-1 text-fg-muted">
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
  return (
    <section
      aria-label={t('notebook.sheetChanges.listAriaLabel')}
      className="flex max-h-56 shrink-0 flex-col border-t"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
        <span className="text-body font-medium">
          {t('notebook.sheetChanges.title')}
        </span>
        <span className="text-label text-fg-muted">
          {t('notebook.sheetChanges.today', { count: todayCount })}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-fg-muted max-md:hidden">
          {t('notebook.sheetChanges.alwaysRecorded')}
        </span>
      </div>
      <div className="min-h-0 overflow-auto">
        <Table caption={t('notebook.sheetChanges.listAriaLabel')}>
          <TableHeader>
            <tr>
              <TableHead>{t('notebook.sheetChanges.who')}</TableHead>
              <TableHead>{t('notebook.sheetChanges.cell')}</TableHead>
              <TableHead>{t('notebook.sheetChanges.beforeAfter')}</TableHead>
              <TableHead className="w-full">
                {t('notebook.sheetChanges.reason')}
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody colSpan={4} empty={t('notebook.sheetChanges.none')}>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                selected={row.cellKey === selectedCellKey}
                className="cursor-pointer"
                onClick={() => onSelect(row)}
              >
                <TableCell>
                  {row.who}
                  <span className="text-fg-muted"> · {row.when}</span>
                </TableCell>
                <TableCell>{row.cell}</TableCell>
                <TableCell>
                  <BeforeAfter row={row} />
                </TableCell>
                <TableCell className="max-w-0 truncate text-fg-muted">
                  {row.reason
                    ? t('notebook.sheetChanges.reasonQuoted', {
                        reason: row.reason,
                      })
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
      className="w-72 shrink-0 space-y-3 overflow-y-auto border-l px-3 py-3 max-md:w-full max-md:flex-none max-md:overflow-visible max-md:border-t max-md:border-l-0"
    >
      {cell ? (
        <>
          <div>
            <div className="text-label text-fg-muted">{cell.title}</div>
            <div className="text-lg font-medium">{cell.value || '—'}</div>
          </div>
          <div className="space-y-2">
            <h4 className="text-label font-medium text-fg-muted">
              {t('notebook.sheetChanges.historyTitle')}
            </h4>
            {cell.rows.length === 0 ? (
              <p className="text-label text-fg-muted">
                {t('notebook.sheetChanges.noCellChanges')}
              </p>
            ) : (
              <ul className="space-y-2">
                {cell.rows.map((row) => (
                  <li key={row.id} className="flex gap-3 text-label">
                    <span className="w-12 shrink-0 text-fg-muted">
                      {row.when}
                    </span>
                    <span className="min-w-0">
                      {row.who} · <BeforeAfter row={row} />
                      {row.reason ? (
                        <span className="block text-fg-muted">
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
        <p className="text-label text-fg-muted">
          {t('notebook.sheetChanges.selectCell')}
        </p>
      )}
    </aside>
  )
}
