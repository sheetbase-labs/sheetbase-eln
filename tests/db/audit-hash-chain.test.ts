/**
 * REV-05.1 — hash-chained, append-only audit entries.
 *
 * Every audit entry stores the previous entry's hash and its own content hash,
 * computed by a trigger so all writers are covered. Entries cannot be rewritten;
 * verification recomputes the chain and reports the first entry that does not
 * match, which is what the nightly job (REV-05.2) will call.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cf00'
const PROJECT = '00000000-0000-4000-8000-00000000cf01'
const ADMIN = 'rev051-admin'
const MEMBER = 'rev051-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, MEMBER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'rev051','REV-05.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, ADMIN, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'R51','Chain',$3)`,
    [PROJECT, WS, ADMIN],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

/**
 * Emit three audit entries through the canonical helper. It runs as the migrator
 * because the helper is owner-only, exactly as the other audit sources call it.
 */
async function emitThree() {
  await setActorJwt(migrator, ADMIN, WS)
  for (const n of [1, 2, 3]) {
    await migrator.query(
      `select internal.emit_change_event($1,'record',$2,'update',$2,$3,$4::jsonb)`,
      [WS, crypto.randomUUID(), PROJECT, JSON.stringify({ n })],
    )
  }
}

async function chain(client: Client) {
  return (
    await client.query<{
      ok: boolean
      checked: number
      first_bad_sequence: string | null
    }>('select ok,checked,first_bad_sequence from api.verify_audit_chain($1)', [
      WS,
    ])
  ).rows[0]!
}

describe('REV-05.1 audit hash chain', () => {
  it('chains each entry to the previous one and verifies clean', async () => {
    const admin = await actor(ADMIN)
    await emitThree()
    const rows = await migrator.query<{
      previous_hash: string | null
      entry_hash: string
    }>(
      `select previous_hash,entry_hash from api.change_events where workspace_id=$1 order by sequence`,
      [WS],
    )
    expect(rows.rows).toHaveLength(3)
    expect(rows.rows[0]!.previous_hash).toBeNull()
    expect(rows.rows[1]!.previous_hash).toBe(rows.rows[0]!.entry_hash)
    expect(rows.rows[2]!.previous_hash).toBe(rows.rows[1]!.entry_hash)
    expect(new Set(rows.rows.map((row) => row.entry_hash)).size).toBe(3)

    expect(await chain(admin)).toMatchObject({ ok: true, checked: 3 })
  })

  it('refuses to rewrite or delete an entry', async () => {
    await expectDenied(
      migrator.query(
        `update api.change_events set payload='{"n":99}'::jsonb where workspace_id=$1`,
        [WS],
      ),
      'SB121',
    )
    await expectDenied(
      migrator.query('delete from api.change_events where workspace_id=$1', [
        WS,
      ]),
      'SB121',
    )
  })

  it('detects a rewritten entry when the append-only trigger is bypassed', async () => {
    const admin = await actor(ADMIN)
    const target = (
      await migrator.query<{ id: string; sequence: string }>(
        `select id,sequence from api.change_events where workspace_id=$1 order by sequence limit 1`,
        [WS],
      )
    ).rows[0]!
    await migrator.query(
      'alter table api.change_events disable trigger refuse_change_event_mutation',
    )
    try {
      await migrator.query(
        `update api.change_events set payload='{"n":99}'::jsonb where id=$1`,
        [target.id],
      )
      const broken = await chain(admin)
      expect(broken.ok).toBe(false)
      expect(broken.first_bad_sequence).toBe(target.sequence)
    } finally {
      await migrator.query(
        'alter table api.change_events enable trigger refuse_change_event_mutation',
      )
    }
  })

  it('lets only a workspace admin verify the chain', async () => {
    const member = await actor(MEMBER)
    await expectDenied(
      member.query('select * from api.verify_audit_chain($1)', [WS]),
      '42501',
    )
  })
})
