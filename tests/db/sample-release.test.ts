/**
 * LAB-02 step 2 contract: release checks, quarantine, disposal and the
 * withdrawal enforcement that depends on them.
 *
 * Proves, against a freshly migrated sheetbase_test database:
 *  - a sample's effective release rule set is the exact per-sample-type row,
 *    else the workspace '*' row, else the canonical fallback;
 *  - release is refused (SB093) when a required check is missing or a check
 *    fails, and succeeds (with the release recorded and audited) when every
 *    check passes;
 *  - quarantine records a required reason and a canonical event;
 *  - disposal records a required reason, reaches the terminal disposed state
 *    and appends a canonical event;
 *  - a quarantined/hold_exceeded sample cannot be withdrawn unless the
 *    experiment is in its allowed-use list, and a disposed sample never can;
 *  - a viewer lacks the release/quarantine/dispose capabilities, and another
 *    workspace's samples and rules stay invisible.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000282a'
const WS_B = '00000000-0000-4000-8000-00000000282b'
const PROJ_A = '00000000-0000-4000-8000-00000000283a'
const PROJ_B = '00000000-0000-4000-8000-00000000283b'
const OWNER_A = 'lab202-owner-a'
const SCIENTIST_A = 'lab202-scientist-a'
const VIEWER_A = 'lab202-viewer-a'
const OWNER_B = 'lab202-owner-b'
const ALLOWED_EXP = '00000000-0000-4000-8000-0000000028aa'
const OTHER_EXP = '00000000-0000-4000-8000-0000000028ab'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let instrumentA: string
let instrumentB: string

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

async function createSample(
  client: Client,
  project: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, 'sample', $2, 'available', ARRAY[]::text[], $3::jsonb)`,
    [project, title, JSON.stringify(properties)],
  )
  return rows[0]
}

/**
 * Create an integration/QC measurement for a sample: a completed instrument run
 * linked to the sample plus one QC check, which the LAB-03 read model surfaces.
 */
async function addQc(
  workspaceId: string,
  instrumentId: string,
  sample: { id: string; identifier: string; title: string },
  checkName: string,
  checkType: 'pass' | 'fail' | 'warning' | 'info',
  value: number | null,
  unit: string | null,
): Promise<void> {
  const { rows: runRows } = await migrator.query(
    `INSERT INTO api.instrument_runs(workspace_id, instrument_id, name, run_identifier, status)
     VALUES ($1, $2, $3, $3, 'completed') RETURNING id`,
    [workspaceId, instrumentId, `RUN-${checkName}-${sample.identifier}`],
  )
  const runId = runRows[0].id
  await migrator.query(
    `INSERT INTO api.instrument_run_links(workspace_id, run_id, linked_record_id, linked_record_identifier, linked_record_title, link_type)
     VALUES ($1, $2, $3, $4, $5, 'sample')`,
    [workspaceId, runId, sample.id, sample.identifier, sample.title],
  )
  await migrator.query(
    `INSERT INTO api.instrument_qc_checks(workspace_id, run_id, check_name, check_type, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      workspaceId,
      runId,
      checkName,
      checkType,
      value == null ? '{}' : JSON.stringify({ value, unit }),
    ],
  )
}

async function setRules(
  workspaceId: string,
  sampleType: string,
  rules: unknown[],
): Promise<void> {
  await migrator.query(
    `INSERT INTO api.sample_release_rules(workspace_id, sample_type, rules)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (workspace_id, sample_type) DO UPDATE SET rules = EXCLUDED.rules`,
    [workspaceId, sampleType, JSON.stringify(rules)],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LAB202 Owner A', 'lab202-owner-a@sheetbase.test', true),
      ('${SCIENTIST_A}', 'LAB202 Scientist A', 'lab202-scientist-a@sheetbase.test', true),
      ('${VIEWER_A}', 'LAB202 Viewer A', 'lab202-viewer-a@sheetbase.test', true),
      ('${OWNER_B}', 'LAB202 Owner B', 'lab202-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'lab202-a', 'LAB202 A'),
      ('${WS_B}', 'lab202-b', 'LAB202 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${SCIENTIST_A}', 'scientist'),
      ('${WS_A}', '${VIEWER_A}', 'viewer'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'lab202-a', 'LAB202 A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'lab202-b', 'LAB202 B', '${OWNER_B}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: SCIENTIST_A,
    canView: true,
    canEdit: true,
  })

  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: VIEWER_A,
    canView: true,
    canEdit: false,
  })
  const { rows: instA } = await migrator.query(
    `INSERT INTO api.instruments(workspace_id, name, instrument_type)
     VALUES ($1, 'QC reader A', 'other') RETURNING id`,
    [WS_A],
  )
  instrumentA = instA[0].id
  const { rows: instB } = await migrator.query(
    `INSERT INTO api.instruments(workspace_id, name, instrument_type)
     VALUES ($1, 'QC reader B', 'other') RETURNING id`,
    [WS_B],
  )
  instrumentB = instB[0].id

  // Workspace default: Endotoxin must be measured and no measurement may fail.
  await setRules(WS_A, '*', [
    {
      key: 'endotoxin-required',
      kind: 'measurement_required',
      measurement: 'Endotoxin',
      label: 'Endotoxin result',
    },
    {
      key: 'no-fail',
      kind: 'no_result',
      result: 'fail',
      label: 'No failed QC',
    },
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('LAB-02 effective release rule set', () => {
  it('falls back to the workspace default and can be overridden per type', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: fallback } = await owner.query(
      `SELECT internal.sample_release_rules($1, 'unknown-type') AS rules`,
      [WS_A],
    )
    expect(fallback[0].rules).toHaveLength(2)
    expect(fallback[0].rules[0].key).toBe('endotoxin-required')

    await setRules(WS_A, 'plasmid', [
      {
        key: 'supercoiled',
        kind: 'measurement_required',
        measurement: 'Supercoiled',
      },
    ])
    const { rows: exact } = await owner.query(
      `SELECT internal.sample_release_rules($1, 'plasmid') AS rules`,
      [WS_A],
    )
    expect(exact[0].rules).toHaveLength(1)
    expect(exact[0].rules[0].key).toBe('supercoiled')
  })
})

describe('LAB-02 release checks', () => {
  it('refuses release when a required measurement is missing', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Missing release data', {
      quantity: 5,
      sampleType: 'unknown-type',
    })
    await expect(
      owner.query(`SELECT * FROM api.release_sample($1, $2)`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB093' })
  })

  it('refuses release when a measurement fails', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Failing release data', {
      quantity: 5,
      sampleType: 'unknown-type',
    })
    await addQc(WS_A, instrumentA, sample, 'Endotoxin', 'fail', 9.9, 'EU/mL')
    await expect(
      owner.query(`SELECT * FROM api.release_sample($1, $2)`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB093' })
  })

  it('releases a quarantined sample and audits the transition when every check passes', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Releasable lot', {
      quantity: 5,
      sampleType: 'unknown-type',
    })
    await addQc(WS_A, instrumentA, sample, 'Endotoxin', 'pass', 0.8, 'EU/mL')
    const { rows: quarantined } = await owner.query(
      `SELECT * FROM api.quarantine_sample($1, $2, 'Awaiting QC')`,
      [sample.id, sample.metadata_version],
    )

    const { rows } = await owner.query(
      `SELECT * FROM api.release_sample($1, $2, 'QC released')`,
      [sample.id, quarantined[0].metadata_version],
    )
    expect(rows[0].status).toBe('available')
    expect(rows[0].properties.releasedAt).toBeTruthy()
    expect(rows[0].properties.releaseChecks.passed).toBe(true)
    expect(rows[0].properties.releaseChecks.failedCount).toBe(0)

    const { rows: events } = await owner.query(
      `SELECT operation, actor_user_id, notes FROM api.sample_events
        WHERE record_id = $1 AND operation = 'release'`,
      [sample.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].actor_user_id).toBe(OWNER_A)
    expect(events[0].notes).toBe('QC released')

    // The release reaches the durable change stream as a status change.
    const { rows: changes } = await owner.query(
      `SELECT payload FROM api.change_events
        WHERE entity_type = 'record' AND entity_uuid = $1
        ORDER BY sequence DESC LIMIT 1`,
      [sample.id],
    )
    expect(changes[0].payload.changes.status).toEqual({
      from: 'quarantined',
      to: 'available',
    })
  })

  it('is denied to a viewer without the sample.release capability', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Release denied', {
      quantity: 5,
    })
    const viewer = await asAuthenticated(VIEWER_A, WS_A)
    await expect(
      viewer.query(`SELECT * FROM api.release_sample($1, $2)`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('LAB-02 quarantine and disposal', () => {
  it('quarantines with a reason and audits it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Quarantine me', {
      quantity: 5,
    })
    await expect(
      owner.query(`SELECT * FROM api.quarantine_sample($1, $2, '')`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB093' })

    const { rows } = await owner.query(
      `SELECT * FROM api.quarantine_sample($1, $2, 'Endotoxin pending')`,
      [sample.id, sample.metadata_version],
    )
    expect(rows[0].status).toBe('quarantined')
    expect(rows[0].properties.quarantineReason).toBe('Endotoxin pending')
    expect(rows[0].properties.quarantinedAt).toBeTruthy()

    const { rows: events } = await owner.query(
      `SELECT operation, actor_user_id, notes FROM api.sample_events
        WHERE record_id = $1 AND operation = 'quarantine'`,
      [sample.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].actor_user_id).toBe(OWNER_A)
    expect(events[0].notes).toBe('Endotoxin pending')
  })

  it('records a disposal with a reason and makes the sample terminal', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const scientist = await asAuthenticated(SCIENTIST_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Dispose me', {
      quantity: 5,
    })
    const { rows: quarantined } = await owner.query(
      `SELECT * FROM api.quarantine_sample($1, $2, 'Contaminated')`,
      [sample.id, sample.metadata_version],
    )

    await expect(
      scientist.query(`SELECT * FROM api.dispose_sample($1, $2, '')`, [
        sample.id,
        quarantined[0].metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB093' })

    const { rows } = await scientist.query(
      `SELECT * FROM api.dispose_sample($1, $2, 'Autoclaved after contamination')`,
      [sample.id, quarantined[0].metadata_version],
    )
    expect(rows[0].status).toBe('disposed')
    expect(rows[0].properties.disposalReason).toBe(
      'Autoclaved after contamination',
    )
    expect(rows[0].properties.disposedAt).toBeTruthy()

    const { rows: events } = await scientist.query(
      `SELECT operation, actor_user_id, notes FROM api.sample_events
        WHERE record_id = $1 AND operation = 'dispose'`,
      [sample.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].actor_user_id).toBe(SCIENTIST_A)
    expect(events[0].notes).toBe('Autoclaved after contamination')

    // Disposed is terminal.
    await expect(
      scientist.query(`SELECT * FROM api.dispose_sample($1, $2, 'again')`, [
        sample.id,
        rows[0].metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('denies quarantine and disposal to a viewer', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Viewer cannot act', {
      quantity: 5,
    })
    const viewer = await asAuthenticated(VIEWER_A, WS_A)
    await expect(
      viewer.query(`SELECT * FROM api.quarantine_sample($1, $2, 'nope')`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      viewer.query(`SELECT * FROM api.dispose_sample($1, $2, 'nope')`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('LAB-02 withdrawal enforcement', () => {
  it('refuses withdrawal of a quarantined sample unless the experiment is allowed', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Quarantined withdrawal', {
      quantity: 10,
      quantityUnit: 'mL',
      allowedUseExperimentIds: [ALLOWED_EXP],
    })
    const { rows: quarantined } = await owner.query(
      `SELECT * FROM api.quarantine_sample($1, $2, 'On hold for review')`,
      [sample.id, sample.metadata_version],
    )

    // No experiment context: refused.
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
        [sample.id, quarantined[0].metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    // A different experiment: refused.
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2, p_experiment_id => $3)`,
        [sample.id, quarantined[0].metadata_version, OTHER_EXP],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    // An allowed experiment: permitted.
    const { rows: consumed } = await owner.query(
      `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 2, p_expected_metadata_version => $2, p_experiment_id => $3)`,
      [sample.id, quarantined[0].metadata_version, ALLOWED_EXP],
    )
    expect(Number(consumed[0].properties.quantity)).toBe(8)
    expect(consumed[0].status).toBe('quarantined')
  })

  it('never withdraws a disposed sample', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Disposed withdrawal', {
      quantity: 10,
    })
    const { rows: quarantined } = await owner.query(
      `SELECT * FROM api.quarantine_sample($1, $2, 'Bad lot')`,
      [sample.id, sample.metadata_version],
    )
    const { rows: disposed } = await owner.query(
      `SELECT * FROM api.dispose_sample($1, $2, 'Discarded')`,
      [sample.id, quarantined[0].metadata_version],
    )
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2, p_experiment_id => $3)`,
        [sample.id, disposed[0].metadata_version, ALLOWED_EXP],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })
})

describe('LAB-02 workspace isolation', () => {
  it('keeps another workspace’s samples, rules and audit invisible', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)

    // Workspace B has its own sample + passing QC. It uses the canonical
    // fallback (no Endotoxin requirement), so it releases even though A's
    // workspace rule would not.
    const sampleB = await createSample(ownerB, PROJ_B, 'B releasable', {
      quantity: 4,
      sampleType: 'unknown-type',
    })
    await addQc(
      WS_B,
      instrumentB,
      sampleB,
      'Some other check',
      'pass',
      1,
      'a.u.',
    )
    const { rows: releasedB } = await ownerB.query(
      `SELECT * FROM api.release_sample($1, $2)`,
      [sampleB.id, sampleB.metadata_version],
    )
    expect(releasedB[0].status).toBe('available')
    expect(releasedB[0].properties.releaseChecks.passed).toBe(true)

    // A cannot see or release B's sample.
    const { rows: hidden } = await ownerA.query(
      `SELECT id FROM api.records WHERE id = $1`,
      [sampleB.id],
    )
    expect(hidden).toHaveLength(0)
    await expect(
      ownerA.query(`SELECT * FROM api.release_sample($1, $2)`, [
        sampleB.id,
        sampleB.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    // A cannot read B's rule rows.
    const { rows: crossRules } = await ownerA.query(
      `SELECT sample_type FROM api.sample_release_rules WHERE workspace_id = $1`,
      [WS_B],
    )
    expect(crossRules).toHaveLength(0)
  })
})
