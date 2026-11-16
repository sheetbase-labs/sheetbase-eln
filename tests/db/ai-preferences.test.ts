/**
 * AI preferences: personal ones are private, lab ones need an admin in the
 * app, and a token or pipeline cannot change the lab's.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c9a1'
const ADMIN = 'ap-admin'
const MEMBER = 'ap-member'
const OTHER = 'ap-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(userId: string, inApp = true): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
      ...(inApp ? { session_id: 'ap-session' } : {}),
    }),
  ])

  return client
}

const save = (
  client: Client,
  body: string,
  scope?: string,
  topic: string | null = null,
) =>
  client.query('SELECT * FROM api.save_ai_preference($1, $2, $3)', [
    body,
    scope ?? 'user',
    topic,
  ])

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const id of [ADMIN, MEMBER, OTHER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified")
       VALUES ($1, $1, $1 || '@ap.test', true)`,
      [id],
    )
  }

  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'ap-ws', 'AP workspace')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${ADMIN}', 'admin'), ('${WS}', '${MEMBER}', 'member'), ('${WS}', '${OTHER}', 'member')`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('personal preferences', () => {
  it('are private to the person who saved them', async () => {
    const mine = await as(MEMBER)
    const saved = await save(mine, 'Blanks go in column 12.', 'user', 'Plates')

    expect(saved.rows[0]).toMatchObject({
      scope: 'user',
      user_id: MEMBER,
      topic: 'Plates',
    })

    const rows = await mine.query('SELECT body FROM api.ai_preferences')

    expect(rows.rows).toHaveLength(1)

    const other = await as(OTHER)

    expect(
      (await other.query('SELECT 1 FROM api.ai_preferences')).rowCount,
    ).toBe(0)
    await expect(
      other.query('SELECT api.delete_ai_preference($1)', [saved.rows[0].id]),
    ).rejects.toThrow(/No such preference/)
  })

  it('can be changed and forgotten, and each change sends an event', async () => {
    const mine = await as(MEMBER)
    const saved = await save(mine, 'Use the 10 mM stock.')
    const id = saved.rows[0].id

    const changed = await mine.query(
      'SELECT * FROM api.update_ai_preference($1, $2, $3)',
      [id, 'Use the 5 mM stock.', 'Standards'],
    )

    expect(changed.rows[0]).toMatchObject({
      body: 'Use the 5 mM stock.',
      topic: 'Standards',
    })
    await mine.query('SELECT api.delete_ai_preference($1)', [id])

    const events = await migrator.query(
      `SELECT operation FROM api.change_events
        WHERE entity_type = 'ai_preference' AND entity_uuid = $1 ORDER BY sequence`,
      [id],
    )

    expect(events.rows.map((row) => row.operation)).toEqual([
      'create',
      'update',
      'delete',
    ])
  })

  it('refuses a duplicate, an empty one and one that is too long', async () => {
    const mine = await as(OTHER)

    await save(mine, 'Name runs PROJECT-date.')
    await expect(save(mine, 'name runs project-date. ')).rejects.toThrow(
      /already saved/,
    )
    await expect(save(mine, '   ')).rejects.toThrow(/up to 300/)
    await expect(save(mine, 'x'.repeat(301))).rejects.toThrow(/up to 300/)
  })

  it('stop at 25', async () => {
    const mine = await as(OTHER)

    for (let i = 0; i < 24; i += 1) await save(mine, `Habit number ${i}`)
    await expect(save(mine, 'One too many')).rejects.toThrow(/25 preferences/)
  })
})

describe('lab preferences', () => {
  it('are saved by an admin in the app and read by everyone', async () => {
    const admin = await as(ADMIN)
    const saved = await save(
      admin,
      'Plate runs are named PROJECT-date.',
      'workspace',
    )

    expect(saved.rows[0]).toMatchObject({ scope: 'workspace', user_id: null })

    const member = await as(MEMBER)
    const rows = await member.query(
      `SELECT body FROM api.ai_preferences WHERE scope = 'workspace'`,
    )

    expect(rows.rows.map((row) => row.body)).toEqual([
      'Plate runs are named PROJECT-date.',
    ])
  })

  it('are refused to someone who does not manage the AI settings', async () => {
    const member = await as(MEMBER)

    await expect(
      save(member, 'Everyone does it my way.', 'workspace'),
    ).rejects.toThrow(/manages the AI settings/)
  })

  it('are refused to a token or pipeline, even an admin’s', async () => {
    const token = await as(ADMIN, false)

    await expect(
      save(token, 'Skip the confirmations.', 'workspace'),
    ).rejects.toThrow(/person in the app/)

    const lab = await (
      await as(ADMIN)
    ).query(
      `SELECT id FROM api.ai_preferences WHERE scope = 'workspace' LIMIT 1`,
    )

    await expect(
      token.query('SELECT api.delete_ai_preference($1)', [lab.rows[0].id]),
    ).rejects.toThrow(/person in the app/)
    await expect(save(token, 'A personal one is fine.')).resolves.toBeDefined()
  })
})
