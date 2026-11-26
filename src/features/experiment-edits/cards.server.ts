import type { z } from 'zod'

import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  findPerson,
  findRecord,
  partLabel,
  partRows,
  pickPart,
} from '#/lib/assistant-planning.server'
import type { PartRow, RecordRow } from '#/lib/assistant-planning.server'
import {
  invalid,
  likeValue,
  resolveInstrument,
  toolDef,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import type { FeatureProposalOutcome } from '../define.server'
import {
  BLOCK_DELETE_TOOL,
  BLOCK_MOVE_TOOL,
  EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES,
  EXPERIMENT_FIELDS_TOOL,
  LEGAL_HOLD_ADD_TOOL,
  MODEL_MIGRATE_TOOL,
  MODEL_REPARENT_TOOL,
  MODEL_UPGRADE_TOOL,
  MODEL_VERSION_DISCARD_TOOL,
  PARTS_SIGN_OFF_TOOL,
  PART_AMEND_TOOL,
  PART_BLOCK_TOOL,
  PART_DELETE_TOOL,
  PART_GATE_TOOL,
  PART_LINK_TOOL,
  PART_MOVE_TOOL,
  PART_PLAN_TOOL,
  PART_SLIP_TOOL,
  PART_SPLIT_TOOL,
  PROTOCOL_IMPORT_TOOL,
  QC_CREATE_TOOL,
  QC_DELETE_TOOL,
  QC_POINT_TOOL,
  QC_UPDATE_TOOL,
  RECORD_FAVOURITE_TOOL,
  RECORD_TRANSITION_TOOL,
  SERIES_DAY_TOOL,
  SERIES_DISSOLVE_TOOL,
  SERIES_MOVE_TOOL,
  SERIES_START_TOOL,
  proposeBlockDeleteSchema,
  proposeBlockMoveSchema,
  proposeExperimentFieldsSchema,
  proposeHoldAddSchema,
  proposeModelReparentSchema,
  proposePartAmendSchema,
  proposePartBlockSchema,
  proposePartDeleteSchema,
  proposePartGateSchema,
  proposePartLinkSchema,
  proposePartMoveSchema,
  proposePartPlanSchema,
  proposePartSlipSchema,
  proposePartSplitSchema,
  proposePartsSignOffSchema,
  proposeProtocolImportSchema,
  proposeQcCreateSchema,
  proposeQcDeleteSchema,
  proposeQcPointSchema,
  proposeQcUpdateSchema,
  proposeRecordFavouriteSchema,
  proposeRecordTransitionSchema,
  proposeSeriesDaySchema,
  proposeSeriesMemberSchema,
  proposeSeriesMoveSchema,
  proposeSeriesStartSchema,
  proposeVersionDiscardSchema,
  proposeVersionMigrateSchema,
  proposeVersionUpgradeSchema,
  isExperimentEditsAction,
} from './cards'
import type {
  EditJson,
  ExperimentEditKind,
  ExperimentEditsProposeToolName,
} from './cards'

/**
 * The experiment edit cards (see `cards.ts`). Each builder finds what the
 * model named, by ID or by name, under the signed-in person's own access, and
 * returns a card that says exactly what will change. Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isExperimentEditsProposalTool(
  name: string,
): name is ExperimentEditsProposeToolName {
  return EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES.includes(name)
}

const DESCRIPTIONS: Record<ExperimentEditsProposeToolName, string> = {
  [EXPERIMENT_FIELDS_TOOL]:
    'Propose changing an experiment’s reviewer or planned finish date.',
  [RECORD_TRANSITION_TOOL]:
    'Propose moving a record to another status, such as in review or complete. The workflow decides which moves are allowed.',
  [RECORD_FAVOURITE_TOOL]:
    'Propose adding a record to the person’s favourites, or taking it off.',
  [LEGAL_HOLD_ADD_TOOL]:
    'Propose putting records under an active legal hold. Held records cannot be changed or deleted.',
  [PARTS_SIGN_OFF_TOOL]:
    'Propose requiring a signature on the parts of an experiment that are not signed yet, or stopping that.',
  [PART_MOVE_TOOL]:
    'Propose moving a part of an experiment to another place in the order.',
  [PART_DELETE_TOOL]:
    'Propose deleting a part of an experiment. Its blocks go to another part.',
  [PART_AMEND_TOOL]:
    'Propose reopening a signed part of an experiment, with the reason. It needs signing again afterwards.',
  [PART_GATE_TOOL]:
    'Propose the rule that opens a part (other parts done, samples linked, a field set, a date reached, quality control in control), or taking the rule off, or making its steps go in order.',
  [PART_PLAN_TOOL]:
    'Propose a part’s plan for the scheduler: hands-on minutes, waiting time afterwards and the instruments it needs.',
  [PART_SLIP_TOOL]:
    'Propose slipping a part by some days; the scheduler then offers a new plan for the rest.',
  [PART_SPLIT_TOOL]:
    'Propose splitting an experiment into parts, each starting at a block. For an experiment with no parts yet.',
  [PART_BLOCK_TOOL]: 'Propose moving a block of an experiment into a part.',
  [PART_LINK_TOOL]:
    'Propose showing a linked record of an experiment under a part.',
  [BLOCK_MOVE_TOOL]:
    'Propose moving a block to another place on the notebook page.',
  [BLOCK_DELETE_TOOL]: 'Propose deleting a block from the notebook page.',
  [QC_CREATE_TOOL]:
    'Propose a new quality control series to track a value across runs, with its expected mean and spread if known.',
  [QC_UPDATE_TOOL]:
    'Propose renaming a quality control series, turning it on or off, or changing its rules.',
  [QC_DELETE_TOOL]: 'Propose deleting a quality control series and its points.',
  [QC_POINT_TOOL]:
    'Propose recording a value on a quality control series. The rules judge it when it is saved.',
  [SERIES_START_TOOL]:
    'Propose turning an experiment into a series of experiments.',
  [SERIES_DISSOLVE_TOOL]:
    'Propose dissolving a series. Its members stay as experiments.',
  [SERIES_MOVE_TOOL]:
    'Propose moving an experiment to another place in its series.',
  [SERIES_DAY_TOOL]:
    'Propose the day an experiment in a series is planned for.',
  [MODEL_REPARENT_TOOL]:
    'Propose making a record type a subtype of another, or a top-level type.',
  [MODEL_VERSION_DISCARD_TOOL]:
    'Propose throwing away a record type’s unpublished draft version. The published version stays.',
  [MODEL_UPGRADE_TOOL]:
    'Propose moving one record to the latest published version of its type. Values are not changed.',
  [MODEL_MIGRATE_TOOL]:
    'Propose moving every open experiment of a type to its latest published version.',
  [PROTOCOL_IMPORT_TOOL]:
    'Propose adding a protocol written elsewhere (such as on protocols.io) as a draft protocol, with its steps, reagents and source.',
}

const SCHEMAS: Record<ExperimentEditsProposeToolName, z.ZodType> = {
  [EXPERIMENT_FIELDS_TOOL]: proposeExperimentFieldsSchema,
  [RECORD_TRANSITION_TOOL]: proposeRecordTransitionSchema,
  [RECORD_FAVOURITE_TOOL]: proposeRecordFavouriteSchema,
  [LEGAL_HOLD_ADD_TOOL]: proposeHoldAddSchema,
  [PARTS_SIGN_OFF_TOOL]: proposePartsSignOffSchema,
  [PART_MOVE_TOOL]: proposePartMoveSchema,
  [PART_DELETE_TOOL]: proposePartDeleteSchema,
  [PART_AMEND_TOOL]: proposePartAmendSchema,
  [PART_GATE_TOOL]: proposePartGateSchema,
  [PART_PLAN_TOOL]: proposePartPlanSchema,
  [PART_SLIP_TOOL]: proposePartSlipSchema,
  [PART_SPLIT_TOOL]: proposePartSplitSchema,
  [PART_BLOCK_TOOL]: proposePartBlockSchema,
  [PART_LINK_TOOL]: proposePartLinkSchema,
  [BLOCK_MOVE_TOOL]: proposeBlockMoveSchema,
  [BLOCK_DELETE_TOOL]: proposeBlockDeleteSchema,
  [QC_CREATE_TOOL]: proposeQcCreateSchema,
  [QC_UPDATE_TOOL]: proposeQcUpdateSchema,
  [QC_DELETE_TOOL]: proposeQcDeleteSchema,
  [QC_POINT_TOOL]: proposeQcPointSchema,
  [SERIES_START_TOOL]: proposeSeriesStartSchema,
  [SERIES_DISSOLVE_TOOL]: proposeSeriesMemberSchema,
  [SERIES_MOVE_TOOL]: proposeSeriesMoveSchema,
  [SERIES_DAY_TOOL]: proposeSeriesDaySchema,
  [MODEL_REPARENT_TOOL]: proposeModelReparentSchema,
  [MODEL_VERSION_DISCARD_TOOL]: proposeVersionDiscardSchema,
  [MODEL_UPGRADE_TOOL]: proposeVersionUpgradeSchema,
  [MODEL_MIGRATE_TOOL]: proposeVersionMigrateSchema,
  [PROTOCOL_IMPORT_TOOL]: proposeProtocolImportSchema,
}

export function experimentEditsProposalDefs(): ProviderToolDef[] {
  return EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES.map((name) => {
    if (!isExperimentEditsProposalTool(name)) {
      throw new Error(`${name} is not an experiment edit tool.`)
    }

    return toolDef(name, `${DESCRIPTIONS[name]} ${NOTE}`, SCHEMAS[name])
  })
}

// ---------------------------------------------------------------------------
// Lookups by the names people use.
// ---------------------------------------------------------------------------

type Failure = { ok: false; message: string }

const failure = (message: string): Failure => ({ ok: false, message })

const recordLabel = (row: { identifier: string; title: string }): string =>
  `${row.identifier} · ${row.title}`

const recordLink = (id: string): string => `/records/${id}`

/** The experiment named by ID or name, with its parts. */
async function experimentWithParts(
  client: DataClient,
  wanted: string,
): Promise<Lookup<{ record: RecordRow; parts: PartRow[] }>> {
  const found = await findRecord(client, wanted, ['experiment'])

  if (!found.ok) return found

  return {
    ok: true,
    value: {
      record: found.value,
      parts: await partRows(client, found.value.id),
    },
  }
}

interface BlockRow {
  id: string
  type: string
  payload: EditJson
  order: number
  version: number
}

function blockLabel(row: BlockRow, position: number): string {
  // The words in the payload: its string values, without ids and kinds.
  const text = [
    ...JSON.stringify(row.payload).matchAll(
      /"(?:text|title|label|name)":"([^"]+)"/g,
    ),
  ]
    .map((match) => match[1])
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

  return `${position}. ${row.type.replaceAll('_', ' ')}${text ? `: ${text}` : ''}`
}

/** The notebook page of a record, top to bottom. */
function blocksOf(client: DataClient, recordId: string): Promise<BlockRow[]> {
  return client.list<BlockRow>(
    'blocks',
    `?record_id=eq.${encodeURIComponent(recordId)}&order=order.asc&select=id,type,payload,order,version&limit=500`,
  )
}

/** The block a person means: its place on the page, or words from its text or type. */
function pickBlock(
  rows: readonly BlockRow[],
  wanted: string,
  recordName: string,
): Lookup<{ row: BlockRow; position: number }> {
  const labels = rows.map((row, index) => blockLabel(row, index + 1))
  const text = wanted.trim().toLowerCase()
  const place = /^(?:block\s*)?(\d{1,3})$/.exec(text)

  if (place) {
    const index = Number(place[1]) - 1

    if (rows[index])
      return { ok: true, value: { row: rows[index], position: index + 1 } }
  }

  const words = text.split(/\s+/).filter(Boolean)

  const matches = rows.flatMap((row, index) =>
    words.every((word) => labels[index].toLowerCase().includes(word))
      ? [{ row, position: index + 1 }]
      : [],
  )

  if (matches.length === 1) return { ok: true, value: matches[0] }

  const listed = (found: readonly { position: number }[]) =>
    found
      .slice(0, 8)
      .map((each) => labels[each.position - 1])
      .join('; ')

  return matches.length === 0
    ? {
        ok: false,
        message: `No block of ${recordName} matches "${wanted}". Its blocks are: ${listed(rows.map((row, index) => ({ row, position: index + 1 })))}.`,
      }
    : {
        ok: false,
        message: `More than one block fits: ${listed(matches)}. Ask the person which one.`,
      }
}

async function structureVersion(
  client: DataClient,
  recordId: string,
): Promise<number | null> {
  const rows = await client.list<{ structure_version: number }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=structure_version&limit=1`,
  )

  return rows.at(0)?.structure_version ?? null
}

interface SeriesRow {
  id: string
  name: string
  enabled: boolean
}

async function findSeries(
  client: DataClient,
  wanted: string,
): Promise<Lookup<SeriesRow>> {
  const rows = await client.list<SeriesRow>(
    'qc_series',
    `?name=ilike.${likeValue(wanted)}&select=id,name,enabled&order=name.asc&limit=6`,
  )

  const lower = wanted.trim().toLowerCase()

  return pick(
    rows,
    wanted,
    'quality control series',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

interface ModelRow {
  id: string
  key: string
  name: string
}

async function findModelRow(
  client: DataClient,
  wanted: string,
): Promise<Lookup<ModelRow>> {
  const rows = await client.list<ModelRow>(
    'record_models',
    '?select=id,key,name&order=name.asc&limit=300',
  )

  const lower = wanted.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)

  const partial = rows.filter((row) =>
    words.every((word) =>
      `${row.name} ${row.key}`.toLowerCase().includes(word),
    ),
  )

  return pick(
    partial,
    wanted,
    'record type',
    (row) => row.name,
    (row) =>
      row.key.toLowerCase() === lower || row.name.toLowerCase() === lower,
  )
}

interface VersionRow {
  id: string
  version: number
  lifecycle: 'draft' | 'published'
}

async function versionsOf(
  client: DataClient,
  modelId: string,
): Promise<VersionRow[]> {
  return client.list<VersionRow>(
    'record_model_versions',
    `?model_id=eq.${encodeURIComponent(modelId)}&select=id,version,lifecycle&order=version.desc&limit=50`,
  )
}

// ---------------------------------------------------------------------------
// Builders: each returns what the card says and does, or why it cannot.
// ---------------------------------------------------------------------------

interface Built {
  ok: true
  target: string
  deepLink: string | null
  changes: ProposalChange[]
  kind: ExperimentEditKind
  params: Record<string, EditJson>
  href?: string
}

type BuildResult = Built | Failure

interface Env {
  client: DataClient
  workspaceId: string
}

const change = (
  label: string,
  before: string | null,
  after: string,
): ProposalChange => ({ label, before, after })

function experimentCard(
  record: RecordRow,
  kind: ExperimentEditKind,
  params: Record<string, EditJson>,
  changes: ProposalChange[],
): Built {
  return {
    ok: true,
    target: recordLabel(record),
    deepLink: recordLink(record.id),
    changes,
    kind,
    params,
  }
}

interface Headed extends Built {
  title: string
  summary: string
}

type Tool = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  env: Env,
) => Promise<Headed | Failure>

type Builder<S extends z.ZodType> = (
  input: z.infer<S>,
  env: Env,
) => Promise<BuildResult>

function define<S extends z.ZodType<{ title: string; summary: string }>>(
  schema: S,
  run: Builder<S>,
): Tool {
  return async (args, env) => {
    const parsed = schema.safeParse(args)

    if (!parsed.success) return failure(invalid(parsed.error))
    const built = await run(parsed.data, env)

    if (!built.ok) return built

    return { ...built, title: parsed.data.title, summary: parsed.data.summary }
  }
}

/** A part of an experiment, by words; its experiment comes with it. */
async function partOf(
  client: DataClient,
  experimentWanted: string,
  partWanted: string,
): Promise<Lookup<{ record: RecordRow; parts: PartRow[]; part: PartRow }>> {
  const found = await experimentWithParts(client, experimentWanted)

  if (!found.ok) return found

  const part = pickPart(
    found.value.parts,
    partWanted,
    recordLabel(found.value.record),
  )

  if (!part.ok) return part

  return { ok: true, value: { ...found.value, part: part.value } }
}

const BUILDERS: Record<ExperimentEditsProposeToolName, Tool> = {
  [EXPERIMENT_FIELDS_TOOL]: define(
    proposeExperimentFieldsSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.experiment, ['experiment'])

      if (!found.ok) return found
      const record = found.value

      const current = (
        await client.list<{
          reviewer_user_id: string | null
          planned_end: string | null
        }>(
          'records',
          `?id=eq.${record.id}&select=reviewer_user_id,planned_end&limit=1`,
        )
      ).at(0)

      let reviewer = current?.reviewer_user_id ?? null
      let reviewerName: string | null = null
      const changes: ProposalChange[] = []

      if (input.reviewer !== undefined) {
        if (input.reviewer.trim().toLowerCase() === 'none') {
          reviewer = null
          changes.push(
            change(
              'Reviewer',
              current?.reviewer_user_id ? 'Someone' : null,
              'None',
            ),
          )
        } else {
          const person = await findPerson(client, input.reviewer)

          if (!person.ok) return person
          reviewer = person.value.id
          reviewerName = person.value.name
          changes.push(change('Reviewer', null, reviewerName))
        }
      }

      let plannedEnd = current?.planned_end ?? null

      if (input.plannedEnd !== undefined) {
        plannedEnd = input.plannedEnd
        changes.push(
          change(
            'Planned finish',
            current?.planned_end ?? null,
            input.plannedEnd ?? 'No date',
          ),
        )
      }

      if (changes.length === 0) {
        return failure('Give a reviewer or a planned finish date to change.')
      }

      return experimentCard(
        record,
        'experiment_edits.fields',
        {
          p_record_id: record.id,
          p_reviewer_user_id: reviewer,
          p_planned_end: plannedEnd,
        },
        changes,
      )
    },
  ),

  [RECORD_TRANSITION_TOOL]: define(
    proposeRecordTransitionSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.record)

      if (!found.ok) return found
      const record = found.value

      const status = input.status
        .trim()
        .toLowerCase()
        .replaceAll(/[\s-]+/g, '_')

      if (record.status === status) {
        return failure(`${recordLabel(record)} is already ${record.status}.`)
      }

      return experimentCard(
        record,
        'experiment_edits.transition',
        {
          p_record_id: record.id,
          p_target_status: status,
          p_expected_metadata_version: record.metadata_version,
        },
        [change('Status', record.status, status)],
      )
    },
  ),

  [RECORD_FAVOURITE_TOOL]: define(
    proposeRecordFavouriteSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.record)

      if (!found.ok) return found

      return experimentCard(
        found.value,
        'experiment_edits.favourite',
        {
          p_object_kind: 'record',
          p_object_id: found.value.id,
          p_favourite: input.favourite,
        },
        [
          change(
            'Favourite',
            input.favourite ? 'No' : 'Yes',
            input.favourite ? 'Yes' : 'No',
          ),
        ],
      )
    },
  ),

  [LEGAL_HOLD_ADD_TOOL]: define(
    proposeHoldAddSchema,
    async (input, { client }) => {
      const holds = await client.list<{ id: string; name: string }>(
        'legal_holds',
        `?released_at=is.null&name=ilike.${likeValue(input.hold)}&select=id,name&limit=6`,
      )

      const lower = input.hold.trim().toLowerCase()

      const hold = pick(
        holds,
        input.hold,
        'active legal hold',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )

      if (!hold.ok) return hold
      const ids: string[] = []
      const labels: string[] = []

      for (const wanted of input.records) {
        const found = await findRecord(client, wanted)

        if (!found.ok) return found
        ids.push(found.value.id)
        labels.push(recordLabel(found.value))
      }

      return {
        ok: true,
        target: hold.value.name,
        deepLink: null,
        changes: labels.map((label) => change('Put under hold', null, label)),
        kind: 'experiment_edits.hold_add',
        params: { p_hold_id: hold.value.id, p_record_ids: ids },
      }
    },
  ),

  [PARTS_SIGN_OFF_TOOL]: define(
    proposePartsSignOffSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.experiment, ['experiment'])

      if (!found.ok) return found

      return experimentCard(
        found.value,
        'experiment_edits.sign_off',
        { p_record_id: found.value.id, p_required: input.required },
        [
          change(
            'Signature on parts',
            null,
            input.required
              ? 'Required on every part not yet signed'
              : 'Not required',
          ),
        ],
      )
    },
  ),

  [PART_MOVE_TOOL]: define(proposePartMoveSchema, async (input, { client }) => {
    const found = await partOf(client, input.experiment, input.part)

    if (!found.ok) return found
    const { record, parts, part } = found.value
    let afterId: string | null = null
    let place = 'First'

    if (input.after) {
      const after = pickPart(parts, input.after, recordLabel(record))

      if (!after.ok) return after

      if (after.value.part_id === part.part_id) {
        return failure('A part cannot go after itself.')
      }

      afterId = after.value.part_id
      place = `After ${partLabel(after.value)}`
    }

    return experimentCard(
      record,
      'experiment_edits.part_move',
      { p_part_id: part.part_id, p_after_part_id: afterId },
      [change(partLabel(part), `Part ${part.part_number}`, place)],
    )
  }),

  [PART_DELETE_TOOL]: define(
    proposePartDeleteSchema,
    async (input, { client }) => {
      const found = await partOf(client, input.experiment, input.part)

      if (!found.ok) return found
      const { record, parts, part } = found.value
      let moveTo: string | null = null
      const changes = [change('Delete', partLabel(part), 'Deleted')]

      if (input.moveBlocksTo) {
        const target = pickPart(parts, input.moveBlocksTo, recordLabel(record))

        if (!target.ok) return target

        if (target.value.part_id === part.part_id) {
          return failure(
            'The blocks cannot move into the part that is deleted.',
          )
        }

        moveTo = target.value.part_id
        changes.push(change('Its blocks go to', null, partLabel(target.value)))
      } else if (part.block_count > 0) {
        return failure(
          `${partLabel(part)} has ${part.block_count} blocks. Ask the person which part takes them.`,
        )
      }

      return experimentCard(
        record,
        'experiment_edits.part_delete',
        { p_part_id: part.part_id, p_move_blocks_to: moveTo },
        changes,
      )
    },
  ),

  [PART_AMEND_TOOL]: define(
    proposePartAmendSchema,
    async (input, { client }) => {
      const found = await partOf(client, input.experiment, input.part)

      if (!found.ok) return found
      const { record, part } = found.value

      return experimentCard(
        record,
        'experiment_edits.part_amend',
        { p_part_id: part.part_id, p_reason: input.reason.trim() },
        [
          change(partLabel(part), 'Signed', 'Reopened'),
          change('Reason', null, input.reason.trim()),
        ],
      )
    },
  ),

  [PART_GATE_TOOL]: define(proposePartGateSchema, async (input, { client }) => {
    const found = await partOf(client, input.experiment, input.part)

    if (!found.ok) return found
    const { record, parts, part } = found.value
    const changes: ProposalChange[] = []
    let conditions: EditJson = null

    if (input.conditions !== undefined) {
      const resolved: EditJson[] = []

      for (const condition of input.conditions) {
        switch (condition.kind) {
          case 'part_done': {
            const other = pickPart(parts, condition.part, recordLabel(record))

            if (!other.ok) return other

            if (other.value.part_id === part.part_id) {
              return failure('A part cannot wait for itself.')
            }

            resolved.push({ kind: 'part_done', partId: other.value.part_id })
            changes.push(
              change('Opens when', null, `${partLabel(other.value)} is done`),
            )
            break
          }

          case 'samples_linked':
            resolved.push({ kind: 'samples_linked', min: condition.min ?? 1 })
            changes.push(
              change(
                'Opens when',
                null,
                `${condition.min ?? 1} or more samples are linked`,
              ),
            )
            break

          case 'field_set':
            resolved.push({
              kind: 'field_set',
              field: condition.field,
              label: condition.field,
            })
            changes.push(
              change('Opens when', null, `${condition.field} is filled in`),
            )
            break

          case 'date_reached':
            resolved.push({ kind: 'date_reached', date: condition.date })
            changes.push(
              change('Opens when', null, `${condition.date} is reached`),
            )
            break

          case 'qc_in_control': {
            if (condition.series) {
              const one = await findSeries(client, condition.series)

              if (!one.ok) return one
              resolved.push({
                kind: 'qc_in_control',
                seriesId: one.value.id,
                label: one.value.name,
              })
              changes.push(
                change('Opens when', null, `${one.value.name} is in control`),
              )
            } else {
              resolved.push({ kind: 'qc_in_control' })
              changes.push(
                change('Opens when', null, 'Quality control is in control'),
              )
            }
          }
        }
      }

      conditions = resolved.length > 0 ? resolved : null

      if (resolved.length === 0) changes.push(change('Rule', null, 'Taken off'))
    }

    if (input.mode)
      changes.push(
        change(
          'Mode',
          null,
          input.mode === 'block' ? 'Stops people' : 'Warns, can go on',
        ),
      )

    if (input.stepsInOrder !== undefined) {
      changes.push(
        change('Steps', null, input.stepsInOrder ? 'In order' : 'Any order'),
      )
    }

    if (changes.length === 0) return failure('Say what the rule should be.')

    return experimentCard(
      record,
      'experiment_edits.part_gate',
      {
        p_part_id: part.part_id,
        p_conditions: conditions,
        p_gate_mode: input.mode ?? null,
        p_steps_in_order: input.stepsInOrder ?? null,
      },
      [change('Part', null, partLabel(part)), ...changes],
    )
  }),

  [PART_PLAN_TOOL]: define(proposePartPlanSchema, async (input, { client }) => {
    const found = await partOf(client, input.experiment, input.part)

    if (!found.ok) return found
    const { record, part } = found.value
    const needs: EditJson[] = []

    const changes = [
      change('Part', null, partLabel(part)),
      change('Hands-on', null, `${input.handsOnMinutes} min`),
    ]

    if (input.waitAfterMinutes > 0) {
      changes.push(change('Wait after', null, `${input.waitAfterMinutes} min`))
    }

    for (const need of input.needs) {
      const like = likeValue(need.resource)

      const resources = await client.list<{ id: string; name: string }>(
        'calendar_resources',
        `?name=ilike.${like}&select=id,name&order=name.asc&limit=6`,
      )

      const lower = need.resource.trim().toLowerCase()

      const one = pick(
        resources,
        need.resource,
        'instrument or room',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )

      if (!one.ok) return one
      needs.push({ resourceId: one.value.id, minutes: need.minutes })
      changes.push(
        change('Needs', null, `${one.value.name} for ${need.minutes} min`),
      )
    }

    return experimentCard(
      record,
      'experiment_edits.part_plan',
      {
        p_part_id: part.part_id,
        p_hands_on_minutes: input.handsOnMinutes,
        p_wait_after_minutes: input.waitAfterMinutes,
        p_needs: needs,
      },
      changes,
    )
  }),

  [PART_SLIP_TOOL]: define(proposePartSlipSchema, async (input, { client }) => {
    const found = await partOf(client, input.experiment, input.part)

    if (!found.ok) return found
    const { record, part } = found.value

    if (input.days === 0) return failure('Slipping by 0 days changes nothing.')

    return experimentCard(
      record,
      'experiment_edits.part_slip',
      { p_part_id: part.part_id, p_days: input.days },
      [
        change(
          partLabel(part),
          part.due_on,
          `${Math.abs(input.days)} ${Math.abs(input.days) === 1 ? 'day' : 'days'} ${input.days > 0 ? 'later' : 'earlier'}`,
        ),
      ],
    )
  }),

  [PART_SPLIT_TOOL]: define(
    proposePartSplitSchema,
    async (input, { client }) => {
      const found = await experimentWithParts(client, input.experiment)

      if (!found.ok) return found
      const { record, parts } = found.value

      if (parts.length > 0) {
        return failure(
          `${recordLabel(record)} already has parts. Add or move parts with the part tools.`,
        )
      }

      const blocks = await blocksOf(client, record.id)
      const split: EditJson[] = []
      const changes: ProposalChange[] = []

      for (const [index, wanted] of input.parts.entries()) {
        const block = pickBlock(blocks, wanted.firstBlock, recordLabel(record))

        if (!block.ok) return block
        split.push({
          title: wanted.title,
          first_block_id: block.value.row.id,
          day_offset: index,
        })
        changes.push(
          change(
            `Part ${index + 1}`,
            null,
            `${wanted.title}, from block ${block.value.position}`,
          ),
        )
      }

      return experimentCard(
        record,
        'experiment_edits.part_split',
        { p_record_id: record.id, p_parts: split },
        changes,
      )
    },
  ),

  [PART_BLOCK_TOOL]: define(
    proposePartBlockSchema,
    async (input, { client }) => {
      const found = await partOf(client, input.experiment, input.part)

      if (!found.ok) return found
      const { record, part } = found.value

      const block = pickBlock(
        await blocksOf(client, record.id),
        input.block,
        recordLabel(record),
      )

      if (!block.ok) return block

      return experimentCard(
        record,
        'experiment_edits.part_block',
        { p_block_id: block.value.row.id, p_part_id: part.part_id },
        [
          change(
            blockLabel(block.value.row, block.value.position),
            null,
            `Moves into ${partLabel(part)}`,
          ),
        ],
      )
    },
  ),

  [PART_LINK_TOOL]: define(proposePartLinkSchema, async (input, { client }) => {
    const found = await partOf(client, input.experiment, input.part)

    if (!found.ok) return found
    const { record, part } = found.value
    const like = likeValue(input.link)

    const links = await client.list<{
      id: string
      target_identifier: string | null
      link_type: string
    }>(
      'record_links',
      `?source_record_id=eq.${record.id}&target_identifier=ilike.${like}&select=id,target_identifier,link_type&limit=6`,
    )

    const lower = input.link.trim().toLowerCase()

    const one = pick(
      links,
      input.link,
      'linked record',
      (row) => row.target_identifier ?? row.link_type,
      (row) => row.target_identifier?.toLowerCase() === lower,
    )

    if (!one.ok) return one

    return experimentCard(
      record,
      'experiment_edits.part_link',
      { p_link_id: one.value.id, p_part_id: part.part_id },
      [
        change(
          one.value.target_identifier ?? 'Link',
          null,
          `Shown under ${partLabel(part)}`,
        ),
      ],
    )
  }),

  [BLOCK_MOVE_TOOL]: define(
    proposeBlockMoveSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.experiment, ['experiment'])

      if (!found.ok) return found
      const record = found.value
      const blocks = await blocksOf(client, record.id)
      const block = pickBlock(blocks, input.block, recordLabel(record))

      if (!block.ok) return block
      let afterId: string | null = null
      let place = 'First on the page'

      if (input.after) {
        const after = pickBlock(blocks, input.after, recordLabel(record))

        if (!after.ok) return after

        if (after.value.row.id === block.value.row.id) {
          return failure('A block cannot go after itself.')
        }

        afterId = after.value.row.id
        place = `After block ${after.value.position}`
      }

      return experimentCard(
        record,
        'experiment_edits.block_move',
        {
          p_block_id: block.value.row.id,
          p_after_block_id: afterId,
          p_before_block_id: null,
          p_expected_structure_version: await structureVersion(
            client,
            record.id,
          ),
        },
        [
          change(
            blockLabel(block.value.row, block.value.position),
            `Block ${block.value.position}`,
            place,
          ),
        ],
      )
    },
  ),

  [BLOCK_DELETE_TOOL]: define(
    proposeBlockDeleteSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.experiment, ['experiment'])

      if (!found.ok) return found
      const record = found.value

      const block = pickBlock(
        await blocksOf(client, record.id),
        input.block,
        recordLabel(record),
      )

      if (!block.ok) return block

      return experimentCard(
        record,
        'experiment_edits.block_delete',
        {
          p_block_id: block.value.row.id,
          p_expected_structure_version: await structureVersion(
            client,
            record.id,
          ),
        },
        [
          change(
            'Delete block',
            blockLabel(block.value.row, block.value.position),
            'Deleted',
          ),
        ],
      )
    },
  ),

  [QC_CREATE_TOOL]: define(
    proposeQcCreateSchema,
    async (input, { client, workspaceId }) => {
      const changes = [change('Series', null, input.name.trim())]
      let instrumentId: string | null = null

      if (input.instrument) {
        const one = await resolveInstrument(
          client,
          workspaceId,
          input.instrument,
        )

        if (!one.ok) return failure(one.message)
        instrumentId = one.instrument.id
        changes.push(change('Instrument', null, one.instrument.name))
      }

      if (input.mean !== undefined && input.sd !== undefined) {
        changes.push(
          change('Limits', null, `mean ${input.mean}, SD ${input.sd}`),
        )
      }

      return {
        ok: true,
        target: input.name.trim(),
        deepLink: null,
        changes,
        kind: 'experiment_edits.qc_create',
        params: {
          p_workspace_id: workspaceId,
          p_name: input.name.trim(),
          p_source_kind: 'manual',
          p_metric: null,
          p_design_id: null,
          p_instrument_id: instrumentId,
          p_unit: input.unit?.trim() || null,
          p_mean: input.mean ?? null,
          p_sd: input.sd ?? null,
        },
      }
    },
  ),

  [QC_UPDATE_TOOL]: define(proposeQcUpdateSchema, async (input, { client }) => {
    const found = await findSeries(client, input.series)

    if (!found.ok) return found
    const changes: ProposalChange[] = []

    if (input.name)
      changes.push(change('Name', found.value.name, input.name.trim()))

    if (input.enabled !== undefined) {
      changes.push(
        change(
          'Checking',
          found.value.enabled ? 'On' : 'Off',
          input.enabled ? 'On' : 'Off',
        ),
      )
    }

    if (input.rules)
      changes.push(change('Rules', null, input.rules.join(', ') || 'None'))

    if (changes.length === 0)
      return failure('Say what to change on the series.')

    return {
      ok: true,
      target: found.value.name,
      deepLink: null,
      changes,
      kind: 'experiment_edits.qc_update',
      params: {
        p_series_id: found.value.id,
        p_name: input.name?.trim() ?? null,
        p_rules: input.rules ?? null,
        p_enabled: input.enabled ?? null,
      },
    }
  }),

  [QC_DELETE_TOOL]: define(proposeQcDeleteSchema, async (input, { client }) => {
    const found = await findSeries(client, input.series)

    if (!found.ok) return found

    return {
      ok: true,
      target: found.value.name,
      deepLink: null,
      changes: [
        change('Delete series', found.value.name, 'Deleted with its points'),
      ],
      kind: 'experiment_edits.qc_delete',
      params: { p_series_id: found.value.id },
    }
  }),

  [QC_POINT_TOOL]: define(proposeQcPointSchema, async (input, { client }) => {
    const found = await findSeries(client, input.series)

    if (!found.ok) return found

    return {
      ok: true,
      target: found.value.name,
      deepLink: null,
      changes: [
        change('New point', null, String(input.value)),
        ...(input.label ? [change('Label', null, input.label)] : []),
      ],
      kind: 'experiment_edits.qc_point',
      params: {
        p_series_id: found.value.id,
        p_value: input.value,
        p_at: null,
        p_label: input.label?.trim() || null,
        p_instrument_run_id: null,
      },
    }
  }),

  [SERIES_START_TOOL]: define(
    proposeSeriesStartSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.experiment, ['experiment'])

      if (!found.ok) return found

      return experimentCard(
        found.value,
        'experiment_edits.series_start',
        { p_record_id: found.value.id },
        [change('Series', null, 'Becomes a series of experiments')],
      )
    },
  ),

  [SERIES_DISSOLVE_TOOL]: define(
    proposeSeriesMemberSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.member, ['experiment'])

      if (!found.ok) return found

      return experimentCard(
        found.value,
        'experiment_edits.series_dissolve',
        { p_record_id: found.value.id },
        [change('Series', 'A series', 'Dissolved; its members stay')],
      )
    },
  ),

  [SERIES_MOVE_TOOL]: define(
    proposeSeriesMoveSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.member, ['experiment'])

      if (!found.ok) return found

      return experimentCard(
        found.value,
        'experiment_edits.series_move',
        { p_member_record_id: found.value.id, p_position: input.position },
        [change('Place in series', null, String(input.position))],
      )
    },
  ),

  [SERIES_DAY_TOOL]: define(
    proposeSeriesDaySchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.member, ['experiment'])

      if (!found.ok) return found

      const params = {
        p_member_record_id: found.value.id,
        p_planned_on: input.plannedOn,
      }

      return experimentCard(
        found.value,
        'experiment_edits.series_day',
        params,
        [change('Planned day', null, input.plannedOn ?? 'No day')],
      )
    },
  ),

  [MODEL_REPARENT_TOOL]: define(
    proposeModelReparentSchema,
    async (input, { client }) => {
      const found = await findModelRow(client, input.model)

      if (!found.ok) return found
      let parentKey: string | null = null

      if (input.parent) {
        const parent = await findModelRow(client, input.parent)

        if (!parent.ok) return parent

        if (parent.value.id === found.value.id) {
          return failure('A type cannot be its own parent.')
        }

        parentKey = parent.value.key
      }

      return {
        ok: true,
        target: found.value.name,
        deepLink: null,
        changes: [
          change(
            'Subtype of',
            null,
            input.parent
              ? (parentKey ?? input.parent)
              : 'Nothing: a top-level type',
          ),
        ],
        kind: 'experiment_edits.model_reparent',
        params: { p_model_id: found.value.id, p_parent_key: parentKey },
      }
    },
  ),

  [MODEL_VERSION_DISCARD_TOOL]: define(
    proposeVersionDiscardSchema,
    async (input, { client }) => {
      const found = await findModelRow(client, input.model)

      if (!found.ok) return found

      const draft = (await versionsOf(client, found.value.id)).find(
        (row) => row.lifecycle === 'draft',
      )

      if (!draft)
        return failure(`${found.value.name} has no draft version to discard.`)

      return {
        ok: true,
        target: found.value.name,
        deepLink: null,
        changes: [
          change(
            'Draft version',
            `Version ${draft.version}`,
            'Discarded; the published version stays',
          ),
        ],
        kind: 'experiment_edits.version_discard',
        params: { p_version_id: draft.id },
      }
    },
  ),

  [MODEL_UPGRADE_TOOL]: define(
    proposeVersionUpgradeSchema,
    async (input, { client }) => {
      const found = await findRecord(client, input.record)

      if (!found.ok) return found
      const record = found.value
      const model = await findModelRow(client, record.kind)

      if (!model.ok) return model

      const latest = (await versionsOf(client, model.value.id)).find(
        (row) => row.lifecycle === 'published',
      )

      if (!latest)
        return failure(`${model.value.name} has no published version.`)

      return experimentCard(
        record,
        'experiment_edits.version_upgrade',
        {
          p_record_id: record.id,
          p_version_id: latest.id,
          p_expected_metadata_version: record.metadata_version,
          p_reason: input.reason.trim(),
        },
        [
          change('Type version', null, `Version ${latest.version}`),
          change('Reason', null, input.reason.trim()),
        ],
      )
    },
  ),

  [MODEL_MIGRATE_TOOL]: define(
    proposeVersionMigrateSchema,
    async (input, { client }) => {
      const found = await findModelRow(client, input.model)

      if (!found.ok) return found

      const latest = (await versionsOf(client, found.value.id)).find(
        (row) => row.lifecycle === 'published',
      )

      if (!latest)
        return failure(`${found.value.name} has no published version.`)

      return {
        ok: true,
        target: found.value.name,
        deepLink: null,
        changes: [
          change('Open experiments', null, `Move to version ${latest.version}`),
          change('Reason', null, input.reason.trim()),
        ],
        kind: 'experiment_edits.version_migrate',
        params: {
          p_model_id: found.value.id,
          p_version_id: latest.id,
          p_reason: input.reason.trim(),
        },
      }
    },
  ),

  [PROTOCOL_IMPORT_TOOL]: define(proposeProtocolImportSchema, async (input) => {
    const params = {
      p_title: input.name.trim(),
      p_steps: input.steps.map((step) => ({
        text: step.text,
        section: step.section ?? null,
      })),
      p_description: input.description ?? null,
      p_reagents: input.reagents ?? [],
      p_source: input.source
        ? {
            provider: input.source.provider,
            url: input.source.url,
            doi: input.source.doi ?? null,
          }
        : null,
    }

    return {
      ok: true,
      target: input.name.trim(),
      deepLink: '/protocols',
      changes: [
        change('Draft protocol', null, input.name.trim()),
        change('Steps', null, String(input.steps.length)),
        ...(input.source ? [change('From', null, input.source.provider)] : []),
      ],
      kind: 'experiment_edits.protocol_import',
      params,
      href: '/protocols',
    }
  }),
}

export async function buildExperimentEditsProposal(
  name: ExperimentEditsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const built = await BUILDERS[name](args, {
    client: context.client,
    workspaceId: context.workspaceId,
  })

  if (!built.ok) return built

  const action = { kind: built.kind, params: built.params, href: built.href }

  if (!isExperimentEditsAction(action)) return failure('Unknown action.')

  return {
    ok: true,
    proposal: {
      tool: name,
      title: built.title,
      summary: built.summary,
      target: built.target,
      deepLink: built.deepLink,
      changes: built.changes,
      action,
    },
  }
}
