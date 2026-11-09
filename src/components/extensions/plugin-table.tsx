/**
 * The table a plugin screen asks for (`sheetbase.table`), drawn with the app's
 * own Table so it looks and behaves like every other table: the same rows,
 * headings, hover and light and dark. The screen only sends data.
 */
import * as React from 'react'
import { useRouter } from '@tanstack/react-router'

import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { sortFrameRows } from '#/lib/extensions/frame-table'
import type { FrameTable } from '#/lib/extensions/frame-table'
import { t } from '#/copy'

export function PluginTable({ table }: { table: FrameTable }) {
  const router = useRouter()

  const [chosen, setChosen] = React.useState<{
    key: string
    descending: boolean
  } | null>(null)

  const sort = chosen ?? table.sort ?? null

  const rows = React.useMemo(
    () => sortFrameRows(table.rows, sort),
    [table.rows, sort],
  )

  return (
    <TableBox className="mt-3">
      <Table caption={t('plugins.screen.tableCaption')}>
        <TableHeader>
          <tr>
            {table.columns.map((column) => {
              const active = sort?.key === column.key

              return (
                <TableHead
                  key={column.key}
                  align={column.align}
                  aria-sort={
                    active
                      ? sort.descending
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="font-medium hover:text-fg"
                    onClick={() =>
                      setChosen({
                        key: column.key,
                        descending: active ? !sort.descending : false,
                      })
                    }
                  >
                    {column.label}
                    {active ? (sort.descending ? ' ↓' : ' ↑') : ''}
                  </button>
                </TableHead>
              )
            })}
          </tr>
        </TableHeader>
        <TableBody
          colSpan={table.columns.length}
          empty={table.empty ?? t('plugins.screen.tableEmpty')}
        >
          {rows.map((row) => (
            <TableRow key={row.id}>
              {table.columns.map((column) => {
                const cell = row.cells[column.key] ?? {}

                const content = (
                  <>
                    {cell.svg ? (
                      <span
                        className="inline-block h-14 align-middle [&>svg]:h-full [&>svg]:w-auto"
                        dangerouslySetInnerHTML={{ __html: cell.svg }}
                      />
                    ) : null}
                    {cell.image ? (
                      <img src={cell.image} alt="" className="h-14 w-auto" />
                    ) : null}
                    {cell.text !== undefined ? cell.text : null}
                  </>
                )

                return (
                  <TableCell
                    key={column.key}
                    align={column.align}
                    style={
                      cell.shade !== undefined
                        ? {
                            backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(cell.shade * 55 + 6)}%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {cell.href ? (
                      <a
                        href={cell.href}
                        className="text-link hover:underline"
                        onClick={(event) => {
                          if (
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.button !== 0
                          )
                            return
                          event.preventDefault()
                          router.history.push(cell.href!)
                        }}
                      >
                        {content}
                      </a>
                    ) : (
                      content
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}
