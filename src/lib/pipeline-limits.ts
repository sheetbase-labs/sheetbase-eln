/**
 * Canonical Pipeline executor limits — the single source of truth shared by
 * the pipeline executor, scheduler, and admin diagnostics.
 *
 * Importing from this module prevents the admin surface from drifting when
 * the executor changes a limit.
 */

/** Maximum input rows a single transform can consume. */
export const INPUT_ROW_LIMIT = 100_000

/** Maximum number of fields (columns × rows) in transform input. */
export const INPUT_FIELD_LIMIT = 256

/** Maximum cells in a transform result set (rows × columns). */
export const RESULT_CELL_LIMIT = 1_000_000

/** Per-run execution timeout in seconds. The statement_timeout is set to this
 * value on the pipeline_sandbox session. */
export const EXECUTION_TIMEOUT_SECONDS = 60

/** Maximum Python request or result payload in bytes (32 MiB). Mirrored by the
 * runner broker, which also rejects larger bodies before they reach the job. */
export const PAYLOAD_BYTE_LIMIT = 32 * 1024 * 1024

/** Render a byte count for a limit-failure message, e.g. `33.6 MiB`. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
