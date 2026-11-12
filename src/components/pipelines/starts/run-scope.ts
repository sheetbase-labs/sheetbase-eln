import { z } from 'zod'

import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import { specBindings } from '#/lib/pipeline-schedule'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

export interface ScopeLine {
  icon: IconName
  text: string
}

const savedScope = z.looseObject({
  output: z
    .looseObject({
      mode: z.string().optional(),
      datasetId: z.string().optional(),
      datasetName: z.string().optional(),
    })
    .optional(),
  steps: z
    .array(
      z.looseObject({
        kind: z.string(),
        action: z
          .looseObject({
            operation: z.string(),
            mode: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
})

/** The Datasets a pipeline's starts read, by id. */
function readIds(schedules: readonly PipelineScheduleWire[]): string[] {
  const ids = schedules.flatMap((schedule) => [
    ...(z.string().safeParse(schedule.spec.datasetId).success
      ? [z.string().parse(schedule.spec.datasetId)]
      : []),
    ...Object.values(specBindings(schedule.spec)).flatMap((binding) =>
      'datasetId' in binding ? [binding.datasetId] : [],
    ),
  ])

  return [...new Set(ids)]
}

/** What the pipeline's own identity touches, read from its starts and its
 * saved steps: Datasets read and written, ELN actions, notifications. */
export function runScope(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The stored configuration; parsed with the schema above before any field is read.
  configuration: unknown,
  schedules: readonly PipelineScheduleWire[],
  datasetNames: Map<string, string>,
): ScopeLine[] {
  const parsed = savedScope.safeParse(configuration)
  const config = parsed.success ? parsed.data : {}
  const lines: ScopeLine[] = []

  const names = readIds(schedules).map((id) => datasetNames.get(id) ?? id)

  if (names.length > 0)
    lines.push({
      icon: 'database',
      text: t('features.pipelineStarts.aside.scope.reads', {
        names: names.join(', '),
      }),
    })

  const output = config.output

  if (output?.mode === 'append' && output.datasetId)
    lines.push({
      icon: 'plus',
      text: t('features.pipelineStarts.aside.scope.appends', {
        name: datasetNames.get(output.datasetId) ?? output.datasetId,
      }),
    })

  if (output?.mode === 'create' && output.datasetName)
    lines.push({
      icon: 'plus',
      text: t('features.pipelineStarts.aside.scope.createsDataset', {
        name: output.datasetName,
      }),
    })

  const steps = config.steps ?? []

  for (const step of steps) {
    if (step.kind !== 'action' || !step.action) continue

    const label =
      PIPELINE_ACTIONS.find(
        (action) =>
          action.operation === step.action?.operation ||
          action.rpc === step.action?.operation,
      )?.label ?? step.action.operation

    lines.push({
      icon: 'edit',
      text:
        step.action.mode === 'propose'
          ? t('features.pipelineStarts.aside.scope.proposes', { action: label })
          : t('features.pipelineStarts.aside.scope.does', { action: label }),
    })
  }

  const posts = steps.filter((step) => step.kind === 'notify').length

  if (posts > 0)
    lines.push({
      icon: 'comment',
      text: t('features.pipelineStarts.aside.scope.posts', { count: posts }),
    })

  return lines
}
