import { useRef } from 'react'
import type { SpreadsheetCustomEditorContext } from '@sheetbase-labs/sheetbase-table'

export type TypedTextEditorCellProps = Pick<
  SpreadsheetCustomEditorContext,
  'initialDraft' | 'commit' | 'cancel'
> & { label: string }

/**
 * In-cell text entry for a column whose stored value is not what people type,
 * such as a duration kept in seconds but typed as `2 h 30 min`. The edit
 * opens on the readable text; the sheet's own parser turns it back into the
 * stored value on commit.
 */
export function TypedTextEditorCell({
  initialDraft,
  commit,
  cancel,
  label,
}: TypedTextEditorCellProps) {
  const done = useRef(false)

  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true

    if (value === null) cancel()
    else commit(value)
  }

  return (
    <input
      type="text"
      className="sheetbase-formula-editor"
      aria-label={label}
      defaultValue={initialDraft}
      autoComplete="off"
      spellCheck={false}
      // The editor exists only while a cell is being edited, so it takes the
      // keyboard as soon as it mounts, as the grid's own editors do.
      ref={(node) => node?.focus()}
      onFocus={(event) => {
        const end = event.currentTarget.value.length
        event.currentTarget.setSelectionRange(end, end)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          finish(event.currentTarget.value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  )
}
