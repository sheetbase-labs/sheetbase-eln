import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * PlateMap — a semantic grid for microplate layouts (e.g. 96-well). Rows are
 * labelled A–H, columns 1–12. Each well is a real button (keyboard-operable,
 * focusable, part of the tab order) so selection works for mouse and keyboard
 * users. Wells with no value render as empty/missing (distinct from zero),
 * and a legend explains the colour scale (UI-006).
 *
 * The component is presentational: it takes well data and selection and
 * reports selection changes. It never owns assay state.
 */

export interface PlateWell {
  /** Row index, 0-based. */
  row: number
  /** Column index, 0-based. */
  col: number
  /** Numeric value used to pick a colour band; undefined = missing/empty. */
  value?: number | null
  /** Optional per-well label, e.g. "A1 positive control". */
  label?: string
}

export interface PlateMapBand {
  /** Inclusive lower bound. */
  from: number
  /** Inclusive upper bound. */
  to: number
  label: string
  className: string
}

export interface PlateMapProps {
  wells: PlateWell[]
  rows?: number
  cols?: number
  bands?: PlateMapBand[]
  /** Index of the selected well in `wells`, or undefined. */
  selectedIndex?: number
  onSelect?: (index: number) => void
  compact?: boolean
  /** Accessible label for the plate, e.g. "96-well plate". */
  ariaLabel?: string
  className?: string
}

const DEFAULT_BANDS: PlateMapBand[] = [
  { from: 0, to: 0, label: 'Empty', className: 'bg-muted' },
  {
    from: 0.0001,
    to: 0.25,
    label: 'Low',
    className: 'bg-blue-200 dark:bg-blue-900',
  },
  {
    from: 0.25,
    to: 0.5,
    label: 'Mid-low',
    className: 'bg-blue-300 dark:bg-blue-700',
  },
  {
    from: 0.5,
    to: 0.75,
    label: 'Mid-high',
    className: 'bg-blue-400 dark:bg-blue-600',
  },
  {
    from: 0.75,
    to: 1.0001,
    label: 'High',
    className: 'bg-indigo-400 dark:bg-indigo-600',
  },
]

function bandFor(
  value: number | null | undefined,
  bands: PlateMapBand[],
): string {
  if (value === null || value === undefined) return 'bg-muted-foreground/10'
  const band = bands.find((b) => value >= b.from && value <= b.to)
  return band ? band.className : 'bg-muted-foreground/10'
}

function rowLabel(i: number): string {
  return String.fromCharCode(65 + i)
}

export function PlateMap({
  wells,
  rows = 8,
  cols = 12,
  bands = DEFAULT_BANDS,
  selectedIndex,
  onSelect,
  compact = false,
  ariaLabel = 'Microplate',
  className,
}: PlateMapProps) {
  const wellByCell = React.useMemo(() => {
    const map = new Map<string, { well: PlateWell; index: number }>()
    wells.forEach((well, index) => {
      map.set(`${well.row}:${well.col}`, { well, index })
    })
    return map
  }, [wells])

  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="grid"
        aria-label={ariaLabel}
        className="inline-block"
        style={{ minWidth: compact ? '12rem' : '20rem' }}
      >
        {/* Column header row */}
        <div role="row" className="flex gap-1">
          <span
            className={cn('shrink-0', compact ? 'w-3' : 'w-5')}
            aria-hidden="true"
          />
          {Array.from({ length: cols }, (_, c) => (
            <span
              key={c}
              role="columnheader"
              className={cn(
                'flex-1 text-center text-[10px] font-medium text-muted-foreground',
                compact ? 'min-w-2' : 'min-w-4',
              )}
            >
              {c + 1}
            </span>
          ))}
        </div>

        {Array.from({ length: rows }, (_, r) => (
          <div role="row" key={r} className="mt-1 flex gap-1">
            <span
              role="rowheader"
              className={cn(
                'flex shrink-0 items-center justify-center text-[10px] font-medium text-muted-foreground',
                compact ? 'w-3' : 'w-5',
              )}
            >
              {rowLabel(r)}
            </span>
            {Array.from({ length: cols }, (_col, c) => {
              const cell = wellByCell.get(`${r}:${c}`)
              const well = cell?.well
              const index = cell?.index
              const missing =
                !well || well.value === null || well.value === undefined
              const selected = index !== undefined && index === selectedIndex
              const title =
                well?.label ??
                `${rowLabel(r)}${c + 1}${missing ? ' (empty)' : ''}`
              return (
                <span role="gridcell" key={c} className="flex-1">
                  <button
                    type="button"
                    aria-label={title}
                    aria-selected={selected}
                    onClick={() => index !== undefined && onSelect?.(index)}
                    className={cn(
                      'aspect-square rounded-[3px] border border-white/60 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:border-black/20',
                      compact ? 'min-w-2' : 'min-w-4',
                      bandFor(well?.value, bands),
                      selected && 'ring-2 ring-primary ring-offset-1',
                    )}
                  />
                </span>
              )
            })}
          </div>
        ))}
      </div>

      {bands.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          {bands.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                className={cn(
                  'inline-block size-2.5 rounded-[2px]',
                  b.className,
                )}
              />
              {b.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
