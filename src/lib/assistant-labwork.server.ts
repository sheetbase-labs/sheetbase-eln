import { sequenceFingerprint } from './bio-registry'
import { cleanDna } from './molbio/dna'
import {
  BOOKING_RULES_SET_TOOL,
  COMPOUND_LOT_TOOL,
  COMPOUND_REGISTER_TOOL,
  LAB_LOGO_TOOL,
  LABWORK_PROPOSE_TOOL_NAMES,
  LEGAL_HOLD_CREATE_TOOL,
  LEGAL_HOLD_RELEASE_TOOL,
  PIN_TOOL,
  RECURRING_END_TOOL,
  RECURRING_PAUSE_TOOL,
  REGISTRY_ADD_TOOL,
  RETENTION_APPLY_TOOL,
  RETENTION_SET_TOOL,
  SAMPLE_POOL_TOOL,
  SEARCH_SAVE_TOOL,
  SOLUTION_PREPARE_TOOL,
  SPEC_LIMITS_SET_TOOL,
  STOCKTAKE_COMPLETE_TOOL,
  STOCKTAKE_START_TOOL,
  TIMER_END_TOOL,
  WATCHER_FINDING_TOOL,
  WATCHER_SET_TOOL,
  WORKFLOW_ENROL_TOOL,
  WORKFLOW_LEAVE_TOOL,
  proposeBookingRulesSetSchema,
  proposeCompoundLotSchema,
  proposeCompoundRegisterSchema,
  proposeLabLogoSchema,
  proposeLegalHoldCreateSchema,
  proposeLegalHoldReleaseSchema,
  proposePinSchema,
  proposeRecurringEndSchema,
  proposeRecurringPauseSchema,
  proposeRegistryAddSchema,
  proposeRetentionApplySchema,
  proposeRetentionSetSchema,
  proposeSamplePoolSchema,
  proposeSearchSaveSchema,
  proposeSolutionPrepareSchema,
  proposeSpecLimitsSetSchema,
  proposeStocktakeCompleteSchema,
  proposeStocktakeStartSchema,
  proposeTimerEndSchema,
  proposeWatcherFindingSchema,
  proposeWatcherSetSchema,
  proposeWorkflowEnrolSchema,
  proposeWorkflowLeaveSchema,
} from './assistant-labwork'
import type { LabworkAction, LabworkProposeToolName } from './assistant-labwork'
import {
  amountOf,
  findSample,
  parse,
  pick,
  sampleLabel,
  sentence,
  withUnit,
} from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import {
  findExperiment,
  instrumentLabel,
  likeValue,
  resolveInstrument,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import {
  describeMinutes,
  fetchBookingRules,
  fetchProtocolOptions,
} from './booking-rules'
import { WATCHER_SCHEDULE_LABEL, watcherMeta } from './lab-watchers'
import type { DataClient } from './data-client'
import { loadOcl } from './chemistry-draw'
import { describeStructure, findStructureDuplicates } from './compound-registry'
import { fetchModelFields } from './model-fields'
import { keepTimeLabel, limitsProblem } from './result-quality'
import type { DueRecord } from './result-quality'
import { fetchSampleRuns } from './sample-workflows'
import { searchIngredientLots } from './solution-prep'
import {
  fetchStorageTree,
  formatNodePath,
  isArchived,
} from './storage-locations'
import { isStocktakeLevel, stocktakeReference } from './stocktake'
import type { StocktakeLevel } from './stocktake'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for running the lab (see `assistant-labwork.ts`). Each builder finds
 * what the person named under their own access, checks what it can, and
 * returns a card saying exactly what will change. Nothing is written here.
 */

export type LabworkOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isLabworkProposalTool(
  name: string,
): name is LabworkProposeToolName {
  return (LABWORK_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function labworkProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      STOCKTAKE_START_TOOL,
      `Propose starting a stocktake (a count) of a freezer, shelf, rack or box, so someone can scan what is there. ${NOTE}`,
      proposeStocktakeStartSchema,
    ),
    toolDef(
      STOCKTAKE_COMPLETE_TOOL,
      `Propose finishing an open stocktake. Anything not scanned is recorded as missing, so say how many that is. ${NOTE}`,
      proposeStocktakeCompleteSchema,
    ),
    toolDef(
      LEGAL_HOLD_CREATE_TOOL,
      `Propose a legal hold that stops records in a project, or of one kind, being archived or deleted. Needs a project or a kind. ${NOTE}`,
      proposeLegalHoldCreateSchema,
    ),
    toolDef(
      LEGAL_HOLD_RELEASE_TOOL,
      `Propose releasing an active legal hold, with the reason. ${NOTE}`,
      proposeLegalHoldReleaseSchema,
    ),
    toolDef(
      RETENTION_SET_TOOL,
      `Propose how long one kind of record is kept before it is due for archiving, or removing that rule. ${NOTE}`,
      proposeRetentionSetSchema,
    ),
    toolDef(
      RETENTION_APPLY_TOOL,
      `Propose archiving every record that is past its retention time and not on hold. Records on hold are skipped. The card says how many. ${NOTE}`,
      proposeRetentionApplySchema,
    ),
    toolDef(
      REGISTRY_ADD_TOOL,
      `Propose adding an entry to a registry (cell lines, constructs, antibodies and so on), filled in only from what the person said. For a construct or other sequence entry, pass the sequence (the same sequence is refused as a duplicate, from either strand or any start) and the entries it was built from. Duplicates are refused. ${NOTE}`,
      proposeRegistryAddSchema,
    ),
    toolDef(
      COMPOUND_REGISTER_TOOL,
      `Propose registering a compound by its structure (a SMILES line) in a registry that takes structures. Salts and solvents are set aside when checking for repeats; a repeat is refused. ${NOTE}`,
      proposeCompoundRegisterSchema,
    ),
    toolDef(
      COMPOUND_LOT_TOOL,
      `Propose adding a lot (a batch) to a compound that is already registered. ${NOTE}`,
      proposeCompoundLotSchema,
    ),
    toolDef(
      WORKFLOW_ENROL_TOOL,
      `Propose putting a sample into a sample workflow. ${NOTE}`,
      proposeWorkflowEnrolSchema,
    ),
    toolDef(
      WORKFLOW_LEAVE_TOOL,
      `Propose taking a sample out of the workflow it is in. ${NOTE}`,
      proposeWorkflowLeaveSchema,
    ),
    toolDef(
      SPEC_LIMITS_SET_TOOL,
      `Propose result limits on a number field of a model: fail and warning limits, either side. ${NOTE}`,
      proposeSpecLimitsSetSchema,
    ),
    toolDef(
      BOOKING_RULES_SET_TOOL,
      `Propose booking rules for an instrument: longest booking, how far ahead, and the training required. Only the rules named change. ${NOTE}`,
      proposeBookingRulesSetSchema,
    ),
    toolDef(
      TIMER_END_TOOL,
      `Propose stopping one of the person’s running step timers. ${NOTE}`,
      proposeTimerEndSchema,
    ),
    toolDef(
      RECURRING_PAUSE_TOOL,
      `Propose pausing (or resuming) repeating work, such as a repeating booking or experiment. ${NOTE}`,
      proposeRecurringPauseSchema,
    ),
    toolDef(
      RECURRING_END_TOOL,
      `Propose ending repeating work for good, optionally cancelling what is still ahead. ${NOTE}`,
      proposeRecurringEndSchema,
    ),
    toolDef(
      SAMPLE_POOL_TOOL,
      `Propose combining volume from several samples into one new pooled sample for an experiment. ${NOTE}`,
      proposeSamplePoolSchema,
    ),
    toolDef(
      SOLUTION_PREPARE_TOOL,
      `Propose preparing a solution (buffer, medium) from ingredient lots. The ingredients are used up and the new lot is registered. ${NOTE}`,
      proposeSolutionPrepareSchema,
    ),
    toolDef(
      SEARCH_SAVE_TOOL,
      `Propose saving a search so the person can run it again. ${NOTE}`,
      proposeSearchSaveSchema,
    ),
    toolDef(
      PIN_TOOL,
      `Propose pinning (or unpinning) a record, project, instrument or pipeline so it shows on the person’s home. ${NOTE}`,
      proposePinSchema,
    ),
    toolDef(
      LAB_LOGO_TOOL,
      `Propose setting the lab logo from a PNG or JPEG already uploaded to the lab, or removing it. Only administrators can. You cannot take an image from the chat. ${NOTE}`,
      proposeLabLogoSchema,
    ),
    toolDef(
      WATCHER_FINDING_TOOL,
      `Propose dismissing, snoozing or reopening something a lab watcher found. Find it first with the lab list tool (watcher_findings). ${NOTE}`,
      proposeWatcherFindingSchema,
    ),
    toolDef(
      WATCHER_SET_TOOL,
      `Propose turning a lab watcher (stock expiring, stock low, work overdue, data missing, results off) on or off, or changing how often it looks. Findings go to the person’s Inbox. ${NOTE}`,
      proposeWatcherSetSchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// Lookups by the words people use.
// ---------------------------------------------------------------------------

const fail = (message: string): LabworkOutcome => ({ ok: false, message })

function card(
  tool: LabworkProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: LabworkAction
  },
): LabworkOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      ...rest,
    },
  }
}

interface NamedModel {
  key: string
  name: string
}

async function findModel(
  client: DataClient,
  wanted: string,
  extra = '',
): Promise<Lookup<NamedModel>> {
  const rows = await client.list<NamedModel>(
    'record_models',
    `?${extra}select=key,name&order=name.asc&limit=200`,
  )
  const lower = wanted.trim().toLowerCase()
  const exact = rows.filter(
    (row) =>
      row.key.toLowerCase() === lower || row.name.toLowerCase() === lower,
  )
  if (exact.length === 1) return { ok: true, value: exact[0] }
  const words = lower.split(/\s+/).filter(Boolean)
  const partial = rows.filter((row) =>
    words.every((word) =>
      `${row.name} ${row.key}`.toLowerCase().includes(word),
    ),
  )
  return pick(
    partial,
    wanted,
    'model',
    (row) => row.name,
    () => false,
  )
}

interface ProjectRow {
  id: string
  key: string
  title: string
}

async function findProject(
  client: DataClient,
  text: string,
): Promise<Lookup<ProjectRow>> {
  const like = likeValue(text)
  const rows = await client.list<ProjectRow>(
    'projects',
    `?archived_at=is.null&or=(key.ilike.${like},title.ilike.${like})&select=id,key,title&order=title.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'project',
    (row) => row.title,
    (row) =>
      row.key.toLowerCase() === lower || row.title.toLowerCase() === lower,
  )
}

export async function buildLabworkProposal(
  name: LabworkProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<LabworkOutcome> {
  const { client, workspaceId } = context
  switch (name) {
    case STOCKTAKE_START_TOOL: {
      const parsed = parse(proposeStocktakeStartSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const tree = await fetchStorageTree(client)
      const lower = input.location.trim().toLowerCase()
      const words = lower.split(/\s+/).filter(Boolean)
      const nodes = tree.nodes
        .filter((node) => isStocktakeLevel(node.level))
        .filter((node) => !isArchived(tree, node))
        .map((node) => ({ node, path: formatNodePath(tree, node) }))
      const matches = nodes.filter(({ node, path }) =>
        words.every((word) =>
          `${path} ${node.code ?? ''}`.toLowerCase().includes(word),
        ),
      )
      const found = pick(
        matches,
        input.location,
        'storage place',
        (row) => row.path,
        (row) =>
          row.path.toLowerCase() === lower ||
          row.node.name.toLowerCase() === lower ||
          row.node.code?.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      const { node, path } = found.value
      const open = await client.list<{ number: number }>(
        'stocktakes',
        `?status=eq.open&scope_id=eq.${encodeURIComponent(node.id)}&select=number&limit=1`,
      )
      if (open.length > 0) {
        return fail(
          `${stocktakeReference(open[0].number)} is already open for ${path}. Tell the person.`,
        )
      }
      const changes: ProposalChange[] = [
        { label: 'Count', before: null, after: path },
        { label: 'Level', before: null, after: sentence(node.level) },
        {
          label: 'Samples on the list',
          before: null,
          after: String(node.held),
        },
      ]
      if (input.note) {
        changes.push({ label: 'Note', before: null, after: input.note })
      }
      return card(name, input, {
        target: path,
        deepLink: '/stocktake',
        changes,
        action: {
          kind: 'stocktake.start',
          level: node.level as StocktakeLevel,
          scopeId: node.id,
          note: input.note?.trim() || null,
        },
      })
    }

    case STOCKTAKE_COMPLETE_TOOL: {
      const parsed = parse(proposeStocktakeCompleteSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const number = /^ST-?(\d+)$/i.exec(input.stocktake.trim())
      const rows = await client.list<{
        id: string
        number: number
        scope_name: string
        scope_path: string
        status: string
      }>(
        'stocktakes',
        `?status=eq.open&${
          number
            ? `number=eq.${Number(number[1])}`
            : `or=(scope_name.ilike.${likeValue(input.stocktake)},scope_path.ilike.${likeValue(input.stocktake)})`
        }&select=id,number,scope_name,scope_path,status&order=number.desc&limit=6`,
      )
      const found = pick(
        rows,
        input.stocktake,
        'open stocktake',
        (row) => `${stocktakeReference(row.number)} ${row.scope_name}`,
        (row) => number !== null && row.number === Number(number[1]),
      )
      if (!found.ok) return fail(found.message)
      const count = found.value
      const items = await client.list<{ state: string }>(
        'stocktake_items',
        `?stocktake_id=eq.${encodeURIComponent(count.id)}&select=state&limit=5000`,
      )
      const tally = (state: string) =>
        items.filter((item) => item.state === state).length
      const unseen = tally('expected')
      const changes: ProposalChange[] = [
        { label: 'Status', before: 'Open', after: 'Completed' },
        {
          label: 'Found where expected',
          before: null,
          after: String(tally('confirmed')),
        },
      ]
      if (unseen > 0) {
        changes.push({
          label: 'Not scanned, recorded as missing',
          before: null,
          after: String(unseen),
        })
      }
      for (const [state, label] of [
        ['misplaced', 'Found in a different box'],
        ['unexpected', 'Found but not on the list'],
      ] as const) {
        if (tally(state) > 0) {
          changes.push({ label, before: null, after: String(tally(state)) })
        }
      }
      return card(name, input, {
        target: `${stocktakeReference(count.number)} · ${count.scope_name}`,
        deepLink: `/stocktake/${count.id}`,
        changes,
        action: { kind: 'stocktake.complete', stocktakeId: count.id },
      })
    }

    case LEGAL_HOLD_CREATE_TOOL: {
      const parsed = parse(proposeLegalHoldCreateSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      if (!input.project && !input.kind) {
        return fail(
          'A hold covers a project or one kind of record. Ask the person which.',
        )
      }
      const same = await client.list<{ name: string }>(
        'legal_holds',
        `?released_at=is.null&name=ilike.${likeValue(input.name)}&select=name&limit=3`,
      )
      if (
        same.some(
          (row) => row.name.toLowerCase() === input.name.trim().toLowerCase(),
        )
      ) {
        return fail(`There is already an active hold called "${input.name}".`)
      }
      let project: ProjectRow | null = null
      if (input.project) {
        const found = await findProject(client, input.project)
        if (!found.ok) return fail(found.message)
        project = found.value
      }
      let model: NamedModel | null = null
      if (input.kind) {
        const found = await findModel(client, input.kind)
        if (!found.ok) return fail(found.message)
        model = found.value
      }
      const covers = [
        project ? `Everything in ${project.title}` : null,
        model ? `Every ${model.name} record` : null,
      ].filter((text): text is string => text !== null)
      const changes: ProposalChange[] = [
        { label: 'Hold', before: null, after: input.name.trim() },
        { label: 'Covers', before: null, after: covers.join(', ') },
      ]
      if (input.reason) {
        changes.push({ label: 'Reason', before: null, after: input.reason })
      }
      return card(name, input, {
        target: input.name.trim(),
        deepLink: '/settings/lab/retention',
        changes,
        action: {
          kind: 'hold.create',
          name: input.name.trim(),
          reason: input.reason?.trim() ?? '',
          projectId: project?.id ?? null,
          recordKind: model?.key ?? null,
        },
      })
    }

    case LEGAL_HOLD_RELEASE_TOOL: {
      const parsed = parse(proposeLegalHoldReleaseSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        name: string
        reason: string | null
      }>(
        'legal_holds',
        `?released_at=is.null&name=ilike.${likeValue(input.hold)}&select=id,name,reason&order=created_at.desc&limit=6`,
      )
      const lower = input.hold.trim().toLowerCase()
      const found = pick(
        rows,
        input.hold,
        'active hold',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      const changes: ProposalChange[] = [
        { label: 'Status', before: 'Active', after: 'Released' },
        {
          label: 'Records covered',
          before: null,
          after: 'Can be archived or deleted again',
        },
      ]
      if (input.note) {
        changes.push({ label: 'Reason', before: null, after: input.note })
      }
      return card(name, input, {
        target: found.value.name,
        deepLink: '/settings/lab/retention',
        changes,
        action: {
          kind: 'hold.release',
          holdId: found.value.id,
          note: input.note?.trim() ?? '',
        },
      })
    }

    case RETENTION_SET_TOOL: {
      const parsed = parse(proposeRetentionSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const model = await findModel(client, input.kind)
      if (!model.ok) return fail(model.message)
      const existing = await client.list<{ keep_months: number }>(
        'retention_rules',
        `?kind=eq.${encodeURIComponent(model.value.key)}&select=keep_months&limit=1`,
      )
      const before = existing[0] ? keepTimeLabel(existing[0].keep_months) : null
      if (input.keepMonths === null && !existing[0]) {
        return fail(
          `${model.value.name} has no retention rule to remove. Tell the person.`,
        )
      }
      if (existing[0]?.keep_months === input.keepMonths) {
        return fail(
          `${model.value.name} is already kept for ${before}. Tell the person.`,
        )
      }
      const changes: ProposalChange[] = [
        {
          label: 'Keep',
          before: before ?? 'Forever',
          after:
            input.keepMonths === null
              ? 'Forever (rule removed)'
              : keepTimeLabel(input.keepMonths),
        },
      ]
      if (input.note) {
        changes.push({ label: 'Note', before: null, after: input.note })
      }
      return card(name, input, {
        target: model.value.name,
        deepLink: '/settings/lab/retention',
        changes,
        action: {
          kind: 'retention.set',
          recordKind: model.value.key,
          keepMonths: input.keepMonths,
          note: input.note?.trim() ?? '',
        },
      })
    }

    case RETENTION_APPLY_TOOL: {
      const parsed = parse(proposeRetentionApplySchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      let model: NamedModel | null = null
      if (input.kind) {
        const found = await findModel(client, input.kind)
        if (!found.ok) return fail(found.message)
        model = found.value
      }
      const due = await client.rpc<DueRecord[]>(
        'retention_due',
        model ? { p_kind: model.key } : {},
      )
      if (due.length === 0) {
        return fail(
          'Nothing is past its retention time (records on hold are skipped). Tell the person.',
        )
      }
      const sample = due
        .slice(0, 6)
        .map((row) => `${row.identifier} · ${row.title}`)
        .join('\n')
      return card(name, input, {
        target: model ? model.name : 'All retention rules',
        deepLink: '/settings/lab/retention',
        changes: [
          {
            label: 'Archive',
            before: null,
            after: `${due.length} record${due.length === 1 ? '' : 's'}`,
          },
          {
            label: due.length > 6 ? 'For example' : 'Records',
            before: null,
            after: sample,
          },
        ],
        action: { kind: 'retention.apply', recordKind: model?.key ?? null },
      })
    }

    case REGISTRY_ADD_TOOL: {
      const parsed = parse(proposeRegistryAddSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const registry = await findModel(
        client,
        input.registry,
        'is_registry=eq.true&',
      )
      if (!registry.ok) return fail(registry.message)
      const takesStructures = await client.list<{
        key: string
        registry_structure_field: string | null
      }>(
        'record_models',
        `?key=eq.${encodeURIComponent(registry.value.key)}&select=key,registry_structure_field`,
      )
      if (takesStructures.some((row) => row.registry_structure_field)) {
        return fail(
          `${registry.value.name} registers compounds by structure. Use ${COMPOUND_REGISTER_TOOL} with a SMILES line instead.`,
        )
      }
      const project = await findProject(client, input.project)
      if (!project.ok) return fail(project.message)
      const defs = await fetchModelFields(client, registry.value.key)
      const customFields: Record<string, unknown> = {}
      const changes: ProposalChange[] = [
        { label: 'Name', before: null, after: input.name.trim() },
        { label: 'Project', before: null, after: project.value.title },
      ]
      for (const [wanted, value] of Object.entries(input.fields ?? {})) {
        const lower = wanted.trim().toLowerCase()
        const def = defs.find(
          (field) =>
            field.lifecycle === 'active' &&
            (field.fieldName.toLowerCase() === lower ||
              field.label.toLowerCase() === lower),
        )
        if (!def) {
          return fail(
            `${registry.value.name} has no field "${wanted}". Its fields are: ${defs
              .filter((field) => field.lifecycle === 'active')
              .map((field) => field.label)
              .join(', ')}.`,
          )
        }
        customFields[def.fieldName] = value
        changes.push({ label: def.label, before: null, after: String(value) })
      }
      if (input.sequence) {
        const models = await client.list<{
          registry_sequence_field: string | null
        }>(
          'record_models',
          `?key=eq.${encodeURIComponent(registry.value.key)}&select=registry_sequence_field&limit=1`,
        )
        const field = models.at(0)?.registry_sequence_field
        if (!field)
          return fail(
            `${registry.value.name} does not keep a sequence. Pick a registry that does, or leave the sequence out.`,
          )
        const residues = cleanDna(input.sequence)
        if (residues.length < 10)
          return fail('That sequence is too short to register.')
        const topology = input.topology ?? 'circular'
        customFields[field] = await sequenceFingerprint({
          name: input.name,
          description: '',
          organism: null,
          molecule: 'dna',
          topology,
          length: residues.length,
          residues,
          features: [],
        })
        if (registry.value.key === 'construct') {
          customFields.sequence_length = String(residues.length)
          customFields.shape = topology
        }
        changes.push({
          label: 'Sequence',
          before: null,
          after: `${residues.length} bp, ${topology}`,
        })
      }
      const parents: { recordId: string; role: string }[] = []
      for (const wanted of input.parents ?? []) {
        const like = likeValue(wanted.record)
        const found = await client.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=5`,
        )
        const exact = found.find(
          (row) =>
            row.identifier.toLowerCase() === wanted.record.trim().toLowerCase(),
        )
        const one = exact ?? (found.length === 1 ? found[0] : undefined)
        if (!one)
          return fail(
            found.length === 0
              ? `No entry matches "${wanted.record}".`
              : `More than one entry matches "${wanted.record}": ${found
                  .map((row) => `${row.identifier} ${row.title}`)
                  .join(', ')}. Ask which one.`,
          )
        parents.push({ recordId: one.id, role: wanted.role ?? 'parent' })
        changes.push({
          label: `Built from (${wanted.role ?? 'parent'})`,
          before: null,
          after: `${one.identifier} · ${one.title}`,
        })
      }
      const twins = await client.rpc<
        { identifier: string; title: string; match: string }[]
      >('registry_find_duplicates', {
        p_kind: registry.value.key,
        p_title: input.name.trim(),
        p_custom_fields: customFields,
        p_exclude_id: null,
      })
      if (twins.length > 0) {
        return fail(
          `${registry.value.name} already has ${twins
            .slice(0, 4)
            .map((row) => `${row.identifier} · ${row.title}`)
            .join(', ')}. Ask whether they meant that entry.`,
        )
      }
      return card(name, input, {
        target: registry.value.name,
        deepLink: '/registry',
        changes,
        action: {
          kind: 'registry.add',
          projectId: project.value.id,
          recordKind: registry.value.key,
          title: input.name.trim(),
          customFields,
          ...(parents.length > 0 ? { parents } : {}),
        },
      })
    }

    case COMPOUND_REGISTER_TOOL: {
      const parsed = parse(proposeCompoundRegisterSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const registry = await findModel(
        client,
        input.registry,
        'is_registry=eq.true&registry_structure_field=not.is.null&',
      )
      if (!registry.ok) return fail(registry.message)
      const project = await findProject(client, input.project)
      if (!project.ok) return fail(project.message)
      const described = describeStructure(await loadOcl(), input.structure)
      if (!described) {
        return fail(
          'That could not be read as a structure. Ask for a SMILES line, or tell the person to draw it in the registry.',
        )
      }
      const defs = await fetchModelFields(client, registry.value.key)
      const customFields: Record<string, unknown> = {}
      const changes: ProposalChange[] = [
        { label: 'Name', before: null, after: input.name.trim() },
        { label: 'Project', before: null, after: project.value.title },
        { label: 'Formula', before: null, after: described.formula },
        { label: 'Mass', before: null, after: `${described.mass} g/mol` },
      ]
      if (described.salts.length > 0) {
        changes.push({
          label: 'Set aside',
          before: null,
          after: described.salts.join(', '),
        })
      }
      for (const [wanted, value] of Object.entries(input.fields ?? {})) {
        const lower = wanted.trim().toLowerCase()
        const def = defs.find(
          (field) =>
            field.lifecycle === 'active' &&
            (field.fieldName.toLowerCase() === lower ||
              field.label.toLowerCase() === lower),
        )
        if (!def) {
          return fail(
            `${registry.value.name} has no field "${wanted}". Its fields are: ${defs
              .filter((field) => field.lifecycle === 'active')
              .map((field) => field.label)
              .join(', ')}.`,
          )
        }
        customFields[def.fieldName] = value
        changes.push({ label: def.label, before: null, after: String(value) })
      }
      const twins = await findStructureDuplicates(client, {
        kind: registry.value.key,
        descriptor: described,
      })
      if (twins.length > 0) {
        const list = twins
          .slice(0, 4)
          .map((row) => `${row.identifier} · ${row.title}`)
          .join(', ')
        return fail(
          twins.some((row) => row.sameForm)
            ? `${registry.value.name} already has this structure: ${list}. Ask whether they meant that entry.`
            : `${registry.value.name} already has this compound as a different salt or form: ${list}. Ask whether to add it as a lot with ${COMPOUND_LOT_TOOL}.`,
        )
      }
      return card(name, input, {
        target: registry.value.name,
        deepLink: '/registry',
        changes,
        action: {
          kind: 'compound.register',
          projectId: project.value.id,
          recordKind: registry.value.key,
          title: input.name.trim(),
          customFields,
          structure: described,
        },
      })
    }

    case COMPOUND_LOT_TOOL: {
      const parsed = parse(proposeCompoundLotSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const models = await client.list<{
        key: string
        name: string
        registry_lot_kind: string | null
      }>(
        'record_models',
        '?is_registry=eq.true&registry_structure_field=not.is.null&select=key,name,registry_lot_kind',
      )
      if (models.length === 0) {
        return fail(
          'No registry takes structures yet, so there are no compounds.',
        )
      }
      const like = likeValue(input.compound)
      const kinds = models.map((m) => m.key).join(',')
      const rows = await client.list<{
        id: string
        identifier: string
        title: string
        kind: string
      }>(
        'records',
        `?kind=in.(${kinds})&deleted_at=is.null&archived_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,kind&order=identifier.asc&limit=6`,
      )
      const lower = input.compound.trim().toLowerCase()
      const compound = pick(
        rows,
        input.compound,
        'compound',
        (row) => `${row.identifier} · ${row.title}`,
        (row) =>
          row.identifier.toLowerCase() === lower ||
          row.title.toLowerCase() === lower,
      )
      if (!compound.ok) return fail(compound.message)
      const model = models.find((m) => m.key === compound.value.kind)
      if (!model?.registry_lot_kind) {
        return fail(
          `${model?.name ?? 'That registry'} does not take lots. Tell the person to choose a lot model in the registry’s settings.`,
        )
      }
      const defs = await fetchModelFields(client, model.registry_lot_kind)
      const customFields: Record<string, unknown> = {}
      const label = `${compound.value.identifier} · ${compound.value.title}`
      const lotName = input.name?.trim() || `${compound.value.identifier} lot`
      const changes: ProposalChange[] = [
        { label: 'Compound', before: null, after: label },
        { label: 'Lot', before: null, after: lotName },
      ]
      for (const [wanted, value] of Object.entries(input.fields ?? {})) {
        const lowerField = wanted.trim().toLowerCase()
        const def = defs.find(
          (field) =>
            field.lifecycle === 'active' &&
            (field.fieldName.toLowerCase() === lowerField ||
              field.label.toLowerCase() === lowerField),
        )
        if (!def) {
          return fail(
            `A lot has no field "${wanted}". Its fields are: ${defs
              .filter((field) => field.lifecycle === 'active')
              .map((field) => field.label)
              .join(', ')}.`,
          )
        }
        customFields[def.fieldName] = value
        changes.push({ label: def.label, before: null, after: String(value) })
      }
      return card(name, input, {
        target: label,
        deepLink: `/records/${compound.value.id}`,
        changes,
        action: {
          kind: 'compound.lot',
          compoundId: compound.value.id,
          compound: compound.value.identifier,
          title: lotName,
          customFields,
        },
      })
    }

    case WORKFLOW_ENROL_TOOL: {
      const parsed = parse(proposeWorkflowEnrolSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findSample(client, input.sample)
      if (!sample.ok) return fail(sample.message)
      const workflows = await client.list<{ id: string; name: string }>(
        'sample_workflows',
        `?status=eq.active&name=ilike.${likeValue(input.workflow)}&select=id,name&order=name.asc&limit=6`,
      )
      const lower = input.workflow.trim().toLowerCase()
      const workflow = pick(
        workflows,
        input.workflow,
        'workflow',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )
      if (!workflow.ok) return fail(workflow.message)
      const runs = await fetchSampleRuns(client, sample.value.id)
      if (
        runs.some(
          (run) => !run.completedAt && run.workflowId === workflow.value.id,
        )
      ) {
        return fail(
          `${sample.value.identifier} is already in ${workflow.value.name}. Tell the person.`,
        )
      }
      return card(name, input, {
        target: sampleLabel(sample.value),
        deepLink: `/records/${sample.value.id}`,
        changes: [
          { label: 'Workflow', before: null, after: workflow.value.name },
        ],
        action: {
          kind: 'workflow.enrol',
          sampleId: sample.value.id,
          workflowId: workflow.value.id,
        },
      })
    }

    case WORKFLOW_LEAVE_TOOL: {
      const parsed = parse(proposeWorkflowLeaveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findSample(client, input.sample)
      if (!sample.ok) return fail(sample.message)
      const open = (await fetchSampleRuns(client, sample.value.id)).filter(
        (run) => !run.completedAt,
      )
      const lower = input.workflow?.trim().toLowerCase()
      const matching = lower
        ? open.filter((run) => run.workflowName.toLowerCase().includes(lower))
        : open
      const run = pick(
        matching,
        input.workflow ?? input.sample,
        'workflow the sample is in',
        (row) => row.workflowName,
        () => false,
      )
      if (!run.ok) {
        return fail(
          open.length === 0
            ? `${sample.value.identifier} is not in a workflow.`
            : run.message,
        )
      }
      return card(name, input, {
        target: sampleLabel(sample.value),
        deepLink: `/records/${sample.value.id}`,
        changes: [
          {
            label: 'Workflow',
            before: `${run.value.workflowName} · ${run.value.stageName}`,
            after: 'Left',
          },
        ],
        action: {
          kind: 'workflow.leave',
          sampleId: sample.value.id,
          runId: run.value.id,
        },
      })
    }

    case SPEC_LIMITS_SET_TOOL: {
      const parsed = parse(proposeSpecLimitsSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const model = await findModel(client, input.model)
      if (!model.ok) return fail(model.message)
      const fields = (await fetchModelFields(client, model.value.key)).filter(
        (field) =>
          field.lifecycle === 'active' &&
          (field.logicalType === 'integer' || field.logicalType === 'decimal'),
      )
      const lower = input.field.trim().toLowerCase()
      const field = pick(
        fields.filter(
          (row) =>
            row.fieldName.toLowerCase().includes(lower) ||
            row.label.toLowerCase().includes(lower),
        ),
        input.field,
        'number field',
        (row) => row.label,
        (row) =>
          row.fieldName.toLowerCase() === lower ||
          row.label.toLowerCase() === lower,
      )
      if (!field.ok) {
        return fail(
          fields.length === 0
            ? `${model.value.name} has no number fields to put limits on.`
            : `${field.message} Number fields: ${fields.map((row) => row.label).join(', ')}.`,
        )
      }
      const next = {
        lowerLimit: input.lowerLimit ?? null,
        upperLimit: input.upperLimit ?? null,
        alertLower: input.alertLower ?? null,
        alertUpper: input.alertUpper ?? null,
      }
      const problem = limitsProblem(next)
      if (problem) {
        return fail(
          problem === 'order'
            ? 'The limits are the wrong way round. Ask the person to confirm them.'
            : problem === 'alertOutside'
              ? 'A warning limit sits outside its fail limit. Ask the person to confirm them.'
              : 'A warning limit needs a fail limit on at least one side. Ask the person.',
        )
      }
      const current = await client.list<{
        lower_limit: number | string | null
        upper_limit: number | string | null
        alert_lower: number | string | null
        alert_upper: number | string | null
      }>(
        'field_spec_limits',
        `?kind=eq.${encodeURIComponent(model.value.key)}&field_name=eq.${encodeURIComponent(field.value.fieldName)}&select=lower_limit,upper_limit,alert_lower,alert_upper&limit=1`,
      )
      const old = current.at(0)
      const show = (value: unknown) =>
        value === null || value === undefined ? 'none' : String(value)
      const changes: ProposalChange[] = []
      for (const [label, key, now] of [
        ['Fails below', 'lower_limit', next.lowerLimit],
        ['Fails above', 'upper_limit', next.upperLimit],
        ['Warns below', 'alert_lower', next.alertLower],
        ['Warns above', 'alert_upper', next.alertUpper],
      ] as const) {
        const was = old ? old[key] : null
        if (show(was) !== show(now)) {
          changes.push({ label, before: show(was), after: show(now) })
        }
      }
      if (changes.length === 0) {
        return fail('Those limits are already set. Tell the person.')
      }
      return card(name, input, {
        target: `${model.value.name} · ${field.value.label}`,
        deepLink: '/models',
        changes,
        action: {
          kind: 'limits.set',
          recordKind: model.value.key,
          fieldName: field.value.fieldName,
          ...next,
          note: input.note?.trim() || null,
        },
      })
    }

    case BOOKING_RULES_SET_TOOL: {
      const parsed = parse(proposeBookingRulesSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await resolveInstrument(
        client,
        workspaceId,
        input.instrument,
      )
      if (!found.ok) return fail(found.message)
      const current = await fetchBookingRules(client, found.instrument.id)
      const maxMinutes =
        input.maxBookingMinutes === undefined
          ? current.maxBookingMinutes
          : input.maxBookingMinutes
      const maxDays =
        input.maxAdvanceDays === undefined
          ? current.maxAdvanceDays
          : input.maxAdvanceDays
      let protocolIds = current.training.map((row) => row.protocolId)
      let trainingText = current.training
        .map((row) => `${row.identifier} · ${row.title}`)
        .join('\n')
      if (input.requiredTraining) {
        const options = await fetchProtocolOptions(client)
        const chosen: typeof options = []
        for (const wanted of input.requiredTraining) {
          const lower = wanted.trim().toLowerCase()
          const matches = options.filter((row) =>
            `${row.identifier} ${row.title}`.toLowerCase().includes(lower),
          )
          const one = pick(
            matches,
            wanted,
            'procedure',
            (row) => `${row.identifier} ${row.title}`,
            (row) =>
              row.identifier.toLowerCase() === lower ||
              row.title.toLowerCase() === lower,
          )
          if (!one.ok) return fail(one.message)
          chosen.push(one.value)
        }
        protocolIds = chosen.map((row) => row.id)
        trainingText = chosen
          .map((row) => `${row.identifier} · ${row.title}`)
          .join('\n')
      }
      const changes: ProposalChange[] = []
      const minutesText = (value: number | null) =>
        value === null ? 'No limit' : describeMinutes(value)
      const daysText = (value: number | null) =>
        value === null ? 'No limit' : `${value} days`
      if (maxMinutes !== current.maxBookingMinutes) {
        changes.push({
          label: 'Longest booking',
          before: minutesText(current.maxBookingMinutes),
          after: minutesText(maxMinutes),
        })
      }
      if (maxDays !== current.maxAdvanceDays) {
        changes.push({
          label: 'Book ahead',
          before: daysText(current.maxAdvanceDays),
          after: daysText(maxDays),
        })
      }
      const sameTraining =
        protocolIds.length === current.training.length &&
        protocolIds.every((id) =>
          current.training.some((row) => row.protocolId === id),
        )
      if (!sameTraining) {
        changes.push({
          label: 'Training required',
          before:
            current.training
              .map((row) => `${row.identifier} · ${row.title}`)
              .join('\n') || 'None',
          after: trainingText || 'None',
        })
      }
      if (changes.length === 0) {
        return fail('Those booking rules are already set. Tell the person.')
      }
      return card(name, input, {
        target: instrumentLabel(found.instrument),
        deepLink: '/instruments',
        changes,
        action: {
          kind: 'booking_rules.set',
          instrumentId: found.instrument.id,
          protocolIds,
          maxBookingMinutes: maxMinutes,
          maxAdvanceDays: maxDays,
        },
      })
    }

    case WATCHER_FINDING_TOOL: {
      const parsed = parse(proposeWatcherFindingSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const wanted =
        input.change === 'reopen'
          ? 'status=in.(dismissed,snoozed)'
          : 'status=in.(open,snoozed)'
      const rows = await client.list<{ id: string; title: string }>(
        'lab_watcher_findings',
        `?${wanted}&title=ilike.${likeValue(input.finding)}&select=id,title&order=created_at.desc&limit=6`,
      )
      const found = pick(
        rows,
        input.finding,
        'finding',
        (row) => row.title,
        (row) => row.title.toLowerCase() === input.finding.trim().toLowerCase(),
      )
      if (!found.ok) return fail(found.message)
      const days = input.days ?? 7
      return card(name, input, {
        target: found.value.title,
        deepLink: '/inbox',
        changes: [
          {
            label: 'Finding',
            before: input.change === 'reopen' ? 'Set aside' : 'Open',
            after:
              input.change === 'dismiss'
                ? 'Dismissed'
                : input.change === 'snooze'
                  ? `Snoozed for ${days} ${days === 1 ? 'day' : 'days'}`
                  : 'Open again',
          },
        ],
        action: {
          kind: 'watcher.finding',
          findingId: found.value.id,
          change: input.change,
          days,
        },
      })
    }

    case WATCHER_SET_TOOL: {
      const parsed = parse(proposeWatcherSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const meta = watcherMeta(input.watcher)
      const rows = await client.list<{
        enabled: boolean
        schedule: 'hourly' | 'daily' | 'weekly'
      }>(
        'lab_watchers',
        `?kind=eq.${input.watcher}&project_id=is.null&select=enabled,schedule&limit=1`,
      )
      const current = rows.at(0)
      const schedule = input.schedule ?? current?.schedule ?? 'daily'
      return card(name, input, {
        target: meta?.label ?? input.watcher,
        deepLink: '/settings/account/watchers',
        changes: [
          {
            label: 'Watcher',
            before: current?.enabled ? 'On' : 'Off',
            after: input.enabled ? 'On' : 'Off',
          },
          {
            label: 'Looks',
            before: current ? WATCHER_SCHEDULE_LABEL[current.schedule] : '—',
            after: WATCHER_SCHEDULE_LABEL[schedule],
          },
        ],
        action: {
          kind: 'watcher.set',
          workspaceId: context.workspaceId,
          watcher: input.watcher,
          enabled: input.enabled,
          schedule,
        },
      })
    }

    case TIMER_END_TOOL: {
      const parsed = parse(proposeTimerEndSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        record_id: string
        label: string
        ends_at: string
      }>(
        'my_step_timers',
        `?${input.timer ? `label=ilike.${likeValue(input.timer)}&` : ''}select=id,record_id,label,ends_at&order=ends_at.asc&limit=6`,
      )
      const lower = input.timer?.trim().toLowerCase()
      const found = pick(
        rows,
        input.timer ?? 'a timer',
        'running timer',
        (row) => row.label,
        (row) => row.label.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      return card(name, input, {
        target: found.value.label,
        deepLink: `/records/${found.value.record_id}`,
        changes: [{ label: 'Timer', before: 'Running', after: 'Stopped' }],
        action: {
          kind: 'timer.end',
          timerId: found.value.id,
          recordId: found.value.record_id,
        },
      })
    }

    case RECURRING_PAUSE_TOOL:
    case RECURRING_END_TOOL: {
      const ending = name === RECURRING_END_TOOL
      const parsedPause = ending
        ? null
        : parse(proposeRecurringPauseSchema, args)
      const parsedEnd = ending ? parse(proposeRecurringEndSchema, args) : null
      const parsed = parsedPause ?? parsedEnd
      if (!parsed || !parsed.ok)
        return fail(parsed?.message ?? 'Invalid input.')
      const input = parsed.data
      const pause = parsedPause?.ok ? (parsedPause.data.pause ?? true) : true
      const rows = await client.list<{
        id: string
        title: string
        status: string
        kind: string
      }>(
        'recurring_schedules',
        `?status=in.(${ending || pause ? 'active,paused' : 'paused'})&title=ilike.${likeValue(input.schedule)}&select=id,title,status,kind&order=title.asc&limit=6`,
      )
      const lower = input.schedule.trim().toLowerCase()
      const found = pick(
        rows,
        input.schedule,
        'repeating work',
        (row) => row.title,
        (row) => row.title.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      const schedule = found.value
      if (!ending) {
        if (pause && schedule.status === 'paused') {
          return fail(`${schedule.title} is already paused.`)
        }
        return card(name, input, {
          target: schedule.title,
          deepLink: '/schedule',
          changes: [
            {
              label: 'Repeats',
              before: pause ? 'Active' : 'Paused',
              after: pause ? 'Paused' : 'Active',
            },
          ],
          action: {
            kind: 'recurring.pause',
            scheduleId: schedule.id,
            paused: pause,
          },
        })
      }
      const cancelUpcoming = parsedEnd?.ok
        ? (parsedEnd.data.cancelUpcoming ?? true)
        : true
      return card(name, input, {
        target: schedule.title,
        deepLink: '/schedule',
        changes: [
          {
            label: 'Repeats',
            before: sentence(schedule.status),
            after: 'Ended',
          },
          {
            label: 'Ahead',
            before: null,
            after: cancelUpcoming
              ? 'Upcoming bookings are cancelled'
              : 'Upcoming bookings stay',
          },
        ],
        action: {
          kind: 'recurring.end',
          scheduleId: schedule.id,
          cancelUpcoming,
        },
      })
    }

    case SAMPLE_POOL_TOOL: {
      const parsed = parse(proposeSamplePoolSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const experiment = await findExperiment(client, input.experiment)
      if (typeof experiment === 'string') return fail(experiment)
      const sources: Extract<
        LabworkAction,
        { kind: 'sample.pool' }
      >['sources'] = []
      const changes: ProposalChange[] = []
      let unit: string | null = null
      let total = 0
      for (const source of input.sources) {
        const sample = await findSample(client, source.sample)
        if (!sample.ok) return fail(sample.message)
        const row = sample.value
        if (sources.some((existing) => existing.recordId === row.id)) {
          return fail(`${row.identifier} is listed twice. Ask the person.`)
        }
        if (row.status !== 'available') {
          return fail(
            `${sampleLabel(row)} is ${row.status.replaceAll('_', ' ')}, so it cannot go into a pool.`,
          )
        }
        const amount = amountOf(row)
        if (amount.quantity !== null && source.quantity > amount.quantity) {
          return fail(
            `${row.identifier} has only ${withUnit(amount.quantity, amount.unit)}, so ${withUnit(source.quantity, amount.unit)} cannot be taken. Tell the person.`,
          )
        }
        if (unit !== null && amount.unit !== unit) {
          return fail(
            `${row.identifier} is measured in ${amount.unit || 'no unit'} but the others are in ${unit || 'no unit'}, so they cannot be pooled. Tell the person.`,
          )
        }
        unit = amount.unit
        total += source.quantity
        sources.push({
          recordId: row.id,
          quantity: source.quantity,
          expectedMetadataVersion: row.metadata_version,
        })
        changes.push({
          label: sampleLabel(row),
          before:
            amount.quantity === null ? null : withUnit(amount.quantity, unit),
          after: `Take ${withUnit(source.quantity, unit)}`,
        })
      }
      changes.push({
        label: input.poolName
          ? `New pool: ${input.poolName}`
          : 'New pooled sample',
        before: null,
        after: `${withUnit(Math.round(total * 1_000_000) / 1_000_000, unit ?? '')} for ${experiment.identifier}`,
      })
      return card(name, input, {
        target: `${sources.length} samples`,
        deepLink: '/samples',
        changes,
        action: {
          kind: 'sample.pool',
          sources,
          experimentId: experiment.id,
          unit: unit || null,
          notes: input.notes?.trim() || null,
          poolName: input.poolName?.trim() || null,
          storageLocation: input.storageLocation?.trim() || null,
        },
      })
    }

    case SOLUTION_PREPARE_TOOL: {
      const parsed = parse(proposeSolutionPrepareSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const project = await findProject(client, input.project)
      if (!project.ok) return fail(project.message)
      const ingredients: { recordId: string; quantity: number }[] = []
      const changes: ProposalChange[] = [
        {
          label: 'Makes',
          before: null,
          after: `${input.name.trim()}, lot ${input.lot.trim()}, ${withUnit(input.quantity, input.unit ?? '')}`,
        },
      ]
      const expiries: string[] = []
      for (const wanted of input.ingredients) {
        const lots = await searchIngredientLots(client, wanted.lot, 6)
        const lower = wanted.lot.trim().toLowerCase()
        const found = pick(
          lots,
          wanted.lot,
          'ingredient lot in date and in stock',
          (row) => `${row.identifier} ${row.title} lot ${row.lot ?? '—'}`,
          (row) =>
            row.identifier.toLowerCase() === lower ||
            row.lot?.toLowerCase() === lower,
        )
        if (!found.ok) return fail(found.message)
        const lot = found.value
        if (lot.quantity !== null && wanted.quantity > lot.quantity) {
          return fail(
            `${lot.identifier} has only ${withUnit(lot.quantity, lot.unit ?? '')} left, so ${withUnit(wanted.quantity, lot.unit ?? '')} cannot be used. Tell the person.`,
          )
        }
        if (ingredients.some((row) => row.recordId === lot.id)) {
          return fail(`${lot.identifier} is listed twice. Ask the person.`)
        }
        if (lot.expiry) expiries.push(lot.expiry)
        ingredients.push({ recordId: lot.id, quantity: wanted.quantity })
        changes.push({
          label: `${lot.title} (${lot.identifier})`,
          before:
            lot.quantity === null
              ? null
              : withUnit(lot.quantity, lot.unit ?? ''),
          after: `Use ${withUnit(wanted.quantity, lot.unit ?? '')}`,
        })
      }
      const earliest = [...expiries].sort().at(0) ?? null
      changes.push({
        label: 'Expires',
        before: null,
        after: input.expiry ?? earliest ?? 'No expiry',
      })
      return card(name, input, {
        target: input.name.trim(),
        deepLink: '/materials',
        changes,
        action: {
          kind: 'solution.prepare',
          projectId: project.value.id,
          title: input.name.trim(),
          lot: input.lot.trim(),
          quantity: input.quantity,
          unit: input.unit?.trim() || null,
          expiry: input.expiry ?? null,
          storage: input.storage?.trim() || null,
          note: input.note?.trim() || null,
          ingredients,
        },
      })
    }

    case SEARCH_SAVE_TOOL: {
      const parsed = parse(proposeSearchSaveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const visibility = input.shareWithLab ? 'workspace' : 'private'
      const same = await client.list<{ name: string }>(
        'saved_searches',
        `?name=ilike.${likeValue(input.name)}&select=name&limit=3`,
      )
      if (
        same.some(
          (row) => row.name.toLowerCase() === input.name.trim().toLowerCase(),
        )
      ) {
        return fail(
          `There is already a saved search called "${input.name}". Ask for another name.`,
        )
      }
      return card(name, input, {
        target: input.name.trim(),
        deepLink: `/search?q=${encodeURIComponent(input.words.trim())}`,
        changes: [
          { label: 'Saved search', before: null, after: input.name.trim() },
          { label: 'Words', before: null, after: input.words.trim() },
          {
            label: 'Visible to',
            before: null,
            after:
              visibility === 'workspace' ? 'Everyone in the lab' : 'Only you',
          },
        ],
        action: {
          kind: 'search.save',
          name: input.name.trim(),
          words: input.words.trim(),
          visibility,
        },
      })
    }

    case PIN_TOOL: {
      const parsed = parse(proposePinSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const pin = input.pin ?? true
      const like = likeValue(input.name)
      const lower = input.name.trim().toLowerCase()
      let found: Lookup<{ id: string; label: string }>
      switch (input.target) {
        case 'record': {
          const rows = await client.list<{
            id: string
            identifier: string
            title: string
          }>(
            'records',
            `?deleted_at=is.null&archived_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
          )
          found = pick(
            rows.map((row) => ({
              id: row.id,
              label: `${row.identifier} · ${row.title}`,
              identifier: row.identifier.toLowerCase(),
              title: row.title.toLowerCase(),
            })),
            input.name,
            'record',
            (row) => row.label,
            (row) => row.identifier === lower || row.title === lower,
          )
          break
        }
        case 'project': {
          const project = await findProject(client, input.name)
          found = project.ok
            ? {
                ok: true,
                value: { id: project.value.id, label: project.value.title },
              }
            : project
          break
        }
        case 'instrument': {
          const instrument = await resolveInstrument(
            client,
            workspaceId,
            input.name,
          )
          found = instrument.ok
            ? {
                ok: true,
                value: {
                  id: instrument.instrument.id,
                  label: instrumentLabel(instrument.instrument),
                },
              }
            : { ok: false, message: instrument.message }
          break
        }
        case 'pipeline': {
          const rows = await client.list<{ id: string; name: string }>(
            'pipeline_definitions',
            `?name=ilike.${like}&select=id,name&order=name.asc&limit=6`,
          )
          found = pick(
            rows.map((row) => ({ id: row.id, label: row.name })),
            input.name,
            'pipeline',
            (row) => row.label,
            (row) => row.label.toLowerCase() === lower,
          )
          break
        }
      }
      if (!found.ok) return fail(found.message)
      const existing = await client.list<{ object_id: string }>(
        'user_favourites',
        `?object_kind=eq.${input.target}&object_id=eq.${encodeURIComponent(found.value.id)}&select=object_id&limit=1`,
      )
      if (pin && existing.length > 0) {
        return fail(`${found.value.label} is already pinned.`)
      }
      if (!pin && existing.length === 0) {
        return fail(`${found.value.label} is not pinned.`)
      }
      return card(name, input, {
        target: found.value.label,
        deepLink:
          input.target === 'record'
            ? `/records/${found.value.id}`
            : input.target === 'project'
              ? `/projects/${found.value.id}`
              : input.target === 'pipeline'
                ? `/pipelines/${found.value.id}`
                : '/instruments',
        changes: [
          {
            label: 'Pinned',
            before: pin ? 'No' : 'Yes',
            after: pin ? 'Yes' : 'No',
          },
        ],
        action: {
          kind: 'pin.set',
          target: input.target,
          id: found.value.id,
          pinned: pin,
        },
      })
    }

    case LAB_LOGO_TOOL: {
      const parsed = parse(proposeLabLogoSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      if (input.change === 'remove') {
        return card(name, input, {
          target: 'Lab logo',
          deepLink: '/settings/workspace',
          changes: [
            { label: 'Logo', before: 'Current logo', after: 'Removed' },
          ],
          action: { kind: 'logo.remove' },
        })
      }
      if (!input.file) {
        return fail(
          'Which file? The logo must be a PNG or JPEG already uploaded to the lab. Ask the person for its name, or point them to Settings > General to upload one.',
        )
      }
      const files = await client.list<{
        record_id: string
        display_name: string
        media_type: string
        byte_size: number | string
      }>(
        'file_objects',
        `?status=eq.active&media_type=in.(image/png,image/jpeg)&display_name=ilike.${likeValue(input.file)}&select=record_id,display_name,media_type,byte_size&order=created_at.desc&limit=6`,
      )
      const lower = input.file.trim().toLowerCase()
      const found = pick(
        files,
        input.file,
        'PNG or JPEG file',
        (row) => row.display_name,
        (row) => row.display_name.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      if (Number(found.value.byte_size) > 1_048_576) {
        return fail(
          `${found.value.display_name} is over 1 MB, which is too big for a logo. Tell the person.`,
        )
      }
      return card(name, input, {
        target: 'Lab logo',
        deepLink: '/settings/workspace',
        changes: [
          { label: 'Logo', before: null, after: found.value.display_name },
        ],
        action: { kind: 'logo.set', fileRecordId: found.value.record_id },
      })
    }
  }
}
