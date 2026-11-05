/**
 * The menu at the end of every registry table's header: choose which columns
 * show, and export what is on screen as CSV or Excel. What a person chose
 * (columns, and the sort from clicking a header) is remembered for them by
 * `useListView`.
 */
import { IconButton } from '#/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { toast } from '#/components/ui/sonner'
import { getColumnHeaderLabel } from '#/components/reui/data-grid/data-grid'
import type {
  DataGridFeatures,
  DataGridTableInstance,
} from '#/components/reui/data-grid/data-grid'
import { downloadTextFile } from '#/lib/download'
import { XLSX_TYPE, tableCsv, tableXlsx } from '#/lib/export/table-file'
import type { ExportTable, ExportValue } from '#/lib/export/table-file'
import type { ListView } from '#/lib/list-views'
import { t } from '#/copy'
import type { Column, RowData } from '@tanstack/react-table'

/** The columns an export can write: shown, and with a value to write. */
function exportable<T extends RowData>(
  table: DataGridTableInstance<T>,
): Column<DataGridFeatures, T, unknown>[] {
  return table
    .getVisibleLeafColumns()
    .filter(
      (column) =>
        column.id !== '__bulk' &&
        column.id !== '__view' &&
        (column.columnDef.meta?.exportValue !== undefined ||
          'accessorFn' in column.columnDef),
    )
}

/** What is on screen, in the order it is shown: the visible columns of every
 * record row (group bands carry no record). */
export function exportTable<T extends RowData>(
  table: DataGridTableInstance<T>,
): ExportTable {
  const columns = exportable(table)
  const rows = table
    .getRowModel()
    .rows.filter((row) => !('__band' in (row.original as object)))
    .map((row) =>
      columns.map((column): ExportValue => {
        const custom = column.columnDef.meta?.exportValue
        return custom
          ? custom(row.original)
          : row.getValue(column.id)
      }),
    )
  return { headers: columns.map(getColumnHeaderLabel), rows }
}

/** A file name from the list's name: "Samples" → "samples-2026-11-05". */
export function exportFileName(name: string, extension: string): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'
  return `${stem}-${new Date().toISOString().slice(0, 10)}.${extension}`
}

export function ListViewMenu<T extends RowData>({
  table,
  view,
  name,
}: {
  table: DataGridTableInstance<T>
  view?: ListView
  /** What the list is called, for the file name. */
  name: string
}) {
  const hideable = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.id !== '__view')

  const save = (kind: 'csv' | 'xlsx') => {
    const data = exportTable(table)
    if (data.rows.length === 0) {
      toast(t('library.listView.nothingToExport'))
      return
    }
    const file = exportFileName(name, kind)
    try {
      if (kind === 'csv') {
        downloadTextFile(file, tableCsv(data), 'text/csv;charset=utf-8')
      } else {
        downloadTextFile(
          file,
          new Blob([tableXlsx(data, name) as BlobPart], { type: XLSX_TYPE }),
        )
      }
      toast(t('library.listView.exported', { count: data.rows.length, file }))
    } catch (error) {
      toast(t('library.listView.exportFailed'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.listView.exportFailedDetail'),
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            label={t('library.listView.options')}
            icon="settings"
            className="-my-1"
            onClick={(event) => event.stopPropagation()}
          />
        }
      />
      <DropdownMenuContent align="end" className="w-[220px]">
        {hideable.length > 0 && view ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t('library.listView.columns')}
              </DropdownMenuLabel>
              {hideable.map((column) => {
                const on = column.getIsVisible()
                return (
                  <DropdownMenuItem
                    key={column.id}
                    closeOnClick={false}
                    icon={on ? 'check' : undefined}
                    className={on ? '' : 'pl-[30px]'}
                    onClick={() => column.toggleVisibility(!on)}
                  >
                    {getColumnHeaderLabel(column)}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuItem
                className="pl-[30px]"
                onClick={() => view.reset()}
              >
                {t('library.listView.reset')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem icon="download" onClick={() => save('csv')}>
          {t('library.listView.exportCsv')}
        </DropdownMenuItem>
        <DropdownMenuItem icon="download" onClick={() => save('xlsx')}>
          {t('library.listView.exportExcel')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
