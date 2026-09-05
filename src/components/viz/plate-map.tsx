import * as React from 'react'
import { cn } from '#/lib/utils'
import { parseWellCode, rowLabel } from '#/lib/plate-map'

/**
 * PlateMap — a semantic grid for microplate layouts (e.g. 96-well). Rows are
 * labelled A–H, columns 1–12. Each well is a real button (keyboard-operable,
 * focusable, part of the tab order) so selection works for mouse and keyboard
 * users. Wells with no value render as empty/missing (distinct from zero),
 * and a legend explains the colour scale (UI-006).
 *
 * SCI-005 extends the component with optional assignment-role colouring,
 * well-code-based selection, keyboard arrow navigation, and a role legend —
 * while preserving the existing value-band API and tests.
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
  /** Optional canonical well code, e.g. "A1" (SCI-005). */
  wellCode?: string
  /** Optional role-based colour class, overriding band-based colouring (SCI-005). */
  roleClass?: string
  /** Optional short label to display inside the well cell (SCI-005). */
  displayLabel?: string
}

export interface PlateMapBand {
  /** Inclusive lower bound. */
  from: number
  /** Inclusive upper bound. */
  to: number
  label: string
  className: string
}

export interface PlateMapRoleLegendEntry {
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
  /** Selected well by well code (alternative to selectedIndex, SCI-005). */
  selectedWellCode?: string | null
  /** Called when a well is selected by well code (SCI-005). */
  onSelectWellCode?: (wellCode: string) => void
  compact?: boolean
  /** Accessible label for the plate, e.g. "96-well plate". */
  ariaLabel?: string
  className?: string
  /** Role-based legend entries (SCI-005). When provided, replaces band legend. */
  roleLegend?: PlateMapRoleLegendEntry[]
  /** Disable well interaction (read-only mode, SCI-005). */
  readOnly?: boolean
  /**
   * Allow well selection while `readOnly` (VIEW-02). Selection never edits:
   * the grid reports the well code so the host can show linked-record
   * context. Without this, `readOnly` disables every well button.
   */
  selectable?: boolean
  /**
   * Row-windowed rendering for large formats (VIEW-02). `true` forces
   * windowing, `false` renders the full grid; the default (`'auto'`) windows
   * only when the cell count exceeds `LARGE_PLATE_CELL_THRESHOLD`. Only the
   * visible row band mounts wells, so 1536-well plates stay interactive.
   */
  windowed?: boolean | 'auto'
  /** Rows per window when windowing (default 8, one 96-well band). */
  rowsPerWindow?: number
}

/**
 * Cell count above which `PlateMap` windows by row band. A 384-well plate
 * (384 cells) still renders whole; 1536-well and larger render one band at
 * a time. Callers can override per instance with `windowed`.
 */
export const LARGE_PLATE_CELL_THRESHOLD = 384

const DEFAULT_BANDS: PlateMapBand[] = [
  { from: 0, to: 0, label: 'Empty', className: 'bg-muted' },
  {
    from: 0.0001,
    to: 0.25,
    label: 'Low',
    className: 'bg-info/20',
  },
  {
    from: 0.25,
    to: 0.5,
    label: 'Mid-low',
    className: 'bg-info/40',
  },
  {
    from: 0.5,
    to: 0.75,
    label: 'Mid-high',
    className: 'bg-info/60',
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
  if (value === null || value === undefined) return 'bg-muted/60'
  const band = bands.find((b) => value >= b.from && value <= b.to)
  return band ? band.className : 'bg-muted-foreground/10'
}

function wellCodeForRowCol(r: number, c: number): string {
  return `${rowLabel(r)}${c + 1}`
}

export function PlateMap({
  wells,
  rows = 8,
  cols = 12,
  bands = DEFAULT_BANDS,
  selectedIndex,
  onSelect,
  selectedWellCode,
  onSelectWellCode,
  compact = false,
  ariaLabel = 'Microplate',
  className,
  roleLegend,
  readOnly = false,
  selectable = false,
  windowed = 'auto',
  rowsPerWindow = 8,
}: PlateMapProps) {
  const gridRef = React.useRef<HTMLDivElement>(null)
  const interactive = !readOnly || selectable

  const wellByCell = React.useMemo(() => {
    const map = new Map<string, { well: PlateWell; index: number }>()
    wells.forEach((well, index) => {
      map.set(`${well.row}:${well.col}`, { well, index })
    })
    return map
  }, [wells])

  // Row-band windowing for large formats. The selected well keeps its
  // selection across windows; the window jumps to it when it changes to a
  // code outside the visible band.
  const windowing =
    windowed === true || (windowed === 'auto' && rows * cols > LARGE_PLATE_CELL_THRESHOLD)
  const windowCount = Math.max(1, Math.ceil(rows / Math.max(1, rowsPerWindow)))
  const [windowIndex, setWindowIndex] = React.useState(0)
  const safeWindowIndex = Math.min(windowIndex, windowCount - 1)
  const windowStartRow = windowing ? safeWindowIndex * rowsPerWindow : 0
  const windowEndRow = windowing
    ? Math.min(rows, windowStartRow + rowsPerWindow)
    : rows
  React.useEffect(() => {
    if (!windowing || !selectedWellCode) return
    const parsed = parseWellCode(selectedWellCode)
    if (!parsed || parsed.row < 0 || parsed.row >= rows) return
    const target = Math.floor(parsed.row / rowsPerWindow)
    if (target !== safeWindowIndex) setWindowIndex(target)
  }, [windowing, selectedWellCode, rows, rowsPerWindow, safeWindowIndex])
  // Selection reports the well code; editing never happens here.
  function handleSelect(r: number, c: number) {
    if (!interactive) return
    const cell = wellByCell.get(`${r}:${c}`)
    const code = wellCodeForRowCol(r, c)
    // For well-code-based selection, always report (even for empty cells)
    if (onSelectWellCode) {
      onSelectWellCode(code)
    }
    // For index-based selection, only report if the well exists
    if (onSelect && cell?.index !== undefined) {
      onSelect(cell.index)
    }
  }

  // Keyboard navigation: arrow keys move focus between cells
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!interactive) return
    const focused = document.activeElement as HTMLButtonElement | null
    if (!focused || !focused.dataset.cell) return

    const [r, c] = focused.dataset.cell.split(':').map(Number)
    let nr = r
    let nc = c

    switch (e.key) {
      case 'ArrowRight':
        nc = Math.min(c + 1, cols - 1)
        break
      case 'ArrowLeft':
        nc = Math.max(c - 1, 0)
        break
      case 'ArrowDown':
        nr = Math.min(r + 1, rows - 1)
        break
      case 'ArrowUp':
        nr = Math.max(r - 1, 0)
        break
      case 'Home':
        if (e.ctrlKey) {
          nr = 0
          nc = 0
        } else {
          nc = 0
        }
        break
      case 'End':
        if (e.ctrlKey) {
          nr = rows - 1
          nc = cols - 1
        } else {
          nc = cols - 1
        }
        break
      default:
        return
    }

    e.preventDefault()
    if (nr === r && nc === c) return

    // Find the button at the target cell
    const targetBtn = gridRef.current?.querySelector(
      `button[data-cell="${nr}:${nc}"]`,
    ) as HTMLButtonElement | null
    if (targetBtn) {
      targetBtn.focus()
      handleSelect(nr, nc)
    }
  }

  const legendEntries = roleLegend ?? bands

  const wellSize = compact ? 'min-w-5' : 'min-w-6'
  const labelSize = compact ? 'w-5' : 'w-6'
  const gap = compact ? 'gap-0.5' : 'gap-1'

  return (
    <div className={cn('space-y-2', className)}>
      {windowing ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            aria-label="Previous row band"
            disabled={safeWindowIndex === 0}
            onClick={() => setWindowIndex(safeWindowIndex - 1)}
            className="inline-flex h-6 items-center rounded-md border border-input bg-background px-2 font-medium disabled:opacity-40"
          >
            ←
          </button>
          <span aria-live="polite" className="tabular-nums">
            Rows {rowLabel(windowStartRow)}–{rowLabel(windowEndRow - 1)} of{' '}
            {rowLabel(rows - 1)} ({windowEndRow - windowStartRow}×{cols})
          </span>
          <button
            type="button"
            aria-label="Next row band"
            disabled={safeWindowIndex >= windowCount - 1}
            onClick={() => setWindowIndex(safeWindowIndex + 1)}
            className="inline-flex h-6 items-center rounded-md border border-input bg-background px-2 font-medium disabled:opacity-40"
          >
            →
          </button>
        </div>
      ) : null}
      <div
        ref={gridRef}
        role="grid"
        aria-label={ariaLabel}
        className="inline-block"
        style={{ minWidth: compact ? '18rem' : '24rem' }}
        onKeyDown={handleKeyDown}
      >
        {/* Column header row */}
        <div role="row" className={cn('flex', gap)}>
          <span className={cn('shrink-0', labelSize)} aria-hidden="true" />
          {Array.from({ length: cols }, (_, c) => (
            <span
              key={c}
              role="columnheader"
              className={cn(
                'flex-1 text-center text-xs font-medium text-muted-foreground',
                wellSize,
              )}
            >
              {c + 1}
            </span>
          ))}
        </div>

        {Array.from(
          { length: windowEndRow - windowStartRow },
          (_, i) => windowStartRow + i,
        ).map((r) => (
          <div role="row" key={r} className={cn('mt-0.5 flex', gap)}>
            <span
              role="rowheader"
              className={cn(
                'flex shrink-0 items-center justify-center text-xs font-medium text-muted-foreground',
                labelSize,
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
              const code = wellCodeForRowCol(r, c)
              const selectedByIndex =
                index !== undefined && index === selectedIndex
              const selectedByCode = selectedWellCode === code
              const selected = selectedByIndex || selectedByCode
              const title =
                well?.label ??
                `${rowLabel(r)}${c + 1}${missing ? ' (empty)' : ''}`

              // Use roleClass if available, otherwise fall back to band-based colouring
              const cellColour = well?.roleClass ?? bandFor(well?.value, bands)

              return (
                <span
                  role="gridcell"
                  key={c}
                  className="flex-1"
                  aria-selected={selected}
                >
                  <button
                    type="button"
                    aria-label={title}
                    data-cell={`${r}:${c}`}
                    disabled={!interactive}
                    onClick={() => handleSelect(r, c)}
                    className={cn(
                      'flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border border-white/60 text-[8px] font-medium leading-none text-white/90 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:border-black/20',
                      wellSize,
                      cellColour,
                      selected && 'ring-2 ring-primary ring-offset-1',
                      !interactive && 'cursor-default hover:scale-100',
                    )}
                  >
                    {well?.displayLabel ?? ''}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>

      {legendEntries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {legendEntries.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                className={cn(
                  'inline-block size-2.5 rounded-full',
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
