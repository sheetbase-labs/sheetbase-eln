import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { findModel, findProject } from '#/lib/assistant-labwork.server'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'
import { fetchModelFields } from '#/lib/model-fields'

import type { FeatureProposalOutcome } from '../define.server'
import {
  MATERIAL_ADD_LOT_TOOL,
  RECORDS_PROPOSE_TOOL_NAMES,
  RECORD_ARCHIVE_TOOL,
  RECORD_CREATE_TOOL,
  RECORD_LINK_TOOL,
  RECORD_RESTORE_TOOL,
  proposeMaterialLotSchema,
  proposeRecordCreateSchema,
  proposeRecordLinkSchema,
  proposeRecordStateSchema,
} from './cards'
import type { RecordsAction, RecordsProposeToolName } from './cards'

/**
 * The record cards (see `cards.ts`). Each builder finds what the model named
 * under the signed-in person's own access and returns a card that says
 * exactly what will change. Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isRecordsProposalTool(
  name: string,
): name is RecordsProposeToolName {
  return RECORDS_PROPOSE_TOOL_NAMES.includes(name)
}

export function recordsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      RECORD_CREATE_TOOL,
      `Propose adding a new record: a material or reagent (a standard, a stock, a buffer, a consumable) or a record of a type the lab has defined. Give its fields by label, such as Supplier, Catalog no, Lot, Expiry, Quantity, Unit and Storage for a material. Use this to add things that are not in the lab yet; ordering more of an existing material is a different tool. ${NOTE}`,
      proposeRecordCreateSchema,
    ),
    toolDef(
      RECORD_ARCHIVE_TOOL,
      `Propose archiving a record, which hides it from everyday lists. Nothing is deleted and it can be restored. ${NOTE}`,
      proposeRecordStateSchema,
    ),
    toolDef(
      RECORD_RESTORE_TOOL,
      `Propose bringing an archived record back. ${NOTE}`,
      proposeRecordStateSchema,
    ),
    toolDef(
      RECORD_LINK_TOOL,
      `Propose linking one record to another, for example a sample to the material it came from. ${NOTE}`,
      proposeRecordLinkSchema,
    ),
    toolDef(
      MATERIAL_ADD_LOT_TOOL,
      `Propose registering a new lot of a material that is already in the lab, with its lot number, expiry and quantity. To add a material that is not in the lab yet, use the record tool. ${NOTE}`,
      proposeMaterialLotSchema,
    ),
  ]
}

const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

/** The standard material fields live in `properties`, under these names. */
const MATERIAL_PROPERTIES = new Set([
  'supplier',
  'catalog_no',
  'lot',
  'expiry',
  'quantity',
  'unit',
  'storage',
  'low_stock_threshold',
  'expiry_warning_days',
])

const MATERIAL_ALIASES = new Map(
  Object.entries({
    supplier: 'supplier',
    vendor: 'supplier',
    catalogno: 'catalog_no',
    catalognumber: 'catalog_no',
    catalogueno: 'catalog_no',
    cataloguenumber: 'catalog_no',
    catno: 'catalog_no',
    lot: 'lot',
    lotnumber: 'lot',
    expiry: 'expiry',
    expirydate: 'expiry',
    quantity: 'quantity',
    amount: 'quantity',
    unit: 'unit',
    storage: 'storage',
    storagecondition: 'storage',
    lowstockthreshold: 'low_stock_threshold',
    expirywarningdays: 'expiry_warning_days',
  }),
)

const squash = (text: string): string =>
  text.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

interface ModelTarget {
  key: string
  name: string
  builtIn: boolean
}

async function resolveKind(
  client: DataClient,
  wanted: string,
): Promise<Lookup<ModelTarget>> {
  const squashed = squash(wanted)

  if (['material', 'materials', 'reagent', 'reagents'].includes(squashed)) {
    return {
      ok: true,
      value: { key: 'material', name: 'Material', builtIn: true },
    }
  }

  if (
    ['experiment', 'sample', 'protocol', 'project', 'instrument'].includes(
      squashed.replace(/s$/, ''),
    )
  ) {
    return {
      ok: false,
      message: `${wanted} has a card of its own (start an experiment, receive a sample, add an instrument, create a project). Use that instead.`,
    }
  }

  const model = await findModel(client, wanted)

  if (!model.ok) return model

  const registry = await client.list<{ is_registry: boolean }>(
    'record_models',
    `?key=eq.${encodeURIComponent(model.value.key)}&select=is_registry&limit=1`,
  )

  if (registry.at(0)?.is_registry) {
    return {
      ok: false,
      message: `${model.value.name} is a registry. Use the registry tool to add an entry to it.`,
    }
  }

  return { ok: true, value: { ...model.value, builtIn: false } }
}

async function projectFor(
  client: DataClient,
  wanted: string | undefined,
): Promise<Lookup<{ id: string; title: string }>> {
  if (wanted) return findProject(client, wanted)

  const rows = await client.list<{ id: string; title: string }>(
    'projects',
    '?archived_at=is.null&select=id,title&order=title.asc&limit=8',
  )

  if (rows.length === 1) return { ok: true, value: rows[0] }

  if (rows.length === 0) {
    return { ok: false, message: 'There is no project to put it in yet.' }
  }

  return {
    ok: false,
    message: `Which project does it go in? ${rows.map((row) => row.title).join(', ')}. Ask the person, naming these.`,
  }
}

interface FoundRecord {
  id: string
  identifier: string
  title: string
  kind: string
  metadata_version: number
  archived_at: string | null
}

async function findRecord(
  client: DataClient,
  wanted: string,
  extra = '',
): Promise<Lookup<FoundRecord>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundRecord>(
    'records',
    `?deleted_at=is.null${extra}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,kind,metadata_version,archived_at&order=identifier.asc&limit=6`,
  )

  const lower = wanted.trim().toLowerCase()

  return pick(
    rows,
    wanted,
    'record',
    (row) => `${row.identifier} · ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

const label = (row: FoundRecord): string => `${row.identifier} · ${row.title}`

export async function buildRecordsProposal(
  name: RecordsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  switch (name) {
    case RECORD_CREATE_TOOL: {
      const parsed = proposeRecordCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const model = await resolveKind(client, input.kind)

      if (!model.ok) return fail(model.message)
      const project = await projectFor(client, input.project)

      if (!project.ok) return fail(project.message)
      const defs = await fetchModelFields(client, model.value.key)
      const active = defs.filter((field) => field.lifecycle === 'active')
      const properties: Record<string, string | number | null> = {}
      const customFields: Record<string, string | number | boolean> = {}

      const changes: ProposalChange[] = [
        { label: 'Type', before: null, after: model.value.name },
        { label: 'Name', before: null, after: input.name.trim() },
        { label: 'Project', before: null, after: project.value.title },
      ]

      for (const [wanted, value] of Object.entries(input.fields ?? {})) {
        const squashed = squash(wanted)

        const def = active.find(
          (field) =>
            squash(field.fieldName) === squashed ||
            squash(field.label) === squashed,
        )

        const material =
          model.value.key === 'material'
            ? (def?.fieldName ?? MATERIAL_ALIASES.get(squashed))
            : undefined

        if (material && MATERIAL_PROPERTIES.has(material)) {
          properties[material] =
            value === true || value === false ? String(value) : value
          changes.push({
            label: def?.label ?? wanted,
            before: null,
            after: String(value),
          })
          continue
        }

        if (!def) {
          return fail(
            `${model.value.name} has no field "${wanted}". Its fields are: ${active
              .map((field) => field.label)
              .join(', ')}.`,
          )
        }

        customFields[def.fieldName] = value
        changes.push({ label: def.label, before: null, after: String(value) })
      }

      const action: RecordsAction = {
        kind: 'records.create',
        projectId: project.value.id,
        recordKind: model.value.key,
        title: input.name.trim(),
        properties,
        customFields,
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: model.value.name,
          deepLink: model.value.key === 'material' ? '/materials' : null,
          changes,
          action,
        },
      }
    }

    case RECORD_ARCHIVE_TOOL:
    case RECORD_RESTORE_TOOL: {
      const parsed = proposeRecordStateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const archiving = name === RECORD_ARCHIVE_TOOL

      const found = await findRecord(
        client,
        input.record,
        archiving ? '&archived_at=is.null' : '&archived_at=not.is.null',
      )

      if (!found.ok) return fail(found.message)
      const record = found.value

      if (record.kind === 'sample') {
        return fail(
          `${record.identifier} is a sample: use the sample archive tool, which also frees its storage position.`,
        )
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(record),
          deepLink: null,
          changes: [
            {
              label: 'Status',
              before: archiving ? 'Active' : 'Archived',
              after: archiving ? 'Archived' : 'Active',
            },
          ],
          action: {
            kind: archiving ? 'records.archive' : 'records.restore',
            recordId: record.id,
            metadataVersion: record.metadata_version,
          },
        },
      }
    }

    case RECORD_LINK_TOOL: {
      const parsed = proposeRecordLinkSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const from = await findRecord(client, input.from)

      if (!from.ok) return fail(from.message)
      const to = await findRecord(client, input.to)

      if (!to.ok) return fail(to.message)

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(from.value),
          deepLink: null,
          changes: [
            { label: 'Link', before: null, after: input.linkType },
            { label: 'To', before: null, after: label(to.value) },
          ],
          action: {
            kind: 'records.link',
            sourceId: from.value.id,
            targetId: to.value.id,
            targetKind: to.value.kind,
            targetIdentifier: to.value.identifier,
            linkType: input.linkType,
          },
        },
      }
    }

    case MATERIAL_ADD_LOT_TOOL: {
      const parsed = proposeMaterialLotSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const found = await findRecord(
        client,
        input.material,
        '&kind=eq.material',
      )

      if (!found.ok) return fail(found.message)
      const unit = input.unit?.trim() || null

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(found.value),
          deepLink: '/materials',
          changes: [
            { label: 'Lot', before: null, after: input.lot },
            { label: 'Expiry', before: null, after: input.expiry },
            {
              label: 'Quantity',
              before: null,
              after: unit
                ? `${input.quantity} ${unit}`
                : String(input.quantity),
            },
          ],
          action: {
            kind: 'material.add_lot',
            recordId: found.value.id,
            lot: input.lot,
            expiry: input.expiry,
            quantity: input.quantity,
            unit,
            reason: input.reason?.trim() || null,
          },
        },
      }
    }
  }
}
