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
export const MATERIAL_STOCK_TOOL = 'sheetbase.material.stock'
export const SAMPLE_EDIT_TOOL = 'sheetbase.sample.edit'
export const SAMPLE_RESTORE_TOOL = 'sheetbase.sample.restore'
export const STORAGE_UPDATE_TOOL = 'sheetbase.storage.update_location'
export const STORAGE_ARCHIVE_TOOL = 'sheetbase.storage.archive_location'
export const DATASET_ARCHIVE_TOOL = 'sheetbase.dataset.archive'
export const DATASET_RESTORE_TOOL = 'sheetbase.dataset.restore'
export const SHEET_ARCHIVE_TOOL = 'sheetbase.sheet.archive'
export const SHEET_RESTORE_TOOL = 'sheetbase.sheet.restore'
export const SHEET_DUPLICATE_TOOL = 'sheetbase.sheet.duplicate'

export const RECORDS_PROPOSE_TOOL_NAMES: readonly string[] = [
  RECORD_CREATE_TOOL,
  RECORD_ARCHIVE_TOOL,
  RECORD_RESTORE_TOOL,
  RECORD_LINK_TOOL,
  MATERIAL_ADD_LOT_TOOL,
  MATERIAL_STOCK_TOOL,
  SAMPLE_EDIT_TOOL,
  SAMPLE_RESTORE_TOOL,
  STORAGE_UPDATE_TOOL,
  STORAGE_ARCHIVE_TOOL,
  DATASET_ARCHIVE_TOOL,
  DATASET_RESTORE_TOOL,
  SHEET_ARCHIVE_TOOL,
  SHEET_RESTORE_TOOL,
  SHEET_DUPLICATE_TOOL,
]

export type RecordsProposeToolName =
  | typeof RECORD_CREATE_TOOL
  | typeof RECORD_ARCHIVE_TOOL
  | typeof RECORD_RESTORE_TOOL
  | typeof RECORD_LINK_TOOL
  | typeof MATERIAL_ADD_LOT_TOOL
  | typeof MATERIAL_STOCK_TOOL
  | typeof SAMPLE_EDIT_TOOL
  | typeof SAMPLE_RESTORE_TOOL
  | typeof STORAGE_UPDATE_TOOL
  | typeof STORAGE_ARCHIVE_TOOL
  | typeof DATASET_ARCHIVE_TOOL
  | typeof DATASET_RESTORE_TOOL
  | typeof SHEET_ARCHIVE_TOOL
  | typeof SHEET_RESTORE_TOOL
  | typeof SHEET_DUPLICATE_TOOL

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

export const MATERIAL_STOCK_OPERATIONS = [
  'receive',
  'consume',
  'quarantine',
  'restore',
] as const

export const proposeMaterialStockSchema = z.strictObject({
  title,
  summary,
  material: recordRef.describe('The material, by ID or name.'),
  operation: z
    .enum(MATERIAL_STOCK_OPERATIONS)
    .describe(
      'receive: stock came in. consume: some was used up. quarantine: set it aside. restore: bring it back from quarantine.',
    ),
  quantity: z
    .number()
    .positive()
    .optional()
    .describe('How much, for receive and consume, in the material’s own unit.'),
  reason: z.string().max(400).optional(),
})

export const proposeSampleEditSchema = z.strictObject({
  title,
  summary,
  sample: recordRef.describe('The sample, by ID (S-0142) or name.'),
  name: z.string().min(1).max(200).optional().describe('A new name.'),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  notes: z.string().max(400).optional().describe('Why it is changed.'),
})

export const proposeSampleRestoreSchema = z.strictObject({
  title,
  summary,
  sample: recordRef.describe('The archived sample, by ID or name.'),
  notes: z.string().max(400).optional(),
})

export const STORAGE_LEVELS = [
  'site',
  'room',
  'unit',
  'shelf',
  'rack',
  'box',
] as const

const locationRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The freezer, shelf, rack, box, room or site, by name or code.')

export const proposeStorageUpdateSchema = z.strictObject({
  title,
  summary,
  location: locationRef,
  level: z
    .enum(STORAGE_LEVELS)
    .optional()
    .describe('Its level, if the name could mean more than one.'),
  name: z.string().min(1).max(200).optional().describe('A new name.'),
  code: z.string().min(1).max(40).optional().describe('A new short code.'),
  temperatureMinC: z.number().optional(),
  temperatureMaxC: z.number().optional(),
})

export const proposeStorageArchiveSchema = z.strictObject({
  title,
  summary,
  location: locationRef,
  level: z.enum(STORAGE_LEVELS).optional(),
  archived: z
    .boolean()
    .describe('true takes it out of use, false brings it back.'),
})

const datasetRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The dataset or sheet, by name or ID.')

export const proposeDatasetStateSchema = z.strictObject({
  title,
  summary,
  dataset: datasetRef,
})

export const proposeSheetStateSchema = z.strictObject({
  title,
  summary,
  sheet: datasetRef,
})

export const proposeSheetDuplicateSchema = z.strictObject({
  title,
  summary,
  sheet: datasetRef,
  name: z.string().min(1).max(200).describe('The copy’s name.'),
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
  | {
      kind: 'material.stock'
      recordId: string
      metadataVersion: number
      operation: (typeof MATERIAL_STOCK_OPERATIONS)[number]
      quantity: number
      reason: string | null
    }
  | {
      kind: 'sample.edit'
      recordId: string
      metadataVersion: number
      name: string | null
      tags: string[] | null
      notes: string | null
    }
  | {
      kind: 'sample.restore'
      recordId: string
      metadataVersion: number
      notes: string | null
    }
  | {
      kind: 'storage.update_location'
      level: (typeof STORAGE_LEVELS)[number]
      id: string
      name: string | null
      code: string | null
      temperatureMinC: number | null
      temperatureMaxC: number | null
    }
  | {
      kind: 'storage.archive_location'
      level: (typeof STORAGE_LEVELS)[number]
      id: string
      archived: boolean
    }
  | {
      kind: 'dataset.archive' | 'dataset.restore'
      id: string
      revision: number
    }
  | { kind: 'sheet.archive' | 'sheet.restore'; id: string; revision: number }
  | { kind: 'sheet.duplicate'; id: string; revision: number; name: string }

const RECORDS_ACTIONS = new Set([
  'records.create',
  'records.archive',
  'records.restore',
  'records.link',
  'material.add_lot',
  'material.stock',
  'sample.edit',
  'sample.restore',
  'storage.update_location',
  'storage.archive_location',
  'dataset.archive',
  'dataset.restore',
  'sheet.archive',
  'sheet.restore',
  'sheet.duplicate',
])

export function isRecordsAction(action: {
  kind: string
}): action is RecordsAction {
  return RECORDS_ACTIONS.has(action.kind)
}
