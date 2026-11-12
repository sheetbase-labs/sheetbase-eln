import { z } from 'zod'

import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { PIPELINE_STARTS_OPERATIONS } from './operations'

/**
 * Start rules from the assistant: change when a pipeline may start. A card,
 * like every write: nothing happens until the person presses its button,
 * which calls `set_pipeline_start_rules` in their own session.
 */

export const PIPELINE_START_RULES_TOOL = 'sheetbase.pipeline.start_rules_set'

export const PIPELINE_STARTS_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(PIPELINE_STARTS_OPERATIONS, 'propose')

export type PipelineStartsProposeToolName = typeof PIPELINE_START_RULES_TOOL

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM.')

export const proposeStartRulesSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  pipeline: z
    .string()
    .min(1)
    .max(200)
    .describe('The pipeline, by its name or key.'),
  hours: z
    .strictObject({
      days: z.enum(['daily', 'weekdays', 'weekends']),
      from: hhmm,
      to: hhmm,
    })
    .nullable()
    .optional()
    .describe(
      'Only start inside these days and hours, in the person’s time zone. `null` removes the hours. Leave out to keep them.',
    ),
  minNewRows: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .nullable()
    .optional()
    .describe(
      'A new snapshot must add at least this many new rows to start a run. `null` removes it.',
    ),
  waitMinutes: z
    .number()
    .int()
    .min(0)
    .max(1440)
    .optional()
    .describe(
      'Wait this many minutes after the last snapshot so a batch of imports runs once. 0 means no waiting.',
    ),
  conditionsMatch: z
    .enum(['all', 'any'])
    .optional()
    .describe('Whether all the conditions must hold, or any one.'),
  missedRuns: z
    .enum(['run_once', 'skip'])
    .optional()
    .describe(
      'After an outage: catch up with one run, or skip what was missed.',
    ),
})

/** What the card does when its button is pressed. */
export type PipelineStartsAction = {
  kind: 'pipeline.start_rules'
  workspaceId: string
  definitionId: string
  rules: Record<string, z.core.util.JSONType>
}

export function isPipelineStartsAction(action: {
  kind: string
}): action is PipelineStartsAction {
  return action.kind === 'pipeline.start_rules'
}
