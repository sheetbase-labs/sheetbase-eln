/**
 * Plain-language reading of a failed run's error code: what went wrong, where
 * to fix it, and whether running it again could help. A retry re-runs the same
 * version on the same inputs, so it only helps when the failure was the
 * environment's (a timeout, an internal fault) and not the pipeline's.
 */

export type RunErrorFix = 'steps' | 'inputs' | 'output' | null

export interface RunErrorGuidance {
  title: string
  /** What to do next. */
  hint: string
  /** The Steps editor section that holds the fix, if editing is the fix. */
  fix: RunErrorFix
  /** Whether running the same version on the same inputs again could work. */
  retryHelps: boolean
}

const GUIDANCE: Record<string, RunErrorGuidance> = {
  invalid_configuration: {
    title: 'The pipeline is not set up correctly',
    hint: 'Open the pipeline, fix what it flags and publish a new version.',
    fix: 'steps',
    retryHelps: false,
  },
  invalid_run_request: {
    title: 'The run was started with values the pipeline does not accept',
    hint: 'Start it again and check the parameters and the input versions.',
    fix: 'inputs',
    retryHelps: false,
  },
  input_not_found: {
    title: 'An input Dataset Version is not available',
    hint: 'Start a new run and pick an input that exists in this workspace.',
    fix: 'inputs',
    retryHelps: false,
  },
  input_too_large: {
    title: 'An input is larger than a pipeline can read',
    hint: 'Narrow the input, for example with a smaller Dataset Version.',
    fix: 'inputs',
    retryHelps: false,
  },
  transform_rejected: {
    title: 'The transform uses something pipelines do not allow',
    hint: 'Edit the SQL on the Steps tab and publish a new version.',
    fix: 'steps',
    retryHelps: false,
  },
  transform_failed: {
    title: 'The transform could not run',
    hint: 'Edit the SQL on the Steps tab and publish a new version. Running it again will fail the same way.',
    fix: 'steps',
    retryHelps: false,
  },
  transform_timed_out: {
    title: 'The transform took too long',
    hint: 'Simplify the SQL or read less data. Running it again may help only if the server was busy.',
    fix: 'steps',
    retryHelps: true,
  },
  PL003: {
    title: 'The pipeline ran out of temporary storage',
    hint: 'Free or expand the pipeline worker’s temporary storage, then retry. Retrying before freeing space will fail the same way.',
    fix: null,
    retryHelps: true,
  },
  row_limit_exceeded: {
    title: 'The result is too large',
    hint: 'Filter or aggregate in the transform so it returns fewer rows.',
    fix: 'steps',
    retryHelps: false,
  },
  output_schema_not_found: {
    title: 'The output schema is not available',
    hint: 'Choose an active schema version in the Output section and publish a new version.',
    fix: 'output',
    retryHelps: false,
  },
  output_target_not_found: {
    title: 'The output Dataset is not available',
    hint: 'Choose another Dataset in the Output section and publish a new version.',
    fix: 'output',
    retryHelps: false,
  },
  output_column_mapping: {
    title: 'The result does not fit the output schema',
    hint: 'Rename the result columns in the SQL, or map them to schema fields in the Output section.',
    fix: 'output',
    retryHelps: false,
  },
  output_value_invalid: {
    title: 'A result value does not fit its output field',
    hint: 'Check the value types in the SQL, or map the column to a different field.',
    fix: 'output',
    retryHelps: false,
  },
  dataset_commit_failed: {
    title: 'The output Dataset refused the rows',
    hint: 'The message below says which rule failed. Fix the SQL or the output mapping and publish a new version.',
    fix: 'output',
    retryHelps: false,
  },
  pipeline_internal: {
    title: 'The run failed inside Sheetbase',
    hint: 'Running it again may work. If it keeps failing, tell your administrator.',
    fix: null,
    retryHelps: true,
  },
}

/** Guidance for a code; an unknown code (Python, newer engines) may be retried. */
export function explainRunError(code: string | null): RunErrorGuidance {
  const known = code ? GUIDANCE[code] : undefined
  return (
    known ?? {
      title: code ?? 'The run failed',
      hint: 'The log shows how far it got.',
      fix: null,
      retryHelps: true,
    }
  )
}
