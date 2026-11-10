import {
  describeParameters,
  describeSchedule,
} from '#/lib/pipeline-schedule-form'
import type {
  PipelineScheduleKind,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'

/** Stored schedules use the same interpretation as the schedule editor. */
export function scheduleSpecLabel(
  kind: PipelineScheduleKind,
  spec: PipelineScheduleWire['spec'],
  datasetNames: Map<string, string>,
): string {
  return describeSchedule(kind, spec, datasetNames)
}

export function scheduleParametersLabel(
  spec: PipelineScheduleWire['spec'],
): string {
  return describeParameters(spec)
}
