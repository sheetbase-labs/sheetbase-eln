/**
 * Frozen-evidence / locked-sheet affordances: a status badge plus the
 * read-only row set the engine expects for an entirely locked grid.
 */
export function LockedSheetBadge({ label = 'Locked · read-only' }: Readonly<{ label?: string }>) {
  return (
    <span className="eln-locked-badge" role="status">
      {label}
    </span>
  )
}

/** Every row index marked read-only — pass as `readOnlyRows` to lock the grid. */
export function readOnlyRowSet(rowCount: number): Set<number> {
  return new Set(Array.from({ length: Math.max(0, rowCount) }, (_, index) => index))
}
