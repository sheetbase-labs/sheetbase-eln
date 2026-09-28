/**
 * PROJ-01.1 — clients, project details and stable display ids.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000200a'
const OTHER_WS = '00000000-0000-4000-8000-00000000200b'
const MEMBER = 'pd-member'
const VIEWER = 'pd-viewer'
const OUTSIDER = 'pd-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'PD Member', 'pd@sheetbase.test', true),
      ('${VIEWER}', 'PD Viewer', 'pdv@sheetbase.test', true),
      ('${OUTSIDER}', 'PD Outsider', 'pdo@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pd', 'PD'), ('${OTHER_WS}', 'pd-other', 'PD other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
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

describe('PROJ-01.1 project details and clients', () => {
  it('assigns a PRJ display id and creates a client with a CL code', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows: clientRows } = await member.query<{
      id: string
      code: string
    }>(
      `INSERT INTO api.clients (workspace_id, name) VALUES ($1, 'Acme Biologics') RETURNING id, code`,
      [WS],
    )
    expect(clientRows[0]?.code).toMatch(/^CL-\d{3}$/)

    const { rows } = await member.query<{
      display_id: string
      client_id: string
      modality: string
      stage: string
      lead_user_id: string
    }>(
      `SELECT * FROM api.create_project($1, $2, 'AAV9', 'Process development', $3)`,
      ['AAV9 process transfer', clientRows[0]!.id, MEMBER],
    )
    expect(rows[0]?.display_id).toMatch(/^PRJ-\d{4}$/)
    expect(rows[0]?.client_id).toBe(clientRows[0]!.id)
    expect(rows[0]?.modality).toBe('AAV9')
    expect(rows[0]?.stage).toBe('Process development')
    expect(rows[0]?.lead_user_id).toBe(MEMBER)
  })

  it('rejects a client from another workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows: other } = await outsider.query<{ id: string }>(
      `INSERT INTO api.clients (workspace_id, name) VALUES ($1, 'Other Co') RETURNING id`,
      [OTHER_WS],
    )
    const member = await asAuthenticated(MEMBER, WS)
    await expectDenied(
      member.query(`SELECT * FROM api.create_project('Cross', $1)`, [
        other[0]!.id,
      ]),
      '42501',
    )
  })

  it('updates details at the expected revision and rejects a stale one', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{ id: string; revision: string }>(
      `SELECT * FROM api.create_project('Detail target')`,
    )
    const project = rows[0]!
    const { rows: updated } = await member.query<{
      revision: string
      stage: string
    }>(
      `SELECT * FROM api.update_project_details($1, $2, 'Detail target', NULL, 'LVV', 'Tech transfer')`,
      [project.id, project.revision],
    )
    expect(updated[0]?.stage).toBe('Tech transfer')
    expect(Number(updated[0]?.revision)).toBe(Number(project.revision) + 1)

    await expect(
      member.query(
        `SELECT * FROM api.update_project_details($1, $2, 'Stale', NULL, NULL, NULL)`,
        [project.id, project.revision],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('denies a viewer writes to clients and projects', async () => {
    const viewer = await asAuthenticated(VIEWER, WS)
    await expectDenied(
      viewer.query(
        `INSERT INTO api.clients (workspace_id, name) VALUES ($1, 'Nope')`,
        [WS],
      ),
      '42501',
    )
    await expectDenied(
      viewer.query(`SELECT * FROM api.create_project('Nope')`),
      '42501',
    )
  })
})
