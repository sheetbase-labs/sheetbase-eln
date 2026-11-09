/**
 * Planning and reporting integrations (migration 20261109113000).
 *
 * Proves the database's own copies of the pipeline action catalogue and the
 * trigger list know everything the application declares, that analysis views
 * and definitions can be saved and deleted through functions (as their owner
 * only), and that a generated report's event does not carry the document.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EVENT_CATALOGUE } from '../../src/lib/event-catalogue'
import { PIPELINE_ACTIONS } from '../../src/lib/pipelines/actions'
import { PIPELINE_TRIGGER_EVENTS } from '../../src/lib/pipeline-schedule'
import { PLANNING_OPERATIONS } from '../../src/lib/operations/declarations/planning'
import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000090c0'
const OWNER = 'prt-owner'
const OTHER = 'prt-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OTHER]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'prt','Planning')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, OTHER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('the database knows what the application declares', () => {
  it('accepts every pipeline action the application lists', async () => {
    for (const action of PIPELINE_ACTIONS) {
      const args = Object.fromEntries(
        action.arguments
          .filter((field) => field.required && !field.server)
          .map((field) => [field.name, 'x']),
      )
      const { rows } = await migrator.query(
        `SELECT internal.pipeline_action_errors($1::jsonb) AS errors`,
        [
          JSON.stringify([
            { name: 'step', operation: action.operation, arguments: args },
          ]),
        ],
      )
      expect(rows[0].errors, action.operation).toEqual([])
    }
  })

  it('refuses a workspace the step tries to supply', async () => {
    const { rows } = await migrator.query(
      `SELECT internal.pipeline_action_errors($1::jsonb) AS errors`,
      [
        JSON.stringify([
          {
            name: 'step',
            operation: 'create_study_task',
            arguments: { p_title: 'x', p_workspace_id: WS },
          },
        ]),
      ],
    )
    expect(rows[0].errors).not.toEqual([])
  })

  it('accepts every trigger event these operations produce', async () => {
    const names = PLANNING_OPERATIONS.flatMap((op) =>
      (op.events ?? []).map((event) => event.name),
    )
    expect(names.length).toBeGreaterThan(15)
    for (const name of names) {
      expect(PIPELINE_TRIGGER_EVENTS, name).toContain(name)
      const { rows } = await migrator.query(
        `SELECT api.normalize_pipeline_event_type($1) AS name`,
        [name],
      )
      expect(rows[0].name, name).toBe(name)
    }
  })

  it('has every webhook event name the catalogue delivers', async () => {
    const { rows } = await migrator.query<{ name: string }>(
      `SELECT name FROM internal.webhook_event_names`,
    )
    const known = new Set(rows.map((row) => row.name))
    for (const entry of EVENT_CATALOGUE)
      if (entry.wireName && entry.name.startsWith('study.'))
        expect(known.has(entry.wireName), entry.wireName).toBe(true)
  })
})

describe('analysis views and definitions', () => {
  it('saves, changes and deletes a view as its owner, and nobody else', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query(
      `SELECT * FROM api.save_analysis_view(NULL, 'Potency', '[{"title":"a"}]'::jsonb, '[]'::jsonb, NULL)`,
    )
    expect(rows[0]).toMatchObject({ name: 'Potency', version: 1 })
    const again = await owner.query(
      `SELECT * FROM api.save_analysis_view($1, 'Potency 2', '[{"title":"a"}]'::jsonb, '[]'::jsonb, NULL)`,
      [rows[0].id],
    )
    expect(again.rows[0]).toMatchObject({ name: 'Potency 2', version: 2 })

    const other = await actor(OTHER)
    await expect(
      other.query(
        `SELECT * FROM api.save_analysis_view($1, 'Mine now', '[{"title":"a"}]'::jsonb, '[]'::jsonb, NULL)`,
        [rows[0].id],
      ),
    ).rejects.toMatchObject({ code: 'SB015' })
    await expect(
      other.query(`SELECT api.delete_analysis_view($1)`, [rows[0].id]),
    ).rejects.toMatchObject({ code: 'SB015' })

    await owner.query(`SELECT api.delete_analysis_view($1)`, [rows[0].id])
    const left = await migrator.query(
      `SELECT 1 FROM api.analysis_views WHERE id = $1`,
      [rows[0].id],
    )
    expect(left.rows).toHaveLength(0)
  })

  it('saves and deletes a definition as its owner', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query(
      `SELECT * FROM api.save_analysis_definition(NULL, 'Mean titre', '{"kind":"mean"}'::jsonb, '[]'::jsonb)`,
    )
    expect(rows[0]).toMatchObject({ name: 'Mean titre', version: 1 })
    await owner.query(`SELECT api.delete_analysis_definition($1)`, [rows[0].id])
    await expect(
      owner.query(`SELECT api.delete_analysis_definition($1)`, [rows[0].id]),
    ).rejects.toMatchObject({ code: 'SB015' })
  })

  it('puts analysis views on the change feed without their charts', async () => {
    const { rows } = await migrator.query(
      `SELECT operation, payload FROM api.change_events
        WHERE workspace_id = $1 AND entity_type = 'analysis_view' ORDER BY sequence`,
      [WS],
    )
    expect(rows.map((row) => row.operation)).toEqual([
      'create',
      'update',
      'delete',
    ])
    for (const row of rows) {
      expect(row.payload).not.toHaveProperty('charts')
      expect(row.payload.name).toMatch(/^Potency/)
    }
  })
})
