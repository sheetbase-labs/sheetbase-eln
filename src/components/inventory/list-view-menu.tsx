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
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { downloadTextFile } from '#/lib/download'
import { XLSX_TYPE, tableCsv, tableXlsx } from '#/lib/export/table-file'
import type { ListView } from '#/lib/list-views'
import { t } from '#/copy'
import type { RowData, Table } from '@tanstack/react-table'
import { exportFileName, exportTable } from './list-view-export'

export { exportFileName, exportTable } from './list-view-export'

export function ListViewMenu<T extends RowData>({
  table,
  view,
  name,
}: {
  table: Table<DataGridFeatures, T>
  view?: ListView
  /** What the list is called, for the file name. */
  name: string
}) {
  const hideable = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && !column.id.startsWith('__'))

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
          new Blob([new Uint8Array(tableXlsx(data, name))], {
            type: XLSX_TYPE,
          }),
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
