import { t } from '#/copy'
import type { PipelineScheduleActivityKind } from '#/lib/pipelines/types'

export type Tone = 'ok' | 'stored' | 'warn' | 'bad'

/** What a start did with each thing it heard: its word, why, and how serious. */
export const OUTCOMES: Record<
  PipelineScheduleActivityKind,
  { label: () => string; why: () => string; tone: Tone }
> = {
  started: {
    label: () => t('features.pipelineStarts.outcome.started'),
    why: () => t('features.pipelineStarts.why.started'),
    tone: 'ok',
  },
  batched: {
    label: () => t('features.pipelineStarts.outcome.batched'),
    why: () => t('features.pipelineStarts.why.batched'),
    tone: 'ok',
  },
  skipped_unchanged: {
    label: () => t('features.pipelineStarts.outcome.skippedUnchanged'),
    why: () => t('features.pipelineStarts.why.skippedUnchanged'),
    tone: 'stored',
  },
  skipped_overlap: {
    label: () => t('features.pipelineStarts.outcome.skippedOverlap'),
    why: () => t('features.pipelineStarts.why.skippedOverlap'),
    tone: 'stored',
  },
  skipped_condition: {
    label: () => t('features.pipelineStarts.outcome.skippedCondition'),
    why: () => t('features.pipelineStarts.why.skippedCondition'),
    tone: 'stored',
  },
  skipped_missed: {
    label: () => t('features.pipelineStarts.outcome.skippedMissed'),
    why: () => t('features.pipelineStarts.why.skippedMissed'),
    tone: 'warn',
  },
  skipped_no_version: {
    label: () => t('features.pipelineStarts.outcome.skippedNoVersion'),
    why: () => t('features.pipelineStarts.why.skippedNoVersion'),
    tone: 'warn',
  },
  input_unresolved: {
    label: () => t('features.pipelineStarts.outcome.inputUnresolved'),
    why: () => t('features.pipelineStarts.why.inputUnresolved'),
    tone: 'warn',
  },
  start_failed: {
    label: () => t('features.pipelineStarts.outcome.startFailed'),
    why: () => t('features.pipelineStarts.why.startFailed'),
    tone: 'bad',
  },
}
