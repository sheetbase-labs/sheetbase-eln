import * as React from 'react'

// Pressing a button on a block also selects it, and a selected block swaps this
// view for the editor's, which would drop local state and close the full-size
// view. So whether it is open lives outside the component.
const expandedFiles = new Set<string>()
const expandedListeners = new Set<() => void>()

/** Close every full-size view. It outlives a component, so tests start each case from closed. */
export function closeExpandedFiles(): void {
  expandedFiles.clear()

  for (const listener of expandedListeners) listener()
}

export function useExpanded(
  fileRecordId: string,
): [boolean, (open: boolean) => void] {
  const open = React.useSyncExternalStore(
    (listener) => {
      expandedListeners.add(listener)

      return () => expandedListeners.delete(listener)
    },
    () => expandedFiles.has(fileRecordId),
    () => false,
  )

  const set = React.useCallback(
    (next: boolean) => {
      if (next) expandedFiles.add(fileRecordId)
      else expandedFiles.delete(fileRecordId)

      for (const listener of expandedListeners) listener()
    },
    [fileRecordId],
  )

  return [open, set]
}
