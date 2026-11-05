import { useRef, useState } from 'react'
import { Source } from './source'
import type { SourceKind } from './source'
import { cn } from '#/lib/utils'

// Sheet grid (.g): 28px rows, visible grid lines, row numbers, derived cells tinted, a Source label in each header.
// This is the read-and-navigate version: arrow keys move a single roving focus, Home/End jump within a row.
// Editing, selection ranges and virtualisation (TanStack Table + Virtual) come next.
export type GridColumn<TRow> = {
  key: string
  label: string
  unit?: string
  source?: { kind: SourceKind; label: string }
  align?: 'right'
  derived?: boolean
  cell: (row: TRow) => React.ReactNode
}

export function SheetGrid<TRow>({
  label,
  columns,
  rows,
  invalid,
  onActiveChange,
}: {
  label: string
  columns: GridColumn<TRow>[]
  rows: TRow[]
  invalid?: (row: TRow, key: string) => boolean
  onActiveChange?: (pos: { row: number; col: number }) => void
}) {
  const [active, setActive] = useState({ row: 0, col: 0 })
  const ref = useRef<HTMLTableElement>(null)
  const move = (row: number, col: number) => {
    const r = Math.max(0, Math.min(rows.length - 1, row)),
      c = Math.max(0, Math.min(columns.length - 1, col))
    setActive({ row: r, col: c })
    onActiveChange?.({ row: r, col: c })
    ref.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key,
      { row, col } = active
    const next =
      k === 'ArrowDown'
        ? [row + 1, col]
        : k === 'ArrowUp'
          ? [row - 1, col]
          : k === 'ArrowRight'
            ? [row, col + 1]
            : k === 'ArrowLeft'
              ? [row, col - 1]
              : k === 'Home'
                ? [row, 0]
                : k === 'End'
                  ? [row, columns.length - 1]
                  : null
    if (next) {
      e.preventDefault()
      move(next[0], next[1])
    }
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table
        ref={ref}
        role="grid"
        aria-label={label}
        onKeyDown={onKey}
        className="num w-full border-collapse text-body"
      >
        <thead>
          <tr>
            <th
              className="sticky left-0 z-[2] w-9 min-w-9 border-b border-r border-grid-line bg-surface-muted"
              aria-hidden="true"
            />
            {columns.map((c, j) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'border-b border-r border-grid-line bg-surface-muted px-2 py-1 text-left align-bottom text-label font-medium text-fg-muted last:border-r-0',
                  c.align === 'right' && 'text-right',
                  j === 0 &&
                    'sticky left-9 z-[2] shadow-[1px_0_0_var(--grid-line)]',
                )}
              >
                <div
                  className={cn(
                    'flex flex-col gap-0.5',
                    c.align === 'right' && 'items-end',
                  )}
                >
                  <span className="whitespace-nowrap">
                    {c.label}
                    {c.unit ? ` (${c.unit})` : ''}
                  </span>
                  {c.source ? (
                    <Source kind={c.source.kind}>{c.source.label}</Source>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th
                scope="row"
                className="sticky left-0 z-[1] h-7 w-9 min-w-9 border-b border-r border-grid-line bg-surface-muted text-center text-label font-normal text-fg-faint"
              >
                {i + 1}
              </th>
              {columns.map((c, j) => {
                const bad = invalid?.(r, c.key)
                const on = active.row === i && active.col === j
                return (
                  <td
                    key={c.key}
                    role="gridcell"
                    data-cell={`${i}-${j}`}
                    tabIndex={on ? 0 : -1}
                    aria-invalid={bad || undefined}
                    onClick={() => move(i, j)}
                    className={cn(
                      'h-7 whitespace-nowrap border-b border-r border-grid-line px-2 outline-none last:border-r-0 focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]',
                      c.align === 'right' && 'text-right',
                      c.derived && 'bg-surface-derived',
                      j === 0 &&
                        'sticky left-9 z-[1] bg-surface shadow-[1px_0_0_var(--grid-line)]',
                      bad && 'bg-danger-wash text-danger-text',
                      on && 'shadow-[inset_0_0_0_2px_var(--selection-border)]',
                    )}
                  >
                    {c.cell(r)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
