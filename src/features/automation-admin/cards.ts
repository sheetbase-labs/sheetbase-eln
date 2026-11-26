import { z } from 'zod'

import { cardWords } from '#/lib/assistant-call-cards'
import type { RpcCardAction } from '#/lib/assistant-call-cards'

/**
 * Pipelines and automation from the assistant: retire a pipeline version,
 * remind someone a run is waiting, set up repeating work, change or delete a
 * saved search, change or delete a webhook and replay what it missed, ask for
 * a schedule and dismiss one, run a watcher now, and set how long the event
 * stream is kept. Each is a card: the model names things the way the lab
 * does, the server finds them and says what will change, and nothing happens
 * until the person presses the button, which calls the ordinary RPC as them.
 * The tool names are on the gateway allowlist through `agent-tool-catalogue.ts`.
 */

/** Each card's kind, the tool that proposes it, and the function it calls. */
export const AUTOMATION_ADMIN_CARDS = {
  'pipeline.version_retire': {
    tool: 'sheetbase.pipeline.retire_version',
    rpc: 'retire_pipeline_definition_version',
  },
  'pipeline.run_remind': {
    tool: 'sheetbase.pipeline.remind_run',
    rpc: 'remind_pipeline_run',
  },
  'recurring.create': {
    tool: 'sheetbase.recurring.create',
    rpc: 'create_recurring_schedule',
  },
  'search.update': {
    tool: 'sheetbase.search.update',
    rpc: 'update_saved_search',
  },
  'search.delete': {
    tool: 'sheetbase.search.delete',
    rpc: 'delete_saved_search',
  },
  'webhook.update': {
    tool: 'sheetbase.webhook.update',
    rpc: 'update_webhook_subscription',
  },
  'webhook.delete': {
    tool: 'sheetbase.webhook.delete',
    rpc: 'delete_webhook_subscription',
  },
  'webhook.replay_delivery': {
    tool: 'sheetbase.webhook.replay_delivery',
    rpc: 'replay_webhook_delivery',
  },
  'webhook.replay_deliveries': {
    tool: 'sheetbase.webhook.replay_deliveries',
    rpc: 'replay_webhook_deliveries',
  },
  'schedule.request_proposal': {
    tool: 'sheetbase.schedule.request',
    rpc: 'request_schedule_proposal',
  },
  'schedule.dismiss_proposal': {
    tool: 'sheetbase.schedule.dismiss',
    rpc: 'dismiss_schedule_proposal',
  },
  'watcher.run': {
    tool: 'sheetbase.watcher.run',
    rpc: 'run_lab_watcher',
  },
  'events.retention': {
    tool: 'sheetbase.events.set_retention',
    rpc: 'set_event_stream_retention',
  },
} as const

export type AutomationAdminKind = keyof typeof AUTOMATION_ADMIN_CARDS

export type AutomationAdminProposeToolName =
  (typeof AUTOMATION_ADMIN_CARDS)[AutomationAdminKind]['tool']

export type AutomationAdminAction = RpcCardAction<AutomationAdminKind>

export const AUTOMATION_ADMIN_PROPOSE_TOOL_NAMES: readonly string[] =
  Object.values(AUTOMATION_ADMIN_CARDS).map((card) => card.tool)

const pipeline = z
  .string()
  .min(1)
  .max(200)
  .describe('The pipeline, by name or key.')

const subscription = z
  .string()
  .min(1)
  .max(200)
  .describe('The webhook, by its key, description or address.')

const experiment = z
  .string()
  .min(1)
  .max(200)
  .describe('The experiment, by ID (EXP-0012) or name.')

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date, YYYY-MM-DD.')

const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .describe('A time of day, HH:MM, on the person’s clock.')

export const WEBHOOK_STATUSES = [
  'active',
  'paused',
  'disabled',
  'archived',
] as const

export const automationAdminSchemas = {
  versionRetire: z.strictObject({
    ...cardWords,
    pipeline,
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The version number. The published one if left out.'),
  }),
  runRemind: z.strictObject({ ...cardWords, pipeline }),
  recurring: z.strictObject({
    ...cardWords,
    kind: z
      .enum(['booking', 'experiment'])
      .describe(
        'booking: book an instrument again and again. experiment: start an experiment from a template again and again.',
      ),
    name: z.string().min(1).max(200).describe('What the repeat is called.'),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'offsets']),
    startsOn: day,
    every: z
      .number()
      .int()
      .min(1)
      .max(52)
      .optional()
      .describe('Every this many days, weeks or months. 1 if left out.'),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .optional()
      .describe('For weekly: the days, Monday is 1 and Sunday is 7.'),
    offsetsDays: z
      .array(z.number().int().min(0).max(3660))
      .max(60)
      .optional()
      .describe(
        'For offsets (an experiment only): the days after the start to run it on, such as 0, 7, 14.',
      ),
    endsOn: day.optional(),
    maxOccurrences: z.number().int().min(1).max(400).optional(),
    instrument: z
      .string()
      .max(200)
      .optional()
      .describe('For a booking: the instrument, by name or INS number.'),
    startTime: time.optional().describe('For a booking: when it starts.'),
    endTime: time.optional().describe('For a booking: when it ends.'),
    template: z
      .string()
      .max(200)
      .optional()
      .describe('For an experiment: the template, by name or ID (TPL-0004).'),
    project: z
      .string()
      .max(200)
      .optional()
      .describe(
        'The project, by name or ID (PRJ-0008). Needed for an experiment.',
      ),
    leadDays: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe('Make each one this many days ahead.'),
    notes: z.string().max(500).optional(),
  }),
  searchUpdate: z.strictObject({
    ...cardWords,
    search: z.string().min(1).max(200).describe('The saved search, by name.'),
    name: z.string().min(1).max(120).optional().describe('A new name.'),
    visibility: z
      .enum(['private', 'workspace'])
      .optional()
      .describe('workspace shares it with everyone in the lab.'),
  }),
  searchDelete: z.strictObject({
    ...cardWords,
    search: z.string().min(1).max(200).describe('The saved search, by name.'),
  }),
  webhookUpdate: z.strictObject({
    ...cardWords,
    webhook: subscription,
    url: z.string().url().max(2048).optional().describe('A new address.'),
    eventTypes: z
      .array(z.string().min(1).max(120))
      .max(100)
      .optional()
      .describe('The events it hears about, replacing the old list.'),
    description: z.string().min(1).max(2000).optional(),
    status: z.enum(WEBHOOK_STATUSES).optional(),
    maxRetries: z.number().int().min(0).max(25).optional(),
    failureThreshold: z.number().int().min(0).max(100).optional(),
    rateLimitPerMinute: z.number().int().min(1).max(60_000).optional(),
  }),
  webhookDelete: z.strictObject({ ...cardWords, webhook: subscription }),
  replayDelivery: z.strictObject({
    ...cardWords,
    webhook: subscription,
    status: z
      .enum(['dead_letter', 'failed', 'delivered'])
      .default('dead_letter')
      .describe(
        'Which delivery to send again: one that gave up, failed or went through.',
      ),
    event: z
      .string()
      .max(120)
      .optional()
      .describe(
        'Its event, such as sample.created, if more than one is waiting.',
      ),
  }),
  replayDeliveries: z.strictObject({
    ...cardWords,
    webhook: subscription.optional(),
    status: z
      .enum(['dead_letter', 'failed', 'delivered'])
      .default('dead_letter'),
    since: day.optional(),
    until: day.optional(),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  scheduleRequest: z.strictObject({
    ...cardWords,
    experiment,
    reason: z
      .enum(['plan', 'slip'])
      .default('plan')
      .describe('plan: a first plan. slip: re-plan because a part ran late.'),
  }),
  scheduleDismiss: z.strictObject({ ...cardWords, experiment }),
  watcherRun: z.strictObject({
    ...cardWords,
    watcher: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'The watcher: stock expiring, stock low, work overdue, data missing or results off.',
      ),
  }),
  retention: z.strictObject({
    ...cardWords,
    days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .describe('How many days the event stream is kept.'),
  }),
}
