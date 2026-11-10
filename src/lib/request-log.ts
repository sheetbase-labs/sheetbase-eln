import { useRequest } from 'nitro/context'
import type { FieldContext, RequestLogger } from 'evlog'

/**
 * Adds fields to the wide event evlog emits when the current request ends.
 * A no-op outside a request (tests, scripts, background sweeps).
 */
export function annotateRequest(fields: FieldContext): void {
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

function currentLog(): RequestLogger | undefined {
  // SAFETY: evlog's Nitro plugin is the only writer of `request.context.log`, and it
  // stores the request's `RequestLogger` there. A request without the plugin either
  // has no context or no logger, and both callers above already treat that as a no-op.
  return (useRequest().context as { log?: RequestLogger }).log
}
