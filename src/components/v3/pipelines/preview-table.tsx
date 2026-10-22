import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import type { ResultPreview } from '#/lib/pipelines/result-preview'

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

function cellText(value: unknown): string {
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
            {preview.rows.map((row, index) => (
              <TableRow key={index}>
                {row.map((cell, position) => (
                  <TableCell
                    key={position}
                    align={typeof cell === 'number' ? 'right' : undefined}
                  >
                    {cellText(cell)}
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
