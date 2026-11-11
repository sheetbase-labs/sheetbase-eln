import type { z } from 'zod'

import {
  FIELD_RETIRE_TOOL,
  LINK_RULE_REMOVE_TOOL,
  LINK_RULE_SET_TOOL,
  MODELS_READ_TOOL,
  MODEL_ADD_SUBTYPE_TOOL,
  MODEL_CREATE_TOOL,
  MODEL_DEPENDENCIES_TOOL,
  MODEL_VERSION_PUBLISH_TOOL,
  MODEL_VERSION_START_TOOL,
  OPTION_ADD_TOOL,
  OPTION_RENAME_TOOL,
  OPTION_RETIRE_TOOL,
  RULE_ADD_TOOL,
  RULE_REMOVE_TOOL,
  RULE_UPDATE_TOOL,
  SCHEMA_PROPOSE_TOOL_NAMES,
  SCHEMA_READ_TOOL_NAMES,
  SHEET_DEFINITIONS_READ_TOOL,
  SHEET_DEFINITION_PUBLISH_TOOL,
  SHEET_DEFINITION_RESTORE_TOOL,
  SHEET_DEFINITION_RETIRE_TOOL,
  SHEET_RENAME_TOOL,
  TEMPLATE_ADD_SHEET_COLUMN_TOOL,
  proposeTemplateSheetColumnSchema,
  TEMPLATES_READ_TOOL,
  TEMPLATE_PUBLISH_TOOL,
  keyFromName,
  modelDependenciesSchema,
  modelsReadSchema,
  proposeFieldRetireSchema,
  proposeLinkRuleRemoveSchema,
  proposeLinkRuleSetSchema,
  proposeModelCreateSchema,
  proposeModelSubtypeSchema,
  proposeModelVersionPublishSchema,
  proposeModelVersionStartSchema,
  proposeOptionAddSchema,
  proposeOptionRenameSchema,
  proposeOptionRetireSchema,
  proposeRuleAddSchema,
  proposeRuleRemoveSchema,
  proposeRuleUpdateSchema,
  proposeSheetDefinitionSchema,
  proposeSheetRenameSchema,
  proposeTemplatePublishSchema,
  sheetDefinitionsReadSchema,
  templatesReadSchema,
} from './assistant-schema'
import type { SchemaAction, SchemaProposeToolName } from './assistant-schema'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import { parseNotebookTemplateConfiguration } from './notebook-template'
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import type { SheetDefinitionConfiguration } from './sheet-definition'
import { addSheetColumn } from './sheet-definition-add-column'
import type {
  ModelRuleCondition,
  ModelRuleEffect,
  UpdateModelRulePatch,
} from './model-rules'

/**
 * Record types, sheet definitions and templates from the assistant (see
 * `assistant-schema.ts`). Reads answer from what the person can see. Each card
 * builder finds what the person named under their own access and returns a
 * card saying exactly what will change. Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export type SchemaOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

type Lookup<T> = { ok: true; value: T } | { ok: false; message: string }

/** The read tools, as a set the dispatcher can test raw tool names against. */
const schemaReadToolNames = new Set<string>(SCHEMA_READ_TOOL_NAMES)
const schemaProposeToolNames = new Set<string>(SCHEMA_PROPOSE_TOOL_NAMES)

export const isSchemaReadTool = (name: string): boolean =>
  schemaReadToolNames.has(name)

export const isSchemaProposalTool = (
  name: string,
): name is SchemaProposeToolName => schemaProposeToolNames.has(name)

export function schemaReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      MODELS_READ_TOOL,
      'Read the record types (models) of the workspace. With one named: its fields, the choices of each category field, its rules, how it links to other types, and its versions.',
      modelsReadSchema,
    ),
    toolDef(
      SHEET_DEFINITIONS_READ_TOOL,
      'Read the reusable sheet definitions. With one named: its versions and which is published.',
      sheetDefinitionsReadSchema,
    ),
    toolDef(
      TEMPLATES_READ_TOOL,
      'Read the notebook templates. With one named: its versions and which is published.',
      templatesReadSchema,
    ),
    toolDef(
      MODEL_DEPENDENCIES_TOOL,
      'What uses a record type: its records, fields, rules, links from other types, sheets, templates and pipelines. Read it before suggesting a type be changed or retired.',
      modelDependenciesSchema,
    ),
  ]
}

export function schemaProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      MODEL_CREATE_TOOL,
      `Propose adding a record type, such as Cell line or Supplier, with the prefix its identifiers start with. ${NOTE}`,
      proposeModelCreateSchema,
    ),
    toolDef(
      MODEL_ADD_SUBTYPE_TOOL,
      `Propose adding a record type that is a kind of another, such as Antibody under Reagent. ${NOTE}`,
      proposeModelSubtypeSchema,
    ),
    toolDef(
      FIELD_RETIRE_TOOL,
      `Propose retiring a field of a record type. Values already kept stay. ${NOTE}`,
      proposeFieldRetireSchema,
    ),
    toolDef(
      OPTION_ADD_TOOL,
      `Propose adding a choice to a category field. ${NOTE}`,
      proposeOptionAddSchema,
    ),
    toolDef(
      OPTION_RENAME_TOOL,
      `Propose renaming a choice on a category field. What is stored does not change. ${NOTE}`,
      proposeOptionRenameSchema,
    ),
    toolDef(
      OPTION_RETIRE_TOOL,
      `Propose no longer offering a choice on a category field. Records that have it keep it. ${NOTE}`,
      proposeOptionRetireSchema,
    ),
    toolDef(
      RULE_ADD_TOOL,
      `Propose a rule that checks records of a type, such as "Passage must be under 30". ${NOTE}`,
      proposeRuleAddSchema,
    ),
    toolDef(
      RULE_UPDATE_TOOL,
      `Propose changing a rule on a record type. ${NOTE}`,
      proposeRuleUpdateSchema,
    ),
    toolDef(
      RULE_REMOVE_TOOL,
      `Propose taking a rule off a record type. ${NOTE}`,
      proposeRuleRemoveSchema,
    ),
    toolDef(
      LINK_RULE_SET_TOOL,
      `Propose how many links of a kind records of one type must or may have to another, such as every Lot links to exactly one Compound. ${NOTE}`,
      proposeLinkRuleSetSchema,
    ),
    toolDef(
      LINK_RULE_REMOVE_TOOL,
      `Propose removing a rule for how two record types link. ${NOTE}`,
      proposeLinkRuleRemoveSchema,
    ),
    toolDef(
      MODEL_VERSION_START_TOOL,
      `Propose starting a new draft version of a record type. ${NOTE}`,
      proposeModelVersionStartSchema,
    ),
    toolDef(
      MODEL_VERSION_PUBLISH_TOOL,
      `Propose publishing the draft version of a record type, so new records use it. ${NOTE}`,
      proposeModelVersionPublishSchema,
    ),
    toolDef(
      SHEET_DEFINITION_PUBLISH_TOOL,
      `Propose publishing the draft version of a sheet definition. ${NOTE}`,
      proposeSheetDefinitionSchema,
    ),
    toolDef(
      SHEET_DEFINITION_RETIRE_TOOL,
      `Propose retiring a sheet definition so it is no longer offered. Sheets made from it keep working. ${NOTE}`,
      proposeSheetDefinitionSchema,
    ),
    toolDef(
      SHEET_DEFINITION_RESTORE_TOOL,
      `Propose offering a retired sheet definition again. ${NOTE}`,
      proposeSheetDefinitionSchema,
    ),
    toolDef(
      TEMPLATE_PUBLISH_TOOL,
      `Propose publishing the draft version of a notebook template. Retiring a template version is signed, so it is for a person in the app. ${NOTE}`,
      proposeTemplatePublishSchema,
    ),
    toolDef(
      TEMPLATE_ADD_SHEET_COLUMN_TOOL,
      `Propose adding a column to a sheet section of a notebook template's draft. It makes and publishes a new version of the sheet and points the draft at it; notebooks already made keep their version. ${NOTE}`,
      proposeTemplateSheetColumnSchema,
    ),
    toolDef(
      SHEET_RENAME_TOOL,
      `Propose renaming a sheet. ${NOTE}`,
      proposeSheetRenameSchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// Lookups.
// ---------------------------------------------------------------------------

function pick<T>(
  rows: readonly T[],
  wanted: string,
  what: string,
  label: (row: T) => string,
  exact: (row: T) => boolean,
): Lookup<T> {
  if (rows.length === 0)
    return { ok: false, message: `No ${what} matches "${wanted}".` }
  const same = rows.filter(exact)

  if (same.length === 1) return { ok: true, value: same[0] }

  if (rows.length === 1) return { ok: true, value: rows[0] }

  return {
    ok: false,
    message: `More than one ${what} matches "${wanted}": ${rows
      .map(label)
      .join('; ')}. Ask the person which one, naming these.`,
  }
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

interface ModelRow {
  id: string
  key: string
  name: string
  identifier_prefix: string
  parent_key: string | null
  lifecycle: string
  is_registry: boolean
}

const MODEL_COLUMNS =
  'id,key,name,identifier_prefix,parent_key,lifecycle,is_registry'

async function findModel(
  client: DataClient,
  text: string,
): Promise<Lookup<ModelRow>> {
  const like = likeValue(text)

  const rows = await client.list<ModelRow>(
    'record_models',
    `?or=(key.ilike.${like},name.ilike.${like})&select=${MODEL_COLUMNS}&order=name&limit=8`,
  )

  return pick(
    rows,
    text,
    'record type',
    (row) => `${row.name} (${row.key})`,
    (row) => same(row.key, text) || same(row.name, text),
  )
}

interface FieldRow {
  id: string
  field_name: string
  label: string
  logical_type: string
  lifecycle: string
}

async function findField(
  client: DataClient,
  modelKey: string,
  text: string,
): Promise<Lookup<FieldRow>> {
  const like = likeValue(text)

  const rows = await client.list<FieldRow>(
    'record_field_definitions',
    `?kind=eq.${encodeURIComponent(modelKey)}&lifecycle=neq.retired&or=(field_name.ilike.${like},label.ilike.${like})&select=id,field_name,label,logical_type,lifecycle&limit=8`,
  )

  return pick(
    rows,
    text,
    'field',
    (row) => `${row.label} (${row.field_name})`,
    (row) => same(row.field_name, text) || same(row.label, text),
  )
}

interface OptionRow {
  id: string
  key: string
  label: string
  display_order: number
  lifecycle: string
}

async function listOptions(
  client: DataClient,
  fieldId: string,
): Promise<OptionRow[]> {
  return client.list<OptionRow>(
    'model_field_options',
    `?definition_id=eq.${fieldId}&select=id,key,label,display_order,lifecycle&order=display_order`,
  )
}

async function findOption(
  client: DataClient,
  fieldId: string,
  text: string,
): Promise<Lookup<OptionRow>> {
  const rows = (await listOptions(client, fieldId)).filter(
    (row) =>
      row.lifecycle === 'active' &&
      (row.key.toLowerCase().includes(text.trim().toLowerCase()) ||
        row.label.toLowerCase().includes(text.trim().toLowerCase())),
  )

  return pick(
    rows,
    text,
    'choice',
    (row) => `${row.label} (${row.key})`,
    (row) => same(row.key, text) || same(row.label, text),
  )
}

interface RuleRow {
  id: string
  model_key: string
  name: string
  field_keys: string[]
  condition: ModelRuleCondition
  effect: ModelRuleEffect
  message: string
}

async function findRule(
  client: DataClient,
  modelKey: string,
  text: string,
): Promise<Lookup<RuleRow>> {
  const rows = await client.list<RuleRow>(
    'model_rules',
    `?model_key=eq.${encodeURIComponent(modelKey)}&name=ilike.${likeValue(text)}&select=id,model_key,name,field_keys,condition,effect,message&limit=8`,
  )

  return pick(
    rows,
    text,
    'rule',
    (row) => row.name,
    (row) => same(row.name, text),
  )
}

interface VersionRow {
  id: string
  version: number
  lifecycle: string
  revision: number
}

interface DefinitionRow {
  id: string
  key: string
  name: string
  lifecycle: string
  revision: number
}

async function findDefinition(
  client: DataClient,
  table: 'sheet_definitions' | 'notebook_templates',
  text: string,
): Promise<Lookup<DefinitionRow>> {
  const like = likeValue(text)

  const rows = await client.list<DefinitionRow>(
    table,
    `?or=(key.ilike.${like},name.ilike.${like})&select=id,key,name,lifecycle,revision&order=name&limit=8`,
  )

  return pick(
    rows,
    text,
    table === 'sheet_definitions' ? 'sheet definition' : 'notebook template',
    (row) => `${row.name} (${row.key})`,
    (row) => same(row.key, text) || same(row.name, text),
  )
}

async function versionsOf(
  client: DataClient,
  table:
    | 'sheet_definition_versions'
    | 'notebook_template_versions'
    | 'record_model_versions',
  column: 'definition_id' | 'template_id' | 'model_id',
  id: string,
): Promise<VersionRow[]> {
  return client.list<VersionRow>(
    table,
    `?${column}=eq.${id}&select=id,version,lifecycle,revision&order=version.desc&limit=20`,
  )
}

const draftOf = (versions: readonly VersionRow[]) =>
  versions.find((v) => v.lifecycle === 'draft')

const fail = (message: string): SchemaOutcome => ({ ok: false, message })
const modelLink = (key: string) => `/models/${key}`

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

type ReadResult = { text: string; isError: boolean }

export async function runSchemaReadTool(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; every read below parses them with its own read schema before use.
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  try {
    switch (name) {
      case MODELS_READ_TOOL:
        return await readModels(args, context.client)
      case SHEET_DEFINITIONS_READ_TOOL:
        return await readDefinitions(args, context.client, 'sheet')
      case TEMPLATES_READ_TOOL:
        return await readDefinitions(args, context.client, 'template')
      default:
        return await readDependencies(args, context.client)
    }
  } catch {
    return { text: 'That could not be read just now.', isError: true }
  }
}

const ok = <Value>(value: Value): ReadResult => ({
  text: JSON.stringify(value),
  isError: false,
})

async function readModels(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; modelsReadSchema decodes them immediately below.
  args: unknown,
  client: DataClient,
): Promise<ReadResult> {
  const parsed = modelsReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  if (!parsed.data.model) {
    const rows = await client.list<ModelRow>(
      'record_models',
      `?select=${MODEL_COLUMNS}&order=name&limit=100`,
    )

    return ok({
      count: rows.length,
      types: rows.map((row) => ({
        name: row.name,
        key: row.key,
        prefix: row.identifier_prefix,
        kindOf: row.parent_key,
        registry: row.is_registry,
        open: modelLink(row.key),
      })),
    })
  }

  const found = await findModel(client, parsed.data.model)

  if (!found.ok) return { text: found.message, isError: true }
  const m = found.value

  const [fields, rules, links, versions] = await Promise.all([
    client.list<FieldRow>(
      'record_field_definitions',
      `?kind=eq.${encodeURIComponent(m.key)}&select=id,field_name,label,logical_type,lifecycle&order=display_order&limit=100`,
    ),
    client.list<RuleRow>(
      'model_rules',
      `?model_key=eq.${encodeURIComponent(m.key)}&select=id,model_key,name,field_keys,condition,effect,message`,
    ),
    client.list<{
      source_model_key: string
      link_type: string
      target_model_key: string
      min_links: number
      max_links: number | null
      label: string | null
    }>(
      'model_relationship_rules',
      `?or=(source_model_key.eq.${encodeURIComponent(m.key)},target_model_key.eq.${encodeURIComponent(m.key)})&select=source_model_key,link_type,target_model_key,min_links,max_links,label`,
    ),
    versionsOf(client, 'record_model_versions', 'model_id', m.id),
  ])

  const categories = fields.filter((f) => f.logical_type === 'category')

  const options = new Map(
    await Promise.all(
      categories.map(
        async (f) => [f.id, await listOptions(client, f.id)] as const,
      ),
    ),
  )

  return ok({
    type: `${m.name} (${m.key})`,
    prefix: m.identifier_prefix,
    kindOf: m.parent_key,
    open: modelLink(m.key),
    fields: fields.map((f) => {
      const shown = {
        label: f.label,
        name: f.field_name,
        type: f.logical_type,
        state: f.lifecycle,
      }

      const choices = options.get(f.id)

      return choices
        ? {
            ...shown,
            choices: choices
              .filter((o) => o.lifecycle === 'active')
              .map((o) => o.label),
          }
        : shown
    }),
    rules: rules.map((r) => ({
      name: r.name,
      fields: r.field_keys,
      when: r.condition,
      effect: r.effect,
      message: r.message,
    })),
    links: links.map((l) => ({
      from: l.source_model_key,
      kind: l.link_type,
      to: l.target_model_key,
      atLeast: l.min_links,
      atMost: l.max_links,
      label: l.label,
    })),
    versions: versions.map((v) => ({ version: v.version, state: v.lifecycle })),
  })
}

async function readDefinitions(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; the sheet or template read schema decodes them immediately below.
  args: unknown,
  client: DataClient,
  what: 'sheet' | 'template',
): Promise<ReadResult> {
  const table = what === 'sheet' ? 'sheet_definitions' : 'notebook_templates'

  const parsed = (
    what === 'sheet' ? sheetDefinitionsReadSchema : templatesReadSchema
  ).safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  const wanted =
    'definition' in parsed.data
      ? parsed.data.definition
      : 'template' in parsed.data
        ? parsed.data.template
        : undefined

  if (!wanted) {
    const rows = await client.list<DefinitionRow>(
      table,
      '?select=id,key,name,lifecycle,revision&order=name&limit=100',
    )

    return ok({
      count: rows.length,
      items: rows.map((row) => ({
        name: row.name,
        key: row.key,
        state: row.lifecycle,
        open:
          what === 'sheet'
            ? `/sheet-definitions/${row.id}`
            : `/templates/${row.id}`,
      })),
    })
  }

  const found = await findDefinition(client, table, wanted)

  if (!found.ok) return { text: found.message, isError: true }

  const versions =
    what === 'sheet'
      ? await versionsOf(
          client,
          'sheet_definition_versions',
          'definition_id',
          found.value.id,
        )
      : await versionsOf(
          client,
          'notebook_template_versions',
          'template_id',
          found.value.id,
        )

  return ok({
    name: `${found.value.name} (${found.value.key})`,
    state: found.value.lifecycle,
    open:
      what === 'sheet'
        ? `/sheet-definitions/${found.value.id}`
        : `/templates/${found.value.id}`,
    versions: versions.map((v) => ({ version: v.version, state: v.lifecycle })),
  })
}

async function readDependencies(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; modelDependenciesSchema decodes them immediately below.
  args: unknown,
  client: DataClient,
): Promise<ReadResult> {
  const parsed = modelDependenciesSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const found = await findModel(client, parsed.data.model)

  if (!found.ok) return { text: found.message, isError: true }

  const result = await client.rpc<unknown>('discover_model_dependencies', {
    p_model_key: found.value.key,
  })

  return ok({ type: `${found.value.name} (${found.value.key})`, result })
}

// ---------------------------------------------------------------------------
// Cards.
// ---------------------------------------------------------------------------

function card(
  name: SchemaProposeToolName,
  input: { title: string; summary: string },
  target: string,
  deepLink: string | null,
  changes: ProposalChange[],
  action: SchemaAction,
): SchemaOutcome {
  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target,
      deepLink,
      changes,
      action,
    },
  }
}

const describeCondition = (condition: ModelRuleCondition): string =>
  JSON.stringify(condition)

const EFFECT_WORDS = new Map<string, string>([
  ['warn', 'Warns'],
  ['block', 'Refuses the save'],
  ['flag_block_submit', 'Can be saved, not submitted'],
])

export async function buildSchemaProposal(
  name: SchemaProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; every case below decodes them with its own schema before building a proposal.
  args: unknown,
  context: LabToolContext,
): Promise<SchemaOutcome> {
  const client = context.client
  const bad = (error: z.ZodError) => fail(invalid(error))

  switch (name) {
    case MODEL_CREATE_TOOL:
    case MODEL_ADD_SUBTYPE_TOOL: {
      const parsed = (
        name === MODEL_CREATE_TOOL
          ? proposeModelCreateSchema
          : proposeModelSubtypeSchema
      ).safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      let parent: ModelRow | null = null

      // The subtype schema is the only one of the two that carries a parent,
      // and this decode is what proves the parent's value.
      const subtype = proposeModelSubtypeSchema.safeParse(args)
      const parentName = subtype.success ? subtype.data.parent : undefined

      if (parentName) {
        const found = await findModel(client, parentName)

        if (!found.ok) return fail(found.message)
        parent = found.value
      }

      const key = input.key ?? keyFromName(input.name)

      const taken = await client.list<{ key: string }>(
        'record_models',
        `?key=eq.${encodeURIComponent(key)}&select=key&limit=1`,
      )

      if (taken.length > 0)
        return fail(
          `There is already a record type with the key ${key}. Ask for another name or key.`,
        )

      const changes: ProposalChange[] = [
        { label: 'Name', before: null, after: input.name },
        { label: 'Identifiers start', before: null, after: input.prefix },
      ]

      if (parent)
        changes.push({ label: 'A kind of', before: null, after: parent.name })

      if (input.description)
        changes.push({
          label: 'Description',
          before: null,
          after: input.description,
        })

      return card(name, input, `${input.name} · Record type`, null, changes, {
        kind: 'schema.model_create',
        workspaceId: context.workspaceId,
        parentKey: parent?.key ?? null,
        key,
        name: input.name,
        prefix: input.prefix,
        description: input.description ?? null,
      })
    }

    case FIELD_RETIRE_TOOL: {
      const parsed = proposeFieldRetireSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const f = await findField(client, m.value.key, input.field)

      if (!f.ok) return fail(f.message)

      return card(
        name,
        input,
        `${m.value.name} · ${f.value.label}`,
        modelLink(m.value.key),
        [{ label: 'Field', before: f.value.lifecycle, after: 'retired' }],
        { kind: 'schema.field_retire', fieldId: f.value.id },
      )
    }

    case OPTION_ADD_TOOL: {
      const parsed = proposeOptionAddSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const f = await findField(client, m.value.key, input.field)

      if (!f.ok) return fail(f.message)

      if (f.value.logical_type !== 'category')
        return fail(`${f.value.label} is not a field with choices.`)
      const options = await listOptions(client, f.value.id)
      const key = input.key ?? keyFromName(input.label)

      if (options.some((o) => o.key === key))
        return fail(`${f.value.label} already has the choice ${key}.`)

      return card(
        name,
        input,
        `${m.value.name} · ${f.value.label}`,
        modelLink(m.value.key),
        [{ label: 'New choice', before: null, after: input.label }],
        {
          kind: 'schema.option_add',
          fieldId: f.value.id,
          key,
          label: input.label,
          order: Math.max(0, ...options.map((o) => o.display_order)) + 1,
        },
      )
    }

    case OPTION_RENAME_TOOL:
    case OPTION_RETIRE_TOOL: {
      const parsed = (
        name === OPTION_RENAME_TOOL
          ? proposeOptionRenameSchema
          : proposeOptionRetireSchema
      ).safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const f = await findField(client, m.value.key, input.field)

      if (!f.ok) return fail(f.message)
      const o = await findOption(client, f.value.id, input.option)

      if (!o.ok) return fail(o.message)
      const target = `${m.value.name} · ${f.value.label}`

      if (name === OPTION_RENAME_TOOL) {
        // The rename schema is the only one of the two that carries a new
        // label, and this decode is what proves its value.
        const renamed = proposeOptionRenameSchema.safeParse(args)

        if (!renamed.success) return bad(renamed.error)
        const { label } = renamed.data

        return card(
          name,
          input,
          target,
          modelLink(m.value.key),
          [{ label: 'Choice', before: o.value.label, after: label }],
          {
            kind: 'schema.option_rename',
            optionId: o.value.id,
            label,
            order: o.value.display_order,
          },
        )
      }

      return card(
        name,
        input,
        target,
        modelLink(m.value.key),
        [{ label: o.value.label, before: 'offered', after: 'retired' }],
        { kind: 'schema.option_retire', optionId: o.value.id },
      )
    }

    case RULE_ADD_TOOL: {
      const parsed = proposeRuleAddSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const fields: FieldRow[] = []

      for (const wanted of input.fields) {
        const f = await findField(client, m.value.key, wanted)

        if (!f.ok) return fail(f.message)
        fields.push(f.value)
      }

      return card(
        name,
        input,
        `${m.value.name} · Rule`,
        modelLink(m.value.key),
        [
          { label: 'Rule', before: null, after: input.name },
          {
            label: 'Looks at',
            before: null,
            after: fields.map((f) => f.label).join(', '),
          },
          {
            label: 'When',
            before: null,
            after: describeCondition(input.condition),
          },
          {
            label: 'Then',
            before: null,
            after: EFFECT_WORDS.get(input.effect) ?? input.effect,
          },
          { label: 'Message', before: null, after: input.message },
        ],
        {
          kind: 'schema.rule_add',
          workspaceId: context.workspaceId,
          modelKey: m.value.key,
          name: input.name,
          fieldKeys: fields.map((f) => f.field_name),
          condition: input.condition,
          effect: input.effect,
          message: input.message,
        },
      )
    }

    case RULE_UPDATE_TOOL: {
      const parsed = proposeRuleUpdateSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const r = await findRule(client, m.value.key, input.rule)

      if (!r.ok) return fail(r.message)
      const patch: UpdateModelRulePatch = {}
      const changes: ProposalChange[] = []

      if (input.name) {
        patch.name = input.name
        changes.push({ label: 'Name', before: r.value.name, after: input.name })
      }

      if (input.condition) {
        patch.condition = input.condition
        changes.push({
          label: 'When',
          before: describeCondition(r.value.condition),
          after: describeCondition(input.condition),
        })
      }

      if (input.effect) {
        patch.effect = input.effect
        changes.push({
          label: 'Then',
          before: EFFECT_WORDS.get(r.value.effect) ?? r.value.effect,
          after: EFFECT_WORDS.get(input.effect) ?? input.effect,
        })
      }

      if (input.message) {
        patch.message = input.message
        changes.push({
          label: 'Message',
          before: r.value.message,
          after: input.message,
        })
      }

      if (changes.length === 0) return fail('Say what to change on the rule.')

      return card(
        name,
        input,
        `${m.value.name} · ${r.value.name}`,
        modelLink(m.value.key),
        changes,
        { kind: 'schema.rule_update', ruleId: r.value.id, patch },
      )
    }

    case RULE_REMOVE_TOOL: {
      const parsed = proposeRuleRemoveSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)
      const r = await findRule(client, m.value.key, input.rule)

      if (!r.ok) return fail(r.message)

      return card(
        name,
        input,
        `${m.value.name} · ${r.value.name}`,
        modelLink(m.value.key),
        [{ label: 'Rule', before: r.value.name, after: 'removed' }],
        { kind: 'schema.rule_remove', ruleId: r.value.id },
      )
    }

    case LINK_RULE_SET_TOOL: {
      const parsed = proposeLinkRuleSetSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const from = await findModel(client, input.from)

      if (!from.ok) return fail(from.message)
      const to = await findModel(client, input.to)

      if (!to.ok) return fail(to.message)
      const min = input.min ?? 0
      const max = input.max ?? null

      if (max !== null && max < min)
        return fail('The most links cannot be fewer than the fewest.')

      return card(
        name,
        input,
        `${from.value.name} → ${to.value.name}`,
        modelLink(from.value.key),
        [
          {
            label: 'Each',
            before: null,
            after: `${from.value.name} links to ${to.value.name}`,
          },
          {
            label: 'How many',
            before: null,
            after:
              max === null
                ? `at least ${min}`
                : min === max
                  ? `exactly ${min}`
                  : `${min} to ${max}`,
          },
        ],
        {
          kind: 'schema.link_rule_set',
          workspaceId: context.workspaceId,
          sourceKey: from.value.key,
          linkType: input.linkType,
          targetKey: to.value.key,
          min,
          max,
          label: input.label ?? null,
        },
      )
    }

    case LINK_RULE_REMOVE_TOOL: {
      const parsed = proposeLinkRuleRemoveSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const from = await findModel(client, input.from)

      if (!from.ok) return fail(from.message)
      const to = await findModel(client, input.to)

      if (!to.ok) return fail(to.message)

      const rows = await client.list<{ id: string; link_type: string }>(
        'model_relationship_rules',
        `?source_model_key=eq.${encodeURIComponent(from.value.key)}&target_model_key=eq.${encodeURIComponent(to.value.key)}&select=id,link_type`,
      )

      if (rows.length === 0)
        return fail(
          `There is no rule for how ${from.value.name} links to ${to.value.name}.`,
        )

      if (rows.length > 1)
        return fail(
          `There is more than one: ${rows.map((r) => r.link_type).join(', ')}. Ask which kind of link.`,
        )

      return card(
        name,
        input,
        `${from.value.name} → ${to.value.name}`,
        modelLink(from.value.key),
        [{ label: 'Link rule', before: rows[0].link_type, after: 'removed' }],
        { kind: 'schema.link_rule_remove', ruleId: rows[0].id },
      )
    }

    case MODEL_VERSION_START_TOOL:
    case MODEL_VERSION_PUBLISH_TOOL: {
      const parsed = (
        name === MODEL_VERSION_START_TOOL
          ? proposeModelVersionStartSchema
          : proposeModelVersionPublishSchema
      ).safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const m = await findModel(client, input.model)

      if (!m.ok) return fail(m.message)

      const versions = await versionsOf(
        client,
        'record_model_versions',
        'model_id',
        m.value.id,
      )

      const draft = draftOf(versions)
      const newest = versions[0]?.version ?? 0

      if (name === MODEL_VERSION_START_TOOL) {
        // The start schema is the only one of the two that carries a reason,
        // and this decode is what proves its value.
        const started = proposeModelVersionStartSchema.safeParse(args)

        if (!started.success) return bad(started.error)

        if (draft)
          return fail(
            `${m.value.name} already has a draft, version ${draft.version}.`,
          )

        return card(
          name,
          input,
          `${m.value.name} · Version ${newest + 1}`,
          modelLink(m.value.key),
          [
            {
              label: 'New draft',
              before: null,
              after: `Version ${newest + 1}`,
            },
          ],
          {
            kind: 'schema.model_version_start',
            modelId: m.value.id,
            reason: started.data.reason,
          },
        )
      }

      if (!draft) return fail(`${m.value.name} has no draft to publish.`)

      return card(
        name,
        input,
        `${m.value.name} · Version ${draft.version}`,
        modelLink(m.value.key),
        [
          {
            label: `Version ${draft.version}`,
            before: 'draft',
            after: 'published',
          },
        ],
        { kind: 'schema.model_version_publish', versionId: draft.id },
      )
    }

    case SHEET_DEFINITION_PUBLISH_TOOL:
    case SHEET_DEFINITION_RETIRE_TOOL:
    case SHEET_DEFINITION_RESTORE_TOOL: {
      const parsed = proposeSheetDefinitionSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data

      const d = await findDefinition(
        client,
        'sheet_definitions',
        input.definition,
      )

      if (!d.ok) return fail(d.message)
      const link = `/sheet-definitions/${d.value.id}`

      if (name === SHEET_DEFINITION_PUBLISH_TOOL) {
        const draft = draftOf(
          await versionsOf(
            client,
            'sheet_definition_versions',
            'definition_id',
            d.value.id,
          ),
        )

        if (!draft) return fail(`${d.value.name} has no draft to publish.`)

        return card(
          name,
          input,
          `${d.value.name} · Version ${draft.version}`,
          link,
          [
            {
              label: `Version ${draft.version}`,
              before: 'draft',
              after: 'published',
            },
          ],
          {
            kind: 'schema.sheet_definition_publish',
            versionId: draft.id,
            revision: draft.revision,
          },
        )
      }

      const retire = name === SHEET_DEFINITION_RETIRE_TOOL

      if (retire === (d.value.lifecycle === 'retired'))
        return fail(
          `${d.value.name} is already ${retire ? 'retired' : 'offered'}.`,
        )

      return card(
        name,
        input,
        `${d.value.name} · Sheet definition`,
        link,
        [
          {
            label: 'Sheet definition',
            before: d.value.lifecycle === 'retired' ? 'retired' : 'offered',
            after: retire ? 'retired' : 'offered',
          },
        ],
        {
          kind: 'schema.sheet_definition_lifecycle',
          definitionId: d.value.id,
          revision: d.value.revision,
          retire,
        },
      )
    }

    case TEMPLATE_PUBLISH_TOOL: {
      const parsed = proposeTemplatePublishSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data

      const t = await findDefinition(
        client,
        'notebook_templates',
        input.template,
      )

      if (!t.ok) return fail(t.message)

      const draft = draftOf(
        await versionsOf(
          client,
          'notebook_template_versions',
          'template_id',
          t.value.id,
        ),
      )

      if (!draft) return fail(`${t.value.name} has no draft to publish.`)

      return card(
        name,
        input,
        `${t.value.name} · Version ${draft.version}`,
        `/templates/${t.value.id}`,
        [
          {
            label: `Version ${draft.version}`,
            before: 'draft',
            after: 'published',
          },
          { label: 'Why', before: null, after: input.reason },
        ],
        {
          kind: 'schema.template_publish',
          versionId: draft.id,
          revision: draft.revision,
          reason: input.reason,
        },
      )
    }

    case TEMPLATE_ADD_SHEET_COLUMN_TOOL: {
      const parsed = proposeTemplateSheetColumnSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data

      const t = await findDefinition(
        client,
        'notebook_templates',
        input.template,
      )

      if (!t.ok) return fail(t.message)

      const draft = draftOf(
        await versionsOf(
          client,
          'notebook_template_versions',
          'template_id',
          t.value.id,
        ),
      )

      if (!draft)
        return fail(
          `${t.value.name} has no draft. Start a draft of it in the app first.`,
        )

      const versionRows = await client.list<{
        id: string
        revision: number
        configuration: unknown
      }>(
        'notebook_template_versions',
        `?id=eq.${draft.id}&select=id,revision,configuration&limit=1`,
      )

      const placements = parseNotebookTemplateConfiguration(
        versionRows[0]?.configuration,
      ).placements.filter((p) => p.kind === 'sheet')

      const pinned = placements.length
        ? await client.list<{
            id: string
            definition_id: string
            configuration: unknown
          }>(
            'sheet_definition_versions',
            `?id=in.(${placements.map((p) => p.definitionVersionId).join(',')})&select=id,definition_id,configuration`,
          )
        : []

      const definitions = pinned.length
        ? await client.list<{ id: string; name: string; revision: number }>(
            'sheet_definitions',
            `?id=in.(${[...new Set(pinned.map((v) => v.definition_id))].join(',')})&select=id,name,revision`,
          )
        : []

      const sections = placements.flatMap((placement) => {
        const version = pinned.find(
          (v) => v.id === placement.definitionVersionId,
        )

        const definition = definitions.find(
          (d) => d.id === version?.definition_id,
        )

        return version && definition
          ? [
              {
                placement,
                version,
                definition,
                name: placement.title || definition.name,
              },
            ]
          : []
      })

      const section = pick(
        sections,
        input.section,
        'sheet section',
        (row) => row.name,
        (row) => same(row.name, input.section),
      )

      if (!section.ok) return fail(section.message)

      let configuration: SheetDefinitionConfiguration

      try {
        configuration = addSheetColumn(
          parseSheetDefinitionConfiguration(
            section.value.version.configuration,
          ),
          {
            label: input.name,
            type: input.type,
            unit: input.unit,
            required: input.required ?? false,
            min: input.min,
            max: input.max,
          },
        )
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }

      const detail = [
        input.type,
        input.unit ? `in ${input.unit}` : null,
        input.required ? 'required' : null,
      ]
        .filter(Boolean)
        .join(', ')

      return card(
        name,
        input,
        `${t.value.name} · ${section.value.name}`,
        `/templates/${t.value.id}`,
        [
          {
            label: 'New column',
            before: null,
            after: `${input.name} (${detail})`,
          },
        ],
        {
          kind: 'schema.template_add_sheet_column',
          templateId: t.value.id,
          target: {
            definitionId: section.value.definition.id,
            definitionRevision: section.value.definition.revision,
            templateVersionId: draft.id,
            templateRevision: versionRows[0]?.revision ?? draft.revision,
            placementId: section.value.placement.id,
          },
          configuration,
        },
      )
    }

    case SHEET_RENAME_TOOL: {
      const parsed = proposeSheetRenameSchema.safeParse(args)

      if (!parsed.success) return bad(parsed.error)
      const input = parsed.data
      const like = likeValue(input.sheet)

      const rows = await client.list<{
        id: string
        display_id: string | null
        name: string
        revision: number
      }>(
        'sheet_instances',
        `?lifecycle=neq.archived&or=(display_id.ilike.${like},name.ilike.${like})&select=id,display_id,name,revision&order=updated_at.desc&limit=8`,
      )

      const s = pick(
        rows,
        input.sheet,
        'sheet',
        (row) => (row.display_id ? `${row.display_id} ${row.name}` : row.name),
        (row) =>
          same(row.display_id ?? '', input.sheet) ||
          same(row.name, input.sheet),
      )

      if (!s.ok) return fail(s.message)

      return card(
        name,
        input,
        `${s.value.display_id ?? s.value.name} · Sheet`,
        `/sheets/${s.value.id}`,
        [{ label: 'Name', before: s.value.name, after: input.name }],
        {
          kind: 'schema.sheet_rename',
          instanceId: s.value.id,
          revision: s.value.revision,
          name: input.name,
        },
      )
    }
  }
}
