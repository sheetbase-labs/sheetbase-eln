/**
 * Real work in the demo's experiments. Two steps:
 *
 * 1. `seedDesignNotebooks` writes each empty experiment's notebook (objective,
 *    method, results, observations, conclusion) from the project's kit, and
 *    gives the numbered runs proper titles.
 * 2. `seedDesignNotebookReviews` puts the experiments that should be under
 *    review or approved through the real review workflow (submit, run checks,
 *    approve or return) so a status always has a submission and a reviewer
 *    behind it. The review rows are then dated inside the project's own
 *    timeline, so Home does not open on a hundred decisions made "today".
 *
 * Both are convergent: an experiment that already has its notebook, or its
 * submission, is left alone.
 */
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'

import type { SeedStep } from './run'
import { withDesignClaims } from './claims'
import { rechainAuditLog } from './design-clock-sweep'
import { DESIGN_SESSION_IDS } from './identities'
import { NAMED_TOPICS, kitFor } from './design-notebook-kits'
import { FINAL_PROJECT_KEY } from './design-lists'
import {
  APPROVAL_NOTES,
  RETURN_NOTES,
  buildNotebook,
} from './design-notebook-content'
import type { NotebookStatus, Topic } from './design-notebook-content'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const PRIYA = '00000000-0000-4000-8000-000000000311'
const MEI = '00000000-0000-4000-8000-000000000312'
const TOM = '00000000-0000-4000-8000-000000000313'
const SAM = '00000000-0000-4000-8000-000000000314'

/** The design day (25 Sep 2026, 09:40 Europe/London); the clock sweep moves it. */
const CLOCK = new Date('2026-09-25T09:40:00+01:00')
const DAY = 86_400_000

const SESSIONS: Record<string, string> = {
  [GARETH]: DESIGN_SESSION_IDS.gareth,
  [PRIYA]: DESIGN_SESSION_IDS.priya,
  [MEI]: DESIGN_SESSION_IDS.mei,
  [SAM]: DESIGN_SESSION_IDS.sam,
  [TOM]: DESIGN_SESSION_IDS.tom,
}

/** Experiments whose notebook the design story already tells in full. */
const HAND_WRITTEN = new Set(['EXP-0142'])

/** Reviewed by "design review lifecycle" itself (signed, amended or returned). */
const HAND_REVIEWED = new Set(['EXP-0127', 'EXP-0130', 'EXP-0136', 'EXP-0138'])

/**
 * Archived projects take no new work, and the retired runs belong to them. The
 * projects are opened while their notebooks and reviews are written, then put
 * back exactly as they were, without leaving an event in the audit log.
 */
async function withArchivedProjectsOpen<T>(
  db: Db,
  fn: () => Promise<T>,
): Promise<T> {
  const archived = await db.execute(sql`
    select id, archived_at from api.projects
     where workspace_id = ${PROCESS} and archived_at is not null`)
  await db.execute(sql`alter table api.projects disable trigger user`)
  try {
    await db.execute(sql`
      update api.projects set archived_at = null
       where workspace_id = ${PROCESS} and archived_at is not null`)
  } finally {
    await db.execute(sql`alter table api.projects enable trigger user`)
  }
  try {
    return await fn()
  } finally {
    await db.execute(sql`alter table api.projects disable trigger user`)
    try {
      for (const project of archived.rows) {
        await db.execute(sql`
          update api.projects
             set archived_at = ${new Date(project.archived_at as string).toISOString()}::timestamptz
           where id = ${String(project.id)}`)
      }
    } finally {
      await db.execute(sql`alter table api.projects enable trigger user`)
    }
  }
}

interface ExperimentRow {
  id: string
  identifier: string
  title: string
  status: string
  projectKey: string
  projectStatus: string
  projectLead: string | null
  createdBy: string
  createdAt: Date
  blocks: number
  maxOrder: number
  submissions: number
}

interface Planned {
  row: ExperimentRow
  topic: Topic
  status: NotebookStatus
  /** Position within the project's numbered runs, oldest first. */
  index: number
  count: number
  generated: boolean
}

function unit01(key: string): number {
  return createHash('sha1').update(key).digest().readUInt32BE(0) / 0xffffffff
}

function blockId(identifier: string, n: number): string {
  const h = createHash('sha1')
    .update(`notebook:${identifier}:${n}`)
    .digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

async function loadExperiments(db: Db): Promise<ExperimentRow[]> {
  const result = await db.execute(sql`
    select r.id, r.identifier, r.title, r.status,
           p.key as project_key, p.status as project_status, p.lead_user_id as project_lead,
           r.created_by_user_id as created_by, r.created_at,
           (select count(*)::int from api.blocks b where b.record_id = r.id) as blocks,
           (select coalesce(max(b."order"), 0)::int from api.blocks b where b.record_id = r.id) as max_order,
           (select count(*)::int from api.review_submissions s where s.record_id = r.id) as submissions
      from api.records r
      join api.projects p on p.id = r.project_id
     where r.workspace_id = ${PROCESS} and r.kind = 'experiment'
     order by r.identifier`)
  return result.rows.map((row) => ({
    id: String(row.id),
    identifier: String(row.identifier),
    title: String(row.title),
    status: String(row.status),
    projectKey:
      FINAL_PROJECT_KEY[String(row.identifier)] ?? String(row.project_key),
    projectStatus: String(row.project_status),
    projectLead: row.project_lead ? String(row.project_lead) : null,
    createdBy: String(row.created_by),
    createdAt: new Date(row.created_at as string),
    blocks: Number(row.blocks),
    maxOrder: Number(row.max_order),
    submissions: Number(row.submissions),
  }))
}

/** How a project's numbered runs end up: older ones done, the newest still moving. */
function generatedStatus(
  projectStatus: string,
  index: number,
  count: number,
): NotebookStatus {
  const position = index + 1
  if (projectStatus === 'complete' || projectStatus === 'archived') {
    return 'approved'
  }
  if (projectStatus === 'in_review') {
    const approved = count >= 4 ? count - 2 : Math.max(0, count - 1)
    return position <= approved ? 'approved' : 'in_review'
  }
  if (projectStatus === 'on_hold') {
    return position <= Math.floor(count * 0.6) ? 'approved' : 'on_hold'
  }
  const approved = Math.floor(count * 0.5)
  const reviewing = count >= 12 ? 2 : count >= 6 ? 1 : 0
  if (position <= approved) return 'approved'
  if (position <= approved + reviewing) return 'in_review'
  return 'in_progress'
}

export function planExperiments(rows: ExperimentRow[]): Planned[] {
  const generatedByProject = new Map<string, ExperimentRow[]>()
  for (const row of rows) {
    if (!/^EXP-[2-4]\d{3}$/.test(row.identifier)) continue
    const list = generatedByProject.get(row.projectKey) ?? []
    list.push(row)
    generatedByProject.set(row.projectKey, list)
  }
  const planned: Planned[] = []
  for (const row of rows) {
    const named = NAMED_TOPICS[row.identifier] as
      (typeof NAMED_TOPICS)[string] | undefined
    if (named) {
      planned.push({
        row,
        topic: { title: row.title, ...named },
        status: row.status as NotebookStatus,
        index: 0,
        count: 1,
        generated: false,
      })
      continue
    }
    const siblings = generatedByProject.get(row.projectKey)
    const index = siblings?.indexOf(row) ?? -1
    if (!siblings || index < 0) continue
    const kit = kitFor(row.projectKey)
    const cycle = Math.floor(index / kit.topics.length)
    const base = kit.topics[index % kit.topics.length]
    planned.push({
      row,
      topic: {
        ...base,
        title: cycle === 0 ? base.title : `${base.title}, repeat ${cycle + 1}`,
        objective:
          cycle === 0
            ? base.objective
            : `Repeat of the earlier run from a fresh starting pool. ${base.objective}`,
      },
      status: generatedStatus(row.projectStatus, index, siblings.length),
      index,
      count: siblings.length,
      generated: true,
    })
  }
  return planned
}

/** Hours and minutes of a working day, stable per key. */
function atWorkingHour(day: Date, key: string): Date {
  const minutes = Math.floor(unit01(`${key}:hm`) * 8 * 60)
  const d = new Date(day)
  d.setUTCHours(8, 0, 0, 0)
  return new Date(d.getTime() + minutes * 60_000)
}

interface Timeline {
  created: Date
  submitted: Date | null
  decided: Date | null
  updated: Date
}

function timelineFor(p: Planned): Timeline {
  const { row } = p
  const done = p.status === 'approved' || p.status === 'returned'
  // Finished work sits before the design's 30-day window ("design list data"
  // dates every other experiment to mid-August); work still moving is recent.
  const pos = p.count > 0 ? p.index / p.count : 0
  const first = done ? Date.UTC(2026, 5, 1) : Date.UTC(2026, 7, 15)
  const length = done ? 57 : 36
  const created = p.generated
    ? atWorkingHour(
        new Date(first + Math.round(pos * length) * DAY),
        row.identifier,
      )
    : new Date(Math.min(row.createdAt.getTime(), CLOCK.getTime() - 3 * DAY))
  const latest =
    done && p.generated ? Date.UTC(2026, 7, 13) : CLOCK.getTime() - DAY
  const cap = (t: number) => new Date(Math.min(t, latest))
  if (done) {
    const submitted = cap(
      created.getTime() + (4 + unit01(`${row.identifier}:s`) * 5) * DAY,
    )
    const decided = cap(
      submitted.getTime() + (1 + unit01(`${row.identifier}:d`) * 2) * DAY,
    )
    return { created, submitted, decided, updated: decided }
  }
  if (p.status === 'in_review') {
    const submitted = new Date(
      Math.max(
        created.getTime() + 2 * DAY,
        CLOCK.getTime() - (1 + unit01(`${row.identifier}:w`) * 4) * DAY,
      ),
    )
    return { created, submitted, decided: null, updated: submitted }
  }
  const age =
    p.status === 'on_hold'
      ? 10 + unit01(`${row.identifier}:h`) * 12
      : unit01(`${row.identifier}:u`) * 4
  return {
    created,
    submitted: null,
    decided: null,
    updated: new Date(
      Math.max(created.getTime() + DAY, CLOCK.getTime() - age * DAY),
    ),
  }
}

async function setStatus(db: Db, id: string, status: string): Promise<void> {
  await db.execute(sql`alter table api.records disable trigger user`)
  try {
    await db.execute(
      sql`update api.records set status = ${status} where id = ${id}`,
    )
  } finally {
    await db.execute(sql`alter table api.records enable trigger user`)
  }
}

export function seedDesignNotebooks(db: Db): Promise<void> {
  return withArchivedProjectsOpen(db, () => writeNotebooks(db))
}

async function writeNotebooks(db: Db): Promise<void> {
  const planned = planExperiments(await loadExperiments(db))
  await db.execute(
    sql`alter table api.blocks disable trigger change_event_blocks`,
  )
  try {
    for (const p of planned) {
      if (HAND_WRITTEN.has(p.row.identifier)) continue
      // Records the design seeded with an Objective only are extended; any
      // other record with blocks has its own story.
      const objectiveOnly = p.row.blocks === 1 && !p.generated
      if (p.row.blocks > 0 && !objectiveOnly) continue
      const firstId = blockId(p.row.identifier, 1)
      const done = await db.execute(
        sql`select 1 from api.blocks where id = ${firstId}`,
      )
      if (done.rows.length) continue

      const blocks = buildNotebook({
        identifier: p.row.identifier,
        status: p.status,
        topic: p.topic,
        kit: kitFor(p.row.projectKey),
        firstOrder: p.row.maxOrder + 1,
      })
      // An existing Objective stays; the new one is only for empty notebooks.
      const fresh = objectiveOnly ? blocks.slice(1) : blocks
      // An approved notebook is closed to edits: open it while writing and
      // put it back as it was.
      const reopen = p.row.status === 'approved'
      if (reopen) await setStatus(db, p.row.id, 'in_progress')
      for (const [n, block] of fresh.entries()) {
        await db.execute(sql`
          insert into api.blocks (id, record_id, type, "order", payload, created_by_user_id)
          values (${blockId(p.row.identifier, n + 1)}, ${p.row.id}, ${block.type},
                  ${block.order}, ${JSON.stringify(block.payload)}::jsonb,
                  ${p.row.createdBy})
          on conflict do nothing`)
      }
      if (reopen) await setStatus(db, p.row.id, 'approved')
      if (p.generated && p.topic.title !== p.row.title) {
        await db.execute(sql`
          update api.records set title = ${p.topic.title}
           where id = ${p.row.id}`)
      }
    }
  } finally {
    await db.execute(
      sql`alter table api.blocks enable trigger change_event_blocks`,
    )
  }
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

interface Marks {
  recordId: string
  submissionId: string
  revisionId: string
  tSubmit: Date
  tDecide: Date | null
  timeline: Timeline
  reviewer: string
  planned: Planned
}

async function dbNow(db: Db): Promise<Date> {
  const result = await db.execute(sql`select clock_timestamp() as t`)
  return new Date(result.rows[0]?.t as string)
}

function people(p: Planned): { reviewers: string[]; submitters: string[] } {
  const lead = p.row.projectLead ?? p.row.createdBy
  const odd = unit01(`${p.row.identifier}:r`) > 0.5
  // Analytical reviews everywhere; Gareth reviews what Mei leads, and shares
  // the stability work with her (the design gives him review there).
  let reviewers: string[]
  if (lead === MEI) reviewers = [GARETH]
  else if (p.row.projectKey === 'lvv-stability-2-8c')
    reviewers = odd ? [GARETH, MEI] : [MEI, GARETH]
  else reviewers = [MEI]
  const submitters = [lead, PRIYA, TOM, SAM, GARETH, MEI].filter(
    (id, i, all) => SESSIONS[id] && all.indexOf(id) === i,
  )
  return { reviewers, submitters }
}

async function submitAndDecide(
  db: Db,
  p: Planned,
  timeline: Timeline,
): Promise<Marks | null> {
  const { row } = p
  const key = `design-notebook-review-${row.identifier.toLowerCase()}`
  const { reviewers, submitters } = people(p)
  const reviewerIds = reviewers
  for (const reviewer of reviewerIds) {
    for (const submitter of submitters) {
      if (submitter === reviewer) continue
      const tSubmit = await dbNow(db)
      let submission: {
        submissionId: string
        revisionId: string
        digest: string
      }
      try {
        submission = await withDesignClaims(
          db,
          submitter,
          PROCESS,
          async (client) => {
            const preview = await client.query<{ source_digest: string }>(
              "select api.preview_submission_digest($1)->>'sourceDigest' as source_digest",
              [row.id],
            )
            const sourceDigest = preview.rows[0]?.source_digest
            if (!sourceDigest) throw new Error('no digest')
            const submitted = await client.query<{
              result: {
                revision: { id: string; integrityDigest: string }
                submission: { id: string }
              }
            }>(
              `select api.submit_record_revision(
                 $1,$2,'default-scientific-review',1,$3::text[],true,$4,$5
               ) as result`,
              [row.id, sourceDigest, [reviewer], key, null],
            )
            const result = submitted.rows.at(0)?.result
            if (!result) throw new Error('submit failed')
            return {
              submissionId: result.submission.id,
              revisionId: result.revision.id,
              digest: result.revision.integrityDigest,
            }
          },
          SESSIONS[submitter],
        )
      } catch (error) {
        console.warn(
          `seed: ${row.identifier} not submitted by ${submitter}/${reviewer}: ${(error as Error).message}`,
        )
        continue
      }

      // The checks run as whoever is about to decide, or as the author while
      // the record waits.
      const runner = p.status === 'in_review' ? submitter : reviewer
      let tDecide: Date | null = null
      try {
        await withDesignClaims(
          db,
          runner,
          PROCESS,
          async (client) => {
            await client.query(
              `select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)`,
              [submission.revisionId, `${key}-checks`],
            )
          },
          SESSIONS[runner],
        )
        if (p.status !== 'in_review') {
          tDecide = await dbNow(db)
          await withDesignClaims(
            db,
            reviewer,
            PROCESS,
            async (client) => {
              if (p.status === 'returned') {
                await client.query(
                  'select api.request_changes_on_review($1,$2,$3,$4) as result',
                  [
                    submission.submissionId,
                    RETURN_NOTES[
                      Math.floor(
                        unit01(`${row.identifier}:n`) * RETURN_NOTES.length,
                      )
                    ],
                    'submitted',
                    submission.digest,
                  ],
                )
              } else {
                await client.query(
                  'select api.approve_review($1,$2,$3,$4) as result',
                  [
                    submission.submissionId,
                    APPROVAL_NOTES[
                      Math.floor(
                        unit01(`${row.identifier}:n`) * APPROVAL_NOTES.length,
                      )
                    ],
                    'submitted',
                    submission.digest,
                  ],
                )
              }
            },
            SESSIONS[reviewer],
          )
        }
      } catch (error) {
        console.warn(
          `seed: ${row.identifier} review step failed (${reviewer}): ${(error as Error).message}`,
        )
      }
      return {
        recordId: row.id,
        submissionId: submission.submissionId,
        revisionId: submission.revisionId,
        tSubmit,
        tDecide,
        timeline,
        reviewer,
        planned: p,
      }
    }
  }
  console.warn(`seed: ${row.identifier} could not be submitted by anyone`)
  return null
}

const REVIEW_TABLES = [
  'change_events',
  'review_submissions',
  'review_decisions',
  'review_check_results',
  'revisions',
  'blocks',
  'records',
] as const

async function stampTimeline(db: Db, marks: Marks[]): Promise<void> {
  for (const table of REVIEW_TABLES) {
    await db.execute(sql.raw(`alter table api.${table} disable trigger user`))
  }
  try {
    for (const m of marks) {
      const t = m.timeline
      const tSub = t.submitted ?? t.created
      const tDec = t.decided ?? tSub
      // Everything the submit, the checks and the decision wrote moves into
      // the project's own timeline, keeping its order.
      const decideFrom = (
        m.tDecide ?? new Date('9999-01-01T00:00:00Z')
      ).toISOString()
      const submitFrom = m.tSubmit.toISOString()
      await db.execute(sql`
        update api.change_events
           set created_at = case
                 when created_at >= ${decideFrom}::timestamptz
                   then ${tDec.toISOString()}::timestamptz + (created_at - ${decideFrom}::timestamptz)
                 else ${tSub.toISOString()}::timestamptz + (created_at - ${submitFrom}::timestamptz)
               end
         where record_id = ${m.recordId} and created_at >= ${submitFrom}::timestamptz`)
      await db.execute(sql`
        update api.review_submissions
           set submitted_at = ${tSub.toISOString()}::timestamptz,
               created_at = ${tSub.toISOString()}::timestamptz,
               updated_at = ${tDec.toISOString()}::timestamptz,
               due_at = ${new Date(tSub.getTime() + 41 * DAY).toISOString()}::timestamptz
         where id = ${m.submissionId}`)
      await db.execute(sql`
        update api.review_decisions
           set created_at = ${tDec.toISOString()}::timestamptz
         where submission_id = ${m.submissionId}`)
      await db.execute(sql`
        update api.review_check_results
           set created_at = ${new Date(tSub.getTime() + 3_600_000).toISOString()}::timestamptz,
               run_at = ${new Date(tSub.getTime() + 3_600_000).toISOString()}::timestamptz
         where revision_id = ${m.revisionId}`)
      await db.execute(sql`
        update api.revisions
           set created_at = ${tSub.toISOString()}::timestamptz,
               updated_at = ${tSub.toISOString()}::timestamptz
         where id = ${m.revisionId}`)
    }
  } finally {
    for (const table of REVIEW_TABLES) {
      await db.execute(sql.raw(`alter table api.${table} enable trigger user`))
    }
  }
}

/** Dates, reviewer and decision on the record itself, for every planned experiment. */
async function stampRecords(
  db: Db,
  planned: Planned[],
  reviewers: Map<string, string>,
): Promise<void> {
  await db.execute(sql`alter table api.records disable trigger user`)
  await db.execute(sql`alter table api.blocks disable trigger user`)
  try {
    for (const p of planned) {
      if (HAND_WRITTEN.has(p.row.identifier) || p.row.submissions > 0) continue
      const t = timelineFor(p)
      const reviewer = reviewers.get(p.row.id) ?? null
      const future =
        p.status === 'in_progress' ||
        p.status === 'planned' ||
        p.status === 'draft' ||
        p.status === 'on_hold'
          ? new Date(
              CLOCK.getTime() +
                (3 + Math.floor(unit01(`${p.row.identifier}:e`) * 18)) * DAY,
            )
              .toISOString()
              .slice(0, 10)
          : null
      const finished =
        p.status === 'approved' ||
        p.status === 'in_review' ||
        p.status === 'returned'
      const kit = kitFor(p.row.projectKey)
      const decision =
        p.status === 'approved' || p.status === 'returned'
          ? decisionFor(p, kit)
          : null
      await db.execute(sql`
        update api.records
           set created_at = ${t.created.toISOString()}::timestamptz,
               updated_at = ${t.updated.toISOString()}::timestamptz,
               reviewer_user_id = coalesce(${finished ? reviewer : null}, reviewer_user_id),
               planned_end = coalesce(${future}::date, planned_end),
               decision = coalesce(${decision?.verdict ?? null}, decision),
               decision_notes = coalesce(${decision?.text ?? null}, decision_notes)
         where id = ${p.row.id}`)
      await db.execute(sql`
        update api.blocks
           set created_at = ${new Date(t.created.getTime() + 3_600_000).toISOString()}::timestamptz,
               updated_at = ${t.updated.toISOString()}::timestamptz
         where record_id = ${p.row.id} and created_at > ${t.updated.toISOString()}::timestamptz`)
    }
  } finally {
    await db.execute(sql`alter table api.blocks enable trigger user`)
    await db.execute(sql`alter table api.records enable trigger user`)
  }
}

function decisionFor(
  p: Planned,
  kit: ReturnType<typeof kitFor>,
): { verdict: string; text: string } | null {
  const blocks = buildNotebook({
    identifier: p.row.identifier,
    status: p.status,
    topic: p.topic,
    kit,
    firstOrder: 1,
  })
  const conclusion = blocks.find((b) => b.type === 'conclusion')
  if (!conclusion) return null
  const { verdict, text } = conclusion.payload as {
    verdict: string
    text: string
  }
  return {
    verdict: verdict === 'not_supported' ? 'refuted' : verdict,
    text,
  }
}

export function seedDesignNotebookReviews(db: Db): Promise<void> {
  return withArchivedProjectsOpen(db, () => runReviews(db))
}

async function runReviews(db: Db): Promise<void> {
  const rows = await loadExperiments(db)
  const planned = planExperiments(rows)
  const marks: Marks[] = []
  const reviewers = new Map<string, string>()

  for (const p of planned) {
    const wantsReview =
      p.status === 'approved' ||
      p.status === 'in_review' ||
      p.status === 'returned'
    if (!wantsReview || p.row.submissions > 0) continue
    if (p.row.identifier === 'EXP-0142' || HAND_REVIEWED.has(p.row.identifier))
      continue

    // Seeded with a status and no review behind it: start from work in
    // progress and let the workflow say the rest.
    if (p.row.status !== 'in_progress') {
      await setStatus(db, p.row.id, 'in_progress')
    }
    const timeline = timelineFor(p)
    const result = await submitAndDecide(db, p, timeline)
    if (result) {
      marks.push(result)
      reviewers.set(p.row.id, result.reviewer)
    }
  }

  // Statuses with no review behind them: paused work.
  await db.execute(sql`alter table api.records disable trigger user`)
  try {
    for (const p of planned) {
      if (p.status === 'on_hold' && p.generated) {
        await db.execute(
          sql`update api.records set status = 'on_hold' where id = ${p.row.id}`,
        )
      }
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger user`)
  }

  await stampTimeline(db, marks)
  await stampRecords(db, planned, reviewers)
  await rechainAuditLog(db, CLOCK.toISOString())
}

/**
 * "design list data" dates every experiment it does not list to mid-August.
 * Work that is still moving is recent, so its last update goes back to where
 * the project's timeline puts it.
 */
export async function seedDesignNotebookDates(db: Db): Promise<void> {
  const planned = planExperiments(await loadExperiments(db))
  await db.execute(sql`alter table api.records disable trigger user`)
  try {
    for (const p of planned) {
      if (!p.generated || p.status === 'approved') continue
      await db.execute(sql`
        update api.records
           set updated_at = ${timelineFor(p).updated.toISOString()}::timestamptz
         where id = ${p.row.id}`)
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger user`)
  }
}
