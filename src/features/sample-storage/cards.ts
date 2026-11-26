import { z } from 'zod'

import { STOCKTAKE_ACTIONS } from '#/lib/stocktake'

/**
 * Samples and storage from the assistant. Like every write, each is a card:
 * the model names things the way the lab does (S-0142, ST-0007, SHP-0003, a
 * box and a position), the server finds them under the person's own access and
 * sends back a card that says what will change, and nothing happens until the
 * person presses its button, which calls the ordinary RPC as them.
 *
 * Releasing a sample and signing stay on the person's own screen.
 */

export const SAMPLE_WITHDRAW_TOOL = 'sheetbase.sample.withdraw'
export const SAMPLE_LABEL_TOOL = 'sheetbase.sample.label_printed'
export const SAMPLE_MATCH_TOOL = 'sheetbase.sample.match_locations'
export const POSITION_STATUS_TOOL = 'sheetbase.storage.position_status'
export const STOCKTAKE_SCAN_TOOL = 'sheetbase.stocktake.scan'
export const STOCKTAKE_RESOLVE_TOOL = 'sheetbase.stocktake.resolve'
export const STOCKTAKE_CANCEL_TOOL = 'sheetbase.stocktake.cancel'
export const SHIPMENT_DISPATCH_TOOL = 'sheetbase.shipment.dispatch'
export const SHIPMENT_UPDATE_TOOL = 'sheetbase.shipment.update'
export const MATERIAL_SAFETY_TOOL = 'sheetbase.material.safety'
export const WORKFLOW_SAVE_TOOL = 'sheetbase.sample_workflow.save'
export const WORKFLOW_STATUS_TOOL = 'sheetbase.sample_workflow.set_status'
export const RELEASE_RULES_TOOL = 'sheetbase.release_rules.set'

export const SAMPLE_STORAGE_PROPOSE_TOOL_NAMES: readonly string[] = [
  SAMPLE_WITHDRAW_TOOL,
  SAMPLE_LABEL_TOOL,
  SAMPLE_MATCH_TOOL,
  POSITION_STATUS_TOOL,
  STOCKTAKE_SCAN_TOOL,
  STOCKTAKE_RESOLVE_TOOL,
  STOCKTAKE_CANCEL_TOOL,
  SHIPMENT_DISPATCH_TOOL,
  SHIPMENT_UPDATE_TOOL,
  MATERIAL_SAFETY_TOOL,
  WORKFLOW_SAVE_TOOL,
  WORKFLOW_STATUS_TOOL,
  RELEASE_RULES_TOOL,
]

export type SampleStorageProposeToolName =
  | typeof SAMPLE_WITHDRAW_TOOL
  | typeof SAMPLE_LABEL_TOOL
  | typeof SAMPLE_MATCH_TOOL
  | typeof POSITION_STATUS_TOOL
  | typeof STOCKTAKE_SCAN_TOOL
  | typeof STOCKTAKE_RESOLVE_TOOL
  | typeof STOCKTAKE_CANCEL_TOOL
  | typeof SHIPMENT_DISPATCH_TOOL
  | typeof SHIPMENT_UPDATE_TOOL
  | typeof MATERIAL_SAFETY_TOOL
  | typeof WORKFLOW_SAVE_TOOL
  | typeof WORKFLOW_STATUS_TOOL
  | typeof RELEASE_RULES_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const shared = { title, summary }

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date, YYYY-MM-DD.')

const sampleRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The sample, by ID (S-0142) or name.')

const stocktakeRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The stocktake, by number (ST-0007) or the place it counts.')

export const proposeSampleWithdrawSchema = z.strictObject({
  ...shared,
  sample: sampleRef,
  quantity: z
    .number()
    .positive()
    .describe('How much to take, in the sample’s own unit.'),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment it is taken for, by ID (EXP-0042) or title. Required: every withdrawal says what it is for.',
    ),
  unit: z.string().max(40).optional(),
  notes: z.string().max(400).optional(),
  newContainer: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Name for a new tube that holds what was taken, linked to the sample. Leave out to just take the amount.',
    ),
})

export const proposeSampleLabelSchema = z.strictObject({
  ...shared,
  sample: sampleRef.describe(
    'The sample whose label was printed, by ID or name.',
  ),
})

export const proposeSampleMatchSchema = z.strictObject({ ...shared })

export const POSITION_STATUSES = [
  'available',
  'quarantined',
  'missing',
] as const

export const proposePositionStatusSchema = z.strictObject({
  ...shared,
  box: z.string().min(1).max(200).describe('The box, by name or code.'),
  position: z.string().min(1).max(8).describe('The position, such as B4.'),
  status: z
    .enum(POSITION_STATUSES)
    .describe(
      'available: usable again. quarantined: do not use. missing: the slot is gone or broken. Only a position with no sample in it can change.',
    ),
  notes: z.string().max(400).optional(),
})

export const proposeStocktakeScanSchema = z.strictObject({
  ...shared,
  stocktake: stocktakeRef,
  item: z
    .string()
    .min(1)
    .max(200)
    .describe('The sample or material that was found, by ID or name.'),
  box: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The box it was found in, by name or code, when that is not the box the count is of.',
    ),
})

export const proposeStocktakeResolveSchema = z.strictObject({
  ...shared,
  stocktake: stocktakeRef,
  item: z
    .string()
    .min(1)
    .max(200)
    .describe('The sample or material that was misplaced or missing.'),
  action: z
    .enum(STOCKTAKE_ACTIONS)
    .describe(
      'accept: the place it was found is fine. refile: file it where it was found. returned: put it back. mark_lost: write a missing sample off. clear_location: forget where a missing material is.',
    ),
  notes: z.string().max(400).optional(),
})

export const proposeStocktakeCancelSchema = z.strictObject({
  ...shared,
  stocktake: stocktakeRef,
})

export const proposeShipmentDispatchSchema = z.strictObject({
  ...shared,
  shipment: z.string().min(1).max(200).describe('The shipment, SHP-0003.'),
  shippedOn: date.optional().describe('When it went. Today if left out.'),
  carrier: z.string().max(120).optional(),
  trackingReference: z.string().max(200).optional(),
  expectedOn: date.optional().describe('When it should arrive.'),
})

export const proposeShipmentUpdateSchema = z.strictObject({
  ...shared,
  shipment: z.string().min(1).max(200).describe('The shipment, SHP-0003.'),
  counterparty: z.string().max(200).optional(),
  carrier: z.string().max(120).optional(),
  trackingReference: z.string().max(200).optional(),
  expectedOn: date.optional(),
  notes: z.string().max(1_000).optional(),
})

export const GHS_CODES = [
  'GHS01',
  'GHS02',
  'GHS03',
  'GHS04',
  'GHS05',
  'GHS06',
  'GHS07',
  'GHS08',
  'GHS09',
] as const

export const proposeMaterialSafetySchema = z.strictObject({
  ...shared,
  material: z.string().min(1).max(200).describe('The material, by ID or name.'),
  pictograms: z
    .array(z.enum(GHS_CODES))
    .max(9)
    .describe(
      'GHS pictograms: 01 explosive, 02 flammable, 03 oxidising, 04 gas under pressure, 05 corrosive, 06 toxic, 07 irritant, 08 health hazard, 09 environment. An empty list clears them.',
    ),
  signalWord: z.enum(['danger', 'warning', 'none']),
  hazardStatements: z
    .array(z.string().regex(/^(H|EUH)\d{2,3}[A-Za-z]*$/))
    .max(30)
    .optional()
    .describe('Hazard statement codes such as H225 or H302.'),
  allLots: z
    .boolean()
    .optional()
    .describe('Apply to every lot of this material. Default true.'),
})

export const proposeWorkflowSaveSchema = z.strictObject({
  ...shared,
  name: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The workflow’s name. An existing workflow of this name is changed; otherwise a new one is made.',
    ),
  description: z.string().max(400).optional(),
  sampleType: z
    .string()
    .max(120)
    .optional()
    .describe('The sample type it applies to. Any type if left out.'),
  autoEnrol: z
    .boolean()
    .optional()
    .describe('New samples of the type start in the first step on their own.'),
  steps: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(120),
        turnaroundDays: z.number().int().min(1).max(3650).optional(),
        requiredFields: z
          .array(z.string().min(1).max(80))
          .max(20)
          .optional()
          .describe(
            'Sample fields to fill in before a sample can reach this step.',
          ),
      }),
    )
    .min(2)
    .max(30)
    .describe(
      'The steps in order. Each leads to the next; the last one finishes the workflow.',
    ),
})

export const proposeWorkflowStatusSchema = z.strictObject({
  ...shared,
  workflow: z.string().min(1).max(200).describe('The workflow, by name.'),
  status: z
    .enum(['active', 'archived'])
    .describe('archived takes it out of use; active brings it back.'),
})

export const proposeReleaseRulesSchema = z.strictObject({
  ...shared,
  sampleType: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The sample type the rules are for, as it is written on samples.',
    ),
  rules: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('no_result'),
          result: z.string().min(1).max(80),
          label: z.string().max(120).optional(),
        }),
        z.strictObject({
          kind: z.literal('min_measurements'),
          count: z.number().int().min(1).max(1000),
          label: z.string().max(120).optional(),
        }),
        z.strictObject({
          kind: z.literal('measurement_required'),
          measurement: z.string().min(1).max(120),
          label: z.string().max(120).optional(),
        }),
        z.strictObject({
          kind: z.literal('measurement_range'),
          measurement: z.string().min(1).max(120),
          min: z.number().optional(),
          max: z.number().optional(),
          label: z.string().max(120).optional(),
        }),
      ]),
    )
    .max(20)
    .describe(
      'What must be true before a sample of this type can be released. These replace the rules the type has now.',
    ),
})

/** What a card does when its button is pressed. */
export type SampleStorageAction =
  | {
      kind: 'sample.withdraw'
      recordId: string
      metadataVersion: number
      quantity: number
      unit: string | null
      experimentId: string
      notes: string | null
      newContainer: string | null
    }
  | {
      kind: 'sample.label_printed'
      recordId: string
      metadataVersion: number
      identifier: string
    }
  | { kind: 'sample.match_locations'; workspaceId: string }
  | {
      kind: 'storage.position_status'
      positionId: string
      status: (typeof POSITION_STATUSES)[number]
      notes: string | null
    }
  | {
      kind: 'stocktake.scan'
      stocktakeId: string
      recordId: string
      boxId: string | null
    }
  | {
      kind: 'stocktake.resolve'
      itemId: string
      stocktakeId: string
      action: (typeof STOCKTAKE_ACTIONS)[number]
      notes: string | null
    }
  | { kind: 'stocktake.cancel'; stocktakeId: string }
  | {
      kind: 'shipment.dispatch'
      shipmentId: string
      shippedOn: string | null
      carrier: string | null
      trackingReference: string | null
      expectedOn: string | null
    }
  | {
      kind: 'shipment.update'
      shipmentId: string
      counterparty: string | null
      carrier: string | null
      trackingReference: string | null
      expectedOn: string | null
      notes: string | null
    }
  | {
      kind: 'material.safety'
      recordId: string
      pictograms: string[]
      signalWord: string | null
      hazardStatements: string[]
      allLots: boolean
    }
  | {
      kind: 'sample_workflow.save'
      workflowId: string | null
      definition: {
        name: string
        description: string
        sampleType: string
        autoEnrol: boolean
        stages: Array<{
          key: string
          id?: string
          name: string
          description: string
          turnaroundDays: number | null
          final: boolean
          requiredFields: string[]
          actions: never[]
          next: string[]
        }>
      }
    }
  | {
      kind: 'sample_workflow.set_status'
      workflowId: string
      status: 'active' | 'archived'
    }
  | {
      kind: 'release_rules.set'
      workspaceId: string
      sampleType: string
      rules: Array<Record<string, string | number>>
    }

const SAMPLE_STORAGE_ACTIONS = new Set([
  'sample.withdraw',
  'sample.label_printed',
  'sample.match_locations',
  'storage.position_status',
  'stocktake.scan',
  'stocktake.resolve',
  'stocktake.cancel',
  'shipment.dispatch',
  'shipment.update',
  'material.safety',
  'sample_workflow.save',
  'sample_workflow.set_status',
  'release_rules.set',
])

export function isSampleStorageAction(action: {
  kind: string
}): action is SampleStorageAction {
  return SAMPLE_STORAGE_ACTIONS.has(action.kind)
}
