import { z } from 'zod'

/**
 * Record types (models), sheet definitions and templates from the assistant.
 * Reads answer in the reply; writes are cards. As with the other cards, the
 * model names things the way people do, the server finds them and sends back a
 * card, and nothing happens until the person presses the button, which calls
 * the ordinary RPC as them. Retiring a template version is signed, so it stays
 * with a person in the app and has no tool here.
 *
 * Adding, changing and switching on fields are the older draft tools
 * (`sheetbase.model_field.create` and friends), and drafting a sheet definition
 * is `sheetbase.sheet_definition.draft`; this module adds the rest.
 */

export const MODELS_READ_TOOL = 'sheetbase.models.read'
export const SHEET_DEFINITIONS_READ_TOOL = 'sheetbase.sheet_definitions.read'
export const TEMPLATES_READ_TOOL = 'sheetbase.templates.read'
export const MODEL_DEPENDENCIES_TOOL = 'sheetbase.model.dependencies'

export const SCHEMA_READ_TOOL_NAMES = [
  MODELS_READ_TOOL,
  SHEET_DEFINITIONS_READ_TOOL,
  TEMPLATES_READ_TOOL,
  MODEL_DEPENDENCIES_TOOL,
] as const

export const MODEL_CREATE_TOOL = 'sheetbase.model.create'
export const MODEL_ADD_SUBTYPE_TOOL = 'sheetbase.model.add_subtype'
export const FIELD_RETIRE_TOOL = 'sheetbase.model_field.retire'
export const OPTION_ADD_TOOL = 'sheetbase.model_field.add_option'
export const OPTION_RENAME_TOOL = 'sheetbase.model_field.rename_option'
export const OPTION_RETIRE_TOOL = 'sheetbase.model_field.retire_option'
export const RULE_ADD_TOOL = 'sheetbase.model_rule.add'
export const RULE_UPDATE_TOOL = 'sheetbase.model_rule.update'
export const RULE_REMOVE_TOOL = 'sheetbase.model_rule.remove'
export const LINK_RULE_SET_TOOL = 'sheetbase.model_link_rule.set'
export const LINK_RULE_REMOVE_TOOL = 'sheetbase.model_link_rule.remove'
export const MODEL_VERSION_START_TOOL = 'sheetbase.model_version.start'
export const MODEL_VERSION_PUBLISH_TOOL = 'sheetbase.model_version.publish'
export const SHEET_DEFINITION_PUBLISH_TOOL =
  'sheetbase.sheet_definition.publish'
export const SHEET_DEFINITION_RETIRE_TOOL = 'sheetbase.sheet_definition.retire'
export const SHEET_DEFINITION_RESTORE_TOOL =
  'sheetbase.sheet_definition.restore'
export const TEMPLATE_PUBLISH_TOOL = 'sheetbase.template.publish'
export const SHEET_RENAME_TOOL = 'sheetbase.sheet.rename'

export const SCHEMA_PROPOSE_TOOL_NAMES = [
  MODEL_CREATE_TOOL,
  MODEL_ADD_SUBTYPE_TOOL,
  FIELD_RETIRE_TOOL,
  OPTION_ADD_TOOL,
  OPTION_RENAME_TOOL,
  OPTION_RETIRE_TOOL,
  RULE_ADD_TOOL,
  RULE_UPDATE_TOOL,
  RULE_REMOVE_TOOL,
  LINK_RULE_SET_TOOL,
  LINK_RULE_REMOVE_TOOL,
  MODEL_VERSION_START_TOOL,
  MODEL_VERSION_PUBLISH_TOOL,
  SHEET_DEFINITION_PUBLISH_TOOL,
  SHEET_DEFINITION_RETIRE_TOOL,
  SHEET_DEFINITION_RESTORE_TOOL,
  TEMPLATE_PUBLISH_TOOL,
  SHEET_RENAME_TOOL,
] as const

export type SchemaProposeToolName = (typeof SCHEMA_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const named = (what: string) => z.string().min(1).max(200).describe(what)
const model = named('The record type, by name or key, such as Cell line.')
const field = named('The field, by its label or name.')
const option = named('The choice, by what people see or what is stored.')
const reason = z.string().min(1).max(500).describe('Why, in a sentence.')
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,59}$/, 'Lower case letters, digits and _.')
const prefix = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'Capital letters and digits, such as CL.')

const leaf = z.object({
  field: z.string().min(1).max(63),
  op: z
    .enum([
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'not_in',
      'is_null',
      'not_null',
      'matches',
    ])
    .optional(),
  value: z.unknown().optional(),
})

/** When the rule fires, as one test on one field, or all/any of several. */
const condition = z
  .union([
    leaf,
    z.object({ all: z.array(leaf).min(1).max(10) }),
    z.object({ any: z.array(leaf).min(1).max(10) }),
  ])
  .describe(
    'When the rule fires: `{ field, op, value }` with op eq, neq, gt, gte, lt, lte, in, not_in, is_null, not_null or matches; or `{ all: [...] }` / `{ any: [...] }` of those.',
  )

const effect = z
  .enum(['warn', 'block', 'flag_block_submit'])
  .describe(
    'warn shows it; block refuses the save; flag_block_submit lets it be saved but not submitted.',
  )

export const modelsReadSchema = z
  .object({
    model: model
      .optional()
      .describe(
        'One record type, to see its fields, choices, rules, link rules and versions. Leave out to list them all.',
      ),
  })
  .strict()

export const sheetDefinitionsReadSchema = z
  .object({
    definition: named('One sheet definition, by name or key.')
      .optional()
      .describe('Leave out to list them all.'),
  })
  .strict()

export const templatesReadSchema = z
  .object({
    template: named('One notebook template, by name or key.')
      .optional()
      .describe('Leave out to list them all.'),
  })
  .strict()

export const modelDependenciesSchema = z.object({ model }).strict()

export const proposeModelCreateSchema = z
  .object({
    title,
    summary,
    name: z.string().min(1).max(120).describe('What people call it.'),
    key: key.optional().describe('Leave out to make one from the name.'),
    prefix: prefix.describe('What identifiers start with.'),
    description: z.string().max(500).optional(),
  })
  .strict()

export const proposeModelSubtypeSchema = proposeModelCreateSchema
  .extend({ parent: named('The record type it is a kind of.') })
  .strict()

export const proposeFieldRetireSchema = z
  .object({ title, summary, model, field })
  .strict()

export const proposeOptionAddSchema = z
  .object({
    title,
    summary,
    model,
    field,
    label: z.string().min(1).max(120).describe('What people see.'),
    key: key.optional().describe('What is stored; leave out to make one.'),
  })
  .strict()

export const proposeOptionRenameSchema = z
  .object({
    title,
    summary,
    model,
    field,
    option,
    label: z.string().min(1).max(120).describe('The new label.'),
  })
  .strict()

export const proposeOptionRetireSchema = z
  .object({ title, summary, model, field, option })
  .strict()

export const proposeRuleAddSchema = z
  .object({
    title,
    summary,
    model,
    name: z.string().min(1).max(200),
    fields: z.array(field).min(1).max(10).describe('The fields it looks at.'),
    condition,
    effect,
    message: z.string().min(1).max(500).describe('What people see.'),
  })
  .strict()

export const proposeRuleUpdateSchema = z
  .object({
    title,
    summary,
    model,
    rule: named('The rule, by its name.'),
    name: z.string().min(1).max(200).optional(),
    condition: condition.optional(),
    effect: effect.optional(),
    message: z.string().min(1).max(500).optional(),
  })
  .strict()

export const proposeRuleRemoveSchema = z
  .object({ title, summary, model, rule: named('The rule, by its name.') })
  .strict()

export const proposeLinkRuleSetSchema = z
  .object({
    title,
    summary,
    from: named('The record type the link is from.'),
    to: named('The record type the link is to.'),
    linkType: z
      .enum([
        'sample',
        'protocol',
        'dataset',
        'material',
        'analysis',
        'file',
        'general',
        'template',
        'follows',
        'upstream',
        'booking',
      ])
      .describe('The kind of link.'),
    min: z.number().int().min(0).max(100).optional(),
    max: z.number().int().min(0).max(100).optional(),
    label: z.string().min(1).max(120).optional(),
  })
  .strict()

export const proposeLinkRuleRemoveSchema = z
  .object({
    title,
    summary,
    from: named('The record type the link is from.'),
    to: named('The record type the link is to.'),
  })
  .strict()

export const proposeModelVersionStartSchema = z
  .object({ title, summary, model, reason })
  .strict()

export const proposeModelVersionPublishSchema = z
  .object({ title, summary, model })
  .strict()

export const proposeSheetDefinitionSchema = z
  .object({ title, summary, definition: named('The sheet definition.') })
  .strict()

export const proposeTemplatePublishSchema = z
  .object({
    title,
    summary,
    template: named('The notebook template.'),
    reason,
  })
  .strict()

export const proposeSheetRenameSchema = z
  .object({
    title,
    summary,
    sheet: named('The sheet, by its id (SHT-12) or name.'),
    name: z.string().min(1).max(200).describe('The new name.'),
  })
  .strict()

export type SchemaAction =
  | {
      kind: 'schema.model_create'
      workspaceId: string
      parentKey: string | null
      key: string
      name: string
      prefix: string
      description: string | null
    }
  | { kind: 'schema.field_retire'; fieldId: string }
  | {
      kind: 'schema.option_add'
      fieldId: string
      key: string
      label: string
      order: number
    }
  | {
      kind: 'schema.option_rename'
      optionId: string
      label: string
      order: number
    }
  | { kind: 'schema.option_retire'; optionId: string }
  | {
      kind: 'schema.rule_add'
      workspaceId: string
      modelKey: string
      name: string
      fieldKeys: string[]
      condition: Record<string, unknown>
      effect: 'warn' | 'block' | 'flag_block_submit'
      message: string
    }
  | {
      kind: 'schema.rule_update'
      ruleId: string
      patch: Record<string, unknown>
    }
  | { kind: 'schema.rule_remove'; ruleId: string }
  | {
      kind: 'schema.link_rule_set'
      workspaceId: string
      sourceKey: string
      linkType: string
      targetKey: string
      min: number
      max: number | null
      label: string | null
    }
  | { kind: 'schema.link_rule_remove'; ruleId: string }
  | { kind: 'schema.model_version_start'; modelId: string; reason: string }
  | { kind: 'schema.model_version_publish'; versionId: string }
  | {
      kind: 'schema.sheet_definition_publish'
      versionId: string
      revision: number
    }
  | {
      kind: 'schema.sheet_definition_lifecycle'
      definitionId: string
      revision: number
      retire: boolean
    }
  | {
      kind: 'schema.template_publish'
      versionId: string
      revision: number
      reason: string
    }
  | {
      kind: 'schema.sheet_rename'
      instanceId: string
      revision: number
      name: string
    }

export type SchemaActionKind = SchemaAction['kind']

export function isSchemaAction(action: {
  kind: string
}): action is SchemaAction {
  return action.kind.startsWith('schema.')
}

export interface SchemaActionResult {
  openHref?: string
}

/** A key from a name: "Cell line" becomes `cell_line`. */
export function keyFromName(name: string): string {
  const made = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 60)
  return /^[a-z]/.test(made) ? made : `x_${made}`.slice(0, 60)
}
