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
 * value inside the pipeline_worker transaction. */
export const EXECUTION_TIMEOUT_SECONDS = 60
