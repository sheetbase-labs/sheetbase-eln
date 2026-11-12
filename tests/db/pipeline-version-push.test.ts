/**
 * Recording a push of the version file on a draft.
 *
 * Proves against a real PostgreSQL surface that:
 *  - a push records who, when and the commit on the draft, and changes nothing else
 *    (not the configuration, not the revision);
 *  - a push with no commit records none, and a later push replaces the record;
 *  - only a draft can be pushed to, and a member cannot record one.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '0e020000-0000-4000-8000-000000000302'
const STEWARD = 'version-push-steward'
const MEMBER = 'version-push-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let definitionId = ''

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')

  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)

  return client
}

const config = {
  configVersion: 2,
  mode: 'advanced',
  description: 'push test',
  parameters: [],
  inputs: [],
  steps: [{ name: 'only', kind: 'sql', statement: 'SELECT 1 AS n' }],
  output: { mode: 'none' },
}

const record = (client: Client, versionId: string, commit?: string | null) =>
  client.query(
    'select * from api.record_pipeline_version_push($1::uuid,$2::uuid,$3::text)',
    [WS, versionId, commit ?? null],
  )

beforeAll(async () => {
  const prepared = await prepareTestDatabase()

  migrator = prepared.migrator
  asRole = prepared.asRole

  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'version-push', 'Version push')`,
    [WS],
  )

  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Steward', 's@push.test'), ($2, 'Member', 'm@push.test')`,
    [STEWARD, MEMBER],
  )

  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'steward'), ($1, $3, 'member')`,
    [WS, STEWARD, MEMBER],
  )

  const steward = await actor(STEWARD)

  const { rows } = await steward.query(
    'select * from api.create_pipeline_definition($1::uuid,$2::text,$3::text,$4::text)',
    [WS, 'push_test', 'Push test', null],
  )

  definitionId = rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
})

describe('Recording a version file push', () => {
  it('says who pushed, when and from which commit, and changes nothing else', async () => {
    const steward = await actor(STEWARD)

    const { rows: made } = await steward.query(
      'select * from api.create_pipeline_definition_version($1::uuid,$2::uuid,$3::jsonb)',
      [WS, definitionId, JSON.stringify(config)],
    )

    const before = made[0]

    expect(before.pushed_at).toBeNull()

    const { rows } = await record(steward, before.id, ' 3f2a1c9 ')

    expect(rows[0].pushed_by_user_id).toBe(STEWARD)
    expect(rows[0].push_commit).toBe('3f2a1c9')
    expect(rows[0].pushed_at).toBeInstanceOf(Date)
    expect(rows[0].revision).toBe(before.revision)
    expect(rows[0].configuration).toEqual(before.configuration)
    expect(rows[0].lifecycle).toBe('draft')
  })

  it('records no commit when none is given, and a later push replaces the record', async () => {
    const steward = await actor(STEWARD)

    const { rows: draft } = await steward.query(
      `select id from api.pipeline_definition_versions where definition_id = $1 and lifecycle = 'draft'`,
      [definitionId],
    )

    const { rows } = await record(steward, draft[0].id)

    expect(rows[0].push_commit).toBeNull()
    expect(rows[0].pushed_by_user_id).toBe(STEWARD)
  })

  it('is refused for a member, for another workspace and for a missing version', async () => {
    const member = await actor(MEMBER)
    const steward = await actor(STEWARD)

    const { rows: draft } = await steward.query(
      `select id from api.pipeline_definition_versions where definition_id = $1 and lifecycle = 'draft'`,
      [definitionId],
    )

    await expect(record(member, draft[0].id, 'abc')).rejects.toThrow()

    await expect(
      steward.query(
        'select * from api.record_pipeline_version_push($1::uuid,$2::uuid,$3::text)',
        ['0e020000-0000-4000-8000-0000000003ff', draft[0].id, null],
      ),
    ).rejects.toThrow(/wrong workspace/)

    await expect(
      record(steward, '00000000-0000-4000-8000-000000000999'),
    ).rejects.toThrow(/not found/)
  })

  it('is refused once the version is not a draft', async () => {
    const steward = await actor(STEWARD)

    const { rows: draft } = await steward.query(
      `select id from api.pipeline_definition_versions where definition_id = $1 and lifecycle = 'draft'`,
      [definitionId],
    )

    await migrator.query(
      `update api.pipeline_definition_versions set lifecycle = 'retired' where id = $1`,
      [draft[0].id],
    )

    await expect(record(steward, draft[0].id)).rejects.toThrow(/only draft/)
  })
})
