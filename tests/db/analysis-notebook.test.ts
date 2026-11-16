/**
 * Putting a saved analysis into an experiment's notebook: one live block per
 * analysis, the same answer when asked twice, who may do it, and the event.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c902'
const PROJECT = '00000000-0000-4000-8000-00000000c903'
const RECORD = '00000000-0000-4000-8000-00000000c904'
const DEFINITION = '00000000-0000-4000-8000-00000000c905'
const WRITER = 'an-writer'
const VIEWER = 'an-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])

  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const id of [WRITER, VIEWER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified")
       VALUES ($1, $1, $1 || '@an.test', true)`,
      [id],
    )
  }

  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'an-ws', 'AN workspace')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${WRITER}', 'member'), ('${WS}', '${VIEWER}', 'viewer')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, display_id, lead_user_id)
     VALUES ('${PROJECT}', '${WS}', 'an-project', 'AN project', 'PRJ-9002', '${WRITER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-AN1', 'AN record', '${WRITER}')`,
  )
  await migrator.query(
    `INSERT INTO api.analysis_definitions (id, workspace_id, owner_user_id, name, definition)
     VALUES ('${DEFINITION}', '${WS}', '${WRITER}', 'Standard curve', '{}'::jsonb)`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('add_analysis_to_notebook', () => {
  it('adds a live analysis block, and the same call again returns it', async () => {
    const client = await as(WRITER)

    const first = await client.query(
      `SELECT api.add_analysis_to_notebook($1, $2, 'Curve fit') AS r`,
      [RECORD, DEFINITION],
    )

    expect(first.rows[0].r.already_there).toBe(false)
    expect(first.rows[0].r.block.type).toBe('analysis')
    expect(first.rows[0].r.block.payload).toMatchObject({
      title: 'Curve fit',
      definitionId: DEFINITION,
    })

    const again = await client.query(
      `SELECT api.add_analysis_to_notebook($1, $2) AS r`,
      [RECORD, DEFINITION],
    )

    expect(again.rows[0].r.already_there).toBe(true)
    expect(again.rows[0].r.block.id).toBe(first.rows[0].r.block.id)

    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.blocks WHERE record_id = $1 AND type = 'analysis'`,
      [RECORD],
    )

    expect(rows[0].n).toBe(1)
  })

  it('sends analysis_notebook once, naming the analysis', async () => {
    const { rows } = await migrator.query(
      `SELECT operation, payload FROM api.change_events
        WHERE workspace_id = $1 AND entity_type = 'analysis_notebook'`,
      [WS],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].operation).toBe('create')
    expect(rows[0].payload).toMatchObject({
      recordId: RECORD,
      definitionId: DEFINITION,
      analysis: 'Standard curve',
      title: 'Curve fit',
    })
  })

  it('does not let a viewer change the notebook', async () => {
    const client = await as(VIEWER)

    await expect(
      client.query(`SELECT api.add_analysis_to_notebook($1, $2)`, [
        RECORD,
        '00000000-0000-4000-8000-00000000c905',
      ]),
    ).rejects.toThrow()
  })

  it('says so when the saved analysis does not exist', async () => {
    const client = await as(WRITER)

    await expect(
      client.query(`SELECT api.add_analysis_to_notebook($1, $2)`, [
        RECORD,
        '00000000-0000-4000-8000-00000000c9ff',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
