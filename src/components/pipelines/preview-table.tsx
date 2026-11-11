import { t } from '#/copy'
import { useMemo } from 'react'
import { Muted } from '#/components/ui/layout'
import { z } from 'zod'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import type { PreviewCell, ResultPreview } from '#/lib/pipelines/result-preview'

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

const numericPreviewCellSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

function cellText(value: PreviewCell | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

type PreviewRow = { key: string; values: ResultPreview['rows'][number] }

/**
 * The first rows a transform produced, as a table, with a line saying how many
 * there were. Shared by a finished run's result and by "Try draft".
 */
export function PreviewTable({
  preview,
  keptAll = false,
}: {
  preview: ResultPreview
  /** True when the full result is stored elsewhere, so a long one is not lost. */
  keptAll?: boolean
}) {
  const rows = useMemo(() => {
    const occurrences = new Map<string, number>()

    return preview.rows.map((row) => {
      const content = JSON.stringify(row)
      const occurrence = occurrences.get(content) ?? 0
      occurrences.set(content, occurrence + 1)

      return { key: `${content}:${occurrence}`, values: row }
    })
  }, [preview.rows])

  const columns = useMemo<RegistryColumn<PreviewRow>[]>(
    () =>
      preview.columns.map((column, position) => ({
        id: `${position}:${column}`,
        header: column,
        accessorFn: (row: PreviewRow) => row.values[position] ?? null,
        meta: { headerTitle: column },
        cell: ({ row }) => {
          const value = row.original.values[position]
          const numeric = numericPreviewCellSchema.safeParse(value).success

          return (
            <span className={numeric ? 'num block text-right' : undefined}>
              {cellText(value)}
            </span>
          )
        },
      })),
    [preview.columns],
  )

  return (
    <>
      <TableBox>
        <RegistryGrid
          label={t('data.previewTable.resultPreview')}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.key}
          selectable={false}
        />
      </TableBox>
      <Muted>
        {preview.truncated
          ? `Showing the first ${plural(preview.rows.length, 'row', 'rows')} of ${plural(preview.rowCount, 'row', 'rows')}${keptAll ? '; the dataset holds all of them' : ''}.`
          : `${plural(preview.rowCount, 'row', 'rows')}.`}
      </Muted>
    </>
  )
}
