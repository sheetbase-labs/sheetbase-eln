import { Muted } from '#/components/ui/layout'
import { z } from 'zod'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
  const occurrences = new Map<string, number>()

  const rows = preview.rows.map((row) => {
    const content = JSON.stringify(row)
    const occurrence = occurrences.get(content) ?? 0
    occurrences.set(content, occurrence + 1)
    const columnOccurrences = new Map<string, number>()

    return {
      key: `${content}:${occurrence}`,
      cells: row.map((value, position) => {
        const column = preview.columns[position] ?? ''
        const columnOccurrence = columnOccurrences.get(column) ?? 0
        columnOccurrences.set(column, columnOccurrence + 1)

        return {
          key: `${column}:${columnOccurrence}`,
          text: cellText(value),
          numeric: numericPreviewCellSchema.safeParse(value).success,
        }
      }),
    }
  })

  return (
    <>
      <TableBox>
        <Table caption="Result preview">
          <TableHeader>
            <TableRow>
              {preview.columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell) => (
                  <TableCell
                    key={cell.key}
                    align={cell.numeric ? 'right' : undefined}
                  >
                    {cell.text}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted>
        {preview.truncated
          ? `Showing the first ${plural(preview.rows.length, 'row', 'rows')} of ${plural(preview.rowCount, 'row', 'rows')}${keptAll ? '; the dataset holds all of them' : ''}.`
          : `${plural(preview.rowCount, 'row', 'rows')}.`}
      </Muted>
    </>
  )
}
