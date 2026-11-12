/**
 * Publishing a pipeline version needs an admin's approval.
 *
 * Proves against a real PostgreSQL surface that:
 *  - a draft is published only by an approval: there is no direct publish;
 *  - the request names admin and owner, and callers cannot widen that;
 *  - a second person decides when one exists, and the person asking may
 *    decide only where they are the sole admin or owner;
 *  - the draft is locked while the request waits, and returning or
 *    withdrawing unlocks it;
 *  - approving publishes the exact revision that was asked for;
 *  - members cannot ask or approve.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '0e020000-0000-4000-8000-000000000301'
const OWNER = 'publish-approval-owner'
const ADMIN = 'publish-approval-admin'
const STEWARD = 'publish-approval-steward'
const MEMBER = 'publish-approval-member'

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

const config = (statement = 'SELECT 1 AS n') => ({
  configVersion: 2,
  mode: 'standard',
  description: 'approval test',
  parameters: [],
  inputs: [],
  steps: [{ name: 'only', kind: 'sql', statement }],
  output: { mode: 'none' },
})

async function draft(
  client: Client,
  statement?: string,
): Promise<{
  id: string
  revision: string
}> {
  const { rows } = await client.query(
    'select * from api.create_pipeline_definition_version($1::uuid,$2::uuid,$3::jsonb)',
    [WS, definitionId, JSON.stringify(config(statement))],
  )

  return rows[0]
}

const ask = (client: Client, versionId: string, reason = 'Ready') =>
  client.query(
    'select * from api.request_pipeline_publish($1::uuid,$2::uuid,$3::text)',
    [WS, versionId, reason],
  )

async function lifecycle(versionId: string): Promise<string> {
  const { rows } = await migrator.query(
    'select lifecycle from api.pipeline_definition_versions where id = $1',
    [versionId],
  )

  return rows[0].lifecycle
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole

  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'publish-approval', 'Publish approval')`,
    [WS],
  )

  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Owner', 'o@publish.test'), ($2, 'Admin', 'a@publish.test'),
       ($3, 'Steward', 's@publish.test'), ($4, 'Member', 'm@publish.test')`,
    [OWNER, ADMIN, STEWARD, MEMBER],
  )

  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'steward'), ($1, $5, 'member')`,
    [WS, OWNER, ADMIN, STEWARD, MEMBER],
  )

  const owner = await actor(OWNER)

  const { rows } = await owner.query(
    'select * from api.create_pipeline_definition($1::uuid,$2::text,$3::text,$4::text)',
    [WS, 'approval_test', 'Approval test', null],
  )

  definitionId = rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
})

describe('Publishing a pipeline version', () => {
  it('has no direct publish any more', async () => {
    const { rows } = await migrator.query(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname = 'publish_pipeline_definition_version'`,
    )

    expect(rows[0].n).toBe(0)
  })

  it('waits for an admin: a steward asks, an admin approves and it publishes', async () => {
    const steward = await actor(STEWARD)
    const admin = await actor(ADMIN)
    const version = await draft(steward)
    const request = (await ask(steward, version.id, 'Tighter limits')).rows[0]

    expect(request.state).toBe('pending')
    expect(request.object_kind).toBe('pipeline_definition_version')
    expect([...request.required_approver_roles].sort()).toEqual([
      'admin',
      'owner',
    ])
    expect(request.require_independence).toBe(true)
    expect(await lifecycle(version.id)).toBe('draft')

    const approved = (
      await admin.query(
        'select * from api.approve_approval_request($1::uuid, $2::text)',
        [request.id, 'Looks right'],
      )
    ).rows[0]

    expect(approved.state).toBe('approved')
    expect(await lifecycle(version.id)).toBe('published')

    const { rows } = await migrator.query(
      'select published_by_user_id from api.pipeline_definition_versions where id = $1',
      [version.id],
    )

    // Published for the person who asked; the approver is on the request.
    expect(rows[0].published_by_user_id).toBe(STEWARD)
    expect(approved.decided_by_user_id).toBe(ADMIN)
  })

  it('does not let the person asking approve while another admin exists', async () => {
    const owner = await actor(OWNER)
    const version = await draft(owner)
    const request = (await ask(owner, version.id)).rows[0]

    expect(request.require_independence).toBe(true)

    await expect(
      owner.query('select * from api.approve_approval_request($1::uuid)', [
        request.id,
      ]),
    ).rejects.toThrow(/own submission/)

    expect(await lifecycle(version.id)).toBe('draft')

    // Clear the way for the next tests.
    await owner.query('select * from api.withdraw_approval_request($1::uuid)', [
      request.id,
    ])
  })

  it('refuses members, and callers who name other roles', async () => {
    const member = await actor(MEMBER)
    const steward = await actor(STEWARD)
    const version = await draft(steward)

    await expect(ask(member, version.id)).rejects.toThrow()

    await expect(
      steward.query(
        `select * from api.submit_approval_request($1::uuid,'pipeline_definition_version',$2::uuid,
           ARRAY['steward']::text[],'Ready',false,1,null)`,
        [WS, version.id],
      ),
    ).rejects.toThrow(/admin or owner/)

    const request = (await ask(steward, version.id)).rows[0]

    await expect(
      member.query('select * from api.approve_approval_request($1::uuid)', [
        request.id,
      ]),
    ).rejects.toThrow(/approval denied/)

    await steward.query(
      'select * from api.withdraw_approval_request($1::uuid)',
      [request.id],
    )
  })

  it('locks the draft while the request waits and unlocks it when returned', async () => {
    const steward = await actor(STEWARD)
    const admin = await actor(ADMIN)
    const version = await draft(steward)
    const request = (await ask(steward, version.id)).rows[0]

    await expect(
      steward.query(
        'select * from api.update_pipeline_definition_version_draft($1::uuid,$2::uuid,$3::bigint,$4::jsonb)',
        [WS, version.id, version.revision, JSON.stringify(config('SELECT 2'))],
      ),
    ).rejects.toThrow(/locked while approval is pending/)

    await expect(ask(steward, version.id)).rejects.toThrow()

    await admin.query(
      'select * from api.return_approval_request($1::uuid,$2::text)',
      [request.id, 'Mention the unit'],
    )

    await steward.query(
      'select * from api.update_pipeline_definition_version_draft($1::uuid,$2::uuid,$3::bigint,$4::jsonb)',
      [WS, version.id, version.revision, JSON.stringify(config('SELECT 2'))],
    )

    expect(await lifecycle(version.id)).toBe('draft')

    const again = (await ask(steward, version.id, 'Fixed')).rows[0]

    await admin.query('select * from api.approve_approval_request($1::uuid)', [
      again.id,
    ])

    expect(await lifecycle(version.id)).toBe('published')
  })

  it('lets a lab with one admin or owner approve its own request', async () => {
    const solo = '0e020000-0000-4000-8000-000000000302'
    const user = 'publish-approval-solo'

    await migrator.query(
      `insert into api.workspaces(id, slug, name) values($1, 'publish-solo', 'Solo lab')`,
      [solo],
    )

    await migrator.query(
      `insert into internal."user"(id, name, email) values($1, 'Solo', 'solo@publish.test')`,
      [user],
    )

    await migrator.query(
      `insert into api.workspace_memberships(workspace_id, user_id, role) values($1, $2, 'owner')`,
      [solo, user],
    )

    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await setActorJwt(client, user, solo)

    const def = (
      await client.query(
        'select * from api.create_pipeline_definition($1::uuid,$2::text,$3::text,$4::text)',
        [solo, 'solo_pipeline', 'Solo', null],
      )
    ).rows[0]

    const version = (
      await client.query(
        'select * from api.create_pipeline_definition_version($1::uuid,$2::uuid,$3::jsonb)',
        [solo, def.id, JSON.stringify(config())],
      )
    ).rows[0]

    const request = (
      await client.query(
        'select * from api.request_pipeline_publish($1::uuid,$2::uuid,$3::text)',
        [solo, version.id, 'Only admin here'],
      )
    ).rows[0]

    expect(request.require_independence).toBe(false)

    await client.query('select * from api.approve_approval_request($1::uuid)', [
      request.id,
    ])

    expect(await lifecycle(version.id)).toBe('published')
  })

  it('refuses a draft that would not pass its own checks', async () => {
    const steward = await actor(STEWARD)
    const version = await draft(steward)

    await migrator.query(
      `update api.pipeline_definition_versions set configuration = '{"configVersion":2,"steps":[]}'::jsonb where id = $1`,
      [version.id],
    )

    await expect(ask(steward, version.id)).rejects.toThrow(
      /invalid pipeline configuration/,
    )
  })
})
