import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cf00'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'nb-views','Notebook views')`,
    [WS],
  )
})

afterAll(async () => {
  await migrator?.end()
})

describe('notebook reporting views', () => {
  it('registers the notebook views and leaves the storage key out', async () => {
    const ready = (
      await migrator.query<{ ok: boolean }>(
        `SELECT internal.reporting_ready() AS ok`,
      )
    ).rows[0]!.ok
    if (!ready) return
    const names = await migrator.query<{ view_key: string; view_name: string }>(
      `SELECT view_key, view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1`,
      [WS],
    )
    const byKey = new Map(names.rows.map((r) => [r.view_key, r.view_name]))
    for (const key of [
      'comments',
      'files',
      'protocol_versions',
      'protocol_training',
      'protocol_acknowledgements',
      'protocol_deviations',
      'approval_requests',
      'approval_decisions',
    ]) {
      expect(byKey.has(key), key).toBe(true)
    }
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT a.attname AS column_name FROM pg_attribute a
         WHERE a.attrelid = format('data.%I', $1::text)::regclass
           AND a.attnum > 0 AND NOT a.attisdropped`,
      [byKey.get('files')!],
    )
    const listed = columns.rows.map((c) => c.column_name)
    expect(listed).toContain('checksum')
    expect(listed).not.toContain('storage_key')
  })
})
