/**
 * Pooling: `api.pool_samples` takes a volume from each source by withdrawal,
 * makes one new sample holding the total, and links every source to it.
 * All or nothing; viewers and mixed units are refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000006510a'
const PROJ = '00000000-0000-4000-8000-00000006520a'
const OWNER = 'pool-owner'
const VIEWER = 'pool-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function create(
  client: Client,
  kind: string,
  title: string,
  props: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [
      PROJ,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(props),
    ],
  )
  return rows[0]
}

const pool = (
  client: Client,
  sources: unknown[],
  experimentId: string,
  container: Record<string, unknown> | null = null,
) =>
  client.query(
    `SELECT api.pool_samples($1::jsonb, $2::uuid, NULL, NULL, $3::jsonb) AS r`,
    [
      JSON.stringify(sources),
      experimentId,
      container ? JSON.stringify(container) : null,
    ],
  )

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Pool Owner', 'pool-owner@sheetbase.test', true),
      ('${VIEWER}', 'Pool Viewer', 'pool-viewer@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'pool-ws', 'Pool');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${VIEWER}', 'viewer');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id)
      VALUES ('${PROJ}', '${WS}', 'pool-ws', 'Pool', '${OWNER}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('pool_samples', () => {
  it('combines samples, draws from each and records the lineage', async () => {
    const owner = await asAuthenticated(OWNER)
    const exp = await create(owner, 'experiment', 'Pool run')
    const a = await create(owner, 'sample', 'Lysate A', {
      quantity: 500,
      quantityUnit: 'µL',
      sampleType: 'Lysate',
      storageLocation: 'Freezer 1',
    })
    const b = await create(owner, 'sample', 'Lysate B', {
      quantity: 300,
      quantityUnit: 'µL',
      sampleType: 'Lysate',
    })
    const { rows } = await pool(
      owner,
      [
        {
          recordId: a.id,
          quantity: 200,
          expectedMetadataVersion: a.metadata_version,
        },
        {
          recordId: b.id,
          quantity: 100,
          expectedMetadataVersion: b.metadata_version,
        },
      ],
      exp.id,
      { title: 'Lysate pool' },
    )
    const result = rows[0].r
    expect(result.pool.title).toBe('Lysate pool')
    expect(Number(result.pool.properties.quantity)).toBe(300)
    expect(result.pool.properties.quantityUnit).toBe('µL')
    expect(result.pool.properties.sampleType).toBe('Lysate')
    expect(result.pool.properties.storageLocation).toBe('Freezer 1')

    const left = await owner.query(
      `SELECT id, properties->>'quantity' AS q FROM api.records WHERE id = ANY($1::uuid[])`,
      [[a.id, b.id]],
    )
    const byId = Object.fromEntries(left.rows.map((r) => [r.id, Number(r.q)]))
    expect(byId[a.id]).toBe(300)
    expect(byId[b.id]).toBe(200)

    const links = await owner.query(
      `SELECT source_record_id, link_metadata FROM api.record_links
        WHERE target_record_id = $1 AND link_type = 'sample'`,
      [result.pool.id],
    )
    expect(links.rows.map((r) => r.source_record_id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
    expect(links.rows[0].link_metadata.origin).toBe('pool_samples')

    const events = await owner.query(
      `SELECT operation, notes FROM api.sample_events WHERE record_id = $1`,
      [result.pool.id],
    )
    expect(events.rows[0].operation).toBe('create')
    expect(events.rows[0].notes).toMatch(/^Pooled from /)
  })

  it('refuses the whole pool when one source would be overdrawn', async () => {
    const owner = await asAuthenticated(OWNER)
    const exp = await create(owner, 'experiment', 'Overdraw run')
    const a = await create(owner, 'sample', 'Full', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const b = await create(owner, 'sample', 'Short', {
      quantity: 10,
      quantityUnit: 'µL',
    })
    await expect(
      pool(
        owner,
        [
          {
            recordId: a.id,
            quantity: 50,
            expectedMetadataVersion: a.metadata_version,
          },
          {
            recordId: b.id,
            quantity: 50,
            expectedMetadataVersion: b.metadata_version,
          },
        ],
        exp.id,
      ),
    ).rejects.toThrow(/insufficient free quantity/)
    const { rows } = await owner.query(
      `SELECT properties->>'quantity' AS q FROM api.records WHERE id = $1`,
      [a.id],
    )
    expect(Number(rows[0].q)).toBe(100)
  })

  it('refuses mixed units, duplicates and a single sample', async () => {
    const owner = await asAuthenticated(OWNER)
    const exp = await create(owner, 'experiment', 'Unit run')
    const a = await create(owner, 'sample', 'ml', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    const b = await create(owner, 'sample', 'ul', {
      quantity: 500,
      quantityUnit: 'µL',
    })
    const src = (s: Record<string, any>) => ({
      recordId: s.id,
      quantity: 1,
      expectedMetadataVersion: s.metadata_version,
    })
    await expect(pool(owner, [src(a), src(b)], exp.id)).rejects.toThrow(
      /share one unit/,
    )
    await expect(pool(owner, [src(a), src(a)], exp.id)).rejects.toThrow(
      /only be pooled once/,
    )
    await expect(pool(owner, [src(a)], exp.id)).rejects.toThrow(
      /between 2 and 50/,
    )
  })

  it('denies viewers', async () => {
    const owner = await asAuthenticated(OWNER)
    const viewer = await asAuthenticated(VIEWER)
    const exp = await create(owner, 'experiment', 'Viewer run')
    const a = await create(owner, 'sample', 'va', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    const b = await create(owner, 'sample', 'vb', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    const src = (s: Record<string, any>) => ({
      recordId: s.id,
      quantity: 1,
      expectedMetadataVersion: s.metadata_version,
    })
    await expect(pool(viewer, [src(a), src(b)], exp.id)).rejects.toThrow()
  })
})
