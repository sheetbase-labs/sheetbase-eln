import { useEffect, useRef } from 'react'

/**
 * A page with edits it has not saved yet (an unsaved analysis, say) tells the
 * workspace, so closing its pane or leaving it can ask "Save, Discard or
 * Cancel" instead of only refusing.
 */
export interface PendingEdit {
  /** What is unsaved, in the person's words, e.g. "Analysis Studio". */
  label: string
  /** Where the page lives: a pane id, or null outside the workspace. */
  paneId: string | null
  /** Save the edits. Resolves true when they are safely stored. */
  save: () => Promise<boolean>
  /** Throw the edits away. */
  discard: () => void
}

const edits = new Set<PendingEdit>()
let checkingLeave = false

/** Edits a pane still holds, in the order they were registered. */
export function pendingEditsFor(paneId: string | null): PendingEdit[] {
  return [...edits].filter((edit) => edit.paneId === paneId)
}

/**
 * Pane-leave checks fire the window's `beforeunload` to ask native guards
 * whether anything is at risk. A page that registers its edits here answers
 * through the Save/Discard prompt instead, so its guard skips that check.
 */
export function isCheckingLeave() {
  return checkingLeave
}

export function runLeaveCheck(): boolean {
  checkingLeave = true

  try {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    return !event.defaultPrevented
  } finally {
    checkingLeave = false
  }
}

/**
 * Register a page's unsaved edits while `dirty`. The native tab-close prompt
 * stays on for a real reload or close; the pane and sign-out checks use the
 * Save/Discard prompt.
 */
export function usePendingEdit(options: {
  dirty: boolean
  label: string
  paneId: string | null
  save: () => Promise<boolean>
  discard: () => void
}) {
  const latest = useRef(options)
  latest.current = options
  const { dirty, paneId, label } = options
  useEffect(() => {
    if (!dirty) return

    const edit: PendingEdit = {
      label,
      paneId,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    }

    edits.add(edit)

    const guard = (event: BeforeUnloadEvent) => {
      if (checkingLeave) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', guard)

    return () => {
      edits.delete(edit)
      window.removeEventListener('beforeunload', guard)
    }
  }, [dirty, paneId, label])
}

/** Register edits without a page, for tests of the prompt. */
export function registerPendingEditForTest(edit: PendingEdit) {
  edits.add(edit)

  return () => {
    edits.delete(edit)
  }
}
