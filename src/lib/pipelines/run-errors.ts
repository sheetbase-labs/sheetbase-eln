import { t } from '#/copy'
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
    title: t('data.runErrors.pipelineSetUpCorrectly'),
    hint: t('data.runErrors.openPipelineFixWhat'),
    fix: 'steps',
    retryHelps: false,
  },
  invalid_run_request: {
    title: t('data.runErrors.runStartedValuesPipeline'),
    hint: t('data.runErrors.startAgainCheckParameters'),
    fix: 'inputs',
    retryHelps: false,
  },
  input_not_found: {
    title: t('data.runErrors.inputDatasetVersionAvailable'),
    hint: t('data.runErrors.startNewRunPick'),
    fix: 'inputs',
    retryHelps: false,
  },
  input_too_large: {
    title: t('data.runErrors.inputLargerThanPipeline'),
    hint: t('data.runErrors.narrowInputExampleSmaller'),
    fix: 'inputs',
    retryHelps: false,
  },
  transform_rejected: {
    title: t('data.runErrors.transformUsesSomethingPipelines'),
    hint: t('data.runErrors.editSqlStepsTab'),
    fix: 'steps',
    retryHelps: false,
  },
  transform_failed: {
    title: t('data.runErrors.transformCouldRun'),
    hint: t('data.runErrors.editSqlStepsTab2'),
    fix: 'steps',
    retryHelps: false,
  },
  transform_timed_out: {
    title: t('data.runErrors.transformTookTooLong'),
    hint: t('data.runErrors.simplifySqlReadLess'),
    fix: 'steps',
    retryHelps: true,
  },
  PL003: {
    title: t('data.runErrors.pipelineRanOutTemporary'),
    hint: t('data.runErrors.freeExpandPipelineWorker'),
    fix: null,
    retryHelps: true,
  },
  row_limit_exceeded: {
    title: t('data.runErrors.resultTooLarge'),
    hint: t('data.runErrors.filterAggregateTransformSo'),
    fix: 'steps',
    retryHelps: false,
  },
  output_schema_not_found: {
    title: t('data.runErrors.outputSchemaAvailable'),
    hint: t('data.runErrors.chooseActiveSchemaVersion'),
    fix: 'output',
    retryHelps: false,
  },
  output_target_not_found: {
    title: t('data.runErrors.outputDatasetAvailable'),
    hint: t('data.runErrors.chooseAnotherDatasetOutput'),
    fix: 'output',
    retryHelps: false,
  },
  output_column_mapping: {
    title: t('data.runErrors.resultDoesFitOutput'),
    hint: t('data.runErrors.renameResultColumnsSql'),
    fix: 'output',
    retryHelps: false,
  },
  output_value_invalid: {
    title: t('data.runErrors.resultValueDoesFit'),
    hint: t('data.runErrors.checkValueTypesSql'),
    fix: 'output',
    retryHelps: false,
  },
  dataset_commit_failed: {
    title: t('data.runErrors.outputDatasetRefusedRows'),
    hint: t('data.runErrors.messageBelowSaysWhich'),
    fix: 'output',
    retryHelps: false,
  },
  pipeline_internal: {
    title: t('data.runErrors.runFailedInsideSheetbase'),
    hint: t('data.runErrors.runningAgainMayWork'),
    fix: null,
    retryHelps: true,
  },
}

/** Guidance for a code; an unknown code (Python, newer engines) may be retried. */
export function explainRunError(code: string | null): RunErrorGuidance {
  const known = code ? GUIDANCE[code] : undefined
  return (
    known ?? {
      title: code ?? t('data.runErrors.runFailed'),
      hint: t('data.runErrors.logShowsHowFar'),
      fix: null,
      retryHelps: true,
    }
  )
}
