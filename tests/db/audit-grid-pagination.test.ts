/**
 * The /settings/audit datagrid's read model: `api.audit_events` paginates the
 * per-workspace change sequence with an exclusive cursor and filters on the
 * server. This suite walks that cursor over a history long enough to span
 * several page boundaries — plain and search-scoped — and proves the
 * reassembled walk is exactly the stored history: no gaps, no repeats, and no
 * entry lost or duplicated at a boundary.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000a11d'
const PROJECT = '10000000-0000-4000-8000-00000000a11d'
const OWNER = 'audit-grid-owner'

/** Deliberately smaller than the search result set, so every walk crosses one. */
const PAGE_SIZE = 7
const HOP_COUNT = 45

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified")
     VALUES ($1, 'Audit Grid Owner', 'audit-grid@sheetbase.test', true)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name)
     VALUES ($1, 'audit-grid', 'Audit Grid')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id)
     VALUES ($1, $2, 'AG-1', 'Audit Grid Project', $3)`,
    [PROJECT, WS, OWNER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: OWNER,
    canView: true,
    canEdit: true,
  })

  // Append a long run of related events above anything the project trigger
  // already emitted, every third one carrying a search term. Inserted as the
  // migrator because the request roles have no write path to the log.
  const base = Number(
    (
      await migrator.query<{ seq: string }>(
        `SELECT COALESCE(MAX(sequence), 0) AS seq FROM api.change_events WHERE workspace_id = $1`,
        [WS],
      )
    ).rows[0].seq,
  )
  await migrator.query(
    `INSERT INTO api.change_events
       (workspace_id, sequence, entity_type, entity_uuid, operation,
        project_id, actor_user_id, payload, created_at)
     SELECT $1, $4 + g, 'project', $2::uuid, 'update', $2::uuid, $3,
            jsonb_build_object(
              'changes',
              jsonb_build_object('title',
                jsonb_build_object('from', 'Audit ' || g, 'to', 'Audit ' || (g + 1))),
              'marker', 'hop-' || g
            )
            || CASE WHEN g % 3 = 0 THEN '{"needle": true}'::jsonb
                    ELSE '{}'::jsonb END,
            now() - (g || ' minutes')::interval
       FROM generate_series(1, $5) AS g`,
    [WS, PROJECT, OWNER, base, HOP_COUNT],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId, { session_id: 'audit-grid' })
  return client
}

interface AuditEventsResult {
  events: Array<{ sequence: number | string; operation: string }>
  hasMore: boolean
  nextCursor: number | null
}

async function callAuditEvents(
  client: Client,
  args: Record<string, unknown>,
): Promise<AuditEventsResult> {
  const { rows } = await client.query<{ result: AuditEventsResult }>(
    `SELECT api.audit_events($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result`,
    [
      args.p_entity_type ?? null,
      args.p_operation ?? null,
      args.p_actor_user_id ?? null,
      args.p_from ?? null,
      args.p_to ?? null,
      args.p_search ?? null,
      args.p_object ?? null,
      args.p_before_sequence ?? null,
      args.p_limit ?? 50,
    ],
  )
  return rows[0].result
}

/** Page the cursor to exhaustion and report the sequence walk and page count. */
async function walk(
  client: Client,
  args: { search?: string } = {},
): Promise<{ sequences: number[]; pages: number }> {
  const sequences: number[] = []
  let before: number | null = null
  let pages = 0
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await callAuditEvents(client, {
      p_search: args.search ?? null,
      p_before_sequence: before,
      p_limit: PAGE_SIZE,
    })
    pages += 1
    sequences.push(...page.events.map((event) => Number(event.sequence)))
    if (!page.hasMore) return { sequences, pages }
    expect(page.nextCursor).not.toBeNull()
    // The cursor is the smallest sequence on the page and is exclusive, so a
    // conforming read must strictly descend.
    expect(before === null || Number(page.nextCursor) < before).toBe(true)
    before = page.nextCursor
  }
  throw new Error('Audit cursor never reached the end of the history')
}

/** The stored history, as the migrator sees it — the walk's ground truth. */
async function storedSequences(needle: boolean): Promise<number[]> {
  const { rows } = await migrator.query<{ sequence: string }>(
    `SELECT sequence FROM api.change_events
      WHERE workspace_id = $1
        ${needle ? `AND payload->>'needle' = 'true'` : ''}
      ORDER BY sequence DESC`,
    [WS],
  )
  return rows.map((row) => Number(row.sequence))
}

describe('audit grid cursor', () => {
  it('walks the full history across page boundaries without gaps or repeats', async () => {
    const expected = await storedSequences(false)
    expect(expected.length).toBeGreaterThanOrEqual(HOP_COUNT)

    const client = await asAuthenticated(OWNER, WS)
    const { sequences, pages } = await walk(client)

    // Several boundaries, so a dropped or repeated row at a cut cannot hide.
    expect(pages).toBeGreaterThan(4)
    expect(sequences).toEqual(expected)
    expect(new Set(sequences).size).toBe(sequences.length)
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBeLessThan(sequences[i - 1])
    }
  })

  it('walks a search selection across page boundaries without gaps or repeats', async () => {
    const expected = await storedSequences(true)
    // 15 matches over pages of 7: more than one boundary, and the last page is
    // partial.
    expect(expected.length).toBe(Math.floor(HOP_COUNT / 3))
    expect(expected.length).toBeGreaterThan(PAGE_SIZE)

    const client = await asAuthenticated(OWNER, WS)
    const { sequences, pages } = await walk(client, { search: 'needle' })

    expect(pages).toBeGreaterThan(2)
    expect(sequences).toEqual(expected)
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('ends a page that matches nothing instead of looping', async () => {
    const client = await asAuthenticated(OWNER, WS)
    const { sequences, pages } = await walk(client, {
      search: 'no-such-marker-in-the-log',
    })
    expect(sequences).toEqual([])
    expect(pages).toBe(1)
  })
})
