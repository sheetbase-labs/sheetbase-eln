import { z } from 'zod'

import { PARENT_ROLES } from './bio-registry'
import type { ModelFieldRecordValues } from './model-fields'

/**
 * Running the lab from the assistant: counting storage, holding and releasing
 * records, keeping rules (retention, result limits, booking rules), adding
 * registry entries, moving samples through a workflow, ending timers and
 * repeats, pooling samples, preparing a solution, saving a search, pinning
 * things and changing the lab logo.
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button calls the ordinary RPC as the signed-in
 * person, so permissions, versions and the audit trail are the page's own.
 * Signing, approving and deciding requests stay with people.
 */

export const STOCKTAKE_START_TOOL = 'sheetbase.stocktake.start'
export const STOCKTAKE_COMPLETE_TOOL = 'sheetbase.stocktake.complete'
export const LEGAL_HOLD_CREATE_TOOL = 'sheetbase.legal_hold.create'
export const LEGAL_HOLD_RELEASE_TOOL = 'sheetbase.legal_hold.release'
export const RETENTION_SET_TOOL = 'sheetbase.retention.set'
export const RETENTION_APPLY_TOOL = 'sheetbase.retention.apply'
export const REGISTRY_ADD_TOOL = 'sheetbase.registry.add'
export const COMPOUND_LOT_TOOL = 'sheetbase.compound.add_lot'
export const WORKFLOW_ENROL_TOOL = 'sheetbase.workflow.enrol'
export const WORKFLOW_LEAVE_TOOL = 'sheetbase.workflow.leave'
export const SPEC_LIMITS_SET_TOOL = 'sheetbase.spec_limits.set'
export const BOOKING_RULES_SET_TOOL = 'sheetbase.booking_rules.set'
export const TIMER_END_TOOL = 'sheetbase.timer.end'
export const RECURRING_PAUSE_TOOL = 'sheetbase.recurring.pause'
export const RECURRING_END_TOOL = 'sheetbase.recurring.end'
export const SAMPLE_POOL_TOOL = 'sheetbase.sample.pool'
export const SOLUTION_PREPARE_TOOL = 'sheetbase.solution.prepare'
export const SEARCH_SAVE_TOOL = 'sheetbase.search.save'
export const PIN_TOOL = 'sheetbase.pin'
export const LAB_LOGO_TOOL = 'sheetbase.lab.logo'
export const WATCHER_FINDING_TOOL = 'sheetbase.watcher.finding'
export const WATCHER_SET_TOOL = 'sheetbase.watcher.set'

export const LABWORK_PROPOSE_TOOL_NAMES = [
  STOCKTAKE_START_TOOL,
  STOCKTAKE_COMPLETE_TOOL,
  LEGAL_HOLD_CREATE_TOOL,
  LEGAL_HOLD_RELEASE_TOOL,
  RETENTION_SET_TOOL,
  RETENTION_APPLY_TOOL,
  REGISTRY_ADD_TOOL,
  COMPOUND_LOT_TOOL,
  WORKFLOW_ENROL_TOOL,
  WORKFLOW_LEAVE_TOOL,
  SPEC_LIMITS_SET_TOOL,
  BOOKING_RULES_SET_TOOL,
  TIMER_END_TOOL,
  RECURRING_PAUSE_TOOL,
  RECURRING_END_TOOL,
  SAMPLE_POOL_TOOL,
  SOLUTION_PREPARE_TOOL,
  SEARCH_SAVE_TOOL,
  PIN_TOOL,
  LAB_LOGO_TOOL,
  WATCHER_FINDING_TOOL,
  WATCHER_SET_TOOL,
] as const

export type LabworkProposeToolName = (typeof LABWORK_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const sampleRef = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The sample as the person names it: its identifier (S-0142) or name.',
  )

export const proposeStocktakeStartSchema = z.strictObject({
  title,
  summary,
  location: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The freezer, shelf, rack or box to count, by name, code or path.',
    ),
  note: z.string().max(400).optional(),
})

export const proposeStocktakeCompleteSchema = z.strictObject({
  title,
  summary,
  stocktake: z
    .string()
    .min(1)
    .max(200)
    .describe('The open count by number (ST-0007) or words from its place.'),
})

export const proposeLegalHoldCreateSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(200).describe('A short name for the hold.'),
  reason: z.string().max(2_000).optional(),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('Hold everything in this project (by name or key).'),
  kind: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Or hold every record of one kind (a model key such as experiment).',
    ),
})

export const proposeLegalHoldReleaseSchema = z.strictObject({
  title,
  summary,
  hold: z.string().min(1).max(200).describe('The active hold, by name.'),
  note: z.string().max(2_000).optional().describe('Why it is released.'),
})

export const proposeRetentionSetSchema = z.strictObject({
  title,
  summary,
  kind: z
    .string()
    .min(1)
    .max(120)
    .describe('The kind of record, by model name or key.'),
  keepMonths: z
    .number()
    .int()
    .min(1)
    .max(1_200)
    .nullable()
    .describe('How many months to keep it. null removes the rule.'),
  note: z.string().max(400).optional(),
})

export const proposeRetentionApplySchema = z.strictObject({
  title,
  summary,
  kind: z
    .string()
    .max(120)
    .optional()
    .describe('Only this kind of record. Leave out for every rule.'),
})

export const proposeRegistryAddSchema = z.strictObject({
  title,
  summary,
  registry: z
    .string()
    .min(1)
    .max(200)
    .describe('The registry, by model name or key (such as Cell line).'),
  name: z.string().min(1).max(200).describe('The new entry’s name.'),
  project: z
    .string()
    .min(1)
    .max(200)
    .describe('The project it belongs to, by name or key.'),
  fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      'Field values by field name, only those the person gave. Do not invent any.',
    ),
  sequence: z
    .string()
    .min(1)
    .max(400_000)
    .optional()
    .describe(
      'The DNA of a construct or other sequence entry, as bases. The registry stores its fingerprint so the same sequence is never entered twice. Only when the person gave or pointed to the sequence.',
    ),
  topology: z
    .enum(['linear', 'circular'])
    .optional()
    .describe('With a sequence: default circular.'),
  parents: z
    .array(
      z.strictObject({
        record: z
          .string()
          .min(1)
          .max(200)
          .describe('A registry entry by identifier (CON-3) or name.'),
        role: z
          .enum(PARENT_ROLES)
          .optional()
          .describe(
            'What it was to the new entry: vector, insert, backbone, parent. Default parent.',
          ),
      }),
    )
    .max(12)
    .optional()
    .describe(
      'Entries this one was built from, such as the vector and insert of a cloning product.',
    ),
})

export const proposeCompoundLotSchema = z.strictObject({
  title,
  summary,
  compound: z
    .string()
    .min(1)
    .max(200)
    .describe('The compound, by its number (such as CMP-0001) or its name.'),
  name: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The lot’s name, such as a batch number. Leave out if not given.',
    ),
  fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      'Lot field values by field name, only those the person gave. Do not invent any.',
    ),
})

export const proposeWorkflowEnrolSchema = z.strictObject({
  title,
  summary,
  sample: sampleRef,
  workflow: z.string().min(1).max(200).describe('The workflow, by name.'),
})

export const proposeWorkflowLeaveSchema = z.strictObject({
  title,
  summary,
  sample: sampleRef,
  workflow: z
    .string()
    .max(200)
    .optional()
    .describe('Which workflow, when the sample is in more than one.'),
})

const limit = z.number().finite().nullable().optional()

export const proposeSpecLimitsSetSchema = z.strictObject({
  title,
  summary,
  model: z.string().min(1).max(200).describe('The model, by name or key.'),
  field: z.string().min(1).max(200).describe('The number field, by name.'),
  lowerLimit: limit.describe('Below this fails. null for none.'),
  upperLimit: limit.describe('Above this fails. null for none.'),
  alertLower: limit.describe('Below this warns. null for none.'),
  alertUpper: limit.describe('Above this warns. null for none.'),
  note: z.string().max(400).optional(),
})

export const proposeBookingRulesSetSchema = z.strictObject({
  title,
  summary,
  instrument: z.string().min(1).max(200),
  maxBookingMinutes: z
    .number()
    .int()
    .min(5)
    .max(10_080)
    .nullable()
    .optional()
    .describe('Longest single booking in minutes. null for no limit.'),
  maxAdvanceDays: z
    .number()
    .int()
    .min(1)
    .max(730)
    .nullable()
    .optional()
    .describe('How far ahead it can be booked, in days. null for no limit.'),
  requiredTraining: z
    .array(z.string().min(1).max(200))
    .max(20)
    .optional()
    .describe(
      'Procedures (by identifier or title) people must be trained on. Replaces the list; [] clears it.',
    ),
})

export const proposeWatcherFindingSchema = z.strictObject({
  title,
  summary,
  finding: z
    .string()
    .min(1)
    .max(200)
    .describe('The finding by words from its title.'),
  change: z.enum(['dismiss', 'snooze', 'reopen']),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe('How many days to snooze it for (default 7).'),
})

export const proposeWatcherSetSchema = z.strictObject({
  title,
  summary,
  watcher: z
    .enum([
      'stock_expiring',
      'stock_low',
      'work_overdue',
      'data_missing',
      'results_off',
    ])
    .describe('Which review.'),
  enabled: z.boolean(),
  schedule: z.enum(['hourly', 'daily', 'weekly']).optional(),
})

export const proposeTimerEndSchema = z.strictObject({
  title,
  summary,
  timer: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The running timer by its label or record. Leave out if the person has one.',
    ),
})

export const proposeRecurringPauseSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(200)
    .describe('The repeating work, by title.'),
  pause: z.boolean().optional().describe('false to resume. Default true.'),
})

export const proposeRecurringEndSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(200)
    .describe('The repeating work, by title.'),
  cancelUpcoming: z
    .boolean()
    .optional()
    .describe('Also cancel the bookings still ahead. Default true.'),
})

export const proposeSamplePoolSchema = z.strictObject({
  title,
  summary,
  sources: z
    .array(
      z.strictObject({
        sample: sampleRef,
        quantity: z.number().positive(),
      }),
    )
    .min(2)
    .max(50),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe('The experiment it is for, by identifier or title.'),
  poolName: z.string().max(200).optional(),
  storageLocation: z.string().max(200).optional(),
  notes: z.string().max(400).optional(),
})

export const proposeSolutionPrepareSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(200).describe('What is being made.'),
  lot: z.string().min(1).max(100).describe('The new lot number.'),
  quantity: z.number().positive(),
  unit: z.string().max(40).optional(),
  project: z
    .string()
    .min(1)
    .max(200)
    .describe('The project the new lot is filed under.'),
  ingredients: z
    .array(
      z.strictObject({
        lot: z
          .string()
          .min(1)
          .max(200)
          .describe('The ingredient lot by identifier, name or lot number.'),
        quantity: z
          .number()
          .positive()
          .describe('In the unit the lot is stocked in.'),
      }),
    )
    .min(1)
    .max(40),
  expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
    .optional()
    .describe('Leave out to use the earliest ingredient expiry.'),
  storage: z.string().max(200).optional(),
  note: z.string().max(400).optional(),
})

export const proposeSearchSaveSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(120).describe('What to call the saved search.'),
  words: z.string().min(1).max(300).describe('The words searched for.'),
  shareWithLab: z
    .boolean()
    .optional()
    .describe('Visible to everyone in the lab. Default: only the person.'),
})

export const proposePinSchema = z.strictObject({
  title,
  summary,
  target: z.enum(['record', 'project', 'instrument', 'pipeline']),
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Identifier, title, name or key of the thing.'),
  pin: z.boolean().optional().describe('false to unpin. Default true.'),
})

export const proposeLabLogoSchema = z.strictObject({
  title,
  summary,
  change: z.enum(['set', 'remove']),
  file: z
    .string()
    .max(200)
    .optional()
    .describe(
      'For set: the PNG or JPEG file (under 1 MB) already uploaded to the lab, by name.',
    ),
})

/** What a lab-work card does when its button is pressed. */
export type LabworkAction =
  | {
      kind: 'stocktake.start'
      level: 'unit' | 'shelf' | 'rack' | 'box'
      scopeId: string
      note: string | null
    }
  | { kind: 'stocktake.complete'; stocktakeId: string }
  | {
      kind: 'hold.create'
      name: string
      reason: string
      projectId: string | null
      recordKind: string | null
    }
  | { kind: 'hold.release'; holdId: string; note: string }
  | {
      kind: 'retention.set'
      recordKind: string
      keepMonths: number | null
      note: string
    }
  | { kind: 'retention.apply'; recordKind: string | null }
  | {
      kind: 'registry.add'
      projectId: string
      recordKind: string
      title: string
      customFields: ModelFieldRecordValues['customFields']
      parents?: { recordId: string; role: string }[]
    }
  | {
      kind: 'compound.lot'
      compoundId: string
      compound: string
      title: string
      customFields: ModelFieldRecordValues['customFields']
    }
  | { kind: 'workflow.enrol'; sampleId: string; workflowId: string }
  | { kind: 'workflow.leave'; sampleId: string; runId: string }
  | {
      kind: 'limits.set'
      recordKind: string
      fieldName: string
      lowerLimit: number | null
      upperLimit: number | null
      alertLower: number | null
      alertUpper: number | null
      note: string | null
    }
  | {
      kind: 'booking_rules.set'
      instrumentId: string
      protocolIds: string[]
      maxBookingMinutes: number | null
      maxAdvanceDays: number | null
    }
  | { kind: 'timer.end'; timerId: string; recordId: string | null }
  | { kind: 'recurring.pause'; scheduleId: string; paused: boolean }
  | { kind: 'recurring.end'; scheduleId: string; cancelUpcoming: boolean }
  | {
      kind: 'sample.pool'
      sources: {
        recordId: string
        quantity: number
        expectedMetadataVersion: number
      }[]
      experimentId: string
      unit: string | null
      notes: string | null
      poolName: string | null
      storageLocation: string | null
    }
  | {
      kind: 'solution.prepare'
      projectId: string
      title: string
      lot: string
      quantity: number
      unit: string | null
      expiry: string | null
      storage: string | null
      note: string | null
      ingredients: { recordId: string; quantity: number }[]
    }
  | {
      kind: 'search.save'
      name: string
      words: string
      visibility: 'private' | 'workspace'
    }
  | {
      kind: 'pin.set'
      target: 'record' | 'project' | 'instrument' | 'pipeline'
      id: string
      pinned: boolean
    }
  | { kind: 'logo.set'; fileRecordId: string }
  | { kind: 'logo.remove' }
  | {
      kind: 'watcher.finding'
      findingId: string
      change: 'dismiss' | 'snooze' | 'reopen'
      days: number
    }
  | {
      kind: 'watcher.set'
      workspaceId: string
      watcher: string
      enabled: boolean
      schedule: 'hourly' | 'daily' | 'weekly'
    }

export type LabworkActionKind = LabworkAction['kind']

const KINDS: readonly string[] = [
  'stocktake.start',
  'stocktake.complete',
  'hold.create',
  'hold.release',
  'retention.set',
  'retention.apply',
  'registry.add',
  'compound.lot',
  'workflow.enrol',
  'workflow.leave',
  'limits.set',
  'booking_rules.set',
  'timer.end',
  'recurring.pause',
  'recurring.end',
  'sample.pool',
  'solution.prepare',
  'search.save',
  'pin.set',
  'logo.set',
  'logo.remove',
  'watcher.finding',
  'watcher.set',
]

export function isLabworkAction(action: {
  kind: string
}): action is LabworkAction {
  return KINDS.includes(action.kind)
}

/** What running a card gave back, for the card to link to. */
export interface LabworkActionResult {
  openHref?: string
}
