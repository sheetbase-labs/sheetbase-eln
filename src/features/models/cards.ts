import { z } from 'zod'

/**
 * Record types and their fields from the assistant. Like every write, each is
 * a card: the model names a record type by its name or key and a field by its
 * label, the server finds them and sends back a card that says what will
 * change, and nothing happens until the person presses its button, which
 * calls the ordinary RPC as them. The database still decides whether the
 * person may edit the schema.
 *
 * Tool names are on the gateway allowlist through the operation declarations
 * (`assistant: { tool }` in `features/schema/operations.ts`) and, for the
 * calls that have no operation yet, `agent-tool-catalogue.ts`.
 */

export const MODEL_REGISTRY_CREATE_TOOL = 'sheetbase.model.registry_create'
export const MODEL_REQUEST_CREATE_TOOL = 'sheetbase.model.request_create'
export const MODEL_STARTER_CREATE_TOOL = 'sheetbase.model.starter_create'
export const MODEL_SUPPLIER_CREATE_TOOL = 'sheetbase.model.supplier_create'
export const MODEL_REGISTRY_SET_TOOL = 'sheetbase.model.registry_set'
export const MODEL_LOT_KIND_TOOL = 'sheetbase.model.registry_lot_kind'
export const MODEL_SAMENESS_TOOL = 'sheetbase.model.registry_sameness'
export const MODEL_INCIDENT_LOG_TOOL = 'sheetbase.model.incident_log_set'
export const MODEL_REQUEST_FORM_TOOL = 'sheetbase.model.request_form_set'
export const MODEL_SUPPLIER_LIST_TOOL = 'sheetbase.model.supplier_list_set'
export const MODEL_FIELD_DRAFT_TOOL = 'sheetbase.model_field.draft'
export const MODEL_FIELD_ADD_TOOL = 'sheetbase.model_field.add'
export const MODEL_FIELD_ACTIVATE_TOOL = 'sheetbase.model_field.activate'
export const MODEL_FIELD_UPDATE_TOOL = 'sheetbase.model_field.update'
export const MODEL_FIELD_SEMANTICS_TOOL = 'sheetbase.model_field.semantics'
export const MODEL_FIELD_EVOLVE_TOOL = 'sheetbase.model_field.evolve'
export const MODEL_FIELD_PLUGIN_TOOL = 'sheetbase.model_field.plugin_type'
export const MODEL_FIELD_PROMOTE_TOOL = 'sheetbase.model_field.promote'
export const RECORD_SET_TYPE_TOOL = 'sheetbase.record.set_type'
export const REGISTRY_REMOVE_PARENT_TOOL = 'sheetbase.registry.remove_parent'

export const MODELS_PROPOSE_TOOL_NAMES: readonly string[] = [
  MODEL_REGISTRY_CREATE_TOOL,
  MODEL_REQUEST_CREATE_TOOL,
  MODEL_STARTER_CREATE_TOOL,
  MODEL_SUPPLIER_CREATE_TOOL,
  MODEL_REGISTRY_SET_TOOL,
  MODEL_LOT_KIND_TOOL,
  MODEL_SAMENESS_TOOL,
  MODEL_INCIDENT_LOG_TOOL,
  MODEL_REQUEST_FORM_TOOL,
  MODEL_SUPPLIER_LIST_TOOL,
  MODEL_FIELD_DRAFT_TOOL,
  MODEL_FIELD_ADD_TOOL,
  MODEL_FIELD_ACTIVATE_TOOL,
  MODEL_FIELD_UPDATE_TOOL,
  MODEL_FIELD_SEMANTICS_TOOL,
  MODEL_FIELD_EVOLVE_TOOL,
  MODEL_FIELD_PLUGIN_TOOL,
  MODEL_FIELD_PROMOTE_TOOL,
  RECORD_SET_TYPE_TOOL,
  REGISTRY_REMOVE_PARENT_TOOL,
]

export type ModelsProposeToolName =
  | typeof MODEL_REGISTRY_CREATE_TOOL
  | typeof MODEL_REQUEST_CREATE_TOOL
  | typeof MODEL_STARTER_CREATE_TOOL
  | typeof MODEL_SUPPLIER_CREATE_TOOL
  | typeof MODEL_REGISTRY_SET_TOOL
  | typeof MODEL_LOT_KIND_TOOL
  | typeof MODEL_SAMENESS_TOOL
  | typeof MODEL_INCIDENT_LOG_TOOL
  | typeof MODEL_REQUEST_FORM_TOOL
  | typeof MODEL_SUPPLIER_LIST_TOOL
  | typeof MODEL_FIELD_DRAFT_TOOL
  | typeof MODEL_FIELD_ADD_TOOL
  | typeof MODEL_FIELD_ACTIVATE_TOOL
  | typeof MODEL_FIELD_UPDATE_TOOL
  | typeof MODEL_FIELD_SEMANTICS_TOOL
  | typeof MODEL_FIELD_EVOLVE_TOOL
  | typeof MODEL_FIELD_PLUGIN_TOOL
  | typeof MODEL_FIELD_PROMOTE_TOOL
  | typeof RECORD_SET_TYPE_TOOL
  | typeof REGISTRY_REMOVE_PARENT_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const modelRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The record type, by its name or key.')

const fieldRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The field, by its label or name.')

export const FIELD_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
  'reference',
] as const

const newField = z.strictObject({
  label: z.string().min(1).max(120).describe('The label people see.'),
  type: z.enum(FIELD_TYPES).optional().describe('`text` if left out.'),
  showInList: z.boolean().optional(),
  choices: z
    .array(z.string().min(1).max(80))
    .max(40)
    .optional()
    .describe('For a category field: its choices, as people read them.'),
})

export type NewField = z.infer<typeof newField>

const newModel = {
  title,
  summary,
  name: z.string().min(1).max(120).describe('The new record type’s name.'),
  key: z
    .string()
    .max(60)
    .optional()
    .describe('Its key (lower case); made from the name if left out.'),
  prefix: z
    .string()
    .min(1)
    .max(8)
    .describe('What its identifiers start with, such as CL for CL-0001.'),
  description: z.string().max(400).optional(),
  fields: z.array(newField).min(1).max(30).describe('Its fields.'),
}

export const proposeModelRegistryCreateSchema = z.strictObject({
  ...newModel,
  keyFields: z
    .array(z.string().min(1).max(120))
    .max(4)
    .optional()
    .describe(
      'Labels of the fields that together say two entries are the same thing.',
    ),
  sequenceField: z
    .string()
    .max(120)
    .optional()
    .describe('The label of the field that holds the running number.'),
})

export const proposeModelRequestCreateSchema = z.strictObject({
  ...newModel,
  intro: z
    .string()
    .max(1000)
    .optional()
    .describe('Text at the top of the form.'),
})

export const proposeModelStarterCreateSchema = z.strictObject({
  ...newModel,
  incidentLog: z
    .boolean()
    .optional()
    .describe('true to use it as an incident log.'),
})

export const proposeModelSupplierCreateSchema = z.strictObject({
  title,
  summary,
})

export const proposeModelRegistrySetSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  registry: z
    .boolean()
    .describe('true makes it a registry, false stops it being one.'),
  keyFields: z
    .array(z.string().min(1).max(120))
    .max(4)
    .optional()
    .describe('Labels of the fields that say two entries are the same thing.'),
  sequenceField: z.string().max(120).optional(),
})

export const proposeModelLotKindSchema = z.strictObject({
  title,
  summary,
  model: modelRef.describe('The registry.'),
  lotType: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The record type its lots are, such as Compound lot. Leave out to take it off.',
    ),
})

export const proposeModelSamenessSchema = z.strictObject({
  title,
  summary,
  model: modelRef.describe('The registry.'),
  rule: z
    .string()
    .max(200)
    .optional()
    .describe(
      'The plugin rule that spots duplicates, `plugin.<plugin>.<rule>`. Leave out to go back to the key fields.',
    ),
})

export const proposeModelIncidentLogSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  enabled: z.boolean().describe('true uses it as an incident log.'),
})

export const proposeModelRequestFormSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  accepts: z.boolean().describe('true lets people send it as a request.'),
  intro: z
    .string()
    .max(1000)
    .optional()
    .describe('Text at the top of the form.'),
  handlers: z
    .array(z.string().min(1).max(120))
    .max(20)
    .optional()
    .describe('Who handles requests, by name.'),
})

export const proposeModelSupplierListSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  enabled: z
    .boolean()
    .describe('true uses its records as the companies the lab buys from.'),
})

const fieldCommon = {
  title,
  summary,
  model: modelRef,
  label: z.string().min(1).max(120).describe('The label people see.'),
  name: z
    .string()
    .max(60)
    .optional()
    .describe(
      'Its name (lower case letters, digits, _); made from the label if left out.',
    ),
  type: z.enum(FIELD_TYPES).describe('What it holds.'),
  required: z.boolean().optional(),
  description: z.string().max(400).optional(),
  unit: z.string().max(20).optional().describe('A unit symbol, such as mL.'),
}

export const proposeModelFieldDraftSchema = z.strictObject(fieldCommon)

export const proposeModelFieldAddSchema = z.strictObject({
  ...fieldCommon,
  choices: z
    .array(z.string().min(1).max(80))
    .max(40)
    .optional()
    .describe('For a category field: its choices.'),
})

export const proposeModelFieldActivateSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  field: fieldRef.describe('The draft field to switch on.'),
})

export const proposeModelFieldUpdateSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  field: fieldRef,
  label: z.string().min(1).max(120).optional().describe('A new label.'),
  description: z.string().max(400).optional(),
  section: z
    .string()
    .max(120)
    .optional()
    .describe('The group it sits in on the form.'),
  showInList: z.boolean().optional(),
  unit: z.string().max(20).optional(),
})

export const proposeModelFieldSemanticsSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  field: fieldRef.describe('The draft field.'),
  quantity: z
    .string()
    .max(60)
    .optional()
    .describe('What it measures, such as volume, mass or concentration.'),
  unit: z.string().max(20).optional().describe('Its unit symbol, such as mL.'),
  cardinality: z.enum(['one', 'many']).optional(),
  targetModel: z
    .string()
    .max(200)
    .optional()
    .describe(
      'For a reference field: the record type it points at, by name or key.',
    ),
})

export const proposeModelFieldEvolveSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  field: fieldRef,
  action: z.enum(['update', 'retire']),
  label: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('For update: a new label.'),
  required: z
    .boolean()
    .optional()
    .describe('For update: make it required or optional.'),
  description: z.string().max(400).optional(),
})

export const proposeModelFieldPluginSchema = z.strictObject({
  title,
  summary,
  model: modelRef,
  field: fieldRef,
  plugin: z
    .string()
    .max(120)
    .optional()
    .describe('The plugin key. Leave out with the type to clear it.'),
  typeId: z.string().max(120).optional().describe('The plugin’s field type.'),
})

export const proposeModelFieldPromoteSchema = z.strictObject({
  title,
  summary,
  sheet: z.string().min(1).max(200).describe('The sheet, by its ID or name.'),
  column: z
    .string()
    .min(1)
    .max(200)
    .describe('The column only that sheet has, by its label.'),
  model: modelRef.describe('The record type that gets the new field.'),
})

export const proposeRecordSetTypeSchema = z.strictObject({
  title,
  summary,
  host: z
    .enum(['record', 'project', 'instrument'])
    .optional()
    .describe('What is being changed; `record` if left out.'),
  item: z
    .string()
    .min(1)
    .max(200)
    .describe('The record, project or instrument, by its ID or name.'),
  type: modelRef.describe('The type to move it to, in the same family.'),
  fields: z
    .record(
      z.string().min(1).max(120),
      z.union([z.string().max(2000), z.number(), z.boolean()]),
    )
    .optional()
    .describe('The new type’s field values, by label.'),
})

export const proposeRegistryRemoveParentSchema = z.strictObject({
  title,
  summary,
  entry: z
    .string()
    .min(1)
    .max(200)
    .describe('The registry entry, by ID or name.'),
  parent: z
    .string()
    .min(1)
    .max(200)
    .describe('Its parent entry, by ID or name.'),
})

type Json = string | number | boolean | null

/** What a card does when its button is pressed. */
export type ModelsAction =
  | {
      kind: 'model.registry_create'
      key: string
      name: string
      prefix: string
      description: string | null
      fields: ModelStarterField[]
      keyFields: string[]
      sequenceField: string | null
    }
  | {
      kind: 'model.request_create'
      key: string
      name: string
      prefix: string
      description: string | null
      fields: ModelStarterField[]
      intro: string | null
    }
  | {
      kind: 'model.starter_create'
      key: string
      name: string
      prefix: string
      description: string | null
      fields: ModelStarterField[]
      incidentLog: boolean
    }
  | { kind: 'model.supplier_create' }
  | {
      kind: 'model.registry_set'
      key: string
      registry: boolean
      keyFields: string[]
      sequenceField: string | null
    }
  | { kind: 'model.registry_lot_kind'; key: string; lotKind: string | null }
  | { kind: 'model.registry_sameness'; key: string; rule: string | null }
  | { kind: 'model.incident_log_set'; key: string; enabled: boolean }
  | {
      kind: 'model.request_form_set'
      key: string
      accepts: boolean
      intro: string | null
      handlerUserIds: string[]
    }
  | { kind: 'model.supplier_list_set'; key: string; enabled: boolean }
  | {
      kind: 'model_field.draft'
      workspaceId: string
      modelKey: string
      fieldName: string
      label: string
      logicalType: (typeof FIELD_TYPES)[number]
      nullable: boolean
      description: string | null
      unit: { symbol: string } | null
    }
  | {
      kind: 'model_field.add'
      workspaceId: string
      modelKey: string
      fieldName: string
      label: string
      logicalType: (typeof FIELD_TYPES)[number]
      nullable: boolean
      description: string | null
      unit: { symbol: string } | null
      options: { key: string; label: string }[] | null
    }
  | { kind: 'model_field.activate'; fieldId: string; modelKey: string }
  | {
      kind: 'model_field.update'
      fieldId: string
      modelKey: string
      patch: Record<string, Json | { symbol: string }>
    }
  | {
      kind: 'model_field.semantics'
      fieldId: string
      modelKey: string
      quantity: { kind: string; unit: string | null } | null
      cardinality: 'one' | 'many' | null
      relationship: { targetModelKey: string } | null
    }
  | {
      kind: 'model_field.evolve'
      fieldId: string
      modelKey: string
      action: 'update' | 'retire'
      patch: Record<string, Json> | null
      confirm: boolean
    }
  | {
      kind: 'model_field.plugin_type'
      modelKey: string
      fieldName: string
      pluginKey: string | null
      typeId: string | null
    }
  | {
      kind: 'model_field.promote'
      instanceId: string
      fieldId: string
      modelKey: string
      revision: number
      idempotencyKey: string
    }
  | {
      kind: 'record.set_type'
      host: 'records' | 'project' | 'instrument'
      id: string
      modelKey: string
      customFields: Record<string, Json>
    }
  | { kind: 'registry.remove_parent'; entryId: string; parentId: string }

/** A field as the starter model functions read it. */
export interface ModelStarterField {
  field_name: string
  label: string
  logical_type: (typeof FIELD_TYPES)[number]
  show_in_list: boolean
  options?: { key: string; label: string }[]
}

const MODELS_ACTIONS = new Set([
  'model.registry_create',
  'model.request_create',
  'model.starter_create',
  'model.supplier_create',
  'model.registry_set',
  'model.registry_lot_kind',
  'model.registry_sameness',
  'model.incident_log_set',
  'model.request_form_set',
  'model.supplier_list_set',
  'model_field.draft',
  'model_field.add',
  'model_field.activate',
  'model_field.update',
  'model_field.semantics',
  'model_field.evolve',
  'model_field.plugin_type',
  'model_field.promote',
  'record.set_type',
  'registry.remove_parent',
])

export function isModelsAction(action: {
  kind: string
}): action is ModelsAction {
  return MODELS_ACTIONS.has(action.kind)
}
