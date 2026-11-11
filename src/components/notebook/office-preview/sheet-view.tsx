import { useState } from 'react'

import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import type { PreviewSheet } from '#/lib/office-preview/sheets'
import { cn } from '#/lib/utils'

/** A column letter the way a spreadsheet writes it: A, B … Z, AA. */
function columnLetter(index: number): string {
  let n = index
  let out = ''

  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)

  return out
}

/** The sheets of a workbook in the app's shared table, one tab per sheet. */
export function SheetView({
  sheets,
  name,
  tall,
}: {
  sheets: PreviewSheet[]
  name: string
  tall?: boolean
}) {
  const [active, setActive] = useState(0)
  const sheet = sheets.at(Math.min(active, sheets.length - 1))

  if (!sheet)
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.officeFiles.emptySheet')}
      </p>
    )
  const width = sheet.rows.reduce((n, row) => Math.max(n, row.length), 0)
  const shownColumns = Array.from({ length: width }, (_, i) => i)

  const gridRows = sheet.rows.map((cells, index) => ({ index, cells }))

  const gridColumns: RegistryColumn<(typeof gridRows)[number]>[] = [
    {
      id: 'row',
      header: '#',
      accessorFn: (row) => row.index + 1,
      meta: {
        headerClassName: 'text-right',
        cellClassName: 'num text-right text-fg-muted',
      },
    },
    ...shownColumns.map((c): RegistryColumn<(typeof gridRows)[number]> => ({
      id: `col:${c}`,
      header: columnLetter(c),
      accessorFn: (row) => row.cells[c] ?? '',
      cell: ({ row }) => (
        <span className="block max-w-64 truncate">
          {row.original.cells[c] ?? ''}
        </span>
      ),
    })),
  ]

  return (
    <div className="space-y-2">
      {sheets.length > 1 ? (
        <Tabs
          mode="state"
          variant="segment"
          label={t('notebook.officeFiles.sheetTabs', { name })}
          items={sheets.map((s, i) => ({ key: String(i), label: s.name }))}
          value={String(Math.min(active, sheets.length - 1))}
          onValueChange={(key) => setActive(Number(key))}
        />
      ) : null}
      {sheet.rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {t('notebook.officeFiles.emptySheet')}
        </p>
      ) : (
        <TableBox
          className={cn('overflow-y-auto', tall ? 'max-h-[70vh]' : 'max-h-80')}
        >
          <RegistryGrid
            label={sheet.name}
            rows={gridRows}
            columns={gridColumns}
            getRowId={(row) => String(row.index)}
            selectable={false}
          />
        </TableBox>
      )}
      {sheet.totalRows > sheet.rows.length ? (
        <p className="text-caption text-fg-muted">
          {t('notebook.officeFiles.sheetCut', {
            rows: sheet.rows.length,
            total: sheet.totalRows,
          })}
        </p>
      ) : null}
      {sheet.totalColumns > width ? (
        <p className="text-caption text-fg-muted">
          {t('notebook.officeFiles.sheetCutColumns', {
            columns: width,
            total: sheet.totalColumns,
          })}
        </p>
      ) : null}
    </div>
  )
}
