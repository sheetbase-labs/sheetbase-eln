/**
 * INT-03 — bounded connector execution errors.
 *
 * Neutral module (no server-only imports) so pure config/identifier
 * validation can throw the same bounded errors the server execution layer
 * uses. Every error carries a stable `code` from the connector error model.
 */
export class ConnectorExecutionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConnectorExecutionError'
    this.code = code
  }
}

/** Format any thrown error into a bounded, safe message for run failures. */
export function boundedErrorMessage(error: unknown): string {
  if (error instanceof ConnectorExecutionError) return error.message
  if (error instanceof Error) {
    // Never surface raw driver/SDK stacks; keep the first line only.
    return error.message.split('\n')[0].slice(0, 500)
  }
  return 'The connector operation failed.'
}
