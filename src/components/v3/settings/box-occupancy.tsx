import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Skeleton } from '#/components/v3/ui/skeleton'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'
import { samplePath } from '#/lib/navigation'
import {
  fetchBoxPositions,
  positionKeys,
  rowLetter,
} from '#/lib/storage-positions'
import type { PositionCell } from '#/lib/storage-positions'
import { cn } from '#/lib/utils'

/**
 * A box as it is now: which positions hold a sample and which are free. A
 * taken position links to its sample. Links, not buttons, so a role that can
 * only view the section still opens them.
 */
export function BoxOccupancy({
  boxId,
  name,
  rows,
  cols,
  client,
}: {
  boxId: string
  name: string
  rows: number
  cols: number
  client: DataClient
}) {
  const positions = useQuery({
    queryKey: [...positionKeys.box(boxId), 'settings'],
    queryFn: () => fetchBoxPositions(client, boxId),
  })
  if (positions.isPending) return <Skeleton className="h-32 w-full" />
  if (positions.isError) return null
  const cells = positions.data
  const held = cells.filter((cell) => cell.status === 'occupied').length
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label font-medium text-fg">
        {t('settings.storageLocationsPanel.positions', {
          held,
          total: cells.length,
        })}
      </span>
      <div className="overflow-auto rounded-md border border-border p-2">
        <div
          role="grid"
          aria-label={t('library.samples.positionPicker.gridAria', { name })}
          className="grid w-max gap-0.5"
          style={{ gridTemplateColumns: `1rem repeat(${cols}, 1.375rem)` }}
        >
          <span aria-hidden="true" />
          {Array.from({ length: cols }, (_, col) => (
            <span
              key={col}
              aria-hidden="true"
              className="num text-center text-[10px] text-fg-muted"
            >
              {col + 1}
            </span>
          ))}
          {Array.from({ length: rows }, (_, row) => (
            <Row key={row} row={row} cols={cols} cells={cells} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({
  row,
  cols,
  cells,
}: {
  row: number
  cols: number
  cells: readonly PositionCell[]
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="num flex items-center justify-center text-[10px] text-fg-muted"
      >
        {rowLetter(row)}
      </span>
      {Array.from({ length: cols }, (_, col) => {
        const cell = cells.find((c) => c.rowIndex === row && c.colIndex === col)
        if (!cell) return <span key={col} />
        const base =
          'flex size-[22px] items-center justify-center rounded-sm border'
        if (cell.occupant) {
          return (
            <Tooltip
              key={col}
              content={`${cell.label}: ${cell.occupant.identifier}${cell.occupant.title ? ` · ${cell.occupant.title}` : ''}`}
            >
              <Link
                to={samplePath(cell.occupant.id)}
                aria-label={`${cell.label}: ${cell.occupant.identifier}`}
                className={cn(
                  base,
                  'border-selection-border bg-selection text-primary-text',
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-current"
                />
              </Link>
            </Tooltip>
          )
        }
        return (
          <Tooltip
            key={col}
            content={
              cell.status === 'available'
                ? `${cell.label}: ${t('library.samples.positionPicker.legendFree')}`
                : `${cell.label}: ${
                    cell.status === 'missing'
                      ? t('library.samples.positionPicker.missing')
                      : t('library.samples.positionPicker.setAside')
                  }`
            }
          >
            <span
              role="img"
              aria-label={cell.label}
              className={cn(
                base,
                cell.status === 'available'
                  ? 'border-border bg-surface'
                  : 'border-border-strong bg-surface-disabled',
              )}
            />
          </Tooltip>
        )
      })}
    </>
  )
}
