import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { migratorUrl, resetTestDatabase, roleUrl, setActorJwt } from './helpers'

const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
const actorId = DESIGN_USER_IDS.gareth
let migrator: Client
let actor: Client
let db: ReturnType<typeof drizzle<typeof schema>>
let inputVersionId: string

async function seed(name: string) {
  const step = designSteps.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing seed step: ${name}`)
  await step.run(db)
}

async function latestRuns() {
  return (
    await migrator.query<{
      key: string
      id: string
      status: string
      attempt: number
      retry_of_run_id: string | null
    }>(
      `select distinct on (d.id) d.key, r.id, r.status, r.attempt, r.retry_of_run_id
         from api.pipeline_definitions d
         join api.pipeline_definition_versions v on v.definition_id = d.id
         join api.pipeline_runs r on r.definition_version_id = v.id
        where d.workspace_id = $1
        order by d.id, r.started_at desc nulls last`,
      [workspaceId],
    )
  ).rows
}

beforeEach(async () => {
  await resetTestDatabase()
  db = drizzle(migratorUrl(), { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
  migrator = new Client({ connectionString: migratorUrl() })
  await migrator.connect()
  for (const name of [
    'design people',
    'design workspaces',
    'design memberships',
    'design projects',
    'design experiments',
    'design work items',
  ]) {
    await seed(name)
  }
  actor = new Client({ connectionString: roleUrl('authenticator') })
  await actor.connect()
  await actor.query('set role authenticated')
  await setActorJwt(actor, actorId, workspaceId)
  const definition = await actor.query(
    `select api.create_dataset_schema_definition($1, 'ambr_250_daily_reading',
       'Ambr 250 daily reading', null, $2::jsonb) as result`,
    [
      workspaceId,
      JSON.stringify([
        { key: 'well', label: 'Well', logicalType: 'text', nullable: false },
        {
          key: 'value',
          label: 'Value',
          logicalType: 'decimal',
          nullable: false,
        },
      ]),
    ],
  )
  const schemaVersionId = definition.rows[0].result.schema_version_id
  await actor.query('select api.publish_dataset_schema_version($1)', [
    schemaVersionId,
  ])
  const dataset = await actor.query(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, 'Seed regression input', $3) returning id`,
    [workspaceId, schemaVersionId, actorId],
  )
  const snapshot = await actor.query(
    'select * from api.snapshot_dataset($1, 1, $2)',
    [dataset.rows[0].id, 'Seed regression snapshot'],
  )
  inputVersionId = snapshot.rows[0].id
})

afterEach(async () => {
  await actor?.end()
  await db?.$client.end()
  await migrator?.end()
})

describe('design pipeline latest-run state', () => {
  it.each(['fresh', 'populated'] as const)(
    'converges the %s fixture to only the intended AUC failure',
    async (state) => {
      let historicalRun: Record<string, unknown> | undefined
      if (state === 'populated') {
        const definition = await actor.query(
          `select * from api.create_pipeline_definition($1,
             'plate_reader_pr_01_export', 'Plate reader PR-01 export', null)`,
          [workspaceId],
        )
        const version = await actor.query(
          'select * from api.create_pipeline_definition_version($1,$2,$3::jsonb)',
          [
            workspaceId,
            definition.rows[0].id,
            JSON.stringify({
              configVersion: 1,
              inputs: [{ name: 'measurements', required: false }],
              transform: {
                language: 'sql',
                statement: 'SELECT well, value FROM measurements',
              },
              output: { mode: 'none' },
            }),
          ],
        )
        await actor.query(
          'select api.publish_pipeline_definition_version($1,$2)',
          [workspaceId, version.rows[0].id],
        )
        const started = await actor.query(
          "select * from api.start_pipeline_run($1,$2,'manual','{}',$3::jsonb)",
          [
            workspaceId,
            version.rows[0].id,
            JSON.stringify({ measurements: inputVersionId }),
          ],
        )
        await actor.query('select api.fail_pipeline_run($1,$2,$3,$4)', [
          workspaceId,
          started.rows[0].id,
          'SB070',
          'Step failed: input column missing',
        ])
        historicalRun = (
          await migrator.query(
            'select * from api.pipeline_runs where id = $1',
            [started.rows[0].id],
          )
        ).rows[0]
        expect(
          (await latestRuns()).filter((run) => run.status === 'failed'),
        ).toHaveLength(2)
        // A newer input exists by reseed time; the retry must still pin the
        // original snapshot, not whichever input the seeder now selects.
        const newerDataset = await actor.query(
          `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
           select workspace_id, schema_version_id, 'Newer input', created_by_user_id
             from api.datasets where name = 'Seed regression input'
           returning id`,
        )
        await actor.query('select * from api.snapshot_dataset($1, 1, $2)', [
          newerDataset.rows[0].id,
          'Newer snapshot',
        ])
      }

      await seed('design pipelines')
      const latest = await latestRuns()
      expect(latest).toHaveLength(7)
      expect(latest.filter((run) => run.status === 'failed')).toEqual([
        expect.objectContaining({
          key: 'full_empty_ratio_from_auc',
          id: '00000000-0000-4000-8000-000000000404',
        }),
      ])
      const plateReader = latest.find(
        (run) => run.key === 'plate_reader_pr_01_export',
      )
      expect(plateReader).toMatchObject({
        status: 'succeeded',
        attempt: state === 'populated' ? 2 : 1,
        retry_of_run_id: historicalRun?.id ?? null,
      })
      if (historicalRun) {
        const runs = await migrator.query(
          'select * from api.pipeline_runs where id = any($1::uuid[]) order by attempt',
          [[historicalRun.id, plateReader?.id]],
        )
        expect(runs.rows[0]).toEqual(historicalRun)
        expect(runs.rows[1]).toMatchObject({
          definition_version_id: historicalRun.definition_version_id,
          input_versions: historicalRun.input_versions,
          parameters: historicalRun.parameters,
          input_digest: historicalRun.input_digest,
        })
        expect(runs.rows[1].started_at.getTime()).toBeGreaterThan(
          runs.rows[0].started_at.getTime(),
        )
      }
      const before = (
        await migrator.query('select * from api.pipeline_runs order by id')
      ).rows
      await seed('design pipelines')
      await seed('design work items')
      await seed('design pipelines')
      expect(
        (await migrator.query('select * from api.pipeline_runs order by id'))
          .rows,
      ).toEqual(before)
      expect(await latestRuns()).toEqual(latest)
    },
  )

  it('leaves a different PR-01 failure visible rather than manufacturing a recovery', async () => {
    await seed('design pipelines')
    const version = await actor.query(
      `select v.id from api.pipeline_definition_versions v
         join api.pipeline_definitions d on d.id = v.definition_id
        where d.workspace_id = $1 and d.key = 'plate_reader_pr_01_export'`,
      [workspaceId],
    )
    const started = await actor.query(
      `select * from api.start_pipeline_run($1,$2,'manual','{}',$3::jsonb,null,
         'manual:00000000-0000-4000-8000-000000000999')`,
      [
        workspaceId,
        version.rows[0].id,
        JSON.stringify({ measurements: inputVersionId }),
      ],
    )
    await actor.query('select api.fail_pipeline_run($1,$2,$3,$4)', [
      workspaceId,
      started.rows[0].id,
      'SB070',
      'Source units need review',
    ])
    const before = (
      await migrator.query('select * from api.pipeline_runs order by id')
    ).rows
    await seed('design pipelines')
    expect(
      (await migrator.query('select * from api.pipeline_runs order by id'))
        .rows,
    ).toEqual(before)
    expect(
      (await latestRuns())
        .filter((run) => run.status === 'failed')
        .map((run) => run.key)
        .sort(),
    ).toEqual(['full_empty_ratio_from_auc', 'plate_reader_pr_01_export'])
  })
})
