import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { keyFromName } from '#/lib/assistant-schema'
import {
  NOTE,
  card,
  fail,
  find,
  findMemberNamed,
  findRecordOf,
  same,
} from '#/lib/assistant-kit.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'
import { fetchModelFields } from '#/lib/model-fields'
import { SUPPLIER_STARTER } from '#/lib/suppliers'

import type { FeatureProposalOutcome } from '../define.server'
import {
  MODELS_PROPOSE_TOOL_NAMES,
  MODEL_FIELD_ACTIVATE_TOOL,
  MODEL_FIELD_ADD_TOOL,
  MODEL_FIELD_DRAFT_TOOL,
  MODEL_FIELD_EVOLVE_TOOL,
  MODEL_FIELD_PLUGIN_TOOL,
  MODEL_FIELD_PROMOTE_TOOL,
  MODEL_FIELD_SEMANTICS_TOOL,
  MODEL_FIELD_UPDATE_TOOL,
  MODEL_INCIDENT_LOG_TOOL,
  MODEL_LOT_KIND_TOOL,
  MODEL_REGISTRY_CREATE_TOOL,
  MODEL_REGISTRY_SET_TOOL,
  MODEL_REQUEST_CREATE_TOOL,
  MODEL_REQUEST_FORM_TOOL,
  MODEL_SAMENESS_TOOL,
  MODEL_STARTER_CREATE_TOOL,
  MODEL_SUPPLIER_CREATE_TOOL,
  MODEL_SUPPLIER_LIST_TOOL,
  RECORD_SET_TYPE_TOOL,
  REGISTRY_REMOVE_PARENT_TOOL,
  proposeModelFieldActivateSchema,
  proposeModelFieldAddSchema,
  proposeModelFieldDraftSchema,
  proposeModelFieldEvolveSchema,
  proposeModelFieldPluginSchema,
  proposeModelFieldPromoteSchema,
  proposeModelFieldSemanticsSchema,
  proposeModelFieldUpdateSchema,
  proposeModelIncidentLogSchema,
  proposeModelLotKindSchema,
  proposeModelRegistryCreateSchema,
  proposeModelRegistrySetSchema,
  proposeModelRequestCreateSchema,
  proposeModelRequestFormSchema,
  proposeModelSamenessSchema,
  proposeModelStarterCreateSchema,
  proposeModelSupplierCreateSchema,
  proposeModelSupplierListSchema,
  proposeRecordSetTypeSchema,
  proposeRegistryRemoveParentSchema,
} from './cards'
import type {
  ModelStarterField,
  ModelsAction,
  ModelsProposeToolName,
  NewField,
} from './cards'

/**
 * The record type cards (see `cards.ts`). Each builder finds what the model
 * named under the signed-in person's own access and returns a card that says
 * exactly what will change. Nothing is written here.
 */

export function isModelsProposalTool(
  name: string,
): name is ModelsProposeToolName {
  return MODELS_PROPOSE_TOOL_NAMES.includes(name)
}

export function modelsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      MODEL_REGISTRY_CREATE_TOOL,
      `Propose adding a registry: a record type for things such as cell lines or constructs, whose entries get a running number and where likely duplicates are refused by the key fields. Give its fields. ${NOTE}`,
      proposeModelRegistryCreateSchema,
    ),
    toolDef(
      MODEL_REQUEST_CREATE_TOOL,
      `Propose adding a request form: a record type people send as a request (a sequencing request, a stores order), with an intro shown on the form. ${NOTE}`,
      proposeModelRequestCreateSchema,
    ),
    toolDef(
      MODEL_STARTER_CREATE_TOOL,
      `Propose adding a record type with all its fields in one go, optionally used as an incident log. For a type with no fields yet use the record type tool of the schema area instead. ${NOTE}`,
      proposeModelStarterCreateSchema,
    ),
    toolDef(
      MODEL_SUPPLIER_CREATE_TOOL,
      `Propose adding the ready-made Supplier record type (contact, email, phone, website, account number, payment terms, currency) and using it as the supplier list for orders. ${NOTE}`,
      proposeModelSupplierCreateSchema,
    ),
    toolDef(
      MODEL_REGISTRY_SET_TOOL,
      `Propose making a record type a registry, or not one any more, with the fields that say two entries are the same thing and the field that holds the running number. ${NOTE}`,
      proposeModelRegistrySetSchema,
    ),
    toolDef(
      MODEL_LOT_KIND_TOOL,
      `Propose choosing which record type the lots of a registry entry are, such as Compound lot, or taking it off. ${NOTE}`,
      proposeModelLotKindSchema,
    ),
    toolDef(
      MODEL_SAMENESS_TOOL,
      `Propose choosing the plugin rule that decides when two entries of a registry are the same thing, or going back to the key fields. ${NOTE}`,
      proposeModelSamenessSchema,
    ),
    toolDef(
      MODEL_INCIDENT_LOG_TOOL,
      `Propose using a record type as an incident log (entries show in the incident list with their severity and follow-up), or not. ${NOTE}`,
      proposeModelIncidentLogSchema,
    ),
    toolDef(
      MODEL_REQUEST_FORM_TOOL,
      `Propose letting people send a record type as a request, or stopping, with the intro on the form and who handles requests. ${NOTE}`,
      proposeModelRequestFormSchema,
    ),
    toolDef(
      MODEL_SUPPLIER_LIST_TOOL,
      `Propose using a record type's records as the supplier list (the companies the lab buys from, so an order can name one), or not. ${NOTE}`,
      proposeModelSupplierListSchema,
    ),
    toolDef(
      MODEL_FIELD_DRAFT_TOOL,
      `Propose adding a field to a record type as a draft. It does nothing on records until it is switched on; to add it and switch it on in one go use the add tool. ${NOTE}`,
      proposeModelFieldDraftSchema,
    ),
    toolDef(
      MODEL_FIELD_ADD_TOOL,
      `Propose adding a field to a record type and switching it on straight away, with the choices of a category field. ${NOTE}`,
      proposeModelFieldAddSchema,
    ),
    toolDef(
      MODEL_FIELD_ACTIVATE_TOOL,
      `Propose switching a draft field on, so records of the type show and keep it. ${NOTE}`,
      proposeModelFieldActivateSchema,
    ),
    toolDef(
      MODEL_FIELD_UPDATE_TOOL,
      `Propose changing a field's label, description, group, whether it shows in lists, or its unit. A change to a field that records already use goes through the evolve tool. ${NOTE}`,
      proposeModelFieldUpdateSchema,
    ),
    toolDef(
      MODEL_FIELD_SEMANTICS_TOOL,
      `Propose saying what a draft field means: the quantity and unit it measures, one value or many, or which record type a reference points at. ${NOTE}`,
      proposeModelFieldSemanticsSchema,
    ),
    toolDef(
      MODEL_FIELD_EVOLVE_TOOL,
      `Propose changing or retiring a field that records already use. The change is checked first: one that would lose data is refused, one that needs confirming says so on the card. ${NOTE}`,
      proposeModelFieldEvolveSchema,
    ),
    toolDef(
      MODEL_FIELD_PLUGIN_TOOL,
      `Propose giving a field a plugin field type (such as a chemical structure), or taking it away. The plugin has to be installed and on. ${NOTE}`,
      proposeModelFieldPluginSchema,
    ),
    toolDef(
      MODEL_FIELD_PROMOTE_TOOL,
      `Propose making a column that only one sheet has into a shared field of a record type, and pointing the sheet at it. ${NOTE}`,
      proposeModelFieldPromoteSchema,
    ),
    toolDef(
      RECORD_SET_TYPE_TOOL,
      `Propose changing what type a record, project or instrument is, to another type of the same family (such as Reagent to Antibody), with the new type's field values. A signed record keeps its type. ${NOTE}`,
      proposeRecordSetTypeSchema,
    ),
    toolDef(
      REGISTRY_REMOVE_PARENT_TOOL,
      `Propose removing a parent link from a registry entry's lineage. ${NOTE}`,
      proposeRegistryRemoveParentSchema,
    ),
  ]
}

interface ModelRow {
  id: string
  key: string
  name: string
  is_registry: boolean
}

const findModelNamed = (
  client: DataClient,
  wanted: string,
): Promise<Lookup<ModelRow>> =>
  find<ModelRow>(client, wanted, {
    table: 'record_models',
    match: ['key', 'name'],
    select: 'id,key,name,is_registry',
    what: 'record type',
    order: 'name.asc',
    label: (row) => `${row.name} (${row.key})`,
    names: (row) => [row.key, row.name],
  })

interface FieldRow {
  id: string
  field_name: string
  label: string
  logical_type: string
  lifecycle: string
}

async function findFieldOf(
  client: DataClient,
  modelKey: string,
  wanted: string,
  lifecycle?: 'draft' | 'active',
): Promise<Lookup<FieldRow>> {
  const like = likeValue(wanted)

  const rows = await client.list<FieldRow>(
    'record_field_definitions',
    `?kind=eq.${encodeURIComponent(modelKey)}&lifecycle=${lifecycle ? `eq.${lifecycle}` : 'neq.retired'}&or=(field_name.ilike.${like},label.ilike.${like})&select=id,field_name,label,logical_type,lifecycle&limit=8`,
  )

  return pick(
    rows,
    wanted,
    lifecycle === 'draft' ? 'draft field' : 'field',
    (row) => `${row.label} (${row.field_name})`,
    (row) => same(row.field_name, wanted) || same(row.label, wanted),
  )
}

const modelLink = (key: string): string => `/models/${key}`

const squash = (text: string): string =>
  text.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

interface Starter {
  key: string
  fields: ModelStarterField[]
  changes: ProposalChange[]
}

/** The new type's key and fields, or why they cannot be made. */
async function starterOf(
  client: DataClient,
  input: {
    name: string
    key?: string
    prefix: string
    description?: string
    fields: NewField[]
  },
): Promise<Lookup<Starter>> {
  const key = keyFromName(input.key ?? input.name)

  const taken = await client.list<{ key: string }>(
    'record_models',
    `?key=eq.${encodeURIComponent(key)}&select=key&limit=1`,
  )

  if (taken.length > 0)
    return {
      ok: false,
      message: `There is already a record type with the key ${key}. Ask for another name or key.`,
    }

  const fields: ModelStarterField[] = []

  for (const field of input.fields) {
    const fieldName = keyFromName(field.label)

    if (fields.some((each) => each.field_name === fieldName))
      return {
        ok: false,
        message: `Two fields would be called ${fieldName}; give each field its own label.`,
      }

    const type = field.type ?? (field.choices ? 'category' : 'text')

    if (field.choices && type !== 'category')
      return {
        ok: false,
        message: `${field.label} has choices, so it has to be a category field.`,
      }

    const starter: ModelStarterField = {
      field_name: fieldName,
      label: field.label.trim(),
      logical_type: type,
      show_in_list: field.showInList ?? false,
    }

    if (type === 'category')
      starter.options = (field.choices ?? []).map((choice) => ({
        key: keyFromName(choice),
        label: choice.trim(),
      }))

    fields.push(starter)
  }

  const changes: ProposalChange[] = [
    { label: 'Name', before: null, after: input.name.trim() },
    { label: 'Identifiers start', before: null, after: input.prefix },
    {
      label: 'Fields',
      before: null,
      after: fields
        .map((field) => `${field.label} (${field.logical_type})`)
        .join(', '),
    },
  ]

  if (input.description)
    changes.push({
      label: 'Description',
      before: null,
      after: input.description,
    })

  return { ok: true, value: { key, fields, changes } }
}

/** A field label from the new fields, as the name the database stores. */
function nameOfLabel(
  fields: readonly ModelStarterField[],
  wanted: string,
): string | null {
  const found = fields.find(
    (field) =>
      squash(field.label) === squash(wanted) ||
      field.field_name === keyFromName(wanted),
  )

  return found?.field_name ?? null
}

/** The names of fields the person named by label, among those that exist. */
function fieldNamesIn(
  fields: readonly { field_name: string; label: string }[],
  labels: readonly string[],
): Lookup<string[]> {
  const names: string[] = []

  for (const label of labels) {
    const found = nameOfLabel(
      fields.map((field) => ({
        field_name: field.field_name,
        label: field.label,
        logical_type: 'text',
        show_in_list: false,
      })),
      label,
    )

    if (!found)
      return {
        ok: false,
        message: `There is no field "${label}" on that type.`,
      }
    names.push(found)
  }

  return { ok: true, value: names }
}

const logicalTypeWords = (type: string): string => type.replaceAll('_', ' ')

export async function buildModelsProposal(
  name: ModelsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case MODEL_REGISTRY_CREATE_TOOL: {
      const parsed = proposeModelRegistryCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const starter = await starterOf(client, input)

      if (!starter.ok) return fail(starter.message)

      const keyFields = fieldNamesIn(
        starter.value.fields,
        input.keyFields ?? [],
      )

      if (!keyFields.ok) return fail(keyFields.message)

      const sequence = input.sequenceField
        ? nameOfLabel(starter.value.fields, input.sequenceField)
        : null

      if (input.sequenceField && !sequence)
        return fail(
          `There is no field "${input.sequenceField}" to hold the running number.`,
        )

      const changes = [...starter.value.changes]

      if (input.keyFields?.length)
        changes.push({
          label: 'Same thing when these match',
          before: null,
          after: input.keyFields.join(', '),
        })

      return card(name, input, `${input.name} · Registry`, null, changes, {
        kind: 'model.registry_create',
        key: starter.value.key,
        name: input.name.trim(),
        prefix: input.prefix,
        description: input.description ?? null,
        fields: starter.value.fields,
        keyFields: keyFields.value,
        sequenceField: sequence,
      })
    }

    case MODEL_REQUEST_CREATE_TOOL: {
      const parsed = proposeModelRequestCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const starter = await starterOf(client, input)

      if (!starter.ok) return fail(starter.message)
      const changes = [...starter.value.changes]

      if (input.intro)
        changes.push({ label: 'Form intro', before: null, after: input.intro })

      return card(name, input, `${input.name} · Request form`, null, changes, {
        kind: 'model.request_create',
        key: starter.value.key,
        name: input.name.trim(),
        prefix: input.prefix,
        description: input.description ?? null,
        fields: starter.value.fields,
        intro: input.intro ?? null,
      })
    }

    case MODEL_STARTER_CREATE_TOOL: {
      const parsed = proposeModelStarterCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const starter = await starterOf(client, input)

      if (!starter.ok) return fail(starter.message)
      const changes = [...starter.value.changes]

      if (input.incidentLog)
        changes.push({
          label: 'Used as',
          before: null,
          after: 'An incident log',
        })

      return card(name, input, `${input.name} · Record type`, null, changes, {
        kind: 'model.starter_create',
        key: starter.value.key,
        name: input.name.trim(),
        prefix: input.prefix,
        description: input.description ?? null,
        fields: starter.value.fields,
        incidentLog: input.incidentLog ?? false,
      })
    }

    case MODEL_SUPPLIER_CREATE_TOOL: {
      const parsed = proposeModelSupplierCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const taken = await client.list<{ key: string }>(
        'record_models',
        `?key=eq.${SUPPLIER_STARTER.key}&select=key&limit=1`,
      )

      if (taken.length > 0)
        return fail(
          'There is already a Supplier record type. Use the supplier list tool to use it as the supplier list.',
        )

      return card(
        name,
        input,
        'Supplier · Record type',
        null,
        [
          { label: 'Name', before: null, after: SUPPLIER_STARTER.name },
          {
            label: 'Identifiers start',
            before: null,
            after: SUPPLIER_STARTER.prefix,
          },
          {
            label: 'Fields',
            before: null,
            after: SUPPLIER_STARTER.fields
              .map((field) => field.label)
              .join(', '),
          },
          {
            label: 'Used as',
            before: null,
            after: 'The supplier list for orders',
          },
        ],
        { kind: 'model.supplier_create' },
      )
    }

    case MODEL_REGISTRY_SET_TOOL: {
      const parsed = proposeModelRegistrySetSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)
      const defs = await fetchModelFields(client, model.value.key)

      const keyFields = fieldNamesIn(
        defs.map((def) => ({ field_name: def.fieldName, label: def.label })),
        input.keyFields ?? [],
      )

      if (!keyFields.ok) return fail(keyFields.message)

      const sequence = input.sequenceField
        ? (defs.find(
            (def) =>
              squash(def.label) === squash(input.sequenceField ?? '') ||
              def.fieldName === keyFromName(input.sequenceField ?? ''),
          )?.fieldName ?? null)
        : null

      if (input.sequenceField && !sequence)
        return fail(
          `There is no field "${input.sequenceField}" to hold the running number.`,
        )

      const changes: ProposalChange[] = [
        {
          label: 'Registry',
          before: model.value.is_registry ? 'Yes' : 'No',
          after: input.registry ? 'Yes' : 'No',
        },
      ]

      if (input.registry && input.keyFields?.length)
        changes.push({
          label: 'Same thing when these match',
          before: null,
          after: input.keyFields.join(', '),
        })

      return card(
        name,
        input,
        `${model.value.name} · Record type`,
        modelLink(model.value.key),
        changes,
        {
          kind: 'model.registry_set',
          key: model.value.key,
          registry: input.registry,
          keyFields: keyFields.value,
          sequenceField: sequence,
        },
      )
    }

    case MODEL_LOT_KIND_TOOL: {
      const parsed = proposeModelLotKindSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      if (!model.value.is_registry)
        return fail(
          `${model.value.name} is not a registry, so its entries have no lots.`,
        )

      const lot = input.lotType
        ? await findModelNamed(client, input.lotType)
        : null

      if (lot && !lot.ok) return fail(lot.message)

      return card(
        name,
        input,
        `${model.value.name} · Registry`,
        modelLink(model.value.key),
        [
          {
            label: 'Lots are',
            before: null,
            after: lot?.ok ? lot.value.name : 'Not set',
          },
        ],
        {
          kind: 'model.registry_lot_kind',
          key: model.value.key,
          lotKind: lot?.ok ? lot.value.key : null,
        },
      )
    }

    case MODEL_SAMENESS_TOOL: {
      const parsed = proposeModelSamenessSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      if (!model.value.is_registry)
        return fail(`${model.value.name} is not a registry.`)

      if (input.rule && !/^plugin\.[^.]+\.[^.]+$/.test(input.rule))
        return fail('A rule is written plugin.<plugin>.<rule>.')

      return card(
        name,
        input,
        `${model.value.name} · Registry`,
        modelLink(model.value.key),
        [
          {
            label: 'Same thing decided by',
            before: null,
            after: input.rule ?? 'The key fields',
          },
        ],
        {
          kind: 'model.registry_sameness',
          key: model.value.key,
          rule: input.rule ?? null,
        },
      )
    }

    case MODEL_INCIDENT_LOG_TOOL: {
      const parsed = proposeModelIncidentLogSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      return card(
        name,
        input,
        `${model.value.name} · Record type`,
        modelLink(model.value.key),
        [
          {
            label: 'Incident log',
            before: null,
            after: input.enabled ? 'On' : 'Off',
          },
        ],
        {
          kind: 'model.incident_log_set',
          key: model.value.key,
          enabled: input.enabled,
        },
      )
    }

    case MODEL_REQUEST_FORM_TOOL: {
      const parsed = proposeModelRequestFormSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)
      const people: { user_id: string; name: string }[] = []

      for (const wanted of input.handlers ?? []) {
        const who = await findMemberNamed(client, wanted)

        if (!who.ok) return fail(who.message)
        people.push(who.value)
      }

      const changes: ProposalChange[] = [
        {
          label: 'Takes requests',
          before: null,
          after: input.accepts ? 'Yes' : 'No',
        },
      ]

      if (input.intro)
        changes.push({ label: 'Form intro', before: null, after: input.intro })

      if (people.length > 0)
        changes.push({
          label: 'Handled by',
          before: null,
          after: people.map((person) => person.name).join(', '),
        })

      return card(
        name,
        input,
        `${model.value.name} · Record type`,
        modelLink(model.value.key),
        changes,
        {
          kind: 'model.request_form_set',
          key: model.value.key,
          accepts: input.accepts,
          intro: input.intro ?? null,
          handlerUserIds: people.map((person) => person.user_id),
        },
      )
    }

    case MODEL_SUPPLIER_LIST_TOOL: {
      const parsed = proposeModelSupplierListSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      return card(
        name,
        input,
        `${model.value.name} · Record type`,
        modelLink(model.value.key),
        [
          {
            label: 'Supplier list',
            before: null,
            after: input.enabled ? 'Used for orders' : 'Not used',
          },
        ],
        {
          kind: 'model.supplier_list_set',
          key: model.value.key,
          enabled: input.enabled,
        },
      )
    }

    case MODEL_FIELD_DRAFT_TOOL:
    case MODEL_FIELD_ADD_TOOL: {
      const adding = name === MODEL_FIELD_ADD_TOOL

      const parsed = (
        adding ? proposeModelFieldAddSchema : proposeModelFieldDraftSchema
      ).safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      // Only the add tool takes choices; its schema is the proof.
      const added = proposeModelFieldAddSchema.safeParse(args)
      const choices = added.success ? added.data.choices : undefined
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)
      const fieldName = keyFromName(input.name ?? input.label)

      const existing = await client.list<{ id: string }>(
        'record_field_definitions',
        `?kind=eq.${encodeURIComponent(model.value.key)}&field_name=eq.${encodeURIComponent(fieldName)}&lifecycle=neq.retired&select=id&limit=1`,
      )

      if (existing.length > 0)
        return fail(
          `${model.value.name} already has a field called ${fieldName}. Ask for another label.`,
        )

      if (input.type === 'category' && adding && !choices?.length)
        return fail(
          'A category field needs its choices; ask the person for them.',
        )

      if (choices?.length && input.type !== 'category')
        return fail('Only a category field has choices.')

      const changes: ProposalChange[] = [
        { label: 'Field', before: null, after: input.label.trim() },
        { label: 'Holds', before: null, after: logicalTypeWords(input.type) },
        {
          label: 'Required',
          before: null,
          after: input.required ? 'Yes' : 'No',
        },
        {
          label: 'Switched on',
          before: null,
          after: adding ? 'Yes, straight away' : 'No, a draft',
        },
      ]

      if (choices?.length)
        changes.push({
          label: 'Choices',
          before: null,
          after: choices.join(', '),
        })

      if (input.unit)
        changes.push({ label: 'Unit', before: null, after: input.unit })

      const common = {
        workspaceId,
        modelKey: model.value.key,
        fieldName,
        label: input.label.trim(),
        logicalType: input.type,
        nullable: !input.required,
        description: input.description ?? null,
        unit: input.unit ? { symbol: input.unit } : null,
      }

      return card(
        name,
        input,
        `${model.value.name} · Record type`,
        modelLink(model.value.key),
        changes,
        adding
          ? {
              kind: 'model_field.add',
              ...common,
              options: choices?.length
                ? choices.map((choice) => ({
                    key: keyFromName(choice),
                    label: choice.trim(),
                  }))
                : null,
            }
          : { kind: 'model_field.draft', ...common },
      )
    }

    case MODEL_FIELD_ACTIVATE_TOOL: {
      const parsed = proposeModelFieldActivateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      const field = await findFieldOf(
        client,
        model.value.key,
        input.field,
        'draft',
      )

      if (!field.ok) return fail(field.message)

      return card(
        name,
        input,
        `${field.value.label} · ${model.value.name}`,
        modelLink(model.value.key),
        [{ label: 'Status', before: 'Draft', after: 'Switched on' }],
        {
          kind: 'model_field.activate',
          fieldId: field.value.id,
          modelKey: model.value.key,
        },
      )
    }

    case MODEL_FIELD_UPDATE_TOOL: {
      const parsed = proposeModelFieldUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)
      const field = await findFieldOf(client, model.value.key, input.field)

      if (!field.ok) return fail(field.message)

      const patch: Record<string, string | boolean | { symbol: string }> = {}
      const changes: ProposalChange[] = []

      if (input.label) {
        patch.label = input.label.trim()
        changes.push({
          label: 'Label',
          before: field.value.label,
          after: input.label.trim(),
        })
      }

      if (input.description !== undefined) {
        patch.description = input.description
        changes.push({
          label: 'Description',
          before: null,
          after: input.description,
        })
      }

      if (input.section !== undefined) {
        patch.section = input.section
        changes.push({ label: 'Group', before: null, after: input.section })
      }

      if (input.showInList !== undefined) {
        patch.show_in_list = input.showInList
        changes.push({
          label: 'Shows in lists',
          before: null,
          after: input.showInList ? 'Yes' : 'No',
        })
      }

      if (input.unit) {
        patch.unit = { symbol: input.unit }
        changes.push({ label: 'Unit', before: null, after: input.unit })
      }

      if (changes.length === 0)
        return fail('Ask the person what to change on the field.')

      return card(
        name,
        input,
        `${field.value.label} · ${model.value.name}`,
        modelLink(model.value.key),
        changes,
        {
          kind: 'model_field.update',
          fieldId: field.value.id,
          modelKey: model.value.key,
          patch,
        },
      )
    }

    case MODEL_FIELD_SEMANTICS_TOOL: {
      const parsed = proposeModelFieldSemanticsSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.quantity &&
        !input.unit &&
        !input.cardinality &&
        !input.targetModel
      )
        return fail('Ask the person what the field measures or points at.')
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      const field = await findFieldOf(
        client,
        model.value.key,
        input.field,
        'draft',
      )

      if (!field.ok) return fail(field.message)

      const target = input.targetModel
        ? await findModelNamed(client, input.targetModel)
        : null

      if (target && !target.ok) return fail(target.message)
      const changes: ProposalChange[] = []

      if (input.quantity || input.unit)
        changes.push({
          label: 'Measures',
          before: null,
          after: [input.quantity, input.unit ? `in ${input.unit}` : null]
            .filter(Boolean)
            .join(' '),
        })

      if (input.cardinality)
        changes.push({
          label: 'Values',
          before: null,
          after: input.cardinality === 'many' ? 'Many' : 'One',
        })

      if (target?.ok)
        changes.push({
          label: 'Points at',
          before: null,
          after: target.value.name,
        })

      return card(
        name,
        input,
        `${field.value.label} · ${model.value.name}`,
        modelLink(model.value.key),
        changes,
        {
          kind: 'model_field.semantics',
          fieldId: field.value.id,
          modelKey: model.value.key,
          quantity:
            input.quantity || input.unit
              ? { kind: input.quantity ?? 'quantity', unit: input.unit ?? null }
              : null,
          cardinality: input.cardinality ?? null,
          relationship: target?.ok
            ? { targetModelKey: target.value.key }
            : null,
        },
      )
    }

    case MODEL_FIELD_EVOLVE_TOOL: {
      const parsed = proposeModelFieldEvolveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      const field = await findFieldOf(
        client,
        model.value.key,
        input.field,
        'active',
      )

      if (!field.ok) return fail(field.message)

      const patch: Record<string, string | boolean> = {}
      const changes: ProposalChange[] = []

      if (input.action === 'retire') {
        changes.push({ label: 'Status', before: 'In use', after: 'Retired' })
      } else {
        if (input.label) {
          patch.label = input.label.trim()
          changes.push({
            label: 'Label',
            before: field.value.label,
            after: input.label.trim(),
          })
        }

        if (input.required !== undefined) {
          patch.nullable = !input.required
          changes.push({
            label: 'Required',
            before: null,
            after: input.required ? 'Yes' : 'No',
          })
        }

        if (input.description !== undefined) {
          patch.description = input.description
          changes.push({
            label: 'Description',
            before: null,
            after: input.description,
          })
        }

        if (changes.length === 0)
          return fail('Ask the person what to change on the field.')
      }

      const preview = await client.rpc<{
        classification: string
        reason: string | null
        blocked: boolean
      }>('preview_model_field_evolution', {
        p_definition_id: field.value.id,
        p_action: input.action,
        p_patch: input.action === 'update' ? patch : null,
      })

      if (preview.blocked)
        return fail(
          `That change would break data, so it cannot be made${preview.reason ? `: ${preview.reason}` : ''}.`,
        )

      const confirm = preview.classification !== 'safe'

      if (confirm)
        changes.push({
          label: 'Check',
          before: null,
          after:
            preview.reason ??
            'Records use this field; pressing the button confirms the change.',
        })

      return card(
        name,
        input,
        `${field.value.label} · ${model.value.name}`,
        modelLink(model.value.key),
        changes,
        {
          kind: 'model_field.evolve',
          fieldId: field.value.id,
          modelKey: model.value.key,
          action: input.action,
          patch: input.action === 'update' ? patch : null,
          confirm,
        },
      )
    }

    case MODEL_FIELD_PLUGIN_TOOL: {
      const parsed = proposeModelFieldPluginSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (Boolean(input.plugin) !== Boolean(input.typeId))
        return fail(
          'Give both the plugin and its field type, or neither to take the type away.',
        )
      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)
      const field = await findFieldOf(client, model.value.key, input.field)

      if (!field.ok) return fail(field.message)

      return card(
        name,
        input,
        `${field.value.label} · ${model.value.name}`,
        modelLink(model.value.key),
        [
          {
            label: 'Plugin type',
            before: null,
            after: input.plugin ? `${input.plugin} · ${input.typeId}` : 'None',
          },
        ],
        {
          kind: 'model_field.plugin_type',
          modelKey: model.value.key,
          fieldName: field.value.field_name,
          pluginKey: input.plugin ?? null,
          typeId: input.typeId ?? null,
        },
      )
    }

    case MODEL_FIELD_PROMOTE_TOOL: {
      const parsed = proposeModelFieldPromoteSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const sheet = await find<{
        id: string
        name: string
        display_id: string | null
        revision: number
        state: { localFields?: { fieldId: string; label: string }[] } | null
      }>(client, input.sheet, {
        table: 'sheet_instances',
        match: ['name', 'display_id'],
        select: 'id,name,display_id,revision,state',
        what: 'sheet',
        extra: '&lifecycle=neq.archived',
        order: 'updated_at.desc',
        label: (row) =>
          row.display_id ? `${row.display_id} · ${row.name}` : row.name,
        names: (row) => [row.name, row.display_id],
      })

      if (!sheet.ok) return fail(sheet.message)
      const locals = sheet.value.state?.localFields ?? []

      const column = locals.filter((local) =>
        squash(local.label).includes(squash(input.column)),
      )

      const exact = column.filter(
        (local) => squash(local.label) === squash(input.column),
      )

      const chosen =
        exact.length === 1 ? exact[0] : column.length === 1 ? column[0] : null

      if (!chosen)
        return fail(
          column.length === 0
            ? `${sheet.value.name} has no column of its own called "${input.column}".`
            : `More than one column matches "${input.column}": ${column.map((local) => local.label).join(', ')}. Ask which.`,
        )

      const model = await findModelNamed(client, input.model)

      if (!model.ok) return fail(model.message)

      // The database says whether this is allowed, and what it would do.
      await client.rpc('preview_local_field_promotion', {
        p_instance_id: sheet.value.id,
        p_field_id: chosen.fieldId,
        p_target: 'model_field',
        p_schema_definition_id: null,
        p_model_key: model.value.key,
      })

      return card(
        name,
        input,
        `${sheet.value.display_id ?? sheet.value.name} · Sheet`,
        `/sheets/${sheet.value.id}`,
        [
          {
            label: 'Makes a field',
            before: null,
            after: `${chosen.label} on ${model.value.name}`,
          },
          {
            label: 'The sheet',
            before: 'Its own column',
            after: 'Uses the shared field',
          },
        ],
        {
          kind: 'model_field.promote',
          instanceId: sheet.value.id,
          fieldId: chosen.fieldId,
          modelKey: model.value.key,
          revision: sheet.value.revision,
          idempotencyKey: `assistant-${sheet.value.id}-${chosen.fieldId}-${sheet.value.revision}`,
        },
      )
    }

    case RECORD_SET_TYPE_TOOL: {
      const parsed = proposeRecordSetTypeSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const host = input.host ?? 'record'

      const item: Lookup<{ id: string; label: string; link: string }> =
        host === 'record'
          ? await (async () => {
              const record = await findRecordOf(client, input.item, 'record', [
                'material',
                'sample',
                'protocol',
                'experiment',
                'study',
                'incident',
              ])

              return record.ok
                ? {
                    ok: true as const,
                    value: {
                      id: record.value.id,
                      label: `${record.value.identifier} · ${record.value.title}`,
                      link: `/records/${record.value.id}`,
                    },
                  }
                : record
            })()
          : host === 'project'
            ? await (async () => {
                const project = await findProject(client, input.item)

                return project.ok
                  ? {
                      ok: true as const,
                      value: {
                        id: project.value.id,
                        label: project.value.title,
                        link: `/projects/${project.value.id}`,
                      },
                    }
                  : project
              })()
            : await find<{
                id: string
                name: string
                display_id: string | null
              }>(client, input.item, {
                table: 'instruments',
                match: ['name', 'display_id'],
                select: 'id,name,display_id',
                what: 'instrument',
                label: (row) => row.name,
                names: (row) => [row.name, row.display_id],
              }).then(
                (found): Lookup<{ id: string; label: string; link: string }> =>
                  found.ok
                    ? {
                        ok: true,
                        value: {
                          id: found.value.id,
                          label: found.value.name,
                          link: `/instruments/${found.value.id}`,
                        },
                      }
                    : found,
              )

      if (!item.ok) return fail(item.message)
      const model = await findModelNamed(client, input.type)

      if (!model.ok) return fail(model.message)
      const defs = await fetchModelFields(client, model.value.key)
      const active = defs.filter((def) => def.lifecycle === 'active')
      const customFields: Record<string, string | number | boolean> = {}

      const changes: ProposalChange[] = [
        { label: 'Type', before: null, after: model.value.name },
      ]

      for (const [wanted, value] of Object.entries(input.fields ?? {})) {
        const def = active.find(
          (each) =>
            squash(each.label) === squash(wanted) ||
            squash(each.fieldName) === squash(wanted),
        )

        if (!def)
          return fail(
            `${model.value.name} has no field "${wanted}". Its fields: ${active.map((each) => each.label).join(', ')}.`,
          )
        customFields[def.fieldName] = value
        changes.push({ label: def.label, before: null, after: String(value) })
      }

      return card(name, input, item.value.label, item.value.link, changes, {
        kind: 'record.set_type',
        host: host === 'record' ? 'records' : host,
        id: item.value.id,
        modelKey: model.value.key,
        customFields,
      })
    }

    case REGISTRY_REMOVE_PARENT_TOOL: {
      const parsed = proposeRegistryRemoveParentSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const registryKinds = await client.list<{ key: string }>(
        'record_models',
        '?is_registry=eq.true&select=key&limit=200',
      )

      const kinds = registryKinds.map((row) => row.key)

      if (kinds.length === 0) return fail('The lab has no registries.')

      const entry = await findRecordOf(
        client,
        input.entry,
        'registry entry',
        kinds,
      )

      if (!entry.ok) return fail(entry.message)

      const parent = await findRecordOf(
        client,
        input.parent,
        'parent entry',
        kinds,
      )

      if (!parent.ok) return fail(parent.message)

      return card(
        name,
        input,
        `${entry.value.identifier} · ${entry.value.title}`,
        `/records/${entry.value.id}`,
        [
          {
            label: 'Parent removed',
            before: `${parent.value.identifier} · ${parent.value.title}`,
            after: 'None',
          },
        ],
        {
          kind: 'registry.remove_parent',
          entryId: entry.value.id,
          parentId: parent.value.id,
        },
      )
    }
  }
}

export type { ModelsAction }
