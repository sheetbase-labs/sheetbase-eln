import { z } from 'zod'

import {
  BOOKING_REPEAT_TOOL,
  EXPERIMENT_START_TOOL,
  INBOX_READ_TOOL,
  PARTS_READ_TOOL,
  PART_ADD_TOOL,
  PART_DONE_TOOL,
  PART_UPDATE_TOOL,
  PLANNING_PROPOSE_TOOL_NAMES,
  RECORD_ASK_TOOL,
  RECORD_ASSIGN_TOOL,
  SERIES_ADD_TOOL,
  SERIES_READ_TOOL,
  SERIES_REMOVE_TOOL,
  SHIPMENT_RECEIVE_TOOL,
  SHIPMENT_SEND_TOOL,
  STEPS_READ_TOOL,
  STEP_DONE_TOOL,
  STEP_RESULT_TOOL,
  TIMER_START_TOOL,
  inboxReadSchema,
  partsReadSchema,
  proposeBookingRepeatSchema,
  proposePartAddSchema,
  proposePartDoneSchema,
  proposePartUpdateSchema,
  proposeExperimentStartSchema,
  proposeRecordAskSchema,
  proposeRecordAssignSchema,
  proposeSeriesAddSchema,
  proposeSeriesRemoveSchema,
  proposeShipmentReceiveSchema,
  proposeShipmentSendSchema,
  proposeStepDoneSchema,
  proposeStepResultSchema,
  proposeTimerStartSchema,
  repeatDates,
  seriesReadSchema,
  stepsReadSchema,
} from './assistant-planning'
import type { PlanningProposeToolName } from './assistant-planning'
import {
  describeSlot,
  instantFromLocal,
  localFromInstant,
} from './assistant-booking'
import {
  bookingsBetween,
  instrumentLabel,
  invalid,
  likeValue,
  memberNames,
  resolveInstrument,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal } from './assistant-proposals'
import type { DataClient } from './data-client'
import type { ProviderToolDef } from './ai-providers/types'
import { fetchInboxPage } from './work-items/data'
import { itemLink } from './work-items/destination'
import type { WorkItemLink } from './work-items/destination'
import { stepDurationSeconds, formatDuration } from './step-timers'
import { shipmentReference } from './shipments'
import type { ManifestLine } from './shipments'
import { describeRepeatRule } from './recurring'

/**
 * Reads and cards for planning and follow-up. Everything is looked up under
 * the person's own access and by the names they use; the card runs the
 * ordinary RPC when they press its button (see `assistant-planning.ts`).
 */

export type PlanningOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

export function isInboxReadTool(name: string): boolean {
  return name === INBOX_READ_TOOL
}

export function isStepsReadTool(name: string): boolean {
  return name === STEPS_READ_TOOL
}

export function isSeriesReadTool(name: string): boolean {
  return name === SERIES_READ_TOOL
}

export function isPartsReadTool(name: string): boolean {
  return name === PARTS_READ_TOOL
}

export function isPlanningProposalTool(
  name: string,
): name is PlanningProposeToolName {
  return (PLANNING_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

function toolDef(
  name: string,
  description: string,
  schema: z.ZodType,
): ProviderToolDef {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema, {
    io: 'input',
  })
  return { name: name.replaceAll('.', '__'), description, parameters }
}

export function inboxToolDefs(): ProviderToolDef[] {
  return [
    toolDef(
      INBOX_READ_TOOL,
      'Read what is waiting on the person: reviews, requests, orders, shipments, tasks and anything overdue, with a link to each. Use it for "what do I need to do today" or "what is waiting on me".',
      inboxReadSchema,
    ),
  ]
}

export function stepsToolDefs(): ProviderToolDef[] {
  return [
    toolDef(
      STEPS_READ_TOOL,
      'Read the protocol steps of an experiment in order: each step’s status (done, in progress or not started, from the notes, results and timers on the page), who finished it and when, and which one is current. Use it for "where am I in EXP-12" or "what is the next step".',
      stepsReadSchema,
    ),
  ]
}

export function seriesToolDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SERIES_READ_TOOL,
      'Read a series of experiments: its members in order with each one’s status, owner, planned day and steps done, how many are approved, which is next due and how many samples there are across them. Give the series or any experiment in it. Use it for "how is the cell assay series going" or "which series is EXP-0145 in".',
      seriesReadSchema,
    ),
  ]
}

export function partsToolDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PARTS_READ_TOOL,
      'Read the parts of an experiment that runs over several days: each part’s day and date, who does it, whether it is done, current or later, and its steps. Use it for "which part are we on" or "when is part 4".',
      partsReadSchema,
    ),
  ]
}

export function planningProposalDefs(): ProviderToolDef[] {
  const note =
    'The person sees a card and presses a button to do it; nothing changes until they do.'
  return [
    toolDef(
      EXPERIMENT_START_TOOL,
      `Propose starting a new experiment from a template in a project. ${note}`,
      proposeExperimentStartSchema,
    ),
    toolDef(
      RECORD_ASSIGN_TOOL,
      `Propose handing a record to someone: they become its assignee. ${note}`,
      proposeRecordAssignSchema,
    ),
    toolDef(
      RECORD_ASK_TOOL,
      `Propose asking someone about a record: a comment on it that mentions them, so they are told. ${note}`,
      proposeRecordAskSchema,
    ),
    toolDef(
      BOOKING_REPEAT_TOOL,
      `Propose booking an instrument on a repeating pattern, such as every Monday 9 to 10 for 8 weeks. The card lists the dates. ${note}`,
      proposeBookingRepeatSchema,
    ),
    toolDef(
      TIMER_START_TOOL,
      `Propose starting a timer on a step of a notebook or protocol, such as a 30 minute incubation. The person gets the usual timer and alert. ${note}`,
      proposeTimerStartSchema,
    ),
    toolDef(
      STEP_DONE_TOOL,
      `Propose finishing a protocol step of an experiment, or reopening it, with an optional note. With no step named it is the current step. ${note}`,
      proposeStepDoneSchema,
    ),
    toolDef(
      STEP_RESULT_TOOL,
      `Propose recording a result, such as a measurement, against a protocol step of an experiment. With no step named it is the current step. ${note}`,
      proposeStepResultSchema,
    ),
    toolDef(
      SERIES_ADD_TOOL,
      `Propose adding an experiment to a series of experiments, so they read as one piece of work. The series is made if it is not one yet. The experiment itself is not changed. ${note}`,
      proposeSeriesAddSchema,
    ),
    toolDef(
      SERIES_REMOVE_TOOL,
      `Propose taking an experiment out of the series it is in. The experiment itself is not changed. ${note}`,
      proposeSeriesRemoveSchema,
    ),
      PART_ADD_TOOL,
      `Propose adding a part (a day or stage) to an experiment, after its last part. ${note}`,
      proposePartAddSchema,
    ),
    toolDef(
      PART_UPDATE_TOOL,
      `Propose changing a part of an experiment: its title, its day or who does it. With no part named it is the current part. ${note}`,
      proposePartUpdateSchema,
    ),
    toolDef(
      PART_DONE_TOOL,
      `Propose marking a part that has no steps as done, or reopening it. With no part named it is the current part. ${note}`,
      proposePartDoneSchema,
    ),
    toolDef(
      SHIPMENT_SEND_TOOL,
      `Propose sending samples or items to a partner or a courier: a shipment with its list of items. ${note}`,
      proposeShipmentSendSchema,
    ),
    toolDef(
      SHIPMENT_RECEIVE_TOOL,
      `Propose marking a shipment that was on its way as received. Name any items that did not arrive. ${note}`,
      proposeShipmentReceiveSchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// What is waiting on the person.
// ---------------------------------------------------------------------------

function hrefOf(link: WorkItemLink): string {
  if ('params' in link) {
    return Object.entries(link.params).reduce(
      (path, [key, value]) => path.replace(`$${key}`, String(value)),
      link.to as string,
    )
  }
  return link.to
}

export async function readInbox(
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = inboxReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const limit = parsed.data.limit ?? 15
  let page: Awaited<ReturnType<typeof fetchInboxPage>>
  try {
    page = await fetchInboxPage(context.client, 'needs-action', undefined)
  } catch {
    return { text: 'The inbox could not be read just now.', isError: true }
  }
  const items = page.items.slice(0, limit).map((item) => ({
    what: item.kind.replaceAll('_', ' '),
    title: item.title,
    identifier: item.identifier,
    reason: item.reason,
    due: item.dueAt,
    overdue: item.state === 'overdue',
    open: hrefOf(itemLink(item)),
  }))
  return {
    text: JSON.stringify({
      waitingOnPerson: page.total,
      shown: items.length,
      items,
      note:
        page.total === 0
          ? 'Nothing is waiting on the person.'
          : 'Each item has a link in `open`; give it as a link the person can press.',
    }),
    isError: false,
  }
}

// ---------------------------------------------------------------------------
// The steps of an experiment.
// ---------------------------------------------------------------------------

interface StepRow {
  block_id: string
  step_number: number | null
  step_text: string | null
  status: 'done' | 'in_progress' | 'not_started'
  is_current: boolean
  completed_at: string | null
  completed_by_user_id: string | null
  note: string | null
  result_count: number
}

const stepLabel = (row: StepRow) =>
  `${row.step_number ?? '·'}. ${(row.step_text ?? 'Untitled step').slice(0, 80)}`

function stepRows(client: DataClient, recordId: string): Promise<StepRow[]> {
  return client.rpc<StepRow[]>('record_steps', { p_record_id: recordId })
}

/** The step the person means: words from it, or else the current one. */
function pickStep(
  rows: readonly StepRow[],
  words: string | undefined,
  recordName: string,
): Lookup<StepRow> {
  if (rows.length === 0) {
    return {
      ok: false,
      message: `${recordName} has no protocol steps. Tell the person.`,
    }
  }
  const wanted = (words ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (wanted.length === 0) {
    const current = rows.find((row) => row.is_current)
    return current
      ? { ok: true, value: current }
      : {
          ok: false,
          message: `Every step of ${recordName} is already done. Tell the person.`,
        }
  }
  const matches = rows.filter((row) =>
    wanted.every((word) => (row.step_text ?? '').toLowerCase().includes(word)),
  )
  if (matches.length === 1) return { ok: true, value: matches[0] }
  if (matches.length === 0) {
    return {
      ok: false,
      message: `No step in ${recordName} matches "${words}". Its steps are: ${rows
        .slice(0, 8)
        .map(stepLabel)
        .join('; ')}.`,
    }
  }
  return {
    ok: false,
    message: `More than one step fits: ${matches
      .slice(0, 6)
      .map(stepLabel)
      .join('; ')}. Ask the person which one.`,
  }
}

export async function readSteps(
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = stepsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const record = await findRecord(context.client, parsed.data.record)
  if (!record.ok) return { text: record.message, isError: true }
  let rows: StepRow[]
  try {
    rows = await stepRows(context.client, record.value.id)
  } catch {
    return { text: 'The steps could not be read just now.', isError: true }
  }
  const names = await memberNames(context.client).catch(
    () => new Map<string, string>(),
  )
  const done = rows.filter((row) => row.status === 'done').length
  return {
    text: JSON.stringify({
      experiment: recordTarget(record.value),
      stepsDone: done,
      stepCount: rows.length,
      steps: rows.map((row) => ({
        number: row.step_number,
        step: row.step_text,
        status: row.status,
        current: row.is_current,
        finishedBy: row.completed_by_user_id
          ? (names.get(row.completed_by_user_id) ?? null)
          : null,
        finishedAt: row.completed_at,
        note: row.note,
        results: row.result_count,
      })),
      open: recordLink(record.value.id),
      note:
        rows.length === 0
          ? 'This experiment has no protocol steps.'
          : 'Status comes from what is on the page: done when ticked, in progress when it has a note, a result or a running timer.',
    }),
    isError: false,
  }
}

// ---------------------------------------------------------------------------
// A series of experiments.
// ---------------------------------------------------------------------------

interface SeriesMemberRow {
  member_record_id: string
  member_number: number
  identifier: string
  title: string
  status: string
  owner_user_id: string
  reviewer_user_id: string | null
  planned_on: string | null
  day_offset: number | null
  steps_total: number
  steps_done: number
  sample_count: number
}

interface RecordSeriesRow {
  series_record_id: string
  series_identifier: string
  series_title: string
  member_number: number
  member_total: number
}

export async function readSeries(
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = seriesReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const { client } = context
  const record = await findRecord(client, parsed.data.record, ['experiment'])
  if (!record.ok) return { text: record.message, isError: true }
  try {
    const membership = (
      await client.rpc<RecordSeriesRow[]>('record_series', {
        p_record_id: record.value.id,
      })
    ).at(0)
    const head = membership
      ? {
          id: membership.series_record_id,
          identifier: membership.series_identifier,
          title: membership.series_title,
        }
      : record.value
    const members = await client.rpc<SeriesMemberRow[]>('series_members', {
      p_series_record_id: head.id,
    })
    if (!membership && members.length === 0) {
      return {
        text: `${recordTarget(record.value)} is not in a series and does not head one. Say so, and offer to add it to a series.`,
        isError: false,
      }
    }
    const rollup = await client.rpc<Record<string, unknown>>('series_rollup', {
      p_series_record_id: head.id,
    })
    const names = await memberNames(client).catch(
      () => new Map<string, string>(),
    )
    return {
      text: JSON.stringify({
        series: `${head.identifier} · ${head.title}`,
        askedAbout: recordTarget(record.value),
        position: membership
          ? `${membership.member_number} of ${membership.member_total}`
          : null,
        rollup,
        members: members.map((row) => ({
          number: row.member_number,
          experiment: `${row.identifier} · ${row.title}`,
          status: row.status.replaceAll('_', ' '),
          owner: names.get(row.owner_user_id) ?? null,
          reviewer: row.reviewer_user_id
            ? (names.get(row.reviewer_user_id) ?? null)
            : null,
          plannedOn: row.planned_on,
          day: row.day_offset,
          stepsDone: row.steps_done,
          stepCount: row.steps_total,
          samples: row.sample_count,
          open: recordLink(row.member_record_id),
        })),
        open: `/experiments/${head.id}/series`,
        note: 'Experiments you cannot read are left out of the list.',
      }),
      isError: false,
    }
  } catch {
    return { text: 'The series could not be read just now.', isError: true }
  }
}

// ---------------------------------------------------------------------------
// The parts of an experiment.
// ---------------------------------------------------------------------------

interface PartRow {
  part_id: string
  part_number: number
  title: string
  day_offset: number
  due_on: string | null
  assignee_user_id: string | null
  status: 'done' | 'now' | 'later'
  is_current: boolean
  opened_at: string | null
  completed_at: string | null
  completed_by_user_id: string | null
  step_count: number
  steps_done: number
  block_count: number
  result_count: number
}

const partLabel = (row: PartRow) =>
  `Part ${row.part_number}: ${row.title.slice(0, 80)}`

function partRows(client: DataClient, recordId: string): Promise<PartRow[]> {
  return client.rpc<PartRow[]>('record_parts', { p_record_id: recordId })
}

/** The part the person means: a number, words from its title, or else the current one. */
function pickPart(
  rows: readonly PartRow[],
  words: string | undefined,
  recordName: string,
): Lookup<PartRow> {
  if (rows.length === 0) {
    return {
      ok: false,
      message: `${recordName} has no parts. Tell the person.`,
    }
  }
  const text = (words ?? '').trim().toLowerCase()
  if (!text) {
    const current = rows.find((row) => row.is_current)
    return current
      ? { ok: true, value: current }
      : {
          ok: false,
          message: `Every part of ${recordName} is already done. Tell the person.`,
        }
  }
  const number = /^(?:part\s*)?(\d{1,3})$/.exec(text)
  if (number) {
    const row = rows.find((part) => part.part_number === Number(number[1]))
    if (row) return { ok: true, value: row }
  }
  const wanted = text.split(/\s+/).filter(Boolean)
  const matches = rows.filter((row) =>
    wanted.every((word) => row.title.toLowerCase().includes(word)),
  )
  if (matches.length === 1) return { ok: true, value: matches[0] }
  const list = (list: readonly PartRow[]) =>
    list.slice(0, 8).map(partLabel).join('; ')
  return matches.length === 0
    ? {
        ok: false,
        message: `No part of ${recordName} matches "${words}". Its parts are: ${list(rows)}.`,
      }
    : {
        ok: false,
        message: `More than one part fits: ${list(matches)}. Ask the person which one.`,
      }
}

export async function readParts(
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = partsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const record = await findRecord(context.client, parsed.data.record)
  if (!record.ok) return { text: record.message, isError: true }
  let rows: PartRow[]
  try {
    rows = await partRows(context.client, record.value.id)
  } catch {
    return { text: 'The parts could not be read just now.', isError: true }
  }
  const names = await memberNames(context.client).catch(
    () => new Map<string, string>(),
  )
  const who = (id: string | null) => (id ? (names.get(id) ?? null) : null)
  return {
    text: JSON.stringify({
      experiment: recordTarget(record.value),
      partsDone: rows.filter((row) => row.status === 'done').length,
      partCount: rows.length,
      parts: rows.map((row) => ({
        number: row.part_number,
        title: row.title,
        day: row.day_offset + 1,
        date: row.due_on,
        status: row.status,
        current: row.is_current,
        doneBy: who(row.completed_by_user_id),
        doneAt: row.completed_at,
        assignee: who(row.assignee_user_id),
        steps: row.step_count,
        stepsDone: row.steps_done,
        results: row.result_count,
      })),
      open: recordLink(record.value.id),
      note:
        rows.length === 0
          ? 'This experiment is a single page with no parts.'
          : 'Day 1 is the day the experiment started. A part with steps is done when its steps are.',
    }),
    isError: false,
  }
}

// ---------------------------------------------------------------------------
// Lookups by the names people use.
// ---------------------------------------------------------------------------

type Lookup<T> = { ok: true; value: T } | { ok: false; message: string }

function pick<T>(
  rows: readonly T[],
  wanted: string,
  what: string,
  label: (row: T) => string,
  exact: (row: T) => boolean,
): Lookup<T> {
  const exacts = rows.filter(exact)
  if (exacts.length === 1) return { ok: true, value: exacts[0] }
  if (rows.length === 1) return { ok: true, value: rows[0] }
  if (rows.length === 0) {
    return { ok: false, message: `No ${what} matches "${wanted}".` }
  }
  return {
    ok: false,
    message: `More than one ${what} matches "${wanted}": ${rows
      .slice(0, 8)
      .map(label)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

interface RecordRow {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  project_id: string | null
  metadata_version: number
  archived_at: string | null
  assignee_user_id: string | null
}

const RECORD_COLUMNS =
  'id,identifier,title,kind,status,project_id,metadata_version,archived_at,assignee_user_id'

async function findRecord(
  client: DataClient,
  text: string,
  kinds?: readonly string[],
): Promise<Lookup<RecordRow>> {
  const like = likeValue(text)
  const kindFilter = kinds ? `&kind=in.(${kinds.join(',')})` : ''
  const rows = await client.list<RecordRow>(
    'records',
    `?deleted_at=is.null${kindFilter}&or=(identifier.ilike.${like},title.ilike.${like})&select=${RECORD_COLUMNS}&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'record',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

async function findProject(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; key: string; title: string }>> {
  const like = likeValue(text)
  const rows = await client.list<{ id: string; key: string; title: string }>(
    'projects',
    `?archived_at=is.null&or=(key.ilike.${like},title.ilike.${like},display_id.ilike.${like})&select=id,key,title&order=title.asc&limit=6`,
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

async function findPerson(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; name: string }>> {
  const members = await memberNames(client)
  const lower = text.trim().toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const all = [...members.entries()].map(([id, name]) => ({ id, name }))
  const matches = all.filter((member) => {
    const name = member.name.toLowerCase()
    return words.every((word) => name.includes(word))
  })
  return pick(
    matches,
    text,
    'person',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

// ---------------------------------------------------------------------------
// Cards.
// ---------------------------------------------------------------------------

const recordLink = (id: string) => `/records/${id}`

function recordTarget(row: RecordRow): string {
  return `${row.identifier} · ${row.title}`
}

function shipmentRows(
  client: DataClient,
  query: string,
): Promise<
  Array<{
    id: string
    number: number
    direction: string
    status: string
    counterparty: string
  }>
> {
  return client.list(
    'shipments',
    `?${query}&select=id,number,direction,status,counterparty&order=number.desc&limit=8`,
  )
}

async function repeatProposal(
  tool: PlanningProposeToolName,
  input: z.infer<typeof proposeBookingRepeatSchema>,
  context: LabToolContext,
): Promise<PlanningOutcome> {
  const { client, workspaceId, timeZone } = context
  const now = context.now ?? new Date()
  const match = await resolveInstrument(client, workspaceId, input.instrument)
  if (!match.ok) return match
  const instrument = match.instrument
  if (instrument.out_of_service_at) {
    return {
      ok: false,
      message: `${instrumentLabel(instrument)} is out of service, so it cannot be booked until it is back. Tell the person.`,
    }
  }
  const today = localFromInstant(now, timeZone).slice(0, 10)
  if (input.firstDay < today) {
    return { ok: false, message: 'The first day has already passed.' }
  }
  const startsLocal = `${input.firstDay}T${input.startTime}`
  const first = instantFromLocal(startsLocal, timeZone)
  const length = input.endTime
    ? (instantFromLocal(
        `${input.firstDay}T${input.endTime}`,
        timeZone,
      ).getTime() -
        first.getTime()) /
      60_000
    : (input.durationMinutes ?? 60)
  if (length <= 0) {
    return { ok: false, message: 'The end must be after the start.' }
  }
  const endTime =
    input.endTime ??
    localFromInstant(
      new Date(first.getTime() + length * 60_000),
      timeZone,
    ).slice(11)
  if (endTime <= input.startTime) {
    return {
      ok: false,
      message:
        'A repeating booking has to finish on the day it starts. Shorten it, or book it day by day.',
    }
  }
  const weekdays =
    input.frequency === 'weekly'
      ? (input.weekdays ?? [
          ((new Date(`${input.firstDay}T12:00:00Z`).getUTCDay() + 6) % 7) + 1,
        ])
      : []
  const every = input.every ?? 1
  const dates = repeatDates({
    firstDay: input.firstDay,
    frequency: input.frequency,
    every,
    weekdays,
    count: input.count ?? null,
    until: input.until ?? null,
  })
  if (dates.length === 0) {
    return { ok: false, message: 'That pattern has no dates in it.' }
  }
  // Which of the dates the instrument is already taken on.
  const taken: string[] = []
  for (const date of dates.slice(0, 60)) {
    const start = instantFromLocal(`${date}T${input.startTime}`, timeZone)
    const end = new Date(start.getTime() + length * 60_000)
    const clashes = await bookingsBetween(
      client,
      workspaceId,
      start,
      end,
      instrument.id,
    )
    if (clashes.length > 0) taken.push(date)
  }
  const dayText = (date: string) =>
    describeSlot(
      instantFromLocal(`${date}T12:00`, timeZone),
      instantFromLocal(`${date}T13:00`, timeZone),
      timeZone,
    ).split(',')[0]
  const shown = dates.slice(0, 12).map(dayText)
  const more =
    dates.length > shown.length
      ? ` and ${dates.length - shown.length} more`
      : ''
  const bookingTitle = input.bookingTitle ?? input.title
  const changes = [
    {
      label: 'Pattern',
      before: null,
      after: `${describeRepeatRule({
        frequency: input.frequency,
        intervalCount: every,
        weekdays,
        offsetsDays: [],
        startsOn: input.firstDay,
      })}, ${input.startTime}–${endTime}`,
    },
    {
      label: `Dates (${dates.length})`,
      before: null,
      after: `${shown.join(', ')}${more}`,
    },
    { label: 'Booking', before: null, after: bookingTitle },
  ]
  if (taken.length > 0) {
    changes.push({
      label: 'Already booked',
      before: null,
      after: `${taken.map(dayText).join(', ')}: those will be skipped.`,
    })
  }
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      target: instrumentLabel(instrument),
      deepLink: '/schedule',
      changes,
      action: {
        kind: 'booking.repeat',
        input: {
          kind: 'booking',
          title: bookingTitle,
          startsOn: input.firstDay,
          timezone: timeZone,
          frequency: input.frequency,
          interval: every,
          weekdays: input.frequency === 'weekly' ? weekdays : null,
          endsOn: input.until && !input.count ? input.until : null,
          maxOccurrences: input.count ?? null,
          resourceId: instrument.id,
          startTime: input.startTime,
          endTime,
          notes: input.notes ?? null,
        },
      },
    },
  }
}

export async function buildPlanningProposal(
  name: PlanningProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<PlanningOutcome> {
  const { client } = context
  switch (name) {
    case EXPERIMENT_START_TOOL: {
      const parsed = proposeExperimentStartSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const template = await findRecord(client, input.template, [
        'protocol_template',
      ])
      if (!template.ok) return template
      if (template.value.archived_at || template.value.status !== 'active') {
        return {
          ok: false,
          message: `${recordTarget(template.value)} is not an active template, so experiments cannot be started from it yet. Tell the person.`,
        }
      }
      const project = await findProject(client, input.project)
      if (!project.ok) return project
      const experimentTitle = input.experimentTitle ?? null
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: project.value.title,
          deepLink: recordLink(template.value.id),
          changes: [
            {
              label: 'Template',
              before: null,
              after: recordTarget(template.value),
            },
            { label: 'Project', before: null, after: project.value.title },
            {
              label: 'Title',
              before: null,
              after: experimentTitle ?? template.value.title,
            },
          ],
          action: {
            kind: 'experiment.start',
            templateRecordId: template.value.id,
            projectId: project.value.id,
            title: experimentTitle,
          },
        },
      }
    }
    case RECORD_ASSIGN_TOOL: {
      const parsed = proposeRecordAssignSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      if (record.value.archived_at) {
        return {
          ok: false,
          message: `${recordTarget(record.value)} is archived, so it cannot be handed on.`,
        }
      }
      const person = await findPerson(client, input.assignee)
      if (!person.ok) return person
      const members = await memberNames(client)
      const before = record.value.assignee_user_id
        ? (members.get(record.value.assignee_user_id) ?? 'Someone')
        : 'No one'
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes: [{ label: 'Assigned to', before, after: person.value.name }],
          action: {
            kind: 'record.assign',
            recordId: record.value.id,
            expectedMetadataVersion: record.value.metadata_version,
            userId: person.value.id,
          },
        },
      }
    }
    case RECORD_ASK_TOOL: {
      const parsed = proposeRecordAskSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const people: Array<{ id: string; name: string }> = []
      for (const text of input.people) {
        const person = await findPerson(client, text)
        if (!person.ok) return person
        if (!people.some((existing) => existing.id === person.value.id)) {
          people.push(person.value)
        }
      }
      if (people.some((person) => person.id === context.userId)) {
        return {
          ok: false,
          message: 'The person cannot mention themselves. Ask who to ask.',
        }
      }
      const body = `${people.map((person) => `@${person.name}`).join(' ')} ${input.message.trim()}`
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes: [
            {
              label: 'Ask',
              before: null,
              after: people.map((person) => person.name).join(', '),
            },
            { label: 'Comment', before: null, after: body },
          ],
          action: {
            kind: 'record.comment',
            recordId: record.value.id,
            body,
            mentions: people.map((person) => person.id),
          },
        },
      }
    }
    case BOOKING_REPEAT_TOOL: {
      const parsed = proposeBookingRepeatSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      return repeatProposal(name, parsed.data, context)
    }
    case TIMER_START_TOOL: {
      const parsed = proposeTimerStartSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const blocks = await client.list<{
        id: string
        payload: Record<string, unknown>
      }>(
        'blocks',
        `?record_id=eq.${encodeURIComponent(record.value.id)}&type=eq.procedure_step&order=order.asc&select=id,payload&limit=200`,
      )
      const words = (input.step ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      const text = (block: { payload: Record<string, unknown> }) =>
        typeof block.payload.text === 'string' ? block.payload.text : ''
      let steps = blocks.filter((block) =>
        words.every((word) => text(block).toLowerCase().includes(word)),
      )
      if (!input.minutes) {
        const timed = steps.filter(
          (block) => stepDurationSeconds(block.payload) !== null,
        )
        if (timed.length > 0) steps = timed
      }
      if (steps.length === 0) {
        return {
          ok: false,
          message: input.step
            ? `No step in ${recordTarget(record.value)} matches "${input.step}".`
            : `${recordTarget(record.value)} has no steps to time.`,
        }
      }
      if (steps.length > 1) {
        return {
          ok: false,
          message: `More than one step fits: ${steps
            .slice(0, 6)
            .map((block) => `"${text(block).slice(0, 60)}"`)
            .join('; ')}. Ask the person which one, naming these.`,
        }
      }
      const step = steps[0]
      const seconds = input.minutes ? Math.round(input.minutes * 60) : null
      const length = seconds ?? stepDurationSeconds(step.payload)
      if (length === null) {
        return {
          ok: false,
          message:
            'That step has no length of its own. Ask the person how many minutes.',
        }
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes: [
            {
              label: 'Step',
              before: null,
              after: text(step).slice(0, 200) || 'Untitled step',
            },
            { label: 'Timer', before: null, after: formatDuration(length) },
          ],
          action: { kind: 'timer.start', blockId: step.id, seconds },
        },
      }
    }
    case STEP_DONE_TOOL: {
      const parsed = proposeStepDoneSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const step = pickStep(
        await stepRows(client, record.value.id),
        input.step,
        recordTarget(record.value),
      )
      if (!step.ok) return step
      const reopen = input.done === false
      const changes = [
        {
          label: 'Step',
          before: null,
          after: stepLabel(step.value),
        },
        {
          label: 'Status',
          before: step.value.status === 'done' ? 'Done' : 'Not done',
          after: reopen ? 'Reopened' : 'Done',
        },
      ]
      if (input.note) {
        changes.push({ label: 'Note', before: null, after: input.note })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes,
          action: {
            kind: 'step.done',
            blockId: step.value.block_id,
            done: !reopen,
            note: input.note ?? null,
          },
        },
      }
    }
    case PART_ADD_TOOL: {
      const parsed = proposePartAddSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const changes: { label: string; before: string | null; after: string }[] =
        [{ label: 'New part', before: null, after: input.part }]
      if (input.day !== undefined) {
        changes.push({
          label: 'Day',
          before: null,
          after: String(input.day + 1),
        })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes,
          action: {
            kind: 'part.add',
            recordId: record.value.id,
            title: input.part,
            dayOffset: input.day ?? null,
          },
        },
      }
    }
    case PART_UPDATE_TOOL: {
      const parsed = proposePartUpdateSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      if (
        input.newTitle === undefined &&
        input.day === undefined &&
        input.assignee === undefined &&
        !input.unassign
      ) {
        return {
          ok: false,
          message: 'Nothing to change. Ask the person what to change.',
        }
      }
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const part = pickPart(
        await partRows(client, record.value.id),
        input.part,
        recordTarget(record.value),
      )
      if (!part.ok) return part
      const members = await memberNames(client).catch(
        () => new Map<string, string>(),
      )
      const changes: { label: string; before: string | null; after: string }[] =
        [{ label: 'Part', before: null, after: partLabel(part.value) }]
      if (input.newTitle !== undefined) {
        changes.push({
          label: 'Title',
          before: part.value.title,
          after: input.newTitle,
        })
      }
      if (input.day !== undefined) {
        changes.push({
          label: 'Day',
          before: String(part.value.day_offset + 1),
          after: String(input.day + 1),
        })
      }
      let assigneeUserId: string | null = null
      if (input.assignee !== undefined) {
        const person = await findPerson(client, input.assignee)
        if (!person.ok) return person
        assigneeUserId = person.value.id
        changes.push({
          label: 'Done by',
          before: part.value.assignee_user_id
            ? (members.get(part.value.assignee_user_id) ?? 'Someone')
            : 'No one',
          after: person.value.name,
        })
      } else if (input.unassign) {
        changes.push({
          label: 'Done by',
          before: part.value.assignee_user_id
            ? (members.get(part.value.assignee_user_id) ?? 'Someone')
            : 'No one',
          after: 'No one',
        })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes,
          action: {
            kind: 'part.update',
            partId: part.value.part_id,
            title: input.newTitle ?? null,
            dayOffset: input.day ?? null,
            assigneeUserId,
            clearAssignee: assigneeUserId === null && input.unassign === true,
          },
        },
      }
    }
    case PART_DONE_TOOL: {
      const parsed = proposePartDoneSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const part = pickPart(
        await partRows(client, record.value.id),
        input.part,
        recordTarget(record.value),
      )
      if (!part.ok) return part
      if (part.value.step_count > 0) {
        return {
          ok: false,
          message: `${partLabel(part.value)} has steps, so it is done when its steps are. Use the step tool instead.`,
        }
      }
      const reopen = input.done === false
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes: [
            { label: 'Part', before: null, after: partLabel(part.value) },
            {
              label: 'Status',
              before: part.value.status === 'done' ? 'Done' : 'Not done',
              after: reopen ? 'Reopened' : 'Done',
            },
          ],
          action: {
            kind: 'part.done',
            partId: part.value.part_id,
            done: !reopen,
          },
        },
      }
    }
    case STEP_RESULT_TOOL: {
      const parsed = proposeStepResultSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const record = await findRecord(client, input.record)
      if (!record.ok) return record
      const step = pickStep(
        await stepRows(client, record.value.id),
        input.step,
        recordTarget(record.value),
      )
      if (!step.ok) return step
      const value = String(input.value)
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(record.value),
          deepLink: recordLink(record.value.id),
          changes: [
            { label: 'Step', before: null, after: stepLabel(step.value) },
            {
              label: input.label,
              before: null,
              after: input.unit ? `${value} ${input.unit}` : value,
            },
          ],
          action: {
            kind: 'step.result',
            blockId: step.value.block_id,
            label: input.label,
            value,
            unit: input.unit ?? null,
          },
        },
      }
    }
    case SERIES_ADD_TOOL: {
      const parsed = proposeSeriesAddSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const series = await findRecord(client, input.series, ['experiment'])
      if (!series.ok) return series
      const member = await findRecord(client, input.experiment, ['experiment'])
      if (!member.ok) return member
      if (series.value.id === member.value.id) {
        return {
          ok: false,
          message:
            'An experiment cannot be in its own series. Ask the person which experiment to add.',
        }
      }
      const already = (
        await client.rpc<RecordSeriesRow[]>('record_series', {
          p_record_id: member.value.id,
        })
      ).at(0)
      if (already) {
        return {
          ok: false,
          message: `${recordTarget(member.value)} is already in ${already.series_identifier}. An experiment is in one series at most; offer to take it out of that one first.`,
        }
      }
      const changes = [
        { label: 'Series', before: null, after: recordTarget(series.value) },
        { label: 'Add', before: null, after: recordTarget(member.value) },
      ]
      if (input.plannedOn) {
        changes.push({
          label: 'Planned for',
          before: null,
          after: input.plannedOn,
        })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(series.value),
          deepLink: `/experiments/${series.value.id}/series`,
          changes,
          action: {
            kind: 'series.add',
            seriesRecordId: series.value.id,
            memberRecordId: member.value.id,
            plannedOn: input.plannedOn ?? null,
          },
        },
      }
    }
    case SERIES_REMOVE_TOOL: {
      const parsed = proposeSeriesRemoveSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const member = await findRecord(client, input.experiment, ['experiment'])
      if (!member.ok) return member
      const membership = (
        await client.rpc<RecordSeriesRow[]>('record_series', {
          p_record_id: member.value.id,
        })
      ).at(0)
      if (!membership) {
        return {
          ok: false,
          message: `${recordTarget(member.value)} is not in a series. Tell the person.`,
        }
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: recordTarget(member.value),
          deepLink: `/experiments/${membership.series_record_id}/series`,
          changes: [
            {
              label: 'Series',
              before: `${membership.series_identifier} · ${membership.series_title}`,
              after: 'Not in a series',
            },
          ],
          action: { kind: 'series.remove', memberRecordId: member.value.id },
        },
      }
    }
    case SHIPMENT_SEND_TOOL: {
      const parsed = proposeShipmentSendSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      let projectId: string | null = null
      if (input.project) {
        const project = await findProject(client, input.project)
        if (!project.ok) return project
        projectId = project.value.id
      }
      const lines: ManifestLine[] = []
      for (const [index, item] of input.items.entries()) {
        let recordId: string | null = null
        let identifier: string | null = null
        let title = item.title ?? ''
        if (item.record) {
          const rows = await client.list<{
            id: string
            identifier: string
            title: string
          }>(
            'records',
            `?deleted_at=is.null&identifier=ilike.${encodeURIComponent(item.record.trim().replaceAll(/[*,()"\\]/g, ' '))}&select=id,identifier,title&limit=2`,
          )
          if (rows.length === 1) {
            recordId = rows[0].id
            identifier = rows[0].identifier
            title = item.title ?? rows[0].title
          } else if (!item.title) {
            return {
              ok: false,
              message: `No record matches "${item.record}". Give it a title to ship it as a plain line, or ask the person.`,
            }
          }
        }
        lines.push({
          key: String(index),
          record_id: recordId,
          identifier,
          title,
          quantity: item.quantity === undefined ? '' : String(item.quantity),
          unit: item.unit ?? '',
          note: item.note ?? '',
        })
      }
      const direction = input.direction ?? 'outbound'
      const markSent = input.markSent ?? true
      const changes = [
        {
          label: direction === 'outbound' ? 'To' : 'From',
          before: null,
          after: input.counterparty,
        },
        {
          label: `Items (${lines.length})`,
          before: null,
          after:
            lines
              .slice(0, 12)
              .map(
                (line) =>
                  `${line.identifier ? `${line.identifier} · ` : ''}${line.title}${line.quantity ? ` × ${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : ''}`,
              )
              .join('\n') +
            (lines.length > 12 ? `\n…and ${lines.length - 12} more` : ''),
        },
      ]
      if (input.carrier || input.trackingReference) {
        changes.push({
          label: 'Carrier',
          before: null,
          after: [input.carrier, input.trackingReference]
            .filter(Boolean)
            .join(' · '),
        })
      }
      if (input.expectedOn) {
        changes.push({
          label: 'Expected',
          before: null,
          after: input.expectedOn,
        })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: input.counterparty,
          deepLink: '/shipments',
          changes,
          action: {
            kind: 'shipment.create',
            markSent,
            input: {
              direction,
              counterparty: input.counterparty,
              carrier: input.carrier ?? '',
              trackingReference: input.trackingReference ?? '',
              expectedOn: input.expectedOn ?? '',
              notes: input.notes ?? '',
              projectId,
              lines,
            },
          },
        },
      }
    }
    case SHIPMENT_RECEIVE_TOOL: {
      const parsed = proposeShipmentReceiveSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const number = /^(?:shp-?)?0*(\d+)$/i.exec(input.shipment.trim())?.[1]
      const rows = await shipmentRows(
        client,
        number
          ? `number=eq.${number}`
          : `status=eq.in_transit&counterparty=ilike.${likeValue(input.shipment)}`,
      )
      const found = pick(
        rows,
        input.shipment,
        'shipment',
        (row) => `${shipmentReference(row.number)} from ${row.counterparty}`,
        (row) => number !== undefined && row.number === Number(number),
      )
      if (!found.ok) return found
      const shipment = found.value
      if (shipment.status !== 'in_transit') {
        return {
          ok: false,
          message: `${shipmentReference(shipment.number)} is ${shipment.status.replaceAll('_', ' ')}, so it cannot be received. Tell the person.`,
        }
      }
      const items = await client.list<{
        id: string
        title: string
        identifier: string | null
      }>(
        'shipment_items',
        `?shipment_id=eq.${encodeURIComponent(shipment.id)}&order=position.asc&select=id,title,identifier`,
      )
      const missingWords = (input.missing ?? []).map((text) =>
        text.toLowerCase(),
      )
      const isMissing = (item: { title: string; identifier: string | null }) =>
        missingWords.some(
          (word) =>
            item.title.toLowerCase().includes(word) ||
            item.identifier?.toLowerCase() === word,
        )
      const unmatched = missingWords.filter(
        (word) =>
          !items.some(
            (item) =>
              item.title.toLowerCase().includes(word) ||
              item.identifier?.toLowerCase() === word,
          ),
      )
      if (unmatched.length > 0) {
        return {
          ok: false,
          message: `Nothing on ${shipmentReference(shipment.number)} matches "${unmatched[0]}". Its items are: ${items.map((item) => item.title).join(', ')}.`,
        }
      }
      const label = (item: { title: string; identifier: string | null }) =>
        item.identifier ? `${item.identifier} · ${item.title}` : item.title
      const changes = [
        {
          label: `Arrived (${items.filter((item) => !isMissing(item)).length})`,
          before: null,
          after:
            items
              .filter((item) => !isMissing(item))
              .slice(0, 12)
              .map(label)
              .join('\n') || 'None',
        },
      ]
      if (missingWords.length > 0) {
        changes.push({
          label: 'Did not arrive',
          before: null,
          after: items.filter(isMissing).map(label).join('\n'),
        })
      }
      if (input.conditionNote) {
        changes.push({
          label: 'Condition',
          before: null,
          after: input.conditionNote,
        })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${shipmentReference(shipment.number)} · ${shipment.counterparty}`,
          deepLink: '/shipments',
          changes,
          action: {
            kind: 'shipment.receive',
            shipmentId: shipment.id,
            results: items.map((item) => ({
              item_id: item.id,
              received: !isMissing(item),
              note: null,
            })),
            conditionNote: input.conditionNote ?? '',
          },
        },
      }
    }
  }
}
