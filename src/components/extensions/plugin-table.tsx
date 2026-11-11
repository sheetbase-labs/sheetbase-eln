/**
 * The table a plugin screen asks for (`sheetbase.table`), drawn with the app's
 * own Table so it looks and behaves like every other table: the same rows,
 * headings, hover and light and dark. The screen only sends data.
 */
import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { isFunction } from '@tanstack/react-table'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import { sortFrameRows } from '#/lib/extensions/frame-table'
import type { FrameTable } from '#/lib/extensions/frame-table'
import { t } from '#/copy'

type FrameRow = FrameTable['rows'][number]

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

  const columns = React.useMemo<RegistryColumn<FrameRow>[]>(
    () =>
      table.columns.map((column) => ({
        id: column.key,
        header: column.label,
        accessorFn: (row: FrameRow) => row.cells[column.key]?.text ?? '',
        meta:
          column.align === 'right'
            ? { headerClassName: 'text-right', cellClassName: 'text-right' }
            : undefined,
        cell: ({ row }) => {
          const cell = row.original.cells[column.key] ?? {}

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

          const shaded =
            cell.shade !== undefined ? (
              <span
                className="-mx-2.5 block px-2.5"
                style={{
                  backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(cell.shade * 55 + 6)}%, transparent)`,
                }}
              >
                {content}
              </span>
            ) : (
              content
            )

          if (!cell.href) return shaded

          const href = cell.href

          return (
            <a
              href={href}
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
                router.history.push(href)
              }}
            >
              {shaded}
            </a>
          )
        },
      })),
    [table.columns, router],
  )

  const pictures = rows.some((row) =>
    Object.values(row.cells).some((cell) => cell.svg || cell.image),
  )

  return (
    <TableBox className="mt-3">
      {rows.length ? (
        <RegistryGrid
          label={t('plugins.screen.tableCaption')}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={false}
          rowHeight={pictures ? 72 : 33}
          sorting={sort ? [{ id: sort.key, desc: sort.descending }] : []}
          onSortingChange={(updater) => {
            const current = sort
              ? [{ id: sort.key, desc: sort.descending }]
              : []

            const next = isFunction(updater) ? updater(current) : updater

            const first = next.at(0)

            if (first) setChosen({ key: first.id, descending: first.desc })
          }}
        />
      ) : (
        <p role="status" className="px-3 py-6 text-center text-fg-muted">
          {table.empty ?? t('plugins.screen.tableEmpty')}
        </p>
      )}
    </TableBox>
  )
}
