import { z } from 'zod'

/**
 * Datasets and measurement tables from the assistant: build a measurement
 * table, change one, publish, discard, retire or bring it back; move a
 * dataset to a newer table; flag a value or clear a flag; set a column's unit
 * or what a dataset is for; keep a snapshot; plan rows; close a problem
 * bringing a file in. Reading measurement tables, open flags, import files and
 * intake problems is the lab list tool's job (`measurement_tables`,
 * `dataset_flags`, `import_files`, `intake_problems`).
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button runs the ordinary dataset and measurement
 * table calls as the signed-in person, so their own rights (schema editing,
 * publishing) still decide.
 */

export const TABLE_CREATE_TOOL = 'sheetbase.measurement_table.create'
export const TABLE_EDIT_TOOL = 'sheetbase.measurement_table.edit'
export const TABLE_PUBLISH_TOOL = 'sheetbase.measurement_table.publish'
export const TABLE_DISCARD_TOOL = 'sheetbase.measurement_table.discard_draft'
export const TABLE_RETIRE_TOOL = 'sheetbase.measurement_table.retire'
export const TABLE_RESTORE_TOOL = 'sheetbase.measurement_table.restore'
export const DATASET_UPGRADE_TOOL = 'sheetbase.dataset.upgrade_table'
export const DATASET_FLAG_TOOL = 'sheetbase.dataset.flag_value'
export const DATASET_CLEAR_FLAG_TOOL = 'sheetbase.dataset.clear_flag'
export const DATASET_UNIT_TOOL = 'sheetbase.dataset.set_unit'
export const DATASET_USE_TOOL = 'sheetbase.dataset.set_intended_use'
export const DATASET_KEEP_TOOL = 'sheetbase.dataset.keep_snapshot'
export const DATASET_PLAN_TOOL = 'sheetbase.dataset.plan_rows'
export const INTAKE_RESOLVE_TOOL = 'sheetbase.intake.resolve'

export const DATASETS_PROPOSE_TOOL_NAMES = [
  TABLE_CREATE_TOOL,
  TABLE_EDIT_TOOL,
  TABLE_PUBLISH_TOOL,
  TABLE_DISCARD_TOOL,
  TABLE_RETIRE_TOOL,
  TABLE_RESTORE_TOOL,
  DATASET_UPGRADE_TOOL,
  DATASET_FLAG_TOOL,
  DATASET_CLEAR_FLAG_TOOL,
  DATASET_UNIT_TOOL,
  DATASET_USE_TOOL,
  DATASET_KEEP_TOOL,
  DATASET_PLAN_TOOL,
  INTAKE_RESOLVE_TOOL,
] as const

export type DatasetsProposeToolName =
  (typeof DATASETS_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const name = (what: string) => z.string().min(1).max(200).describe(what)
const table = name('The measurement table, by words from its name or key.')
const dataset = name('The dataset, by words from its name or its DS number.')
const reason = z
  .string()
  .min(1)
  .max(500)
  .describe('Why, in the person’s words. It is kept with the change.')

export const FIELD_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const

const fieldSpec = z
  .object({
    label: z.string().min(1).max(120).describe('The column name people see.'),
    type: z.enum(FIELD_TYPES).describe('What the column holds.'),
    required: z.boolean().optional().describe('Every row must fill it.'),
    description: z.string().min(1).max(500).optional(),
  })
  .strict()

export const proposeTableCreateSchema = z
  .object({
    title,
    summary,
    name: name('The new measurement table’s name, in the person’s words.'),
    description: z.string().min(1).max(1000).optional(),
    extends: name(
      'Another measurement table this one builds on, if they said; it starts with that table’s columns.',
    ).optional(),
    fields: z.array(fieldSpec).max(60).describe('The columns, in order.'),
  })
  .strict()

export const proposeTableEditSchema = z
  .object({
    title,
    summary,
    table,
    add: z.array(fieldSpec).max(60).optional().describe('Columns to add.'),
    remove: z
      .array(z.string().min(1).max(120))
      .max(60)
      .optional()
      .describe('Columns to take out, by their labels.'),
  })
  .strict()

const tableOnly = z.object({ title, summary, table }).strict()
export const proposeTablePublishSchema = tableOnly
export const proposeTableDiscardSchema = tableOnly
export const proposeTableRetireSchema = tableOnly
export const proposeTableRestoreSchema = tableOnly

export const proposeDatasetUpgradeSchema = z
  .object({ title, summary, dataset })
  .strict()

export const FLAG_KINDS = [
  'out_of_range',
  'missing_unit',
  'above_curve',
  'high_cv',
] as const

export const proposeDatasetFlagSchema = z
  .object({
    title,
    summary,
    dataset,
    rowId: z
      .string()
      .uuid()
      .describe('The row, as `rowId` from reading the dataset’s rows.'),
    field: name('The column, by its label.'),
    kind: z.enum(FLAG_KINDS),
    reason: z.string().min(1).max(200).describe('Why, in a few words.'),
    comment: z.string().min(1).max(1000).optional(),
  })
  .strict()

export const proposeDatasetClearFlagSchema = z
  .object({
    title,
    summary,
    dataset,
    field: name('The column the flag is on, by its label.').optional(),
    rowId: z.string().uuid().optional().describe('The flagged row, if known.'),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()

export const proposeDatasetUnitSchema = z
  .object({
    title,
    summary,
    dataset,
    field: name('The column, by its label.'),
    unit: z.string().min(1).max(40).describe('The unit, such as `mg/mL`.'),
    reason,
  })
  .strict()

export const INTENDED_USES = [
  'exploratory_research',
  'controlled_development',
  'regulated_record',
] as const

export const proposeDatasetUseSchema = z
  .object({ title, summary, dataset, use: z.enum(INTENDED_USES), reason })
  .strict()

export const proposeDatasetKeepSchema = z
  .object({
    title,
    summary,
    dataset,
    snapshot: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The snapshot, by its label. Defaults to the latest one.'),
    reason,
  })
  .strict()

export const proposeDatasetPlanSchema = z
  .object({
    title,
    summary,
    dataset,
    rows: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(50)
      .describe(
        'One key per row to plan, such as the sample or timepoint each will measure.',
      ),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
      .optional()
      .describe('When the measurements are due, if they said.'),
  })
  .strict()

export const proposeIntakeResolveSchema = z
  .object({
    title,
    summary,
    file: name('The file that did not come in, by words from its name.'),
    resolution: z
      .enum(['resolved', 'dismissed'])
      .describe(
        '`resolved` when it has come in after all, `dismissed` to stop showing it.',
      ),
  })
  .strict()

/** A column of a measurement table, in the shape the database takes. */
export interface TableField {
  field_id: string | null
  key: string
  label: string
  description: string | null
  logical_type: string
  nullable: boolean
  default_value?: unknown
  quantity?: unknown
  validation?: unknown
  category?: unknown
  relationship?: unknown
  cardinality?: string
  lifecycle?: string
  display_order?: number | null
}

/** What a dataset or measurement table card does when its button is pressed. */
export type DatasetsAction =
  | {
      kind: 'measurement_table.create'
      workspaceId: string
      key: string
      name: string
      description: string | null
      parentId: string | null
      fields: TableField[]
    }
  | {
      kind: 'measurement_table.edit'
      definitionId: string
      /** The draft to change, or null to start one from the latest version. */
      draftVersionId: string | null
      expectedRevision: number | null
      fields: TableField[]
    }
  | {
      kind: 'measurement_table.publish'
      definitionId: string
      versionId: string
    }
  | {
      kind: 'measurement_table.discard_draft'
      definitionId: string
      versionId: string
    }
  | { kind: 'measurement_table.retire'; definitionId: string }
  | { kind: 'measurement_table.restore'; definitionId: string }
  | {
      kind: 'dataset.upgrade_table'
      datasetId: string
      targetVersionId: string
      expectedRevision: number
    }
  | {
      kind: 'dataset.flag_value'
      datasetId: string
      rowId: string
      fieldId: string
      flagKind: (typeof FLAG_KINDS)[number]
      reason: string
      comment: string | null
    }
  | {
      kind: 'dataset.clear_flag'
      datasetId: string
      flagId: string
      reason: string | null
    }
  | {
      kind: 'dataset.set_unit'
      datasetId: string
      fieldKey: string
      unit: string
      reason: string
    }
  | {
      kind: 'dataset.set_intended_use'
      datasetId: string
      use: (typeof INTENDED_USES)[number]
      reason: string
    }
  | {
      kind: 'dataset.keep_snapshot'
      datasetId: string
      versionId: string
      reason: string
    }
  | {
      kind: 'dataset.plan_rows'
      datasetId: string
      keys: string[]
      scheduledAt: string | null
    }
  | {
      kind: 'intake.resolve'
      failureId: string
      resolution: 'resolved' | 'dismissed'
    }

export type DatasetsActionKind = DatasetsAction['kind']

const KINDS: readonly string[] = [
  'measurement_table.create',
  'measurement_table.edit',
  'measurement_table.publish',
  'measurement_table.discard_draft',
  'measurement_table.retire',
  'measurement_table.restore',
  'dataset.upgrade_table',
  'dataset.flag_value',
  'dataset.clear_flag',
  'dataset.set_unit',
  'dataset.set_intended_use',
  'dataset.keep_snapshot',
  'dataset.plan_rows',
  'intake.resolve',
]

export function isDatasetsAction(action: {
  kind: string
}): action is DatasetsAction {
  return KINDS.includes(action.kind)
}

export interface DatasetsActionResult {
  openHref?: string
}

/** A key the database accepts, made from a label: lower case, digits and _. */
export function keyFromLabel(
  label: string,
  taken: ReadonlySet<string>,
): string {
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  if (!/^[a-z]/.test(base)) base = `f_${base}`
  base = base.slice(0, 50) || 'field'
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`
  return key
}
