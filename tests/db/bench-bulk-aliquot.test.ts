/**
 * Phase 6 (bench): register_samples, aliquot_sample and
 * sample_release_check_status.
 *
 * Proves, against a freshly migrated sheetbase_test database:
 *  - a pasted list registers whole or not at all, in input order;
 *  - an aliquot split writes one derived container, one consume event and one
 *    lineage link per tube, links the purpose experiment, and refuses the whole
 *    split (writing nothing) when the tubes would overdraw the free balance;
 *  - viewers cannot register or aliquot;
 *  - the release-check status reads the same verdict api.release_sample enforces.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-0000000490aa'
const PROJ_A = '00000000-0000-4000-8000-0000000491aa'
const OWNER_A = 'bench490-owner-a'
const VIEWER_A = 'bench490-viewer-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS_A,
      role: 'authenticated',
    }),
  ])
  return client
}

async function createRecord(
  client: Client,
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [
      PROJ_A,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'Bench Owner', 'bench490-owner@sheetbase.test', true),
      ('${VIEWER_A}', 'Bench Viewer', 'bench490-viewer@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS_A}', 'bench490-a', 'Bench 490');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${VIEWER_A}', 'viewer');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'bench490-a', 'Bench 490', '${OWNER_A}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: VIEWER_A,
    canView: true,
    canEdit: false,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('register_samples', () => {
  it('registers a list in order with its properties', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.register_samples($1, $2::jsonb)`,
      [
        PROJ_A,
        JSON.stringify([
          {
            title: 'Lysate A',
            sampleType: 'lysate',
            quantity: 500,
            quantityUnit: 'µL',
            storageLocation: 'Freezer 1 / Rack 2',
          },
          { title: 'Lysate B' },
        ]),
      ],
    )
    expect(rows.map((r) => r.title)).toEqual(['Lysate A', 'Lysate B'])
    expect(rows[0].kind).toBe('sample')
    expect(rows[0].properties.sampleType).toBe('lysate')
    expect(Number(rows[0].properties.quantity)).toBe(500)
    expect(rows[0].properties.storageLocation).toBe('Freezer 1 / Rack 2')
    expect(rows[1].properties.quantity).toBeUndefined()
    expect(rows[0].identifier).not.toBe(rows[1].identifier)
  })

  it('writes nothing when one item is invalid', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const before = await owner.query(
      `SELECT count(*)::int AS n FROM api.records WHERE kind = 'sample'`,
    )
    await expect(
      owner.query(`SELECT * FROM api.register_samples($1, $2::jsonb)`, [
        PROJ_A,
        JSON.stringify([{ title: 'Fine' }, { title: '   ' }]),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    const after = await owner.query(
      `SELECT count(*)::int AS n FROM api.records WHERE kind = 'sample'`,
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('refuses an empty list and a viewer', async () => {
    const owner = await asAuthenticated(OWNER_A)
    await expect(
      owner.query(`SELECT * FROM api.register_samples($1, '[]'::jsonb)`, [
        PROJ_A,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    const viewer = await asAuthenticated(VIEWER_A)
    await expect(
      viewer.query(`SELECT * FROM api.register_samples($1, $2::jsonb)`, [
        PROJ_A,
        JSON.stringify([{ title: 'Nope' }]),
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('aliquot_sample', () => {
  it('splits a sample into linked tubes in one step', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const experiment = await createRecord(owner, 'experiment', 'Aliquot plan')
    const source = await createRecord(owner, 'sample', 'Master stock', {
      quantity: 100,
      quantityUnit: 'µL',
      storageLocation: 'Freezer 1',
    })
    const { rows } = await owner.query(
      `SELECT api.aliquot_sample(
         p_record_id => $1, p_count => 4, p_quantity_each => 20,
         p_purpose_experiment_id => $2, p_expected_metadata_version => $3,
         p_new_container => '{"storageLocation":"Freezer 1 / Box 3"}'::jsonb
       ) AS result`,
      [source.id, experiment.id, source.metadata_version],
    )
    const result = rows[0].result
    expect(Number(result.sample.properties.quantity)).toBe(20)
    expect(result.derivedSamples).toHaveLength(4)
    expect(result.derivedSamples[0].title).toBe('Master stock aliquot 1 of 4')
    expect(result.derivedSamples[3].title).toBe('Master stock aliquot 4 of 4')
    expect(result.derivedSamples[0].properties.storageLocation).toBe(
      'Freezer 1 / Box 3',
    )
    expect(Number(result.derivedSamples[0].properties.quantity)).toBe(20)

    const events = await owner.query(
      `SELECT count(*)::int AS n FROM api.sample_events
        WHERE record_id = $1 AND operation = 'consume'`,
      [source.id],
    )
    expect(events.rows[0].n).toBe(4)
    const lineage = await owner.query(
      `SELECT count(*)::int AS n FROM api.record_links
        WHERE source_record_id = $1 AND link_type = 'sample'
          AND link_metadata ->> 'origin' = 'withdraw_sample'`,
      [source.id],
    )
    expect(lineage.rows[0].n).toBe(4)
    const expLink = await owner.query(
      `SELECT count(*)::int AS n FROM api.record_links
        WHERE source_record_id = $1 AND target_identifier = $2`,
      [experiment.id, source.identifier],
    )
    expect(expLink.rows[0].n).toBe(1)
  })

  it('refuses the whole split and writes nothing when it would overdraw', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const experiment = await createRecord(owner, 'experiment', 'Too many tubes')
    const source = await createRecord(owner, 'sample', 'Small stock', {
      quantity: 50,
      quantityUnit: 'µL',
    })
    await expect(
      owner.query(`SELECT api.aliquot_sample($1, 3, 20, $2, $3)`, [
        source.id,
        experiment.id,
        source.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB006' })
    const { rows } = await owner.query(
      `SELECT properties, metadata_version FROM api.records WHERE id = $1`,
      [source.id],
    )
    expect(Number(rows[0].properties.quantity)).toBe(50)
    expect(rows[0].metadata_version).toBe(source.metadata_version)
  })

  it('rejects a stale version and a count outside 1 to 96', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const experiment = await createRecord(owner, 'experiment', 'Bad inputs')
    const source = await createRecord(owner, 'sample', 'Versioned stock', {
      quantity: 10,
    })
    await expect(
      owner.query(`SELECT api.aliquot_sample($1, 2, 1, $2, 999)`, [
        source.id,
        experiment.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      owner.query(`SELECT api.aliquot_sample($1, 0, 1, $2, $3)`, [
        source.id,
        experiment.id,
        source.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('is denied to a viewer', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const experiment = await createRecord(owner, 'experiment', 'Viewer plan')
    const source = await createRecord(owner, 'sample', 'Viewer stock', {
      quantity: 10,
    })
    const viewer = await asAuthenticated(VIEWER_A)
    await expect(
      viewer.query(`SELECT api.aliquot_sample($1, 2, 1, $2, $3)`, [
        source.id,
        experiment.id,
        source.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('sample_release_check_status', () => {
  it('reports the checks release_sample would enforce', async () => {
    const owner = await asAuthenticated(OWNER_A)
    await migrator.query(
      `INSERT INTO api.sample_release_rules(workspace_id, sample_type, rules)
       VALUES ($1, '*', $2::jsonb)
       ON CONFLICT (workspace_id, sample_type) DO UPDATE SET rules = EXCLUDED.rules`,
      [
        WS_A,
        JSON.stringify([
          {
            key: 'purity-required',
            kind: 'measurement_required',
            measurement: 'Purity',
            label: 'Purity result',
          },
        ]),
      ],
    )
    const sample = await createRecord(owner, 'sample', 'Needs purity', {
      quantity: 5,
      sampleType: 'unknown-type',
    })
    const { rows } = await owner.query(
      `SELECT api.sample_release_check_status($1) AS status`,
      [sample.id],
    )
    const status = rows[0].status
    expect(status.passed).toBe(false)
    expect(status.failedLabels).toEqual(['Purity result'])
    expect(status.checks).toHaveLength(1)
    expect(status.checks[0].passed).toBe(false)
    expect(status.sampleId).toBe(sample.id)
    await expect(
      owner.query(`SELECT * FROM api.release_sample($1, $2)`, [
        sample.id,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB093' })
  })

  it('refuses a record that is not a sample', async () => {
    const owner = await asAuthenticated(OWNER_A)
    const experiment = await createRecord(owner, 'experiment', 'Not a sample')
    await expect(
      owner.query(`SELECT api.sample_release_check_status($1)`, [
        experiment.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB009' })
  })
})
