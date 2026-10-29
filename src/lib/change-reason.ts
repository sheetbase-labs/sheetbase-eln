/**
 * A workspace can ask for a reason whenever a saved value changes. The database
 * refuses the write without one (SB114); the person gives it once and it
 * covers the edits that follow for a few minutes, so typing is not interrupted
 * for every autosave. The data client asks through whatever the app registered.
 */

/** Raised by the database when a change needs a reason it was not given. */
export const CHANGE_REASON_REQUIRED_CODE = 'SB114'

/** How long one answer covers further edits. */
export const CHANGE_REASON_WINDOW_MS = 5 * 60 * 1000

type Asker = () => Promise<string | null>

let asker: Asker | null = null
let remembered: { reason: string; at: number } | null = null
let pending: Promise<string | null> | null = null

/** The app registers how to ask (a dialog); `null` unregisters it. */
export function registerChangeReasonAsker(next: Asker | null): void {
  asker = next
}

/** The reason given a moment ago, if it still covers new edits. */
export function rememberedChangeReason(now = Date.now()): string | null {
  if (!remembered) return null
  if (now - remembered.at > CHANGE_REASON_WINDOW_MS) {
    remembered = null
    return null
  }
  return remembered.reason
}

export function rememberChangeReason(reason: string, now = Date.now()): void {
  remembered = { reason, at: now }
}

export function forgetChangeReason(): void {
  remembered = null
}

/**
 * Ask for a reason. Edits that fail together (an autosave burst) share one
 * question. Resolves `null` when the person cancels or nothing can ask.
 */
export function askForChangeReason(): Promise<string | null> {
  const known = rememberedChangeReason()
  if (known) return Promise.resolve(known)
  if (!asker) return Promise.resolve(null)
  if (!pending) {
    pending = asker()
      .then((reason) => {
        const trimmed = reason?.trim() ?? ''
        if (!trimmed) return null
        rememberChangeReason(trimmed)
        return trimmed
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}
