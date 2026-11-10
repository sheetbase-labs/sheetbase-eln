import { z } from 'zod'

import type { PipelineScheduleWire } from './pipelines/types'

/**
 * Pipelines and plugins from the assistant: run a pipeline, retry or cancel a
 * run, publish its newest draft, retire it or bring it back, add a schedule,
 * switch a schedule on or off or delete it, and switch a plugin on or off or
 * remove it. Reading pipelines, runs, schedules and plugins is the lab list
 * tool's job (`pipelines`, `pipeline_runs`, `pipeline_schedules`, `plugins`).
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button runs the ordinary pipeline and plugin calls
 * as the signed-in person, so the database's own checks apply: stewards and
 * up publish, owners and admins manage plugins. A run that waits for a person
 * is answered on its run page, never from a card.
 */

export const PIPELINE_RUN_TOOL = 'sheetbase.pipeline.run'
export const PIPELINE_RETRY_TOOL = 'sheetbase.pipeline.retry'
export const PIPELINE_CANCEL_TOOL = 'sheetbase.pipeline.cancel'
export const PIPELINE_PUBLISH_TOOL = 'sheetbase.pipeline.publish'
export const PIPELINE_RETIRE_TOOL = 'sheetbase.pipeline.retire'
export const PIPELINE_SCHEDULE_ADD_TOOL = 'sheetbase.pipeline.schedule_add'

export const PIPELINE_SCHEDULE_SWITCH_TOOL =
  'sheetbase.pipeline.schedule_switch'

export const PIPELINE_SCHEDULE_DELETE_TOOL =
  'sheetbase.pipeline.schedule_delete'

export const PLUGIN_SWITCH_TOOL = 'sheetbase.plugin.switch'
export const PLUGIN_REMOVE_TOOL = 'sheetbase.plugin.remove'

export const PIPELINES_PROPOSE_TOOL_NAMES = [
  PIPELINE_RUN_TOOL,
  PIPELINE_RETRY_TOOL,
  PIPELINE_CANCEL_TOOL,
  PIPELINE_PUBLISH_TOOL,
  PIPELINE_RETIRE_TOOL,
  PIPELINE_SCHEDULE_ADD_TOOL,
  PIPELINE_SCHEDULE_SWITCH_TOOL,
  PIPELINE_SCHEDULE_DELETE_TOOL,
  PLUGIN_SWITCH_TOOL,
  PLUGIN_REMOVE_TOOL,
] as const

export type PipelinesProposeToolName =
  (typeof PIPELINES_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const pipeline = z
  .string()
  .min(1)
  .max(200)
  .describe('The pipeline, by its name or key.')

const plugin = z
  .string()
  .min(1)
  .max(200)
  .describe('The plugin, by its name or key.')

const scheduleKind = z
  .enum(['interval', 'daily', 'cron', 'event'])
  .optional()
  .describe(
    'Which of the pipeline’s schedules, when it has more than one: `interval`, `daily`, `cron` or `event`.',
  )

const pipelineParametersSchema = z.record(z.string().min(1).max(64), z.json())

export const proposePipelineRunSchema = z.strictObject({
  title,
  summary,
  pipeline,
  inputs: z
    .record(z.string().min(1).max(64), z.string().min(1).max(200))
    .optional()
    .describe(
      'Which dataset each input reads, as input name to dataset name. The newest version of each dataset is used. Leave out for a pipeline without inputs.',
    ),
  parameters: pipelineParametersSchema
    .optional()
    .describe('Values for the pipeline’s settings, by name, if they said.'),
})

export const proposePipelineRetrySchema = z.strictObject({
  title,
  summary,
  pipeline,
})

export const proposePipelineCancelSchema = z.strictObject({
  title,
  summary,
  pipeline,
})

export const proposePipelinePublishSchema = z.strictObject({
  title,
  summary,
  pipeline,
})

export const proposePipelineRetireSchema = z.strictObject({
  title,
  summary,
  pipeline,
  retire: z
    .boolean()
    .describe(
      '`true` retires it so it can no longer run; `false` brings a retired pipeline back.',
    ),
})

export const proposePipelineScheduleAddSchema = z.strictObject({
  title,
  summary,
  pipeline,
  everyMinutes: z
    .number()
    .int()
    .min(1)
    .max(10080)
    .optional()
    .describe('Run every so many minutes.'),
  dailyAt: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM.')
    .optional()
    .describe('Run every day at this time (HH:MM, the person’s time zone).'),
  cron: z
    .string()
    .min(9)
    .max(100)
    .optional()
    .describe(
      'Run on a five-field cron, such as `0 6 * * 1-5` for 06:00 on weekdays, in the person’s time zone.',
    ),
  onEvent: z
    .string()
    .min(3)
    .max(100)
    .optional()
    .describe(
      'Run whenever this happens, by its event name, such as `dataset.versioned` or `pipeline.run.succeeded`.',
    ),
})

export const proposePipelineScheduleSwitchSchema = z.strictObject({
  title,
  summary,
  pipeline,
  kind: scheduleKind,
  on: z.boolean().describe('`true` switches it on, `false` pauses it.'),
})

export const proposePipelineScheduleDeleteSchema = z.strictObject({
  title,
  summary,
  pipeline,
  kind: scheduleKind,
})

export const proposePluginSwitchSchema = z.strictObject({
  title,
  summary,
  plugin,
  on: z.boolean().describe('`true` switches it on, `false` off.'),
})

export const proposePluginRemoveSchema = z.strictObject({
  title,
  summary,
  plugin,
})

/** The pipeline settings a run is given, as the card's schema carried them. */
type PipelineRunParameters = z.infer<typeof pipelineParametersSchema>

/** What a pipeline or plugin card does when its button is pressed. */
export type PipelinesAction =
  | {
      kind: 'pipeline.run'
      definitionId: string
      versionId: string
      parameters: PipelineRunParameters
      inputVersions: Record<string, string>
    }
  | { kind: 'pipeline.retry'; definitionId: string; runId: string }
  | {
      kind: 'pipeline.cancel'
      workspaceId: string
      definitionId: string
      runId: string
    }
  | {
      kind: 'pipeline.publish'
      workspaceId: string
      definitionId: string
      versionId: string
    }
  | {
      kind: 'pipeline.retire'
      workspaceId: string
      definitionId: string
      lifecycle: 'active' | 'retired'
    }
  | {
      kind: 'pipeline.schedule_add'
      workspaceId: string
      definitionId: string
      scheduleKind: 'interval' | 'daily' | 'cron' | 'event'
      spec: PipelineScheduleWire['spec']
    }
  | {
      kind: 'pipeline.schedule_switch'
      workspaceId: string
      definitionId: string
      scheduleId: string
      enabled: boolean
    }
  | {
      kind: 'pipeline.schedule_delete'
      workspaceId: string
      definitionId: string
      scheduleId: string
    }
  | {
      kind: 'plugin.switch'
      workspaceId: string
      extensionId: string
      enabled: boolean
    }
  | { kind: 'plugin.remove'; workspaceId: string; extensionId: string }

export type PipelinesActionKind = PipelinesAction['kind']

const KINDS: readonly string[] = [
  'pipeline.run',
  'pipeline.retry',
  'pipeline.cancel',
  'pipeline.publish',
  'pipeline.retire',
  'pipeline.schedule_add',
  'pipeline.schedule_switch',
  'pipeline.schedule_delete',
  'plugin.switch',
  'plugin.remove',
]

export function isPipelinesAction(action: {
  kind: string
}): action is PipelinesAction {
  return KINDS.includes(action.kind)
}

export interface PipelinesActionResult {
  openHref?: string
}
