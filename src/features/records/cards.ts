import { z } from 'zod'

/**
 * Records from the assistant. Like every write, each is a card: the model
 * names things the way the lab does, the server finds them and sends back a
 * card that says what will change, and nothing happens until the person
 * presses its button, which calls the ordinary RPC as them.
 *
 * The tool names are on the gateway allowlist through the operation
 * declarations (`create_model_record`, `archive_record`, `restore_record`,
 * `create_record_link`) and `agent-tool-catalogue.ts` (`add_lot`).
 */

export const RECORD_CREATE_TOOL = 'sheetbase.record.create'
export const RECORD_ARCHIVE_TOOL = 'sheetbase.record.archive'
export const RECORD_RESTORE_TOOL = 'sheetbase.record.restore'
export const RECORD_LINK_TOOL = 'sheetbase.record.link'
export const MATERIAL_ADD_LOT_TOOL = 'sheetbase.material.add_lot'

export const RECORDS_PROPOSE_TOOL_NAMES: readonly string[] = [
  RECORD_CREATE_TOOL,
  RECORD_ARCHIVE_TOOL,
  RECORD_RESTORE_TOOL,
  RECORD_LINK_TOOL,
  MATERIAL_ADD_LOT_TOOL,
]

export type RecordsProposeToolName =
  | typeof RECORD_CREATE_TOOL
  | typeof RECORD_ARCHIVE_TOOL
  | typeof RECORD_RESTORE_TOOL
  | typeof RECORD_LINK_TOOL
  | typeof MATERIAL_ADD_LOT_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const recordRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The record, by its ID (MAT-0012, S-0142) or its name.')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date, YYYY-MM-DD.')

const fieldValue = z.union([z.string().max(2_000), z.number(), z.boolean()])

export const proposeRecordCreateSchema = z.strictObject({
  title,
  summary,
  kind: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The type of record, by name or key: material (a reagent, standard, buffer, consumable), or any record type the lab has defined. Experiments, samples and registry entries have cards of their own.',
    ),
  name: z.string().min(1).max(200).describe('The record’s name.'),
  project: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The project it belongs to, by name or key. Leave it out only if there is a single project.',
    ),
  fields: z
    .record(z.string().min(1).max(120), fieldValue)
    .optional()
    .describe(
      'Its fields, by label as the form shows them: for a material Supplier, Catalog no, Lot, Expiry (YYYY-MM-DD), Quantity, Unit, Storage, Low stock threshold.',
    ),
})

export const proposeRecordStateSchema = z.strictObject({
  title,
  summary,
  record: recordRef,
})

export const proposeRecordLinkSchema = z.strictObject({
  title,
  summary,
  from: recordRef.describe('The record the link starts from.'),
  to: recordRef.describe('The record it points to.'),
  linkType: z
    .string()
    .min(1)
    .max(60)
    .default('related')
    .describe('What the link means, such as related, derived_from or used_in.'),
})

export const proposeMaterialLotSchema = z.strictObject({
  title,
  summary,
  material: recordRef.describe('The material the new lot is a lot of.'),
  lot: z.string().min(1).max(120).describe('The new lot number.'),
  expiry: date.describe('When the lot expires.'),
  quantity: z.number().positive().describe('How much came in.'),
  unit: z
    .string()
    .max(40)
    .optional()
    .describe('Its unit; the material’s own if left out.'),
  reason: z.string().max(400).optional(),
})

/** What a card does when its button is pressed. */
export type RecordsAction =
  | {
      kind: 'records.create'
      projectId: string | null
      recordKind: string
      title: string
      properties: Record<string, string | number | null>
      customFields: Record<string, string | number | boolean>
    }
  | { kind: 'records.archive'; recordId: string; metadataVersion: number }
  | { kind: 'records.restore'; recordId: string; metadataVersion: number }
  | {
      kind: 'records.link'
      sourceId: string
      targetId: string
      targetKind: string
      targetIdentifier: string
      linkType: string
    }
  | {
      kind: 'material.add_lot'
      recordId: string
      lot: string
      expiry: string
      quantity: number
      unit: string | null
      reason: string | null
    }

const RECORDS_ACTIONS = new Set([
  'records.create',
  'records.archive',
  'records.restore',
  'records.link',
  'material.add_lot',
])

export function isRecordsAction(action: {
  kind: string
}): action is RecordsAction {
  return RECORDS_ACTIONS.has(action.kind)
}
