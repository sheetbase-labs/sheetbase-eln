/**
 * The Agent page's saved conversations: each is one person's own (nobody else
 * reads, renames or deletes it, admins included), saving keeps the title, and
 * starting and deleting one produce change events without the messages.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c601'
const OWNER = 'ac-owner'
const MEMBER = 'ac-member'
const CHAT = '00000000-0000-4000-8000-00000000c611'

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

const messages = [
  {
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: 'Secret question' }],
  },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
]

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const id of [OWNER, MEMBER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified")
       VALUES ($1, $1, $1 || '@ac.test', true)`,
      [id],
    )
  }

  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'ac-ws', 'AC workspace')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${MEMBER}', 'member')`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
})

describe('assistant conversations', () => {
  it('starts a conversation with the id and title it is given', async () => {
    const member = await as(MEMBER)

    const { rows } = await member.query(
      `SELECT id, title, jsonb_array_length(messages) AS n
         FROM api.save_assistant_conversation($1::jsonb, $2::uuid, $3)`,
      [JSON.stringify(messages), CHAT, 'Hello agent'],
    )

    expect(rows[0]).toMatchObject({ id: CHAT, title: 'Hello agent', n: 2 })
  })

  it('keeps the title when the messages are saved again', async () => {
    const member = await as(MEMBER)

    const { rows } = await member.query(
      `SELECT title, jsonb_array_length(messages) AS n
         FROM api.save_assistant_conversation($1::jsonb, $2::uuid, NULL)`,
      [JSON.stringify([...messages, messages[0]]), CHAT],
    )

    expect(rows[0]).toMatchObject({ title: 'Hello agent', n: 3 })
  })

  it('is read by its owner alone, an admin included', async () => {
    const mine = await (
      await as(MEMBER)
    ).query('SELECT id FROM api.assistant_conversations')

    expect(mine.rows.map((row) => row.id)).toEqual([CHAT])

    const theirs = await (
      await as(OWNER)
    ).query('SELECT id FROM api.assistant_conversations')

    expect(theirs.rows).toEqual([])
  })

  it('cannot be renamed or deleted by someone else', async () => {
    const owner = await as(OWNER)

    await expect(
      owner.query('SELECT api.rename_assistant_conversation($1, $2)', [
        CHAT,
        'Mine now',
      ]),
    ).rejects.toThrow(/not found/)

    await owner.query('SELECT api.delete_assistant_conversation($1)', [CHAT])

    const { rows } = await migrator.query(
      'SELECT title FROM api.assistant_conversations WHERE id = $1',
      [CHAT],
    )

    expect(rows).toEqual([{ title: 'Hello agent' }])
  })

  it('cannot be written to directly', async () => {
    const member = await as(MEMBER)

    await expect(
      member.query(
        `INSERT INTO api.assistant_conversations (workspace_id, user_id, title)
         VALUES ($1, $2, 'sneaky')`,
        [WS, MEMBER],
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('can be renamed by its owner, and an empty title is refused', async () => {
    const member = await as(MEMBER)

    const { rows } = await member.query(
      'SELECT title FROM api.rename_assistant_conversation($1, $2)',
      [CHAT, '  A better name '],
    )

    expect(rows[0]).toEqual({ title: 'A better name' })

    await expect(
      member.query('SELECT api.rename_assistant_conversation($1, $2)', [
        CHAT,
        '   ',
      ]),
    ).rejects.toThrow(/needs a title/)
  })

  it('sends created and deleted events that never carry the messages', async () => {
    const member = await as(MEMBER)
    await member.query('SELECT api.delete_assistant_conversation($1)', [CHAT])

    const { rows } = await migrator.query(
      `SELECT operation, payload FROM api.change_events
        WHERE entity_type = 'assistant_conversation' AND workspace_id = $1
        ORDER BY operation`,
      [WS],
    )

    expect(rows.map((row) => row.operation)).toEqual(['create', 'delete'])

    for (const row of rows) {
      expect(row.payload).toMatchObject({ conversationId: CHAT })
      expect(JSON.stringify(row.payload)).not.toContain('Secret question')
      expect(row.payload).not.toHaveProperty('messages')
    }
  })
})
