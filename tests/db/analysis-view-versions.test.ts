/**
 * Analysis version history.
 *
 * - Every save keeps the version it replaced, readable by workspace members.
 * - Nobody can write to the history; only the save trigger does.
 * - Another workspace sees nothing.
 *
 * NOTE: requires a real PostgreSQL database; run via `pnpm test:db`.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000008a1'
const WS_OTHER = '00000000-0000-4000-8000-0000000008a2'
const OWNER = 'analysis-versions-owner'
const READER = 'analysis-versions-reader'
const OUTSIDER = 'analysis-versions-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let viewId: string

async function as(userId: string, workspaceId = WS): Promise<Client> {
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

const charts = (title: string) => JSON.stringify([{ title }])

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [OWNER, READER, OUTSIDER]) {
    await migrator.query(
      `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ($1, $1, $1 || '@sheetbase.test', true)`,
      [id],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ($1, 'analysis-versions', 'Analysis versions'), ($2, 'analysis-versions-other', 'Other')`,
    [WS, WS_OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'member')`,
    [WS, OWNER, READER, WS_OTHER, OUTSIDER],
  )
  const owner = await as(OWNER)
  const { rows } = await owner.query(
    `INSERT INTO api.analysis_views (workspace_id, owner_user_id, name, charts)
     VALUES ($1, $2, 'Titre trend', $3::jsonb) RETURNING id`,
    [WS, OWNER, charts('first')],
  )
  viewId = rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('analysis version history', () => {
  it('keeps the version each save replaces', async () => {
    const owner = await as(OWNER)
    await owner.query(
      'UPDATE api.analysis_views SET charts = $2::jsonb WHERE id = $1',
      [viewId, charts('second')],
    )
    await owner.query(
      'UPDATE api.analysis_views SET charts = $2::jsonb WHERE id = $1',
      [viewId, charts('third')],
    )
    const { rows } = await owner.query(
      'SELECT version, charts FROM api.analysis_view_versions WHERE view_id = $1 ORDER BY version',
      [viewId],
    )
    expect(rows).toEqual([
      { version: 1, charts: [{ title: 'first' }] },
      { version: 2, charts: [{ title: 'second' }] },
    ])
    const current = await owner.query(
      'SELECT version FROM api.analysis_views WHERE id = $1',
      [viewId],
    )
    expect(current.rows[0].version).toBe(3)
  })

  it('is readable by a member of the workspace and nobody else', async () => {
    const reader = await as(READER)
    const seen = await reader.query(
      'SELECT 1 FROM api.analysis_view_versions WHERE view_id = $1',
      [viewId],
    )
    expect(seen.rowCount).toBe(2)
    const outsider = await as(OUTSIDER, WS_OTHER)
    const hidden = await outsider.query(
      'SELECT 1 FROM api.analysis_view_versions',
    )
    expect(hidden.rowCount).toBe(0)
  })

  it('cannot be written by hand', async () => {
    const owner = await as(OWNER)
    await expect(
      owner.query(
        `INSERT INTO api.analysis_view_versions (view_id, version, workspace_id, name, charts, source_revisions, saved_at)
         VALUES ($1, 9, $2, 'x', '[]', '[]', now())`,
        [viewId, WS],
      ),
    ).rejects.toThrow()
    await expect(
      owner.query('DELETE FROM api.analysis_view_versions'),
    ).rejects.toThrow()
  })
})
