/**
 * LAB-01 step 2 integration proof: `api.sample_reservations` holds sample
 * volume for a planned experiment and reduces the free balance
 * (`current - reserved`), so `api.withdraw_sample` refuses a withdrawal into
 * reserved volume. Cancelling a reservation releases the held volume. The
 * used/reserved/free read model (`api.sample_quantity_balances`) is computed
 * from the canonical sample_events ledger plus the active reservations, and
 * every read/write stays workspace-scoped with viewers denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000002850a'
const WS_B = '00000000-0000-4000-8000-00000002850b'
const PROJ_A = '00000000-0000-4000-8000-00000002860a'
const PROJ_B = '00000000-0000-4000-8000-00000002860b'
const OWNER_A = 'lab285-owner-a'
const VIEWER_A = 'lab285-viewer-a'
const OWNER_B = 'lab285-owner-b'

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

const createSample = (
  client: Client,
  project: string,
  title: string,
  props = {},
) => createRecord(client, project, 'sample', title, props)

const createExperiment = (client: Client, project: string, title: string) =>
  createRecord(client, project, 'experiment', title)

async function balance(
  client: Client,
  recordId: string,
): Promise<{
  current: number
  used: number
  reserved: number
  free: number
  unit: string | null
}> {
  const { rows } = await client.query(
    `SELECT api.sample_quantity_balances($1) AS b`,
    [recordId],
  )
  const b = rows[0].b
  return {
    current: Number(b.current),
    used: Number(b.used),
    reserved: Number(b.reserved),
    free: Number(b.free),
    unit: b.unit,
  }
}

async function reserve(
  client: Client,
  sampleId: string,
  experimentId: string,
  quantity: number,
  extra: { unit?: string; planned?: boolean; notes?: string } = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_sample_reservation(
       p_record_id => $1,
       p_experiment_id => $2,
       p_quantity => $3,
       p_unit => $4,
       p_planned => $5,
       p_notes => $6
     )`,
    [
      sampleId,
      experimentId,
      quantity,
      extra.unit ?? null,
      extra.planned ?? true,
      extra.notes ?? null,
    ],
  )
  return rows[0]
}

async function withdraw(
  client: Client,
  sampleId: string,
  experimentId: string,
  quantity: number,
  expectedVersion: number,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT api.withdraw_sample(
       p_record_id => $1,
       p_quantity => $2,
       p_expected_metadata_version => $3,
       p_purpose_experiment_id => $4
     ) AS result`,
    [sampleId, quantity, expectedVersion, experimentId],
  )
  return rows[0].result
}

async function metadataVersion(
  client: Client,
  recordId: string,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT metadata_version FROM api.records WHERE id = $1`,
    [recordId],
  )
  return rows[0].metadata_version
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LAB285 Owner A', 'lab285-owner-a@sheetbase.test', true),
      ('${VIEWER_A}', 'LAB285 Viewer A', 'lab285-viewer-a@sheetbase.test', true),
      ('${OWNER_B}', 'LAB285 Owner B', 'lab285-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'lab285-a', 'LAB285 A'),
      ('${WS_B}', 'lab285-b', 'LAB285 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${VIEWER_A}', 'viewer'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'lab285-a', 'LAB285 A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'lab285-b', 'LAB285 B', '${OWNER_B}')`,
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

describe('LAB-01 reservations — used / reserved / free', () => {
  it('holds volume, reduces free and refuses a withdrawal into it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Reserved assay')
    const sample = await createSample(owner, PROJ_A, 'Reserve me', {
      quantity: 10,
      quantityUnit: 'mL',
    })

    const reservation = await reserve(owner, sample.id, exp.id, 4, {
      unit: 'mL',
      notes: 'planned run',
    })
    expect(reservation.state).toBe('active')
    expect(Number(reservation.quantity)).toBe(4)
    expect(reservation.unit).toBe('mL')
    expect(reservation.planned).toBe(true)
    expect(reservation.sample_record_id).toBe(sample.id)
    expect(reservation.experiment_record_id).toBe(exp.id)
    expect(reservation.created_by_user_id).toBe(OWNER_A)

    const before = await balance(owner, sample.id)
    expect(before).toEqual({
      current: 10,
      used: 0,
      reserved: 4,
      free: 6,
      unit: 'mL',
    })

    // A withdrawal above the free balance (into reserved volume) is refused
    // and reports the free amount, not the current quantity.
    let error: { code?: string; message?: string } | undefined
    try {
      await withdraw(
        owner,
        sample.id,
        exp.id,
        7,
        await metadataVersion(owner, sample.id),
      )
    } catch (e) {
      error = e as { code?: string; message?: string }
    }
    expect(error?.code).toBe('SB006')
    expect(error?.message).toContain('available 6')
    expect(error?.message).toContain('reserved 4')

    // Nothing was consumed; the reservation still holds.
    const afterRefusal = await balance(owner, sample.id)
    expect(afterRefusal.current).toBe(10)
    expect(afterRefusal.used).toBe(0)

    // A withdrawal exactly to the free balance succeeds.
    const result = await withdraw(
      owner,
      sample.id,
      exp.id,
      6,
      await metadataVersion(owner, sample.id),
    )
    expect(Number(result.sample.properties.quantity)).toBe(4)

    const after = await balance(owner, sample.id)
    expect(after).toEqual({
      current: 4,
      used: 6,
      reserved: 4,
      free: 0,
      unit: 'mL',
    })
  })

  it('frees the balance when a reservation is cancelled', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Cancelled run')
    const sample = await createSample(owner, PROJ_A, 'Cancel reserve', {
      quantity: 10,
      quantityUnit: 'mL',
    })
    const reservation = await reserve(owner, sample.id, exp.id, 4, {
      unit: 'mL',
    })

    expect((await balance(owner, sample.id)).free).toBe(6)

    // Cancelling releases the held volume.
    const { rows } = await owner.query(
      `SELECT * FROM api.cancel_sample_reservation(
         p_reservation_id => $1, p_notes => 'no longer needed'
       )`,
      [reservation.id],
    )
    expect(rows[0].state).toBe('cancelled')
    expect(rows[0].cancelled_by_user_id).toBe(OWNER_A)
    expect(rows[0].cancelled_at).not.toBeNull()

    const freed = await balance(owner, sample.id)
    expect(freed).toEqual({
      current: 10,
      used: 0,
      reserved: 0,
      free: 10,
      unit: 'mL',
    })

    // The previously refused withdrawal now fits.
    const result = await withdraw(
      owner,
      sample.id,
      exp.id,
      7,
      await metadataVersion(owner, sample.id),
    )
    expect(Number(result.sample.properties.quantity)).toBe(3)
    const after = await balance(owner, sample.id)
    expect(after).toEqual({
      current: 3,
      used: 7,
      reserved: 0,
      free: 3,
      unit: 'mL',
    })
  })

  it('refuses a reservation above free and a mismatched unit', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Over-reserve')
    const sample = await createSample(owner, PROJ_A, 'Five only', {
      quantity: 5,
      quantityUnit: 'mL',
    })

    await reserve(owner, sample.id, exp.id, 3, { unit: 'mL' })

    await expect(
      reserve(owner, sample.id, exp.id, 3, { unit: 'mL' }),
    ).rejects.toMatchObject({ code: 'SB006' })

    await expect(
      reserve(owner, sample.id, exp.id, 1, { unit: 'mg' }),
    ).rejects.toMatchObject({ code: '22023' })
  })
})

describe('LAB-01 reservations — isolation and viewer denial', () => {
  it('refuses a viewer from reserving or cancelling', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createExperiment(owner, PROJ_A, 'Viewer reserve')
    const sample = await createSample(owner, PROJ_A, 'Viewer target', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    const reservation = await reserve(owner, sample.id, exp.id, 2, {
      unit: 'mL',
    })

    const viewer = await asAuthenticated(VIEWER_A, WS_A)
    await expect(
      reserve(viewer, sample.id, exp.id, 1, { unit: 'mL' }),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      viewer.query(
        `SELECT api.cancel_sample_reservation(p_reservation_id => $1)`,
        [reservation.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Members (including viewers) can read the reservations and the balance.
    const { rows } = await viewer.query(
      `SELECT id, state FROM api.sample_reservations WHERE sample_record_id = $1`,
      [sample.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('active')
    const viewerBalance = await balance(viewer, sample.id)
    expect(viewerBalance.reserved).toBe(2)
    expect(viewerBalance.free).toBe(3)
  })

  it('isolates another workspace from reserving, cancelling and reading', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const expA = await createExperiment(ownerA, PROJ_A, 'A reserve')
    const expB = await createExperiment(ownerB, PROJ_B, 'B reserve')
    const sampleA = await createSample(ownerA, PROJ_A, 'A only', {
      quantity: 10,
      quantityUnit: 'mL',
    })
    const reservation = await reserve(ownerA, sampleA.id, expA.id, 2, {
      unit: 'mL',
    })

    // B cannot reserve A's sample, even with a B experiment.
    await expect(
      reserve(ownerB, sampleA.id, expB.id, 1, { unit: 'mL' }),
    ).rejects.toMatchObject({ code: '42501' })

    // B cannot cancel A's reservation.
    await expect(
      ownerB.query(
        `SELECT api.cancel_sample_reservation(p_reservation_id => $1)`,
        [reservation.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // B cannot read A's reservations or balance.
    const { rows } = await ownerB.query(
      `SELECT id FROM api.sample_reservations WHERE sample_record_id = $1`,
      [sampleA.id],
    )
    expect(rows).toHaveLength(0)
    await expect(
      ownerB.query(`SELECT api.sample_quantity_balances($1)`, [sampleA.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
