/**
 * A dataset made by instrument intake lands where scientists work: it gets the
 * project and owner the intake knew, the instrument run is recorded on its
 * import receipt, and it is linked to the one open experiment that already uses
 * the samples the file names. More than one candidate experiment links to none.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e601'
const PROJECT = '00000000-0000-4000-8000-00000000e611'
const SCHEMA = '00000000-0000-4000-8000-00000000e621'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000e622'
const CONNECTOR = '00000000-0000-4000-8000-00000000e631'
const OWNER = 'link-owner'
const VIEWER = 'link-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let instrument: string

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function record(
  kind: 'sample' | 'experiment',
  title: string,
): Promise<{ id: string; identifier: string }> {
  const { rows } = await owner.query(
    `select id, identifier from api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT, kind, title, kind === 'sample' ? 'available' : 'draft'],
  )
  return rows[0]
}

async function useSample(
  experimentId: string,
  sample: { id: string; identifier: string },
) {
  await migrator.query(
    `insert into api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
     values($1,$2,'sample',$3,'sample',$4)`,
    [experimentId, sample.id, sample.identifier, OWNER],
  )
}

async function run(name: string): Promise<string> {
  const { rows } = await owner.query(
    `select id from api.create_instrument_run(p_workspace_id => $1, p_name => $2, p_run_identifier => $2, p_instrument_id => $3)`,
    [WS, name, instrument],
  )
  return rows[0].id
}

/** A bare dataset and the import receipt a connector run would have left. */
async function intakeDataset(connectorRunId: string, ownerless = true) {
  const { rows } = await migrator.query(
    `insert into api.datasets(workspace_id,schema_version_id,name,lifecycle,revision,intended_use,created_by_user_id)
     values($1,$2,'TB-02 turbidity readings','active',1,'exploratory_research',$3) returning id, display_id`,
    [WS, SCHEMA_VERSION, ownerless ? null : OWNER],
  )
  const dataset = rows[0] as { id: string; display_id: string }
  const version = (
    await migrator.query(
      `insert into api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id)
       values($1,$2,$3,1,'v1',$4) returning id`,
      [dataset.id, WS, SCHEMA_VERSION, OWNER],
    )
  ).rows[0].id
  await migrator.query(
    `insert into api.connector_runs(id,workspace_id,connector_id,status,actor_user_id)
     values($1,$2,$3,'succeeded',$4)`,
    [connectorRunId, WS, CONNECTOR, OWNER],
  )
  const parser = (
    await migrator.query(
      `select id, (select id from api.parser_versions where parser_id = p.id limit 1) as version_id from api.parsers p where workspace_id = $1 limit 1`,
      [WS],
    )
  ).rows[0]
  await migrator.query(
    `insert into api.dataset_imports(workspace_id,dataset_id,mapping,outcome,status,idempotency_key,
       imported_row_ids,parser_provenance,source_provenance,created_by_user_id,snapshot_version_id,connector_run_id,parser_id,parser_version_id)
     values($1,$2,'{}'::jsonb,'{}'::jsonb,'committed',$3,'[]'::jsonb,'{}'::jsonb,'{"checksum":"x"}'::jsonb,$4,$5,$6,$7,$8)`,
    [
      WS,
      dataset.id,
      `key-${connectorRunId}`,
      OWNER,
      version,
      connectorRunId,
      parser?.id ?? null,
      parser?.version_id ?? null,
    ],
  )
  return dataset
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','link-owner@test.invalid',true),
      ('${VIEWER}','Viewer','link-viewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','links','Links');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values ('${PROJECT}','${WS}','lnk','Links','${OWNER}');
    insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle,created_by_user_id)
      values ('${SCHEMA}','${WS}','links','Links','active','${OWNER}');
    insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,revision,created_by_user_id)
      values ('${SCHEMA_VERSION}','${SCHEMA}',1,'active',1,'${OWNER}');
    insert into api.connectors(id,workspace_id,key,name,connector_type)
      values ('${CONNECTOR}','${WS}','turbidimeter','Turbidimeter','instrument')`)
  owner = await actor(OWNER)
  instrument = (
    await owner.query(
      `select id from api.create_instrument($1,'Turbidimeter','other','T-1','SN-1','Vendor','Lab 2',$2)`,
      [WS, OWNER],
    )
  ).rows[0].id
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function link(
  datasetId: string,
  runId: string | null,
  connectorRunId: string | null,
) {
  const { rows } = await owner.query(
    `select api.link_intake_dataset($1,$2,$3,$4,$5) as r`,
    [WS, datasetId, PROJECT, runId, connectorRunId],
  )
  return rows[0].r as {
    experimentId: string | null
    experimentIdentifier: string | null
    candidates: number
  }
}

describe('link_intake_dataset', () => {
  it('gives an ownerless dataset its project and owner, and keeps a set one', async () => {
    const bare = await intakeDataset('00000000-0000-4000-8000-00000000e701')
    await link(bare.id, null, null)
    const after = await migrator.query(
      `select primary_project_id, created_by_user_id from api.datasets where id = $1`,
      [bare.id],
    )
    expect(after.rows[0]).toEqual({
      primary_project_id: PROJECT,
      created_by_user_id: OWNER,
    })

    const owned = await intakeDataset(
      '00000000-0000-4000-8000-00000000e702',
      false,
    )
    await migrator.query(
      `update api.datasets set created_by_user_id = $2 where id = $1`,
      [owned.id, VIEWER],
    )
    await link(owned.id, null, null)
    const kept = await migrator.query(
      `select created_by_user_id from api.datasets where id = $1`,
      [owned.id],
    )
    expect(kept.rows[0].created_by_user_id).toBe(VIEWER)
  })

  it('links the run and dataset to the one open experiment using the samples', async () => {
    const sample = await record('sample', 'Harvest A')
    const experiment = await record('experiment', 'Turbidity check')
    await useSample(experiment.id, sample)
    const runId = await run('run-link-1')
    await owner.query(`select api.record_run_sample_results($1,$2,$3::jsonb)`, [
      WS,
      runId,
      JSON.stringify([{ sample: sample.identifier, checks: [] }]),
    ])
    const connectorRun = '00000000-0000-4000-8000-00000000e703'
    const dataset = await intakeDataset(connectorRun)

    const result = await link(dataset.id, runId, connectorRun)
    expect(result.candidates).toBe(1)
    expect(result.experimentId).toBe(experiment.id)

    const links = await migrator.query(
      `select count(*)::int as n from api.record_links
        where source_record_id = $1 and target_identifier = $2 and link_type = 'dataset'`,
      [experiment.id, dataset.display_id],
    )
    expect(links.rows[0].n).toBe(1)
    const runLinks = await migrator.query(
      `select link_type from api.instrument_run_links where run_id = $1 order by link_type`,
      [runId],
    )
    expect(runLinks.rows.map((row) => row.link_type)).toEqual([
      'experiment',
      'sample',
    ])
    const receipt = await migrator.query(
      `select instrument_id, experiment_record_id, source_provenance ->> 'instrumentRunId' as run
         from api.dataset_imports where connector_run_id = $1`,
      [connectorRun],
    )
    expect(receipt.rows[0]).toEqual({
      instrument_id: instrument,
      experiment_record_id: experiment.id,
      run: runId,
    })
  })

  it('guesses no experiment when two are open on the same samples', async () => {
    const sample = await record('sample', 'Harvest B')
    const first = await record('experiment', 'Check one')
    const second = await record('experiment', 'Check two')
    await useSample(first.id, sample)
    await useSample(second.id, sample)
    const runId = await run('run-link-2')
    await owner.query(`select api.record_run_sample_results($1,$2,$3::jsonb)`, [
      WS,
      runId,
      JSON.stringify([{ sample: sample.identifier, checks: [] }]),
    ])
    const dataset = await intakeDataset('00000000-0000-4000-8000-00000000e704')
    const result = await link(dataset.id, runId, null)
    expect(result.candidates).toBe(2)
    expect(result.experimentId).toBeNull()
  })

  it('is for people who can edit the dataset', async () => {
    const dataset = await intakeDataset('00000000-0000-4000-8000-00000000e705')
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(`select api.link_intake_dataset($1,$2,$3,null,null)`, [
        WS,
        dataset.id,
        PROJECT,
      ]),
      '42501',
    )
  })
})
