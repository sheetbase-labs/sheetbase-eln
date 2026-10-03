/**
 * LAB-01 step 1 integration proof: `api.withdraw_sample` withdraws volume for a
 * purpose experiment on top of the canonical consume event. It refuses
 * over-withdrawal (reporting the available amount) and held/quarantined samples
 * unless the experiment is allowed, records the purpose on the durable consume
 * event, and can create a linked derived container sample in one transaction.
 * Every read/write stays workspace-scoped and viewers are denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000002110a'
const WS_B = '00000000-0000-4000-8000-00000002110b'
const PROJ_A = '00000000-0000-4000-8000-00000002210a'
const PROJ_B = '00000000-0000-4000-8000-00000002210b'
const OWNER_A = 'lab001-owner-a'
const VIEWER_A = 'lab001-viewer-a'
const OWNER_B = 'lab001-owner-b'

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

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [
      project,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0]
}

const createSample = (client: Client, project: string, title: string, props = {}) =>
  createRecord(client, project, 'sample', title, props)

const createExperiment = (client: Client, project: string, title: string) =>
  createRecord(client, project, 'experiment', title)

function quantityOf(row: Record<string, any>): number | null {
  const q = row.properties?.quantity
  return q == null ? null : Number(q)
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LAB001 Owner A', 'lab001-owner-a@sheetbase.test', true),
      ('${VIEWER_A}', 'LAB001 Viewer A', 'lab001-viewer-a@sheetbase.test', true),
      ('${OWNER_B}', 'LAB001 Owner B', 'lab001-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'lab001-a', 'LAB001 A'),
      ('${WS_B}', 'lab001-b', 'LAB001 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${VIEWER_A}', 'viewer'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'lab001-a', 'LAB001 A'),
      ('${PROJ_B}', '${WS_B}', 'lab001-b', 'LAB001 B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('LAB-01 withdraw_sample — purpose and quantity', () => {
  it('decrements the sample and records the purpose on the consume event', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Purpose experiment')
    const sample = await createSample(owner, PROJ_A, 'Withdraw me', {
      quantity: 10,
      quantityUnit: 'mL',
    })

    const { rows } = await owner.query(
      `SELECT api.withdraw_sample(
         p_record_id => $1,
         p_quantity => 3,
         p_expected_metadata_version => $2,
         p_purpose_experiment_id => $3,
         p_notes => 'assay use'
       ) AS result`,
      [sample.id, sample.metadata_version, exp.id],
    )
    const result = rows[0].result
    expect(Number(result.sample.properties.quantity)).toBe(7)
    expect(result.sample.status).toBe('available')
    expect(result.derivedSampleId).toBeNull()

    const { rows: events } = await owner.query(
      `SELECT operation, quantity_delta, quantity_before, quantity_after,
              quantity_unit, actor_user_id, purpose_record_id, notes
         FROM api.sample_events
        WHERE record_id = $1 AND operation = 'consume'`,
      [sample.id],
    )
    expect(events).toHaveLength(1)
    expect(Number(events[0].quantity_delta)).toBe(-3)
    expect(Number(events[0].quantity_before)).toBe(10)
    expect(Number(events[0].quantity_after)).toBe(7)
    expect(events[0].quantity_unit).toBe('mL')
    expect(events[0].actor_user_id).toBe(OWNER_A)
    expect(events[0].purpose_record_id).toBe(exp.id)
    expect(events[0].notes).toBe('assay use')
  })

  it('refuses over-withdrawal and reports the available amount', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Overdraw purpose')
    const sample = await createSample(owner, PROJ_A, 'Only two', {
      quantity: 2,
      quantityUnit: 'mL',
    })

    let error: { code?: string; message?: string } | undefined
    try {
      await owner.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1,
           p_quantity => 5,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3
         )`,
        [sample.id, sample.metadata_version, exp.id],
      )
    } catch (e) {
      error = e as { code?: string; message?: string }
    }
    expect(error?.code).toBe('SB006')
    expect(error?.message).toContain('available 2')

    // Nothing was consumed.
    const { rows } = await owner.query(
      `SELECT properties FROM api.records WHERE id = $1`,
      [sample.id],
    )
    expect(Number(rows[0].properties.quantity)).toBe(2)
  })

  it('requires a purpose experiment in the active workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'No purpose', {
      quantity: 5,
    })
    await expect(
      owner.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1,
           p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => NULL
         )`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a unit that does not match the sample unit', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Unit purpose')
    const sample = await createSample(owner, PROJ_A, 'mL only', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    await expect(
      owner.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1,
           p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3,
           p_unit => 'mg'
         )`,
        [sample.id, sample.metadata_version, exp.id],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })
})

describe('LAB-01 withdraw_sample — derived container', () => {
  it('creates a linked derived sample with its create event in one transaction', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Derive purpose')
    const sample = await createSample(owner, PROJ_A, 'Stock', {
      quantity: 10,
      quantityUnit: 'mL',
      sampleType: 'Plasma',
      storageLocation: 'Freezer A',
    })

    const { rows } = await owner.query(
      `SELECT api.withdraw_sample(
         p_record_id => $1,
         p_quantity => 2,
         p_expected_metadata_version => $2,
         p_purpose_experiment_id => $3,
         p_new_container => $4::jsonb
       ) AS result`,
      [
        sample.id,
        sample.metadata_version,
        exp.id,
        JSON.stringify({ title: 'Derived aliquot', storageLocation: 'Freezer C' }),
      ],
    )
    const result = rows[0].result
    expect(result.derivedSampleId).not.toBeNull()
    expect(Number(result.sample.properties.quantity)).toBe(8)

    // The derived sample is a real sample record with the withdrawn quantity.
    const { rows: derived } = await owner.query(
      `SELECT id, kind, title, status, identifier, properties
         FROM api.records WHERE id = $1`,
      [result.derivedSampleId],
    )
    expect(derived[0].kind).toBe('sample')
    expect(derived[0].status).toBe('available')
    expect(derived[0].title).toBe('Derived aliquot')
    expect(derived[0].identifier).toMatch(/^SMP-/)
    expect(Number(derived[0].properties.quantity)).toBe(2)
    expect(derived[0].properties.quantityUnit).toBe('mL')
    expect(derived[0].properties.sampleType).toBe('Plasma')
    expect(derived[0].properties.storageLocation).toBe('Freezer C')

    // Its canonical create event carries the purpose and initial quantity.
    const { rows: events } = await owner.query(
      `SELECT operation, quantity_delta, quantity_after, purpose_record_id
         FROM api.sample_events WHERE record_id = $1`,
      [result.derivedSampleId],
    )
    expect(events).toHaveLength(1)
    expect(events[0].operation).toBe('create')
    expect(Number(events[0].quantity_after)).toBe(2)
    expect(events[0].purpose_record_id).toBe(exp.id)

    // The existing lineage model links source -> derived with provenance.
    const { rows: links } = await owner.query(
      `SELECT link_type, target_record_id, link_metadata
         FROM api.record_links WHERE source_record_id = $1`,
      [sample.id],
    )
    expect(links).toHaveLength(1)
    expect(links[0].link_type).toBe('sample')
    expect(links[0].target_record_id).toBe(result.derivedSampleId)
    expect(links[0].link_metadata.origin).toBe('withdraw_sample')
    expect(links[0].link_metadata.purposeRecordId).toBe(exp.id)
  })

  it('defaults the derived title and inherits type/unit/location', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Default title purpose')
    const sample = await createSample(owner, PROJ_A, 'Source lot', {
      quantity: 4,
      quantityUnit: 'uL',
      sampleType: 'Serum',
      storageLocation: 'Fridge 1',
    })
    const { rows } = await owner.query(
      `SELECT api.withdraw_sample(
         p_record_id => $1,
         p_quantity => 1,
         p_expected_metadata_version => $2,
         p_purpose_experiment_id => $3,
         p_new_container => '{}'::jsonb
       ) AS result`,
      [sample.id, sample.metadata_version, exp.id],
    )
    const derivedId = rows[0].result.derivedSampleId
    const { rows: derived } = await owner.query(
      `SELECT title, properties FROM api.records WHERE id = $1`,
      [derivedId],
    )
    expect(derived[0].title).toContain(sample.identifier)
    expect(derived[0].properties.quantityUnit).toBe('uL')
    expect(derived[0].properties.sampleType).toBe('Serum')
    expect(derived[0].properties.storageLocation).toBe('Fridge 1')
  })
})

describe('LAB-01 withdraw_sample — hold and quarantine refusals', () => {
  it('refuses a hold_exceeded sample unless the purpose experiment is allowed', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const allowed = await createExperiment(owner, PROJ_A, 'Allowed use')
    const other = await createExperiment(owner, PROJ_A, 'Other use')
    const sample = await createSample(owner, PROJ_A, 'On hold', {
      quantity: 10,
      quantityUnit: 'mL',
      holdStartedAt: daysAgo(10),
      holdDurationDays: 1,
      allowedUseExperimentIds: [allowed.id],
    })
    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)
    const { rows: held } = await owner.query(
      `SELECT status, metadata_version FROM api.records WHERE id = $1`,
      [sample.id],
    )
    expect(held[0].status).toBe('hold_exceeded')

    await expect(
      owner.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1, p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3)`,
        [sample.id, held[0].metadata_version, other.id],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    const { rows } = await owner.query(
      `SELECT api.withdraw_sample(
         p_record_id => $1, p_quantity => 2,
         p_expected_metadata_version => $2,
         p_purpose_experiment_id => $3) AS result`,
      [sample.id, held[0].metadata_version, allowed.id],
    )
    expect(Number(rows[0].result.sample.properties.quantity)).toBe(8)
  })

  it('refuses a quarantined sample unless the purpose experiment is allowed', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const allowed = await createExperiment(owner, PROJ_A, 'QC allowed')
    const other = await createExperiment(owner, PROJ_A, 'QC other')
    const sample = await createSample(owner, PROJ_A, 'Quarantined', {
      quantity: 10,
      quantityUnit: 'mL',
      allowedUseExperimentIds: [allowed.id],
    })
    const { rows: q } = await owner.query(
      `SELECT * FROM api.quarantine_sample(
         p_record_id => $1, p_expected_metadata_version => $2, p_reason => 'QC hold')`,
      [sample.id, sample.metadata_version],
    )
    expect(q[0].status).toBe('quarantined')

    await expect(
      owner.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1, p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3)`,
        [sample.id, q[0].metadata_version, other.id],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    const { rows } = await owner.query(
      `SELECT api.withdraw_sample(
         p_record_id => $1, p_quantity => 1,
         p_expected_metadata_version => $2,
         p_purpose_experiment_id => $3) AS result`,
      [sample.id, q[0].metadata_version, allowed.id],
    )
    expect(Number(rows[0].result.sample.properties.quantity)).toBe(9)
  })
})

describe('LAB-01 withdraw_sample — isolation and viewer denial', () => {
  it('refuses a viewer', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Viewer purpose')
    const sample = await createSample(owner, PROJ_A, 'Viewer target', {
      quantity: 5,
    })
    const viewer = await asAuthenticated(VIEWER_A, WS_A)
    await expect(
      viewer.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1, p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3)`,
        [sample.id, sample.metadata_version, exp.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('cannot withdraw another workspace sample', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const sampleA = await createSample(ownerA, PROJ_A, 'A only', { quantity: 5 })
    const expB = await createExperiment(ownerB, PROJ_B, 'B purpose')
    await expect(
      ownerB.query(
        `SELECT api.withdraw_sample(
           p_record_id => $1, p_quantity => 1,
           p_expected_metadata_version => $2,
           p_purpose_experiment_id => $3)`,
        [sampleA.id, sampleA.metadata_version, expB.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
