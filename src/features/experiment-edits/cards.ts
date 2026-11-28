import { z } from 'zod'

import { QC_RULES } from '#/lib/run-qc'

/**
 * Editing an experiment from the assistant: its parts, gates and plan, its
 * blocks, series and quality control, favourites and legal holds, and the
 * record types it is made from. Like every write, each is a card: the model
 * names things the way the lab does (EXP-4302, "part 3", "Plate reader QC"),
 * the server finds them and sends back a card saying what will change, and
 * nothing happens until the person presses its button, which calls the
 * ordinary RPC as them.
 *
 * Every tool here is one `action` of kind `experiment_edits.<op>`. The server
 * resolves names to ids and sends the RPC's own arguments; the browser sends
 * them as they are (`EDIT_RPCS` is the only place a name maps to an RPC).
 */

export const EXPERIMENT_FIELDS_TOOL = 'sheetbase.experiment.set_fields'
export const RECORD_TRANSITION_TOOL = 'sheetbase.record.transition'
export const RECORD_FAVOURITE_TOOL = 'sheetbase.record.favourite'
export const LEGAL_HOLD_ADD_TOOL = 'sheetbase.legal_hold.add_records'
export const PARTS_SIGN_OFF_TOOL = 'sheetbase.parts.set_sign_off'
export const PART_MOVE_TOOL = 'sheetbase.part.move'
export const PART_DELETE_TOOL = 'sheetbase.part.delete'
export const PART_AMEND_TOOL = 'sheetbase.part.amend'
export const PART_GATE_TOOL = 'sheetbase.part.set_gate'
export const PART_PLAN_TOOL = 'sheetbase.part.set_plan'
export const PART_SLIP_TOOL = 'sheetbase.part.slip'
export const PART_SPLIT_TOOL = 'sheetbase.part.split'
export const PART_BLOCK_TOOL = 'sheetbase.part.set_block'
export const PART_LINK_TOOL = 'sheetbase.part.set_link'
export const BLOCK_MOVE_TOOL = 'sheetbase.block.move'
export const BLOCK_DELETE_TOOL = 'sheetbase.block.delete'
export const QC_CREATE_TOOL = 'sheetbase.qc.create_series'
export const QC_UPDATE_TOOL = 'sheetbase.qc.update_series'
export const QC_DELETE_TOOL = 'sheetbase.qc.delete_series'
export const QC_POINT_TOOL = 'sheetbase.qc.add_point'
export const SERIES_START_TOOL = 'sheetbase.series.start'
export const SERIES_DISSOLVE_TOOL = 'sheetbase.series.dissolve'
export const SERIES_MOVE_TOOL = 'sheetbase.series.move_member'
export const SERIES_DAY_TOOL = 'sheetbase.series.set_member_day'
export const MODEL_REPARENT_TOOL = 'sheetbase.model.reparent'
export const MODEL_VERSION_DISCARD_TOOL = 'sheetbase.model_version.discard'
export const MODEL_UPGRADE_TOOL = 'sheetbase.model_version.upgrade_record'
export const MODEL_MIGRATE_TOOL = 'sheetbase.model_version.migrate_open'
export const PROTOCOL_IMPORT_TOOL = 'sheetbase.protocol.import'
export const MODEL_FIELD_EDIT_TOOL = 'sheetbase.model_field.edit'

export const EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES: readonly string[] = [
  EXPERIMENT_FIELDS_TOOL,
  RECORD_TRANSITION_TOOL,
  RECORD_FAVOURITE_TOOL,
  LEGAL_HOLD_ADD_TOOL,
  PARTS_SIGN_OFF_TOOL,
  PART_MOVE_TOOL,
  PART_DELETE_TOOL,
  PART_AMEND_TOOL,
  PART_GATE_TOOL,
  PART_PLAN_TOOL,
  PART_SLIP_TOOL,
  PART_SPLIT_TOOL,
  PART_BLOCK_TOOL,
  PART_LINK_TOOL,
  BLOCK_MOVE_TOOL,
  BLOCK_DELETE_TOOL,
  QC_CREATE_TOOL,
  QC_UPDATE_TOOL,
  QC_DELETE_TOOL,
  QC_POINT_TOOL,
  SERIES_START_TOOL,
  SERIES_DISSOLVE_TOOL,
  SERIES_MOVE_TOOL,
  SERIES_DAY_TOOL,
  MODEL_REPARENT_TOOL,
  MODEL_VERSION_DISCARD_TOOL,
  MODEL_UPGRADE_TOOL,
  MODEL_MIGRATE_TOOL,
  PROTOCOL_IMPORT_TOOL,
  MODEL_FIELD_EDIT_TOOL,
]

export type ExperimentEditsProposeToolName =
  | typeof EXPERIMENT_FIELDS_TOOL
  | typeof RECORD_TRANSITION_TOOL
  | typeof RECORD_FAVOURITE_TOOL
  | typeof LEGAL_HOLD_ADD_TOOL
  | typeof PARTS_SIGN_OFF_TOOL
  | typeof PART_MOVE_TOOL
  | typeof PART_DELETE_TOOL
  | typeof PART_AMEND_TOOL
  | typeof PART_GATE_TOOL
  | typeof PART_PLAN_TOOL
  | typeof PART_SLIP_TOOL
  | typeof PART_SPLIT_TOOL
  | typeof PART_BLOCK_TOOL
  | typeof PART_LINK_TOOL
  | typeof BLOCK_MOVE_TOOL
  | typeof BLOCK_DELETE_TOOL
  | typeof QC_CREATE_TOOL
  | typeof QC_UPDATE_TOOL
  | typeof QC_DELETE_TOOL
  | typeof QC_POINT_TOOL
  | typeof SERIES_START_TOOL
  | typeof SERIES_DISSOLVE_TOOL
  | typeof SERIES_MOVE_TOOL
  | typeof SERIES_DAY_TOOL
  | typeof MODEL_REPARENT_TOOL
  | typeof MODEL_VERSION_DISCARD_TOOL
  | typeof MODEL_UPGRADE_TOOL
  | typeof MODEL_MIGRATE_TOOL
  | typeof PROTOCOL_IMPORT_TOOL
  | typeof MODEL_FIELD_EDIT_TOOL

/** What each tool does, in plain words that follow "a card to". */
export const EXPERIMENT_EDITS_CARD_ACTIONS = {
  [EXPERIMENT_FIELDS_TOOL]: 'change an experiment’s reviewer or planned finish',
  [RECORD_TRANSITION_TOOL]: 'move a record to another status',
  [RECORD_FAVOURITE_TOOL]: 'favourite or unfavourite a record',
  [LEGAL_HOLD_ADD_TOOL]: 'put records under a legal hold',
  [PARTS_SIGN_OFF_TOOL]: 'require signatures on an experiment’s parts',
  [PART_MOVE_TOOL]: 'move a part of an experiment',
  [PART_DELETE_TOOL]: 'delete a part of an experiment',
  [PART_AMEND_TOOL]: 'reopen a signed part',
  [PART_GATE_TOOL]: 'set the rule that opens a part',
  [PART_PLAN_TOOL]: 'plan a part for the scheduler',
  [PART_SLIP_TOOL]: 'slip a part',
  [PART_SPLIT_TOOL]: 'split an experiment into parts',
  [PART_BLOCK_TOOL]: 'move a block into a part',
  [PART_LINK_TOOL]: 'show a linked record under a part',
  [BLOCK_MOVE_TOOL]: 'move a block on the page',
  [BLOCK_DELETE_TOOL]: 'delete a block from the page',
  [QC_CREATE_TOOL]: 'start a quality control series',
  [QC_UPDATE_TOOL]: 'change a quality control series',
  [QC_DELETE_TOOL]: 'delete a quality control series',
  [QC_POINT_TOOL]: 'record a quality control point',
  [SERIES_START_TOOL]: 'start a series of experiments',
  [SERIES_DISSOLVE_TOOL]: 'dissolve a series of experiments',
  [SERIES_MOVE_TOOL]: 'move an experiment in its series',
  [SERIES_DAY_TOOL]: 'set the day of an experiment in a series',
  [MODEL_REPARENT_TOOL]: 'change which type a record type belongs to',
  [MODEL_VERSION_DISCARD_TOOL]: 'discard a record type’s draft version',
  [MODEL_UPGRADE_TOOL]: 'upgrade a record to the latest type version',
  [MODEL_MIGRATE_TOOL]: 'move open experiments to the latest type version',
  [PROTOCOL_IMPORT_TOOL]: 'import a protocol',
  [MODEL_FIELD_EDIT_TOOL]: 'change a field in a record type’s draft version',
} as const satisfies Record<ExperimentEditsProposeToolName, string>

/** The RPC each card's button calls, by the card's action kind. */
export const EDIT_RPCS = {
  'experiment_edits.fields': 'set_experiment_fields',
  'experiment_edits.transition': 'transition_record_status',
  'experiment_edits.favourite': 'set_record_favourite',
  'experiment_edits.hold_add': 'add_records_to_legal_hold',
  'experiment_edits.sign_off': 'set_parts_sign_off',
  'experiment_edits.part_move': 'move_experiment_part',
  'experiment_edits.part_delete': 'delete_experiment_part',
  'experiment_edits.part_amend': 'amend_experiment_part',
  'experiment_edits.part_gate': 'set_part_gate',
  'experiment_edits.part_plan': 'set_part_plan',
  'experiment_edits.part_slip': 'slip_experiment_part',
  'experiment_edits.part_split': 'split_record_into_parts',
  'experiment_edits.part_block': 'set_block_part',
  'experiment_edits.part_link': 'set_link_part',
  'experiment_edits.block_move': 'move_block',
  'experiment_edits.block_delete': 'delete_block',
  'experiment_edits.qc_create': 'create_qc_series',
  'experiment_edits.qc_update': 'update_qc_series',
  'experiment_edits.qc_delete': 'delete_qc_series',
  'experiment_edits.qc_point': 'record_qc_point',
  'experiment_edits.series_start': 'start_experiment_series',
  'experiment_edits.series_dissolve': 'dissolve_experiment_series',
  'experiment_edits.series_move': 'move_series_member',
  'experiment_edits.series_day': 'set_series_member_day',
  'experiment_edits.model_reparent': 'reparent_record_model',
  'experiment_edits.version_discard': 'discard_record_model_version',
  'experiment_edits.version_upgrade': 'upgrade_record_model_record',
  'experiment_edits.version_migrate':
    'migrate_open_experiments_to_model_version',
  'experiment_edits.protocol_import': 'import_protocol',
  'experiment_edits.version_edit': 'replace_record_model_version_definition',
} as const

export type ExperimentEditKind = keyof typeof EDIT_RPCS

/** A JSON value, which is all an RPC argument may be. */
export type EditJson =
  string | number | boolean | null | EditJson[] | { [key: string]: EditJson }

/** What a card does when its button is pressed: one RPC, its arguments already resolved. */
export type ExperimentEditsAction = {
  [K in ExperimentEditKind]: {
    kind: K
    params: Record<string, EditJson>
    /** A page to open afterwards. */
    href?: string
  }
}[ExperimentEditKind]

export function isExperimentEditsAction(action: {
  kind: string
}): action is ExperimentEditsAction {
  return Object.hasOwn(EDIT_RPCS, action.kind)
}

// ---------------------------------------------------------------------------
// What the model sends.
// ---------------------------------------------------------------------------

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const base = { title, summary }

const experiment = z
  .string()
  .min(1)
  .max(200)
  .describe('The experiment, by its ID (EXP-4302) or its name.')

const record = z
  .string()
  .min(1)
  .max(200)
  .describe('The record, by its ID (EXP-4302, S-0142, PRT-0007) or its name.')

const partWords = z
  .string()
  .min(1)
  .max(200)
  .describe('A part, by its number ("3", "part 3") or words from its title.')

const blockWords = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'A block of the notebook page, by its place on the page ("4", counting from the top) or words from its text or type.',
  )

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date, YYYY-MM-DD.')

const reason = z.string().min(1).max(400)

export const proposeExperimentFieldsSchema = z.strictObject({
  ...base,
  experiment,
  reviewer: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The person who reviews it, by name. "none" takes the reviewer off. Leave out to keep it.',
    ),
  plannedEnd: date
    .nullable()
    .optional()
    .describe(
      'When it is planned to finish. null clears the date. Leave out to keep it.',
    ),
})

export const proposeRecordTransitionSchema = z.strictObject({
  ...base,
  record,
  status: z
    .string()
    .min(1)
    .max(60)
    .describe(
      'The status to move it to, such as in_progress, in_review or complete. The lab’s workflow decides which moves are allowed.',
    ),
})

export const proposeRecordFavouriteSchema = z.strictObject({
  ...base,
  record,
  favourite: z
    .boolean()
    .default(true)
    .describe('true adds it to the person’s favourites, false removes it.'),
})

export const proposeHoldAddSchema = z.strictObject({
  ...base,
  hold: z.string().min(1).max(200).describe('The active legal hold, by name.'),
  records: z
    .array(record)
    .min(1)
    .max(20)
    .describe('The records to put under the hold.'),
})

export const proposePartsSignOffSchema = z.strictObject({
  ...base,
  experiment,
  required: z
    .boolean()
    .describe(
      'true asks for a signature on every part that is not signed yet, false stops asking.',
    ),
})

export const proposePartMoveSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  after: partWords
    .optional()
    .describe('The part it goes after. Leave out to make it the first part.'),
})

export const proposePartDeleteSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  moveBlocksTo: partWords
    .optional()
    .describe(
      'The part that takes its blocks. Needed when the part has blocks.',
    ),
})

export const proposePartAmendSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  reason: reason.describe('Why the signed part is reopened.'),
})

const gateCondition = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('part_done'),
    part: partWords.describe('The part that must be done first.'),
  }),
  z.strictObject({
    kind: z.literal('samples_linked'),
    min: z.number().int().min(1).max(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal('field_set'),
    field: z
      .string()
      .min(1)
      .max(120)
      .describe('The field that must be filled.'),
  }),
  z.strictObject({ kind: z.literal('date_reached'), date }),
  z.strictObject({
    kind: z.literal('qc_in_control'),
    series: z
      .string()
      .max(200)
      .optional()
      .describe('A quality control series by name; any series if left out.'),
  }),
])

export const proposePartGateSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  conditions: z
    .array(gateCondition)
    .max(12)
    .optional()
    .describe(
      'What must be true before the part opens. An empty list takes the rule off. Leave out to keep it.',
    ),
  mode: z
    .enum(['warn', 'block'])
    .optional()
    .describe(
      'warn lets people go on past it with a reason; block stops them.',
    ),
  stepsInOrder: z
    .boolean()
    .optional()
    .describe('true makes the steps of the part go in order.'),
})

export const proposePartPlanSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  handsOnMinutes: z.number().int().min(0).max(10_000),
  waitAfterMinutes: z.number().int().min(0).max(100_000).default(0),
  needs: z
    .array(
      z.strictObject({
        resource: z
          .string()
          .min(1)
          .max(200)
          .describe('An instrument or room it needs, by name.'),
        minutes: z.number().int().min(1).max(10_000),
      }),
    )
    .max(12)
    .default([]),
})

export const proposePartSlipSchema = z.strictObject({
  ...base,
  experiment,
  part: partWords,
  days: z
    .number()
    .int()
    .min(-60)
    .max(60)
    .describe('How many days it slips; negative brings it forward.'),
})

export const proposePartSplitSchema = z.strictObject({
  ...base,
  experiment,
  parts: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(200),
        firstBlock: blockWords.describe('The block the part starts at.'),
      }),
    )
    .min(1)
    .max(20)
    .describe('The parts, in order, for an experiment that has none yet.'),
})

export const proposePartBlockSchema = z.strictObject({
  ...base,
  experiment,
  block: blockWords,
  part: partWords.describe('The part the block moves into.'),
})

export const proposePartLinkSchema = z.strictObject({
  ...base,
  experiment,
  link: z
    .string()
    .min(1)
    .max(200)
    .describe('A linked record of the experiment, by its ID or name.'),
  part: partWords.describe('The part the link is shown under.'),
})

export const proposeBlockMoveSchema = z.strictObject({
  ...base,
  experiment,
  block: blockWords,
  after: blockWords
    .optional()
    .describe('The block it goes after. Leave out to put it first.'),
})

export const proposeBlockDeleteSchema = z.strictObject({
  ...base,
  experiment,
  block: blockWords,
})

export const proposeQcCreateSchema = z.strictObject({
  ...base,
  name: z.string().min(1).max(200),
  unit: z.string().max(40).optional(),
  mean: z.number().optional().describe('The expected value, if known.'),
  sd: z.number().positive().optional().describe('The spread, if known.'),
  instrument: z
    .string()
    .max(200)
    .optional()
    .describe('The instrument it tracks, by name or INS number.'),
})

const series = z
  .string()
  .min(1)
  .max(200)
  .describe('The quality control series, by name.')

export const proposeQcUpdateSchema = z.strictObject({
  ...base,
  series,
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional().describe('false stops it being checked.'),
  rules: z
    .array(z.enum(QC_RULES))
    .max(12)
    .optional()
    .describe('The rules that flag a point, replacing the current ones.'),
})

export const proposeQcDeleteSchema = z.strictObject({ ...base, series })

export const proposeQcPointSchema = z.strictObject({
  ...base,
  series,
  value: z.number(),
  label: z.string().max(200).optional(),
})

export const proposeSeriesStartSchema = z.strictObject({ ...base, experiment })

export const proposeSeriesMemberSchema = z.strictObject({
  ...base,
  member: record.describe('The experiment in the series.'),
})

export const proposeSeriesMoveSchema = z.strictObject({
  ...base,
  member: record.describe('The experiment in the series.'),
  position: z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .describe('Its new place in the series, counting from 1.'),
})

export const proposeSeriesDaySchema = z.strictObject({
  ...base,
  member: record.describe('The experiment in the series.'),
  plannedOn: date
    .nullable()
    .describe('The day it is planned for; null clears it.'),
})

const model = z
  .string()
  .min(1)
  .max(200)
  .describe('The record type, by name or key.')

export const proposeModelReparentSchema = z.strictObject({
  ...base,
  model,
  parent: z
    .string()
    .max(200)
    .nullable()
    .describe(
      'The record type it becomes a subtype of; null makes it a top-level type.',
    ),
})

export const proposeVersionDiscardSchema = z.strictObject({ ...base, model })

export const proposeVersionUpgradeSchema = z.strictObject({
  ...base,
  record,
  reason: reason.describe('Why the record moves to the latest version.'),
})

export const proposeVersionMigrateSchema = z.strictObject({
  ...base,
  model,
  reason: reason.describe('Why open experiments move to the latest version.'),
})

export const proposeProtocolImportSchema = z.strictObject({
  ...base,
  name: z.string().min(1).max(200).describe('The protocol’s title.'),
  steps: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(2_000),
        section: z
          .string()
          .max(200)
          .optional()
          .describe('A heading; starts a new section where it changes.'),
      }),
    )
    .min(1)
    .max(300),
  description: z.string().max(4_000).optional(),
  reagents: z
    .array(z.string().min(1).max(300))
    .max(100)
    .optional()
    .describe('Reagents and equipment, one line each.'),
  source: z
    .strictObject({
      provider: z.string().max(100),
      url: z.url().max(500),
      doi: z.string().max(200).optional(),
    })
    .optional()
    .describe('Where the method came from, such as protocols.io.'),
})

export const proposeModelFieldEditSchema = z.strictObject({
  ...base,
  model,
  field: z
    .string()
    .min(1)
    .max(200)
    .describe('The field, by its label or name as the form shows it.'),
  label: z.string().min(1).max(120).optional().describe('A new label.'),
  description: z
    .string()
    .max(400)
    .nullable()
    .optional()
    .describe('New help text; null clears it.'),
  required: z
    .boolean()
    .optional()
    .describe('true makes the field required, false makes it optional.'),
  header: z
    .boolean()
    .optional()
    .describe(
      'true shows the field in the header of each record of the type (at most four fields), false takes it out.',
    ),
  reason: reason.describe('Why the draft version changes.'),
})
