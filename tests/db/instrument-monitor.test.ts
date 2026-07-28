/**
 * OPS-006 integration proof for instruments, monitored runs, observations,
 * plate snapshots, QC checks, raw files, lifecycle transitions and RLS.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000606a'
const WS_B = '00000000-0000-4000-8000-00000000606b'
const OWNER_A = 'ops006-owner-a'
const OWNER_B = 'ops006-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createInstrument(
  client: Client,
  name: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_instrument($1, $2)`,
    [WS_A, name],
  )
  return rows[0]
}

async function createRun(
  client: Client,
  name: string,
  runIdentifier: string,
  instrumentId: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_instrument_run($1, $2, $3, $4)`,
    [WS_A, name, runIdentifier, instrumentId],
  )
  return rows[0]
}

async function ingest(
  client: Client,
  runId: string,
  sourceId: string,
  timestamp: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.ingest_observation($1, $2, $3, 'telemetry', $4::timestamptz, '{"cycle":1}'::jsonb)`,
    [WS_A, runId, sourceId, timestamp],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS006 Owner A', 'ops006-owner-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS006 Owner B', 'ops006-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops006-a', 'OPS006 A'),
      ('${WS_B}', 'ops006-b', 'OPS006 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner');`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('OPS-006 create_instrument', () => {
  it('creates an instrument', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'qPCR One')
    expect(instrument).toMatchObject({
      workspace_id: WS_A,
      name: 'qPCR One',
      instrument_type: 'qpcr',
      connection_status: 'disconnected',
    })
  })

  it('rejects empty names', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_instrument($1, $2)`, [WS_A, '  ']),
      'SB034',
    )
  })

  it('rejects cross-workspace access', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.create_instrument($1, $2)`, [
        WS_A,
        'Forbidden instrument',
      ]),
      'SB033',
    )
  })
})

describe('OPS-006 create_instrument_run', () => {
  it('creates a run with stages', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Stages instrument')
    const { rows } = await owner.query(
      `SELECT * FROM api.create_instrument_run($1, $2, $3, $4, 'Test Protocol', NULL, '96', 'Test Operator', 3600, '{}'::text[], '[{"name":"Hold","stageType":"hold","cycleCount":1,"targetTemperature":50,"durationSeconds":120,"config":{}},{"name":"Cycling","stageType":"cycling","cycleCount":40,"targetTemperature":60,"durationSeconds":1800,"config":{}}]'::jsonb)`,
      [WS_A, 'Staged run', 'ops006-staged', instrument.id],
    )
    expect(rows[0].status).toBe('queued')
    const { rows: stages } = await owner.query(
      `SELECT * FROM api.instrument_run_stages WHERE run_id = $1 ORDER BY position`,
      [rows[0].id],
    )
    expect(stages).toHaveLength(2)
    expect(stages.map((stage) => stage.name)).toEqual(['Hold', 'Cycling'])
  })

  it('rejects duplicate run identifiers', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Duplicate instrument')
    await createRun(
      owner,
      'First duplicate run',
      'ops006-duplicate',
      instrument.id,
    )
    await expectDenied(
      owner.query(`SELECT * FROM api.create_instrument_run($1, $2, $3, $4)`, [
        WS_A,
        'Second duplicate run',
        'ops006-duplicate',
        instrument.id,
      ]),
      'SB037',
    )
  })

  it('rejects cross-workspace access', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(
      owner,
      'Cross workspace instrument',
    )
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.create_instrument_run($1, $2, $3, $4)`, [
        WS_A,
        'Forbidden run',
        'ops006-cross-run',
        instrument.id,
      ]),
      'SB033',
    )
  })
})

describe('OPS-006 run lifecycle', () => {
  it('starts a queued run', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Start instrument')
    const run = await createRun(
      owner,
      'Start run',
      'ops006-start',
      instrument.id,
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.start_instrument_run($1, $2)`,
      [WS_A, run.id],
    )
    expect(rows[0].status).toBe('running')
    expect(rows[0].started_at).toBeTruthy()
  })

  it('completes a running run', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Complete instrument')
    const run = await createRun(
      owner,
      'Complete run',
      'ops006-complete',
      instrument.id,
    )
    await owner.query(`SELECT * FROM api.start_instrument_run($1, $2)`, [
      WS_A,
      run.id,
    ])
    const { rows } = await owner.query(
      `SELECT * FROM api.complete_instrument_run($1, $2)`,
      [WS_A, run.id],
    )
    expect(rows[0]).toMatchObject({
      status: 'completed',
      progress_percent: 100,
    })
    expect(rows[0].completed_at).toBeTruthy()
  })

  it('fails a running run', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Fail instrument')
    const run = await createRun(owner, 'Fail run', 'ops006-fail', instrument.id)
    await owner.query(`SELECT * FROM api.start_instrument_run($1, $2)`, [
      WS_A,
      run.id,
    ])
    const { rows } = await owner.query(
      `SELECT * FROM api.fail_instrument_run($1, $2, $3)`,
      [WS_A, run.id, 'Temperature sensor failure'],
    )
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error_message: 'Temperature sensor failure',
    })
  })

  it('rejects starting an already running run', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Double start instrument')
    const run = await createRun(
      owner,
      'Double start run',
      'ops006-double-start',
      instrument.id,
    )
    await owner.query(`SELECT * FROM api.start_instrument_run($1, $2)`, [
      WS_A,
      run.id,
    ])
    await expectDenied(
      owner.query(`SELECT * FROM api.start_instrument_run($1, $2)`, [
        WS_A,
        run.id,
      ]),
      'SB042',
    )
  })
})

describe('OPS-006 ingest_observation idempotency', () => {
  it('ingests a new observation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Ingest instrument')
    const run = await createRun(
      owner,
      'Ingest run',
      'ops006-ingest',
      instrument.id,
    )
    const observation = await ingest(
      owner,
      run.id,
      'obs-new',
      '2026-01-01T10:00:00Z',
    )
    expect(observation.ingestion_status).toBe('received')
  })

  it('returns duplicate for re-ingestion with same source_id', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(
      owner,
      'Duplicate observation instrument',
    )
    const run = await createRun(
      owner,
      'Duplicate observation run',
      'ops006-obs-duplicate',
      instrument.id,
    )
    await ingest(owner, run.id, 'obs-duplicate', '2026-01-01T10:00:00Z')
    const duplicate = await ingest(
      owner,
      run.id,
      'obs-duplicate',
      '2026-01-01T11:00:00Z',
    )
    expect(duplicate.ingestion_status).toBe('duplicate')
  })

  it('preserves original observation on duplicate', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(
      owner,
      'Preserve observation instrument',
    )
    const run = await createRun(
      owner,
      'Preserve observation run',
      'ops006-obs-preserve',
      instrument.id,
    )
    await ingest(owner, run.id, 'obs-preserve', '2026-01-01T10:00:00Z')
    await ingest(owner, run.id, 'obs-preserve', '2026-01-02T10:00:00Z')
    const { rows } = await owner.query(
      `SELECT * FROM api.instrument_observations WHERE run_id = $1 AND source_id = $2`,
      [run.id, 'obs-preserve'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].source_timestamp.toISOString()).toBe(
      '2026-01-01T10:00:00.000Z',
    )
  })

  it('orders observations by source_timestamp', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(
      owner,
      'Ordered observation instrument',
    )
    const run = await createRun(
      owner,
      'Ordered observation run',
      'ops006-obs-order',
      instrument.id,
    )
    await ingest(owner, run.id, 'obs-late', '2026-01-03T10:00:00Z')
    await ingest(owner, run.id, 'obs-early', '2026-01-01T10:00:00Z')
    await ingest(owner, run.id, 'obs-middle', '2026-01-02T10:00:00Z')
    const { rows } = await owner.query(
      `SELECT source_id FROM api.instrument_observations WHERE run_id = $1 ORDER BY source_timestamp`,
      [run.id],
    )
    expect(rows.map((row) => row.source_id)).toEqual([
      'obs-early',
      'obs-middle',
      'obs-late',
    ])
  })
})

describe('OPS-006 plate snapshots', () => {
  it('creates a plate snapshot', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Plate instrument')
    const run = await createRun(
      owner,
      'Plate run',
      'ops006-plate',
      instrument.id,
    )
    const wells = { A1: { fluorescence: 12.5 } }
    const { rows } = await owner.query(
      `SELECT * FROM api.create_plate_snapshot($1, $2, $3::jsonb)`,
      [WS_A, run.id, JSON.stringify(wells)],
    )
    expect(rows[0].wells).toEqual(wells)
  })
})

describe('OPS-006 QC checks', () => {
  it('records a QC check', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'QC instrument')
    const run = await createRun(owner, 'QC run', 'ops006-qc', instrument.id)
    const { rows } = await owner.query(
      `SELECT * FROM api.record_qc_check($1, $2, $3, $4)`,
      [WS_A, run.id, 'Positive control', 'pass'],
    )
    expect(rows[0]).toMatchObject({
      check_type: 'pass',
      check_name: 'Positive control',
    })
  })
})

describe('OPS-006 raw files', () => {
  it('registers a raw file', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'Raw file instrument')
    const run = await createRun(
      owner,
      'Raw file run',
      'ops006-raw',
      instrument.id,
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.register_raw_file($1, $2, $3)`,
      [WS_A, run.id, 'run-data.csv'],
    )
    expect(rows[0]).toMatchObject({
      filename: 'run-data.csv',
      ingestion_status: 'pending',
    })
  })
})

describe('OPS-006 RLS workspace isolation', () => {
  it('workspace A cannot see workspace B runs', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'RLS instrument')
    await createRun(owner, 'RLS run', 'ops006-rls', instrument.id)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(
      `SELECT * FROM api.instrument_runs WHERE workspace_id = '00000000-0000-4000-8000-00000000606a'`,
    )
    expect(rows).toHaveLength(0)
  })

  it('workspace B cannot ingest observations into workspace A runs', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const instrument = await createInstrument(owner, 'RLS ingest instrument')
    const run = await createRun(
      owner,
      'RLS ingest run',
      'ops006-rls-ingest',
      instrument.id,
    )
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(
        `SELECT * FROM api.ingest_observation($1, $2, $3, 'telemetry', $4::timestamptz, '{"cycle":1}'::jsonb)`,
        [WS_A, run.id, 'forbidden-observation', '2026-01-01T10:00:00Z'],
      ),
      'SB033',
    )
  })
})
