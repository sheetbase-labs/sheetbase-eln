import { useRequest } from 'nitro/context'

/**
 * Adds fields to the wide event evlog emits when the current request ends.
 * A no-op outside a request (tests, scripts, background sweeps).
 */
export function annotateRequest(fields: Record<string, unknown>): void {
  try {
    const log = (
      useRequest().context as {
        log?: { set: (fields: Record<string, unknown>) => void }
      }
    ).log
    log?.set(fields)
  } catch {
    // Not inside a Nitro request.
  }
}
