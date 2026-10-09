/**
 * ELN-002 integration proof: row-level security isolates the notebook
 * domain (folders, records, blocks, record_links, revisions) per
 * workspace. Two workspaces with records/blocks/links each; reads, inserts,
 * updates and deletes are exercised as the `authenticated` role with real
 * claim GUCs, plus the missing-claim and api_client paths.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  prepareTestDatabase,
  grantProjectAccess,
} from './helpers'

const DENIED = '42501'

const WS_A = '00000000-0000-4000-8000-00000000090a'
const WS_B = '00000000-0000-4000-8000-00000000090b'
const PROJ_A = '00000000-0000-4000-8000-00000000091a'
const PROJ_B = '00000000-0000-4000-8000-00000000091b'
const OWNER_A = 'nb-rls-owner-a'
const OWNER_B = 'nb-rls-owner-b'
const MEMBER_A = 'nb-rls-member-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'NB Owner A', 'nb-a@sheetbase.test', true),
      ('${OWNER_B}', 'NB Owner B', 'nb-b@sheetbase.test', true),
      ('${MEMBER_A}', 'NB Member A', 'nb-ma@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'nb-ws-a', 'NB WS A'),
      ('${WS_B}', 'nb-ws-b', 'NB WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'nb-proj-a', 'NB Project A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'nb-proj-b', 'NB Project B', '${OWNER_B}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: MEMBER_A,
    canView: true,
    canEdit: true,
  })

  // Seed a record + block + link in each workspace so read isolation can be
  // observed. Created as migrator (owner bypasses RLS) so the seed is not
  // subject to the created_by_user_id = current_user_id() insert policy.
  await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${WS_A}', '${PROJ_A}', 'experiment', 'EXP-2025-0001', 'Virus Stability A', '${OWNER_A}'),
      ('${WS_B}', '${PROJ_B}', 'experiment', 'EXP-2025-0001', 'Virus Stability B', '${OWNER_B}')`,
  )
  const { rows: recs } = await migrator.query<{
    id: string
    workspace_id: string
  }>(`SELECT id::text, workspace_id FROM api.records`)
  const recA = recs.find((r) => r.workspace_id === WS_A)!.id
  const recB = recs.find((r) => r.workspace_id === WS_B)!.id
  await migrator.query(
    `INSERT INTO api.blocks (record_id, type, payload, "order", created_by_user_id) VALUES
      ('${recA}', 'rich_text', '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Methods A"}]}]}}', 1, '${OWNER_A}'),
      ('${recB}', 'rich_text', '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Methods B"}]}]}}', 1, '${OWNER_B}')`,
  )
  await migrator.query(
    `INSERT INTO api.record_links (source_record_id, target_kind, target_identifier, link_type, created_by_user_id) VALUES
      ('${recA}', 'sample', 'SMP-A-0001', 'sample', '${OWNER_A}'),
      ('${recB}', 'sample', 'SMP-B-0001', 'sample', '${OWNER_B}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions (record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id) VALUES
      ('${recA}', 1, 1, '{"title":"Virus Stability A"}', '[]', 'manual', '${OWNER_A}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function recordTitles(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ title: string }>(
    'SELECT title FROM api.records ORDER BY title',
  )
  return rows.map((r) => r.title)
}

async function blockTexts(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ t: string | null }>(
    `SELECT payload#>>'{doc,content,0,content,0,text}' AS t
     FROM api.blocks ORDER BY payload#>>'{doc,content,0,content,0,text}'`,
  )
  return rows.map((r) => r.t ?? '')
}

async function linkTargets(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ target_identifier: string }>(
    `SELECT target_identifier FROM api.record_links ORDER BY target_identifier`,
  )
  return rows.map((r) => r.target_identifier)
}

describe('notebook domain read isolation', () => {
  it('shows an owner only their own workspace records', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    expect(await recordTitles(a)).toEqual(['Virus Stability A'])
    const b = await asAuthenticated(OWNER_B, WS_B)
    expect(await recordTitles(b)).toEqual(['Virus Stability B'])
  })

  it('shows an owner only blocks of records in their workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    expect(await blockTexts(a)).toEqual(['Methods A'])
    const b = await asAuthenticated(OWNER_B, WS_B)
    expect(await blockTexts(b)).toEqual(['Methods B'])
  })

  it('shows an owner only record_links sourced from their workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    expect(await linkTargets(a)).toEqual(['SMP-A-0001'])
    const b = await asAuthenticated(OWNER_B, WS_B)
    expect(await linkTargets(b)).toEqual(['SMP-B-0001'])
  })

  it('shows an owner only revisions of records in their workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    const { rows: aRows } = await a.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.revisions`,
    )
    expect(aRows[0]?.n).toBe('1')
    const b = await asAuthenticated(OWNER_B, WS_B)
    const { rows: bRows } = await b.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.revisions`,
    )
    expect(bRows[0]?.n).toBe('0')
  })
})

describe('notebook domain writes', () => {
  it('lets a member create a record in their own workspace', async () => {
    const a = await asAuthenticated(MEMBER_A, WS_A)
    await a.query(
      `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id)
       VALUES ('${WS_A}', '${PROJ_A}', 'experiment', 'EXP-2025-0002', 'Member record', '${MEMBER_A}')`,
    )
  })

  it('rejects inserting a record into another workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      a.query(
        `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id)
         VALUES ('${WS_B}', '${PROJ_B}', 'experiment', 'EXP-2025-9999', 'Sneaky', '${OWNER_A}')`,
      ),
      DENIED,
    )
  })

  it('lets a member update a record but not move it between workspaces', async () => {
    const a = await asAuthenticated(MEMBER_A, WS_A)
    await a.query(
      `UPDATE api.records SET title = 'Renamed A' WHERE identifier = 'EXP-2025-0002'`,
    )
    // The WITH CHECK pins workspace_id, so moving to WS_B is denied.
    await expectDenied(
      a.query(
        `UPDATE api.records SET workspace_id = '${WS_B}' WHERE identifier = 'EXP-2025-0002'`,
      ),
      DENIED,
    )
  })

  it('makes record deletion owner-only', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    // Member cannot delete: owner-only USING excludes the row (0 rows affected).
    await member.query(
      `DELETE FROM api.records WHERE identifier = 'EXP-2025-0002'`,
    )
    const { rows: stillThere } = await migrator.query<{ id: string }>(
      `SELECT id::text FROM api.records WHERE identifier = 'EXP-2025-0002'`,
    )
    expect(stillThere).toHaveLength(1)

    const owner = await asAuthenticated(OWNER_A, WS_A)
    await owner.query(
      `DELETE FROM api.records WHERE identifier = 'EXP-2025-0002'`,
    )
    const { rows: gone } = await migrator.query<{ id: string }>(
      `SELECT id::text FROM api.records WHERE identifier = 'EXP-2025-0002'`,
    )
    expect(gone).toHaveLength(0)
  })

  it('rejects inserting a block for a record in another workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    const { rows: bRec } = await migrator.query<{ id: string }>(
      `SELECT id::text FROM api.records WHERE workspace_id = '${WS_B}' LIMIT 1`,
    )
    await expectDenied(
      a.query(
        `INSERT INTO api.blocks (record_id, type, payload, "order", created_by_user_id)
         VALUES ('${bRec[0].id}', 'checklist', '{"items":[]}', 1, '${OWNER_A}')`,
      ),
      DENIED,
    )
  })
})

describe('revisions are immutable through PostgREST', () => {
  it('rejects UPDATE on revisions via grants', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `UPDATE api.revisions SET reason = 'submit' WHERE reason = 'manual'`,
      ),
      DENIED,
    )
  })

  it('rejects DELETE on revisions via grants', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`DELETE FROM api.revisions WHERE reason = 'manual'`),
      DENIED,
    )
  })
})

describe('missing claims and api_client', () => {
  it('returns no notebook rows when claims are missing', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query('RESET request.jwt.claims')
    expect(await recordTitles(client)).toEqual([])
    expect(await blockTexts(client)).toEqual([])
    expect(await linkTargets(client)).toEqual([])
  })

  it('lets api_client read only the workspace in its claims', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE api_client')
    await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ role: 'api_client', workspace_id: WS_A }),
    ])
    expect(await recordTitles(client)).toEqual(['Virus Stability A'])
    expect(await blockTexts(client)).toEqual(['Methods A'])
  })
})
