import { useState } from 'react'

import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
          <Table caption={sheet.name}>
            <TableHeader>
              <tr>
                <TableHead className="sticky top-0 w-10 text-right">
                  <span className="sr-only">#</span>
                </TableHead>
                {shownColumns.map((i) => (
                  <TableHead key={i} className="sticky top-0">
                    {columnLetter(i)}
                  </TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {sheet.rows.map((row, r) => (
                <TableRow key={r}>
                  <TableCell align="right" className="num text-fg-muted">
                    {r + 1}
                  </TableCell>
                  {shownColumns.map((c) => (
                    <TableCell key={c} className="max-w-64 truncate">
                      {row[c] ?? ''}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
