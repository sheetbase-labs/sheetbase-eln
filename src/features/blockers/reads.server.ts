/**
 * The "why" read: what stands between a record and its next step, said the
 * way the record page says it. For an experiment that is what stops it being
 * submitted (the readiness list the Overview and the submit dialog show, from
 * `experiment_readiness`), the gates that hold a part, the next open step, the
 * review it is waiting on and what is overdue, plus open flags on its
 * datasets. For a dataset it is its open flags and missing units. With no
 * record it does the same for the person's own open experiments.
 *
 * Every date, person and status is written as the app writes it, so the model
 * can quote the result without turning ids or ISO dates into prose itself.
 */
import { z } from 'zod'

import { BLOCKERS_READ_TOOL } from './tool'
import { readinessItems } from '#/components/overview/readiness'
import type {
  ExperimentReadiness,
  ReadinessItem,
} from '#/components/overview/readiness'
import {
  experimentStatusVocabulary,
  statusLabel,
} from '#/components/scientific/status-vocabularies'
import {
  invalid,
  likeValue,
  memberNames,
  toolDef,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findRecord } from '#/lib/assistant-planning.server'
import type { RecordRow } from '#/lib/assistant-planning.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'
import type { DataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'

export const blockersReadSchema = z.strictObject({
  record: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'The experiment or dataset, by its ID (EXP-0142, DS-0311) or name. Leave out for the person’s own open experiments.',
    ),
})

export function blockersReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      BLOCKERS_READ_TOOL,
      'Answer "why" and "what next" in one call: what stops an experiment being submitted for review (the same list its page shows), the next open step, gates that hold a part, the review it waits on, what is overdue and open flags on its datasets; for a dataset, its open flags and why each was raised. Leave record out for the person’s own open experiments. Use it for "what is stopping EXP-12", "can I submit", "what is left", "why is DS-3 flagged" or "what is holding up my work", before any other lookup.',
      blockersReadSchema,
    ),
  ]
}

export const isBlockersReadTool = (name: string): boolean =>
  name === BLOCKERS_READ_TOOL

type Result = { text: string; isError: boolean }

function answered<T>(body: T): Result {
  return { text: JSON.stringify(body), isError: false }
}

/** Statuses after which nothing is left to submit. */
const SETTLED = new Set(['approved', 'completed', 'locked', 'archived'])

/** Statuses an experiment is worked on in. */
const OPEN_STATUSES = ['draft', 'planned', 'in_progress', 'returned', 'on_hold']

const MY_EXPERIMENTS = 5

interface Say {
  timeZone: string
  now: Date
  names: Map<string, string>
}

const day = (value: string | null | undefined, say: Say) =>
  value ? formatDate(value, { timeZone: say.timeZone }) : null

const person = (id: string | null | undefined, say: Say) =>
  id ? (say.names.get(id) ?? 'someone outside the workspace') : null

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

const link = (identifier: string) => `[${identifier}](/records/${identifier})`

// ---------------------------------------------------------------------------
// Experiments.
// ---------------------------------------------------------------------------

interface ExperimentRow extends RecordRow {
  planned_end: string | null
  decision: string | null
  created_by_user_id: string | null
}

interface GateRow {
  gate_kind: 'block' | 'part'
  part_number: number | null
  label: string
  mode: 'warn' | 'block'
  met: boolean
  overridden: boolean
  missing: string[] | null
}

interface SubmissionRow {
  state: string
  submitted_at: string
  due_at: string | null
  assigned_reviewer_user_ids: string[]
}

interface DatasetIssueRow {
  id: string
  display_id: string | null
  name: string
  out_of_range_count: string | number
  missing_unit_count: string | number
  missing_unit_fields: string[] | null
  experiment_display_id?: string | null
}

interface FlagRow {
  dataset_id: string
  kind: string
  reason: string
  source: string
  set_at: string
}

const EXPERIMENT_COLUMNS =
  'id,identifier,title,kind,status,project_id,metadata_version,archived_at,assignee_user_id,planned_end,decision,created_by_user_id'

/** A read that may fail on its own without spoiling the rest of the answer. */
async function maybe<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read
  } catch {
    return fallback
  }
}

function itemLine(item: ReadinessItem): { what: string; detail?: string } {
  return item.detail
    ? { what: item.title, detail: item.detail }
    : { what: item.title }
}

async function datasetIssues(client: DataClient, filter: string, say: Say) {
  const datasets = await client.list<DatasetIssueRow>(
    'rpc/dataset_list_summary',
    `?${filter}&issue_count=gt.0&archived_at=is.null&order=updated_at.desc&limit=10`,
  )

  if (datasets.length === 0) return []

  const flags = await maybe(
    client.list<FlagRow>(
      'dataset_value_flags',
      `?dataset_id=in.(${datasets.map((row) => encodeURIComponent(row.id)).join(',')})&cleared_at=is.null&select=dataset_id,kind,reason,source,set_at&order=set_at.desc&limit=50`,
    ),
    [],
  )

  return datasets.map((row) => ({
    dataset: row.display_id ?? row.name,
    name: row.name,
    flags: flags
      .filter((flag) => flag.dataset_id === row.id)
      .map((flag) => ({
        what: FLAG_WORDS.get(flag.kind) ?? flag.kind.replaceAll('_', ' '),
        reason: flag.reason,
        raised: day(flag.set_at, say),
        by: flag.source === 'system' ? 'a rule on the field' : 'a person',
      })),
    missingUnits: row.missing_unit_fields ?? [],
  }))
}

/** Open flags on the datasets an experiment links to, as its page lists them. */
async function linkedDatasetIssues(
  client: DataClient,
  recordId: string,
  say: Say,
) {
  const links = await client.list<{ target_identifier: string }>(
    'record_links',
    `?source_record_id=eq.${encodeURIComponent(recordId)}&target_kind=eq.dataset&select=target_identifier&limit=50`,
  )

  const ids = [...new Set(links.map((row) => row.target_identifier))]

  if (ids.length === 0) return []

  return datasetIssues(
    client,
    `display_id=in.(${ids.map((id) => encodeURIComponent(`"${id}"`)).join(',')})`,
    say,
  )
}

const FLAG_WORDS = new Map([
  ['out_of_range', 'Value outside its range'],
  ['missing_unit', 'Missing unit'],
  ['above_curve', 'Above the standard curve'],
  ['high_cv', 'Replicates vary too much (high CV)'],
])

async function experimentBlockers(
  client: DataClient,
  record: ExperimentRow,
  say: Say,
) {
  const [readiness, gates, submissions, datasets] = await Promise.all([
    maybe(
      client.rpc<ExperimentReadiness>('experiment_readiness', {
        p_record_id: record.id,
      }),
      null,
    ),
    maybe(
      client.rpc<GateRow[]>('record_gates', { p_record_id: record.id }),
      [],
    ),
    maybe(
      client.list<SubmissionRow>(
        'review_submissions',
        `?record_id=eq.${encodeURIComponent(record.id)}&order=submitted_at.desc&limit=1&select=state,submitted_at,due_at,assigned_reviewer_user_ids`,
      ),
      [],
    ),
    maybe(linkedDatasetIssues(client, record.id, say), []),
  ])

  const items = readinessItems(
    readiness,
    [],
    (id) => person(id, say) ?? 'Someone',
  )

  // The server refuses a submission while a comment thread is open, though the
  // list shows the thread as a warning; say what the submit itself does.
  const stopsIt = (item: ReadinessItem) =>
    item.severity === 'blocking' || item.kind === 'comment'

  const stops = items.filter(stopsIt)
  const warns = items.filter((item) => !stopsIt(item))
  const openSteps = readiness?.openSteps ?? []
  const next = openSteps.at(0)

  const holding = gates.filter((gate) => !gate.met && !gate.overridden)

  const latest = submissions.at(0)
  const inReview = latest?.state === 'submitted'
  const status = statusLabel(experimentStatusVocabulary, record.status)
  const settled = SETTLED.has(record.status)

  const today = say.now.toISOString().slice(0, 10)
  const overdue: string[] = []

  if (
    !settled &&
    !inReview &&
    record.planned_end &&
    record.planned_end < today
  ) {
    overdue.push(`Planned to finish by ${day(record.planned_end, say)}.`)
  }

  if (inReview && latest.due_at && latest.due_at < say.now.toISOString()) {
    overdue.push(`The review was due ${day(latest.due_at, say)}.`)
  }

  const reviewers = (latest?.assigned_reviewer_user_ids ?? [])
    .map((id) => person(id, say))
    .filter((name): name is string => name !== null)

  let answer: string

  if (settled) {
    answer = `${record.identifier} is ${status.toLowerCase()}: there is nothing left to submit.`
  } else if (inReview) {
    answer = `${record.identifier} is already submitted (${day(latest.submitted_at, say)}) and waiting on ${reviewers.length > 0 ? reviewers.join(' and ') : 'its reviewers'}.`
  } else if (readiness === null) {
    answer = `The readiness of ${record.identifier} could not be read just now; open its page for the list.`
  } else if (stops.length > 0) {
    answer = `${plural(stops.length, 'thing')} ${stops.length === 1 ? 'stops' : 'stop'} ${record.identifier} being submitted: ${stops.map((item) => item.title).join('; ')}.`
  } else {
    answer = `Nothing stops ${record.identifier} being submitted${warns.length > 0 ? `, but ${plural(warns.length, 'thing')} ${warns.length === 1 ? 'is' : 'are'} worth clearing first` : ''}. The person submits it from its page.`
  }

  return {
    experiment: link(record.identifier),
    title: record.title,
    status,
    answer,
    canSubmit: !settled && !inReview && readiness !== null && readiness.ready,
    stopsSubmission: stops.map(itemLine),
    worthClearingFirst: warns.map(itemLine),
    nextStep: next
      ? `${next.stepNumber === null ? '' : `Step ${next.stepNumber}: `}${next.text}`
      : null,
    stepsLeft: openSteps.length,
    partsHeldBack: holding.map((gate) => ({
      what:
        gate.gate_kind === 'part'
          ? `Part ${gate.part_number ?? ''} cannot start yet`
          : gate.label,
      stillMissing: gate.missing ?? [],
      blocks: gate.mode === 'block',
    })),
    review: latest
      ? {
          state: REVIEW_WORDS.get(latest.state) ?? latest.state,
          submitted: day(latest.submitted_at, say),
          due: day(latest.due_at, say),
          reviewers,
        }
      : null,
    overdue,
    datasetFlags: datasets,
    rule:
      readiness?.mode === 'block'
        ? 'In this workspace open steps and a missing decision stop a submission.'
        : readiness?.mode === 'off'
          ? 'This workspace does not check open steps or a decision before submission.'
          : 'In this workspace open steps and a missing decision only warn; they do not stop a submission.',
    note: 'Only a person submits, signs or approves. Dataset flags do not stop a submission on their own; say so if you mention them.',
  }
}

const REVIEW_WORDS = new Map([
  ['submitted', 'In review'],
  ['returned', 'Returned for changes'],
  ['rejected', 'Rejected'],
  ['approved', 'Approved'],
  ['withdrawn', 'Withdrawn'],
])

// ---------------------------------------------------------------------------
// Datasets.
// ---------------------------------------------------------------------------

async function findDataset(
  client: DataClient,
  text: string,
): Promise<{ id: string; display_id: string | null; name: string } | null> {
  const rows = await client.list<{
    id: string
    display_id: string | null
    name: string
  }>(
    'datasets',
    `?or=(display_id.ilike.${likeValue(text)},name.ilike.${likeValue(text)})&select=id,display_id,name&order=updated_at.desc&limit=5`,
  )

  const lower = text.trim().toLowerCase()

  return (
    rows.find((row) => row.display_id?.toLowerCase() === lower) ??
    (rows.length === 1 ? rows[0] : null)
  )
}

async function datasetBlockers(
  client: DataClient,
  dataset: { id: string; display_id: string | null; name: string },
  say: Say,
) {
  const issue = (
    await datasetIssues(client, `id=eq.${encodeURIComponent(dataset.id)}`, say)
  ).at(0)

  const label = dataset.display_id ?? dataset.name

  return {
    dataset: label,
    name: dataset.name,
    answer: issue
      ? `${label} has ${plural(issue.flags.length, 'open flag')}${issue.missingUnits.length > 0 ? ` and ${plural(issue.missingUnits.length, 'column')} missing a unit` : ''}.`
      : `${label} has no open flags or missing units.`,
    flags: issue?.flags ?? [],
    missingUnits: issue?.missingUnits ?? [],
    note: 'A flagged value stays as recorded and is left out of analyses and charts until a person clears the flag on the dataset page.',
  }
}

// ---------------------------------------------------------------------------
// The tool.
// ---------------------------------------------------------------------------

export async function runBlockersReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is checked by blockersReadSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<Result> {
  const parsed = blockersReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  const { client } = context

  const say: Say = {
    timeZone: context.timeZone,
    now: context.now ?? new Date(),
    names: await memberNames(client),
  }

  const wanted = parsed.data.record?.trim()

  try {
    if (!wanted)
      return answered(await myExperiments(client, context.userId, say))

    if (/^DS-\d+$/i.test(wanted)) {
      const dataset = await findDataset(client, wanted)

      if (dataset) return answered(await datasetBlockers(client, dataset, say))
    }

    const found = await findRecord(client, wanted)

    if (!found.ok) {
      const dataset = await findDataset(client, wanted)

      return dataset
        ? answered(await datasetBlockers(client, dataset, say))
        : { text: found.message, isError: true }
    }

    if (found.value.kind !== 'experiment') {
      return answered({
        record: link(found.value.identifier),
        status: statusLabel({}, found.value.status),
        answer: `${found.value.identifier} is not an experiment, so it has no submission checks. Read the record for its status and links.`,
      })
    }

    const row = (
      await client.list<ExperimentRow>(
        'records',
        `?id=eq.${encodeURIComponent(found.value.id)}&select=${EXPERIMENT_COLUMNS}&limit=1`,
      )
    ).at(0)

    return answered(
      await experimentBlockers(
        client,
        row ?? {
          ...found.value,
          planned_end: null,
          decision: null,
          created_by_user_id: null,
        },
        say,
      ),
    )
  } catch {
    return {
      text: 'What holds this up could not be read just now.',
      isError: true,
    }
  }
}

async function myExperiments(client: DataClient, userId: string, say: Say) {
  const mine = encodeURIComponent(userId)

  const rows = await client.list<ExperimentRow>(
    'records',
    `?kind=eq.experiment&deleted_at=is.null&archived_at=is.null&status=in.(${OPEN_STATUSES.join(',')})&or=(created_by_user_id.eq.${mine},assignee_user_id.eq.${mine})&select=${EXPERIMENT_COLUMNS}&order=updated_at.desc&limit=${MY_EXPERIMENTS}`,
  )

  if (rows.length === 0) {
    return {
      answer:
        'The person has no open experiments of their own. Ask which experiment they mean.',
      experiments: [],
    }
  }

  const each = await Promise.all(
    rows.map((row) => experimentBlockers(client, row, say)),
  )

  return {
    answer: `Their ${plural(each.length, 'open experiment')}, most recently changed first.`,
    experiments: each.map((one) => ({
      experiment: one.experiment,
      title: one.title,
      status: one.status,
      answer: one.answer,
      nextStep: one.nextStep,
      overdue: one.overdue,
    })),
    note: 'Read one experiment with this tool for its full list.',
  }
}
