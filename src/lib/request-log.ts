import { useRequest } from 'nitro/context'

/**
 * Adds fields to the wide event evlog emits when the current request ends.
 * A no-op outside a request (tests, scripts, background sweeps).
 */
export function annotateRequest(fields: Record<string, unknown>): void {
  try {
    currentLog()?.set(fields)
  } catch {
    // Not inside a Nitro request.
  }
}

/** Marks the current request's event as a warning or an error. */
export function setRequestLevel(level: 'warn' | 'error'): void {
  try {
    currentLog()?.setLevel(level)
  } catch {
    // Not inside a Nitro request.
  }
}

function currentLog():
  | {
      set: (fields: Record<string, unknown>) => void
      setLevel: (level: 'warn' | 'error') => void
    }
  | undefined {
  return (
    useRequest().context as {
      log?: {
        set: (fields: Record<string, unknown>) => void
        setLevel: (level: 'warn' | 'error') => void
      }
    }
  ).log
}
