/**
 * Team layouts and trail evidence.
 *
 * - A team layout is readable by every member, written only by someone who
 *   can write, and replaced or removed only by its author or an administrator.
 * - A saved trail attaches to a record the caller can edit, is visible to
 *   anyone who can view that record, and can never be changed.
 *
 * NOTE: requires a real PostgreSQL database; run via `pnpm test:db`.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000007a1'
const WS_OTHER = '00000000-0000-4000-8000-0000000007a2'
const PROJECT = '00000000-0000-4000-8000-0000000007b1'
const OWNER = 'team-layout-owner'
const WRITER = 'team-layout-writer'
const VIEWER = 'team-layout-viewer'
const OUTSIDER = 'team-layout-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let recordId: string

async function as(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

const layout = {
  panes: [{ id: 'a', href: '/experiments', title: 'Experiments' }],
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [OWNER, WRITER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ($1, $1, $1 || '@sheetbase.test', true)`,
      [id],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ($1, 'team-layouts', 'Team layouts'), ($2, 'team-layouts-other', 'Other')`,
    [WS, WS_OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'viewer'), ($5, $6, 'member')`,
    [WS, OWNER, WRITER, VIEWER, WS_OTHER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ($1, $2, 'tl-proj', 'Team layouts', $3)`,
    [PROJECT, WS, OWNER],
  )
  for (const [userId, canEdit] of [
    [OWNER, true],
    [WRITER, true],
    [VIEWER, false],
  ] as const) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId,
      canView: true,
      canEdit,
    })
  }
  const owner = await as(OWNER)
  const { rows } = await owner.query(
    `SELECT id FROM api.create_record($1, 'experiment', 'Trail target')`,
    [PROJECT],
  )
  recordId = rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('team layouts', () => {
  it('lets a writer save one that every member can read', async () => {
    const writer = await as(WRITER)
    await writer.query('SELECT api.save_team_layout($1, $2::jsonb)', [
      'Review desk',
      JSON.stringify(layout),
    ])
    const viewer = await as(VIEWER)
    const { rows } = await viewer.query(
      'SELECT name FROM api.workspace_layouts',
    )
    expect(rows).toEqual([{ name: 'Review desk' }])
    const outsider = await as(OUTSIDER, WS_OTHER)
    expect(
      (await outsider.query('SELECT 1 FROM api.workspace_layouts')).rowCount,
    ).toBe(0)
  })

  it('refuses a viewer and any direct write', async () => {
    const viewer = await as(VIEWER)
    await expect(
      viewer.query('SELECT api.save_team_layout($1, $2::jsonb)', [
        'Viewer layout',
        JSON.stringify(layout),
      ]),
    ).rejects.toThrow(/not permitted/)
    // Direct writes are not granted at all.
    await expect(
      viewer.query(`DELETE FROM api.workspace_layouts`),
    ).rejects.toThrow()
  })

  it('lets an administrator replace it and its author remove it', async () => {
    const owner = await as(OWNER)
    await owner.query('SELECT api.save_team_layout($1, $2::jsonb)', [
      'review desk',
      JSON.stringify({ ...layout, panes: [] }),
    ])
    const writer = await as(WRITER)
    const { rows } = await writer.query(
      'SELECT id, layout FROM api.workspace_layouts',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].layout.panes).toEqual([])
    await writer.query('SELECT api.delete_team_layout($1)', [rows[0].id])
    expect(
      (await writer.query('SELECT 1 FROM api.workspace_layouts')).rowCount,
    ).toBe(0)
  })
})

describe('trail evidence', () => {
  const steps = [
    { href: '/experiments', title: 'Experiments', at: '2026-10-26T09:00:00Z' },
    { href: '/datasets', title: 'Datasets', at: '2026-10-26T09:01:00Z' },
  ]

  it('is saved by someone who can edit the record and seen by someone who can view it', async () => {
    const writer = await as(WRITER)
    await writer.query('SELECT api.save_trail_evidence($1, $2::jsonb, $3)', [
      recordId,
      JSON.stringify(steps),
      'Checked the filtration data',
    ])
    const viewer = await as(VIEWER)
    const { rows } = await viewer.query(
      'SELECT steps, note, saved_by_user_id FROM api.trail_evidence WHERE record_id = $1',
      [recordId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].steps).toHaveLength(2)
    expect(rows[0].saved_by_user_id).toBe(WRITER)
    const outsider = await as(OUTSIDER, WS_OTHER)
    expect(
      (await outsider.query('SELECT 1 FROM api.trail_evidence')).rowCount,
    ).toBe(0)
  })

  it('refuses a viewer, a malformed trail and any later change', async () => {
    const viewer = await as(VIEWER)
    await expect(
      viewer.query('SELECT api.save_trail_evidence($1, $2::jsonb)', [
        recordId,
        JSON.stringify(steps),
      ]),
    ).rejects.toThrow(/not permitted/)
    const writer = await as(WRITER)
    await expect(
      writer.query('SELECT api.save_trail_evidence($1, $2::jsonb)', [
        recordId,
        JSON.stringify([{ href: 'https://elsewhere.example', title: 'x' }]),
      ]),
    ).rejects.toThrow(/in-app address/)
    await expect(
      writer.query('SELECT api.save_trail_evidence($1, $2::jsonb)', [
        recordId,
        '[]',
      ]),
    ).rejects.toThrow(/1 to 200 steps/)
    await expect(
      writer.query(`UPDATE api.trail_evidence SET note = 'edited'`),
    ).rejects.toThrow()
    await expect(
      migrator.query(`UPDATE api.trail_evidence SET note = 'edited'`),
    ).rejects.toThrow(/cannot be changed/)
  })

  it('records the save as a change on the record', async () => {
    const { rows } = await migrator.query(
      `SELECT payload FROM api.change_events
        WHERE record_id = $1 AND payload->>'effect' = 'trail_evidence'`,
      [recordId],
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})
