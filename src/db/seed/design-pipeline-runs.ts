/**
 * The run histories the Pipelines boards show: "Run #22" of the full/empty
 * ratio pipeline stopped at its third step, "Run #61" of the Ambr 250 import
 * check waiting for Gareth to confirm units, and "Run #148" of the clarification
 * step yield. Earlier runs are plain succeeded rows so the run numbers (the
 * oldest run is #1) land where the design has them. Runs the engine seeded with
 * the wall clock are moved onto the design's clock first.
 */
import { and, eq, sql } from 'drizzle-orm'

import * as schema from '../schema'
import { DESIGN_CLOCK, DESIGN_USER_IDS } from './design'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const RUN = (n: number) =>
  `00000000-0000-4000-8000-0000000${(5000 + n).toString(16).padStart(5, '0')}`

async function versionOf(db: Db, displayId: string) {
  const rows = await db.execute<{ id: string }>(
    sql`select v.id from api.pipeline_definition_versions v
          join api.pipeline_definitions d on d.id = v.definition_id
         where d.workspace_id = ${PROCESS} and d.display_id = ${displayId}
         order by v.version desc limit 1`,
  )
  return rows.rows.at(0)?.id
}

async function history(
  db: Db,
  versionId: string,
  base: number,
  count: number,
  spacingMinutes: number,
  endsAt: Date,
) {
  for (let i = 0; i < count; i++) {
    const started = new Date(
      endsAt.getTime() - (count - i) * spacingMinutes * 60_000,
    )
    await db
      .insert(schema.pipelineRuns)
      .values({
        id: RUN(base + i),
        workspaceId: PROCESS,
        definitionVersionId: versionId,
        status: 'succeeded',
        actorUserId: DESIGN_USER_IDS.gareth,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 40_000),
      })
      .onConflictDoNothing()
  }
}

export async function seedDesignPipelineRuns(db: Db) {
  // Run rows are evidence and refuse updates; the seed places its own history.
  await db.execute(
    sql`alter table api.pipeline_runs disable trigger prevent_pipeline_run_evidence_mutation`,
  )
  try {
    await writeRuns(db)
  } finally {
    await db.execute(
      sql`alter table api.pipeline_runs enable trigger prevent_pipeline_run_evidence_mutation`,
    )
  }
}

async function writeRuns(db: Db) {
  // Engine-seeded runs carry the wall clock; put them just before the design's
  // "now" in the order they were made.
  await db.execute(
    sql`with ranked as (
          select id, row_number() over (order by started_at) as n,
                 finished_at - started_at as took
            from api.pipeline_runs
           where workspace_id = ${PROCESS} and started_at > ${DESIGN_CLOCK.toISOString()}::timestamptz
        )
        update api.pipeline_runs r
           set started_at = ${DESIGN_CLOCK.toISOString()}::timestamptz - make_interval(mins => 600 - ranked.n::int * 10),
               finished_at = ${DESIGN_CLOCK.toISOString()}::timestamptz - make_interval(mins => 600 - ranked.n::int * 10) + coalesce(ranked.took, interval '40 seconds')
          from ranked where r.id = ranked.id`,
  )

  // PL-0014: 21 earlier runs, then the failed one (#22) with its steps.
  const full = await versionOf(db, 'PL-0014')
  if (full) {
    await db.execute(
      sql`update api.pipeline_definition_versions
             set configuration = ${JSON.stringify({
               configVersion: 1,
               inputs: [{ name: 'traces', required: false }],
               transform: {
                 language: 'sql',
                 statement: 'SELECT * FROM traces',
               },
               steps: [
                 {
                   name: 'select_cells',
                   language: 'sql',
                   statement: 'SELECT * FROM previous',
                 },
                 {
                   name: 'deconvolve_auc_traces',
                   language: 'python',
                   statement: 'result = previous',
                 },
                 {
                   name: 'save_full_empty_ratio',
                   language: 'sql',
                   statement: 'SELECT * FROM previous',
                 },
                 {
                   name: 'email_owner',
                   language: 'sql',
                   statement: 'SELECT * FROM previous',
                 },
               ],
             })}::jsonb
           where id = ${full}`,
    )
    await history(
      db,
      full,
      0,
      21,
      24 * 60,
      new Date(DESIGN_CLOCK.getTime() - 60 * 60_000),
    )
    await db
      .update(schema.pipelineRuns)
      .set({
        errorCode: 'transform_failed',
        errorMessage:
          'Step 3 ran out of temporary storage (2 GB). Nothing was saved and no ELN actions ran. Temporary data was deleted.',
      })
      .where(eq(schema.pipelineRuns.id, '00000000-0000-4000-8000-000000000404'))
    await db
      .delete(schema.pipelineRunLogs)
      .where(
        eq(
          schema.pipelineRunLogs.runId,
          '00000000-0000-4000-8000-000000000404',
        ),
      )
    const lines: Array<[string, string, Record<string, unknown>?]> = [
      ['info', 'step 3 python: resampling 2,416 traces at 0.1 s'],
      ['info', 'temporary storage 1.6 GB'],
      ['warning', 'temporary storage 2.0 GB · limit reached'],
      [
        'error',
        "OSError: [Errno 28] No space left on device: '/tmp/run/traces_resampled.parquet'",
        { step: 'deconvolve_auc_traces' },
      ],
      [
        'info',
        'run stopped · steps 4 and 5 not started · temporary data deleted',
      ],
    ]
    for (const [i, [level, message, detail]] of lines.entries()) {
      await db.insert(schema.pipelineRunLogs).values({
        workspaceId: PROCESS,
        runId: '00000000-0000-4000-8000-000000000404',
        sequence: i + 1,
        level,
        stage: level === 'error' ? 'step' : 'run',
        message,
        detail: detail ?? {},
        at: new Date(DESIGN_CLOCK.getTime() - 50 * 60_000 + i * 60_000),
      })
    }
  }

  // PL-0007: 147 earlier runs, so the seeded run is #148.
  const yieldVersion = await versionOf(db, 'PL-0007')
  if (yieldVersion)
    await history(
      db,
      yieldVersion,
      100,
      147,
      60,
      new Date(DESIGN_CLOCK.getTime() - 24 * 3_600_000),
    )

  // PL-0003: 57 earlier runs plus the 3 seeded ones, then #61 waiting on Gareth.
  const ambr = await versionOf(db, 'PL-0003')
  if (ambr) {
    await history(
      db,
      ambr,
      300,
      57,
      24 * 60,
      new Date(DESIGN_CLOCK.getTime() - 24 * 3_600_000),
    )
    const waitingId = RUN(900)
    const started = new Date(DESIGN_CLOCK.getTime() - 30 * 60_000)
    const existing = await db
      .select({ id: schema.pipelineRuns.id })
      .from(schema.pipelineRuns)
      .where(
        and(
          eq(schema.pipelineRuns.id, waitingId),
          eq(schema.pipelineRuns.workspaceId, PROCESS),
        ),
      )
    if (!existing.length) {
      await db.insert(schema.pipelineRuns).values({
        id: waitingId,
        workspaceId: PROCESS,
        definitionVersionId: ambr,
        status: 'waiting',
        actorUserId: DESIGN_USER_IDS.gareth,
        startedAt: started,
      })
      await db.insert(schema.pipelineRunPrompts).values({
        workspaceId: PROCESS,
        runId: waitingId,
        stepId: 'confirm_units',
        formSchema: {
          title: 'Confirm units for DS-0298',
          description:
            'This run is waiting for you. It found values without units and won’t guess them on its own.',
          fields: [
            { key: 'unit', label: 'Unit', type: 'text', required: true },
          ],
          proposal: {
            step: 'Confirm units',
            rows: [
              {
                Column: 'Glucose',
                Rows: 84,
                'Values seen': '2.2–3.4',
                'Suggested unit': 'g/L',
                Why: 'Range matches g/L on AMB-25-112',
              },
              {
                Column: 'Osmolality',
                Rows: 84,
                'Values seen': '278–318',
                'Suggested unit': 'mOsm/kg',
                Why: 'Header in the export: "Osmo (mOsm/kg)"',
              },
            ],
          },
        },
        askedUserIds: [DESIGN_USER_IDS.gareth],
        expiresAt: new Date(started.getTime() + 24 * 3_600_000),
        createdAt: started,
      })
    }
  }
}
