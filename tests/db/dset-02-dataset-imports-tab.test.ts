/**
 * R5-SURF-01 — the dataset Imports tab reads `api.dataset_import_list`
 * (DSET-02.3). A committed import must appear in that dataset's Imports tab for
 * a workspace member, and must not leak to a non-member.
 */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const workspace = randomUUID()
const otherWorkspace = randomUUID()
const schema = randomUUID()
const schemaVersion = randomUUID()
const field = randomUUID()
let migrator: Client
let writer: Client
let outsider: Client
const clients: Client[] = []

beforeAll(async () => {
  const db = await prepareTestDatabase()
  migrator = db.migrator
  await migrator.query(`INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
    ('imports-tab-writer', 'Writer', 'imports-tab-writer@test.invalid', true),
    ('imports-tab-outsider', 'Outsider', 'imports-tab-outsider@test.invalid', true)`)
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
    ($1, 'imports-tab-a', 'Imports tab A'), ($2, 'imports-tab-b', 'Imports tab B')`,
    [workspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
    ($1, 'imports-tab-writer', 'member'), ($2, 'imports-tab-outsider', 'member')`,
    [workspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name)
    VALUES ($1, $2, 'imports_tab', 'Imports tab')`,
    [schema, workspace],
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version) VALUES ($1, $2, 1)`,
    [schemaVersion, schema],
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
    (schema_version_id, field_id, key, label, logical_type, nullable, display_order)
    VALUES ($1, $2, 'reading', 'Reading', 'decimal', true, 1)`,
    [schemaVersion, field],
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = $1`,
    [schemaVersion],
  )
  for (const [user, ws] of [
    ['imports-tab-writer', workspace],
    ['imports-tab-outsider', otherWorkspace],
  ]) {
    const client = await db.asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await setActorJwt(client, user!, ws!)
  }
  writer = clients[0]!
  outsider = clients[1]!
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

async function committedImport() {
  const dataset = randomUUID()
  const file = randomUUID()
  const parser = randomUUID()
  const parserVersion = randomUUID()
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name)
    VALUES ($1, $2, $3, 'Imports tab dataset')`,
    [dataset, workspace, schemaVersion],
  )
  await migrator.query(
    `INSERT INTO api.dataset_import_files
    (id, workspace_id, filename, byte_size, checksum, storage_key, format)
    VALUES ($1, $2, 'readings.csv', 20, $3, $4, 'csv')`,
    [file, workspace, 'b'.repeat(64), file],
  )
  await migrator.query(
    `INSERT INTO api.parsers (id, workspace_id, key, name, format)
    VALUES ($1::uuid, $2, ($1::uuid)::text, 'Ambr parser', 'csv')`,
    [parser, workspace],
  )
  await migrator.query(
    `INSERT INTO api.parser_versions (id, workspace_id, parser_id, version, signature)
    VALUES ($1, $2, $3, 3, '{"requiredHeaders":["reading"]}')`,
    [parserVersion, workspace, parser],
  )
  const committed = await writer.query(
    `SELECT api.commit_dataset_import(
      $1, 1, $2::jsonb, $3, $4, '{}'::jsonb, $5::jsonb, $6, $7, NULL, NULL) result`,
    [
      dataset,
      JSON.stringify([
        {
          operation: 'create',
          rowId: randomUUID(),
          values: { [field]: 17.25 },
        },
      ]),
      randomUUID(),
      file,
      JSON.stringify({
        total: 1,
        added: 1,
        planned: 0,
        new: 1,
        flagged: 0,
        skipped: 0,
      }),
      parser,
      parserVersion,
    ],
  )
  return { dataset, importId: committed.rows[0].result.importId as string }
}

describe('R5-SURF-01 dataset Imports tab read model', () => {
  it('shows a committed import receipt in that dataset’s Imports list', async () => {
    const { dataset, importId } = await committedImport()

    const rows = (
      await writer.query('SELECT * FROM api.dataset_import_list($1)', [dataset])
    ).rows

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: importId,
      dataset_id: dataset,
      status: 'committed',
    })
    // The provenance the tab renders: file, parser and row outcome.
    expect(rows[0].source_provenance).toMatchObject({
      filename: 'readings.csv',
    })
    expect(rows[0].parser_provenance).toMatchObject({
      name: 'Ambr parser',
      version: 3,
    })
    expect(rows[0].outcome).toMatchObject({ added: 1 })
  })

  it('returns nothing for a non-member rather than another workspace’s imports', async () => {
    const { dataset } = await committedImport()

    const rows = (
      await outsider.query('SELECT * FROM api.dataset_import_list($1)', [
        dataset,
      ])
    ).rows

    expect(rows).toEqual([])
  })
})
