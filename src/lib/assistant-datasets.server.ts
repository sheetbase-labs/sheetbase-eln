import {
  DATASETS_PROPOSE_TOOL_NAMES,
  DATASET_CLEAR_FLAG_TOOL,
  DATASET_FLAG_TOOL,
  DATASET_KEEP_TOOL,
  DATASET_PLAN_TOOL,
  DATASET_UNIT_TOOL,
  DATASET_UPGRADE_TOOL,
  DATASET_USE_TOOL,
  INTAKE_RESOLVE_TOOL,
  TABLE_CREATE_TOOL,
  TABLE_DISCARD_TOOL,
  TABLE_EDIT_TOOL,
  TABLE_PUBLISH_TOOL,
  TABLE_RESTORE_TOOL,
  TABLE_RETIRE_TOOL,
  keyFromLabel,
  proposeDatasetClearFlagSchema,
  proposeDatasetFlagSchema,
  proposeDatasetKeepSchema,
  proposeDatasetPlanSchema,
  proposeDatasetUnitSchema,
  proposeDatasetUpgradeSchema,
  proposeDatasetUseSchema,
  proposeIntakeResolveSchema,
  proposeTableCreateSchema,
  proposeTableDiscardSchema,
  proposeTableEditSchema,
  proposeTablePublishSchema,
  proposeTableRestoreSchema,
  proposeTableRetireSchema,
} from './assistant-datasets'
import type {
  DatasetsAction,
  DatasetsProposeToolName,
  TableField,
} from './assistant-datasets'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for datasets and measurement tables (see `assistant-datasets.ts`).
 * Each builder finds what the person named under their own access, checks
 * what it can, and returns a card saying exactly what will change. Nothing is
 * written here.
 */

export type DatasetsOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isDatasetsProposalTool(
  name: string,
): name is DatasetsProposeToolName {
  return (DATASETS_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function datasetsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      TABLE_CREATE_TOOL,
      `Propose a new measurement table: the columns a kind of dataset is made of. It starts as a draft; publish it before datasets use it. Needs schema editing rights. ${NOTE}`,
      proposeTableCreateSchema,
    ),
    toolDef(
      TABLE_EDIT_TOOL,
      `Propose adding or taking out columns of a measurement table. A published table gets a new draft version with the change; publish it after. List the measurement_tables area first for the name. ${NOTE}`,
      proposeTableEditSchema,
    ),
    toolDef(
      TABLE_PUBLISH_TOOL,
      `Propose publishing a measurement table’s draft version so datasets can use it. Needs publishing rights; where the lab asks for approval, a person approves it first. ${NOTE}`,
      proposeTablePublishSchema,
    ),
    toolDef(
      TABLE_DISCARD_TOOL,
      `Propose throwing away a measurement table’s unpublished draft version. Only propose it when the person clearly asked. ${NOTE}`,
      proposeTableDiscardSchema,
    ),
    toolDef(
      TABLE_RETIRE_TOOL,
      `Propose retiring a measurement table so no new datasets use it. Datasets that use it keep their data. ${NOTE}`,
      proposeTableRetireSchema,
    ),
    toolDef(
      TABLE_RESTORE_TOOL,
      `Propose bringing back a retired measurement table. ${NOTE}`,
      proposeTableRestoreSchema,
    ),
    toolDef(
      DATASET_UPGRADE_TOOL,
      `Propose moving a dataset onto the latest published version of its measurement table, carrying its values across. ${NOTE}`,
      proposeDatasetUpgradeSchema,
    ),
    toolDef(
      DATASET_FLAG_TOOL,
      `Propose flagging one value in a dataset as out of range, missing a unit, above the curve or a high CV, with a reason. Read the dataset’s rows first for the rowId. ${NOTE}`,
      proposeDatasetFlagSchema,
    ),
    toolDef(
      DATASET_CLEAR_FLAG_TOOL,
      `Propose clearing an open flag on a dataset value. List the dataset_flags area first. ${NOTE}`,
      proposeDatasetClearFlagSchema,
    ),
    toolDef(
      DATASET_UNIT_TOOL,
      `Propose setting the unit of a dataset column, with a reason. Needs publishing rights. ${NOTE}`,
      proposeDatasetUnitSchema,
    ),
    toolDef(
      DATASET_USE_TOOL,
      `Propose setting what a dataset is for: exploratory research, controlled development or a regulated record, with a reason. Needs publishing rights. ${NOTE}`,
      proposeDatasetUseSchema,
    ),
    toolDef(
      DATASET_KEEP_TOOL,
      `Propose keeping a dataset snapshot so it is not pruned, with a reason. ${NOTE}`,
      proposeDatasetKeepSchema,
    ),
    toolDef(
      DATASET_PLAN_TOOL,
      `Propose adding planned rows to a dataset: rows waiting for their measurement, one per sample or timepoint. ${NOTE}`,
      proposeDatasetPlanSchema,
    ),
    toolDef(
      INTAKE_RESOLVE_TOOL,
      `Propose closing a problem bringing an instrument or uploaded file in: resolved when it came in after all, or dismissed. List the intake_problems area first. ${NOTE}`,
      proposeIntakeResolveSchema,
    ),
  ]
}

const fail = (message: string): DatasetsOutcome => ({ ok: false, message })

interface DefinitionRow {
  id: string
  key: string
  name: string
  lifecycle: string
  display_id: string | null
}

interface VersionRow {
  id: string
  version: number
  lifecycle: string
  revision: number
}

interface DatasetRow {
  id: string
  name: string
  display_id: string | null
  schema_version_id: string
  revision: number
  lifecycle: string
  intended_use: string | null
}

async function findTable(
  context: LabToolContext,
  text: string,
): Promise<Lookup<DefinitionRow>> {
  const like = likeValue(text)
  const rows = await context.client.list<DefinitionRow>(
    'dataset_schema_definitions',
    `?or=(name.ilike.${like},key.ilike.${like},display_id.ilike.${like})&select=id,key,name,lifecycle,display_id&order=name.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'measurement table',
    (row) => row.name,
    (row) =>
      row.name.toLowerCase() === lower ||
      row.key === lower ||
      row.display_id?.toLowerCase() === lower,
  )
}

async function findDataset(
  context: LabToolContext,
  text: string,
): Promise<Lookup<DatasetRow>> {
  const like = likeValue(text)
  const rows = await context.client.list<DatasetRow>(
    'datasets',
    `?or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id,schema_version_id,revision,lifecycle,intended_use&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'dataset',
    datasetLabel,
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )
}

const datasetLabel = (row: { name: string; display_id: string | null }) =>
  row.display_id ? `${row.display_id} ${row.name}` : row.name

async function versionsOf(
  context: LabToolContext,
  definitionId: string,
): Promise<VersionRow[]> {
  return context.client.list<VersionRow>(
    'dataset_schema_versions',
    `?schema_id=eq.${encodeURIComponent(definitionId)}&select=id,version,lifecycle,revision&order=version.desc`,
  )
}

async function fieldsOf(
  context: LabToolContext,
  versionId: string,
): Promise<TableField[]> {
  return context.client.list<TableField>(
    'dataset_schema_version_fields',
    `?schema_version_id=eq.${encodeURIComponent(versionId)}&select=field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order&order=display_order.asc`,
  )
}

/** The dataset's columns, so a person can name one by its label. */
async function datasetField(
  context: LabToolContext,
  data: DatasetRow,
  label: string,
): Promise<Lookup<TableField>> {
  const fields = (await fieldsOf(context, data.schema_version_id)).filter(
    (field) => field.lifecycle !== 'retired',
  )
  const lower = label.trim().toLowerCase()
  const matches = fields.filter(
    (field) => field.label.toLowerCase().includes(lower) || field.key === lower,
  )
  return pick(
    matches,
    label,
    `column of ${data.name}`,
    (field) => field.label,
    (field) => field.label.toLowerCase() === lower || field.key === lower,
  )
}

function newFields(
  specs: ReadonlyArray<{
    label: string
    type: string
    required?: boolean
    description?: string
  }>,
  taken: Set<string>,
): TableField[] {
  return specs.map((spec) => {
    const key = keyFromLabel(spec.label, taken)
    taken.add(key)
    return {
      field_id: null,
      key,
      label: spec.label.trim(),
      description: spec.description ?? null,
      logical_type: spec.type,
      nullable: spec.required !== true,
    }
  })
}

const tableHref = (row: { id: string }) => `/models/${row.id}`
const datasetHref = (row: { id: string }) => `/datasets/${row.id}`

function card(
  name: DatasetsProposeToolName,
  input: { title: string; summary: string },
  target: string,
  deepLink: string,
  changes: ProposalChange[],
  action: DatasetsAction,
): DatasetsOutcome {
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

export async function buildDatasetsProposal(
  name: DatasetsProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<DatasetsOutcome> {
  switch (name) {
    case TABLE_CREATE_TOOL: {
      const parsed = proposeTableCreateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      let parent: DefinitionRow | null = null
      if (input.extends) {
        const found = await findTable(context, input.extends)
        if (!found.ok) return fail(found.message)
        parent = found.value
      }
      const existing = await context.client.list<{ key: string }>(
        'dataset_schema_definitions',
        '?select=key&limit=1000',
      )
      const key = keyFromLabel(
        input.name,
        new Set(existing.map((row) => row.key)),
      )
      const fields = newFields(input.fields, new Set())
      if (!parent && fields.length === 0)
        return fail('Ask the person which columns the table should have.')
      const changes: ProposalChange[] = [
        { label: 'Measurement table', before: null, after: input.name.trim() },
      ]
      if (parent)
        changes.push({ label: 'Builds on', before: null, after: parent.name })
      for (const field of fields)
        changes.push({
          label: 'Column',
          before: null,
          after: `${field.label} (${field.logical_type}${field.nullable ? '' : ', required'})`,
        })
      changes.push({ label: 'Status', before: null, after: 'Draft' })
      return card(name, input, 'Models', '/models', changes, {
        kind: 'measurement_table.create',
        workspaceId: context.workspaceId,
        key,
        name: input.name.trim(),
        description: input.description ?? null,
        parentId: parent?.id ?? null,
        fields,
      })
    }

    case TABLE_EDIT_TOOL: {
      const parsed = proposeTableEditSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      if (!input.add?.length && !input.remove?.length)
        return fail('Ask the person which columns to add or take out.')
      const found = await findTable(context, input.table)
      if (!found.ok) return fail(found.message)
      const definition = found.value
      if (definition.lifecycle === 'retired')
        return fail(`${definition.name} is retired. Bring it back first.`)
      const latest = (await versionsOf(context, definition.id)).at(0)
      if (!latest) return fail(`${definition.name} has no versions yet.`)
      const current = await fieldsOf(context, latest.id)
      const changes: ProposalChange[] = []
      const removed = new Set<string>()
      for (const label of input.remove ?? []) {
        const lower = label.trim().toLowerCase()
        const field = current.find(
          (row) => row.label.toLowerCase() === lower || row.key === lower,
        )
        if (!field)
          return fail(
            `${definition.name} has no column called "${label}". Its columns are ${current.map((row) => row.label).join(', ')}.`,
          )
        removed.add(field.key)
        changes.push({
          label: 'Column',
          before: field.label,
          after: 'Taken out',
        })
      }
      const added = newFields(
        input.add ?? [],
        new Set(current.map((row) => row.key)),
      )
      for (const field of added)
        changes.push({
          label: 'Column',
          before: null,
          after: `${field.label} (${field.logical_type})`,
        })
      const isDraft = latest.lifecycle === 'draft'
      changes.push({
        label: 'Version',
        before: `v${latest.version}${isDraft ? ' draft' : ''}`,
        after: isDraft
          ? `v${latest.version} draft`
          : `v${latest.version + 1} draft`,
      })
      return card(
        name,
        input,
        `${definition.name} · Models`,
        tableHref(definition),
        changes,
        {
          kind: 'measurement_table.edit',
          definitionId: definition.id,
          draftVersionId: isDraft ? latest.id : null,
          expectedRevision: isDraft ? latest.revision : null,
          fields: [...current.filter((row) => !removed.has(row.key)), ...added],
        },
      )
    }

    case TABLE_PUBLISH_TOOL:
    case TABLE_DISCARD_TOOL: {
      const parsed = proposeTablePublishSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTable(context, input.table)
      if (!found.ok) return fail(found.message)
      const definition = found.value
      const draft = (await versionsOf(context, definition.id)).find(
        (row) => row.lifecycle === 'draft',
      )
      if (!draft)
        return fail(
          `${definition.name} has no draft version to ${name === TABLE_PUBLISH_TOOL ? 'publish' : 'discard'}.`,
        )
      const publish = name === TABLE_PUBLISH_TOOL
      return card(
        name,
        input,
        `${definition.name} · Models`,
        tableHref(definition),
        [
          {
            label: `Version ${draft.version}`,
            before: 'Draft',
            after: publish ? 'Published' : 'Discarded',
          },
        ],
        publish
          ? {
              kind: 'measurement_table.publish',
              definitionId: definition.id,
              versionId: draft.id,
            }
          : {
              kind: 'measurement_table.discard_draft',
              definitionId: definition.id,
              versionId: draft.id,
            },
      )
    }

    case TABLE_RETIRE_TOOL:
    case TABLE_RESTORE_TOOL: {
      const parsed = proposeTableRetireSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTable(context, input.table)
      if (!found.ok) return fail(found.message)
      const definition = found.value
      const retire = name === TABLE_RETIRE_TOOL
      if (retire && definition.lifecycle === 'retired')
        return fail(`${definition.name} is already retired.`)
      if (!retire && definition.lifecycle !== 'retired')
        return fail(`${definition.name} is not retired.`)
      return card(
        name,
        input,
        `${definition.name} · Models`,
        tableHref(definition),
        [
          {
            label: 'Status',
            before: definition.lifecycle,
            after: retire ? 'retired' : 'in use again',
          },
        ],
        retire
          ? { kind: 'measurement_table.retire', definitionId: definition.id }
          : { kind: 'measurement_table.restore', definitionId: definition.id },
      )
    }

    case DATASET_UPGRADE_TOOL: {
      const parsed = proposeDatasetUpgradeSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const bound = (
        await context.client.list<{
          id: string
          schema_id: string
          version: number
        }>(
          'dataset_schema_versions',
          `?id=eq.${encodeURIComponent(data.schema_version_id)}&select=id,schema_id,version`,
        )
      ).at(0)
      if (!bound) return fail(`${data.name} has no measurement table.`)
      const latest = (await versionsOf(context, bound.schema_id)).find(
        (row) => row.lifecycle === 'active',
      )
      if (!latest || latest.id === bound.id)
        return fail(
          `${data.name} already uses the latest published version of its measurement table.`,
        )
      const preview = await context.client.rpc<{
        blocked?: boolean
        reasons?: unknown
      }>('preview_dataset_model_upgrade', {
        p_dataset_id: data.id,
        p_target_version_id: latest.id,
      })
      if (preview.blocked)
        return fail(
          `${data.name} cannot move yet: ${JSON.stringify(preview.reasons ?? preview)}`,
        )
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        [
          {
            label: 'Measurement table',
            before: `v${bound.version}`,
            after: `v${latest.version}`,
          },
        ],
        {
          kind: 'dataset.upgrade_table',
          datasetId: data.id,
          targetVersionId: latest.id,
          expectedRevision: data.revision,
        },
      )
    }

    case DATASET_FLAG_TOOL: {
      const parsed = proposeDatasetFlagSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const field = await datasetField(context, data, input.field)
      if (!field.ok) return fail(field.message)
      if (!field.value.field_id) return fail('That column has no id yet.')
      const rows = await context.client.list<{ id: string }>(
        'dataset_rows',
        `?id=eq.${encodeURIComponent(input.rowId)}&dataset_id=eq.${encodeURIComponent(data.id)}&select=id`,
      )
      if (rows.length === 0)
        return fail(`That row is not in ${data.name}. Read its rows again.`)
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        [
          {
            label: field.value.label,
            before: null,
            after: `${input.kind.replaceAll('_', ' ')}: ${input.reason}`,
          },
        ],
        {
          kind: 'dataset.flag_value',
          datasetId: data.id,
          rowId: input.rowId,
          fieldId: field.value.field_id,
          flagKind: input.kind,
          reason: input.reason,
          comment: input.comment ?? null,
        },
      )
    }

    case DATASET_CLEAR_FLAG_TOOL: {
      const parsed = proposeDatasetClearFlagSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      let filter = `?dataset_id=eq.${encodeURIComponent(data.id)}&cleared_at=is.null`
      let fieldLabel: string | null = null
      if (input.field) {
        const field = await datasetField(context, data, input.field)
        if (!field.ok) return fail(field.message)
        fieldLabel = field.value.label
        filter += `&field_id=eq.${encodeURIComponent(field.value.field_id ?? '')}`
      }
      if (input.rowId) filter += `&row_id=eq.${encodeURIComponent(input.rowId)}`
      const flags = await context.client.list<{
        id: string
        kind: string
        reason: string
      }>('dataset_value_flags', `${filter}&select=id,kind,reason&limit=6`)
      if (flags.length === 0)
        return fail(`No open flag on ${data.name} matches.`)
      if (flags.length > 1)
        return fail(
          `${data.name} has ${flags.length} open flags that match: ${flags.map((flag) => `${flag.kind} (${flag.reason})`).join(', ')}. Ask which row, or give the rowId.`,
        )
      const flag = flags[0]
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        [
          {
            label: fieldLabel ?? 'Flag',
            before: `${flag.kind.replaceAll('_', ' ')}: ${flag.reason}`,
            after: 'Cleared',
          },
        ],
        {
          kind: 'dataset.clear_flag',
          datasetId: data.id,
          flagId: flag.id,
          reason: input.reason ?? null,
        },
      )
    }

    case DATASET_UNIT_TOOL: {
      const parsed = proposeDatasetUnitSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const field = await datasetField(context, data, input.field)
      if (!field.ok) return fail(field.message)
      const before = (field.value.quantity as { unit?: string } | null)?.unit
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        [
          {
            label: `${field.value.label} unit`,
            before: before ?? null,
            after: input.unit,
          },
        ],
        {
          kind: 'dataset.set_unit',
          datasetId: data.id,
          fieldKey: field.value.key,
          unit: input.unit,
          reason: input.reason,
        },
      )
    }

    case DATASET_USE_TOOL: {
      const parsed = proposeDatasetUseSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const words = (use: string | null) => use?.replaceAll('_', ' ') ?? null
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        [
          {
            label: 'Intended use',
            before: words(data.intended_use),
            after: words(input.use) ?? input.use,
          },
        ],
        {
          kind: 'dataset.set_intended_use',
          datasetId: data.id,
          use: input.use,
          reason: input.reason,
        },
      )
    }

    case DATASET_KEEP_TOOL: {
      const parsed = proposeDatasetKeepSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const snapshots = await context.client.list<{
        id: string
        label: string | null
        created_at: string
      }>(
        'dataset_versions',
        `?dataset_id=eq.${encodeURIComponent(data.id)}${input.snapshot ? `&label=ilike.${likeValue(input.snapshot)}` : ''}&select=id,label,created_at&order=created_at.desc&limit=6`,
      )
      const snapshot = input.snapshot
        ? pick(
            snapshots,
            input.snapshot,
            'snapshot',
            (row) => row.label ?? row.created_at.slice(0, 10),
            (row) => row.label?.toLowerCase() === input.snapshot?.toLowerCase(),
          )
        : snapshots.length > 0
          ? ({ ok: true, value: snapshots[0] } as const)
          : ({
              ok: false,
              message: `${data.name} has no snapshots yet.`,
            } as const)
      if (!snapshot.ok) return fail(snapshot.message)
      return card(
        name,
        input,
        `${datasetLabel(data)} · Snapshots`,
        `/datasets/${data.id}/snapshots`,
        [
          {
            label:
              snapshot.value.label ?? snapshot.value.created_at.slice(0, 10),
            before: null,
            after: `Kept: ${input.reason}`,
          },
        ],
        {
          kind: 'dataset.keep_snapshot',
          datasetId: data.id,
          versionId: snapshot.value.id,
          reason: input.reason,
        },
      )
    }

    case DATASET_PLAN_TOOL: {
      const parsed = proposeDatasetPlanSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findDataset(context, input.dataset)
      if (!found.ok) return fail(found.message)
      const data = found.value
      const keys = [...new Set(input.rows.map((row) => row.trim()))]
      return card(
        name,
        input,
        `${datasetLabel(data)} · Datasets`,
        datasetHref(data),
        keys.map((key) => ({
          label: 'Planned row',
          before: null,
          after: input.dueOn ? `${key}, due ${input.dueOn}` : key,
        })),
        {
          kind: 'dataset.plan_rows',
          datasetId: data.id,
          keys,
          scheduledAt: input.dueOn ? `${input.dueOn}T12:00:00Z` : null,
        },
      )
    }

    case INTAKE_RESOLVE_TOOL: {
      const parsed = proposeIntakeResolveSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const rows = await context.client.list<{
        id: string
        file_name: string
        code: string
        message: string
      }>(
        'intake_failures',
        `?status=eq.open&file_name=ilike.${likeValue(input.file)}&select=id,file_name,code,message&order=last_attempt_at.desc&limit=6`,
      )
      const lower = input.file.trim().toLowerCase()
      const found = pick(
        rows,
        input.file,
        'open intake problem',
        (row) => row.file_name,
        (row) => row.file_name.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      return card(
        name,
        input,
        `${found.value.file_name} · Instruments`,
        '/instruments',
        [
          {
            label: found.value.file_name,
            before: found.value.message,
            after: input.resolution,
          },
        ],
        {
          kind: 'intake.resolve',
          failureId: found.value.id,
          resolution: input.resolution,
        },
      )
    }
  }
}
