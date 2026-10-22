import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const workspace = randomUUID()
const otherWorkspace = randomUUID()
const schema = randomUUID()
const schemaVersion = randomUUID()
const field = randomUUID()
let migrator: Client
let writer: Client
let viewer: Client
let outsider: Client
const clients: Client[] = []

beforeAll(async () => {
  const db = await prepareTestDatabase()
  migrator = db.migrator
  await migrator.query(`INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
    ('provenance-writer', 'Writer', 'provenance-writer@test.invalid', true),
    ('provenance-viewer', 'Viewer', 'provenance-viewer@test.invalid', true),
    ('provenance-outsider', 'Outsider', 'provenance-outsider@test.invalid', true)`)
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
    ($1, 'provenance-a', 'Provenance A'), ($2, 'provenance-b', 'Provenance B')`,
    [workspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
    ($1, 'provenance-writer', 'member'), ($1, 'provenance-viewer', 'viewer'),
    ($2, 'provenance-outsider', 'member')`,
    [workspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name)
    VALUES ($1, $2, 'provenance', 'Provenance')`,
    [schema, workspace],
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version)
    VALUES ($1, $2, 1)`,
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
    ['provenance-writer', workspace],
    ['provenance-viewer', workspace],
    ['provenance-outsider', otherWorkspace],
  ]) {
    const client = await db.asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await setActorJwt(client, user!, ws!)
  }
  writer = clients[0]!
  viewer = clients[1]!
  outsider = clients[2]!
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

async function fixture() {
  const dataset = randomUUID()
  const file = randomUUID()
  const parser = randomUUID()
  const version = randomUUID()
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name)
    VALUES ($1, $2, $3, 'Import provenance')`,
    [dataset, workspace, schemaVersion],
  )
  await migrator.query(
    `INSERT INTO api.dataset_import_files
    (id, workspace_id, filename, byte_size, checksum, storage_key, format)
    VALUES ($1, $2, 'readings.csv', 20, $3, $4, 'csv')`,
    [file, workspace, 'a'.repeat(64), file],
  )
  await migrator.query(
    `INSERT INTO api.parsers (id, workspace_id, key, name, format)
    VALUES ($1::uuid, $2, ($1::uuid)::text, 'Test parser', 'csv')`,
    [parser, workspace],
  )
  await migrator.query(
    `INSERT INTO api.parser_versions (id, workspace_id, parser_id, version, signature)
    VALUES ($1, $2, $3, 1, '{"requiredHeaders":["reading"]}')`,
    [version, workspace, parser],
  )
  return { dataset, file, parser, version }
}

async function commit(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    client?: Client
    parser?: string | null
    version?: string | null
    revision?: number
    key?: string
    connectorRun?: string | null
    mapping?: Record<string, unknown>
  } = {},
) {
  const result = await (options.client ?? writer).query(
    `SELECT api.commit_dataset_import(
    $1, $2, $3::jsonb, $4, $5, $9::jsonb, '{}'::jsonb, $6, $7, NULL, NULL, $8) result`,
    [
      f.dataset,
      options.revision ?? 1,
      JSON.stringify([
        {
          operation: 'create',
          rowId: randomUUID(),
          values: { [field]: 17.25 },
        },
      ]),
      options.key ?? randomUUID(),
      f.file,
      options.parser === undefined ? f.parser : options.parser,
      options.version === undefined ? f.version : options.version,
      options.connectorRun ?? null,
      JSON.stringify(options.mapping ?? {}),
    ],
  )
  return result.rows[0].result
}

describe('DSET-06.2 canonical import provenance', () => {
  it('freezes worksheet interpretation beside authoritative raw identity and refuses key reuse with a different interpretation', async () => {
    const f = await fixture()
    const key = randomUUID()
    const mapping = {
      sheetName: 'Measurements',
      sources: [{ source: 'reading', fieldId: field, unit: null }],
    }
    const result = await commit(f, { key, mapping })
    expect(result.ok).toBe(true)
    const receipt = (
      await migrator.query(
        'SELECT source_provenance, mapping FROM api.dataset_imports WHERE id=$1',
        [result.importId],
      )
    ).rows[0]
    expect(receipt.source_provenance).toEqual({
      fileId: f.file,
      filename: 'readings.csv',
      checksum: 'a'.repeat(64),
      storageKey: f.file,
      sheetName: 'Measurements',
    })
    expect(receipt.mapping).toEqual(mapping)
    expect((await commit(f, { key, mapping })).idempotent).toBe(true)
    await expectDenied(
      commit(f, { key, mapping: { ...mapping, sheetName: 'Cover' } }),
      '22023',
    )
    await expectDenied(
      commit(f, {
        key,
        mapping: {
          ...mapping,
          sources: [{ source: 'reading', fieldId: field, unit: 'mg' }],
        },
      }),
      '22023',
    )
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int n FROM api.dataset_versions WHERE dataset_id=$1',
          [f.dataset],
        )
      ).rows[0].n,
    ).toBe(1)
  })

  it('requires both canonical parser identities, not nullable attribution', async () => {
    const f = await fixture()
    await expectDenied(commit(f, { parser: null, version: null }), 'SB107')
    await expectDenied(commit(f, { version: null }), 'SB107')
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int n FROM api.dataset_rows WHERE dataset_id = $1',
          [f.dataset],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await migrator.query(
          'SELECT status FROM api.dataset_import_files WHERE id = $1',
          [f.file],
        )
      ).rows[0].status,
    ).toBe('stored')
  })

  it('rejects a version belonging to a different parser or workspace', async () => {
    const f = await fixture()
    const other = await fixture()
    await expectDenied(commit(f, { version: other.version }), 'SB107')
    await migrator.query(
      'UPDATE api.parser_versions SET workspace_id = $1 WHERE id = $2',
      [otherWorkspace, f.version],
    )
    await expectDenied(commit(f), 'SB107')
  })

  it('preserves writer isolation and stale revision rejection', async () => {
    const f = await fixture()
    await expectDenied(commit(f, { client: viewer }), '42501')
    await expectDenied(commit(f, { client: outsider }), '42501')
    await expect(commit(f, { revision: 9 })).rejects.toThrow(
      'stale_dataset_revision',
    )
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int n FROM api.dataset_imports WHERE dataset_id = $1',
          [f.dataset],
        )
      ).rows[0].n,
    ).toBe(0)
  })

  it('does not attach an unverified connector run even with a retained import file', async () => {
    const f = await fixture()
    await expectDenied(commit(f, { connectorRun: randomUUID() }), '42501')
  })

  it('requires QA approval for regulated imports without allowing importer downgrades', async () => {
    const f = await fixture()
    await migrator.query(
      `UPDATE api.datasets SET intended_use = 'regulated_record' WHERE id = $1`,
      [f.dataset],
    )
    await expectDenied(commit(f), 'SB107')
    await migrator.query(
      `UPDATE api.parser_versions SET status = 'validated' WHERE id = $1`,
      [f.version],
    )
    await expectDenied(commit(f), 'SB107')
    await expectDenied(
      writer.query(
        `SELECT api.set_dataset_intended_use($1, 'exploratory_research', 'bypass')`,
        [f.dataset],
      ),
      '42501',
    )
    await expectDenied(
      writer.query('SELECT api.approve_parser_version($1)', [f.version]),
      '42501',
    )
    await expectDenied(
      writer.query(
        `UPDATE api.datasets SET intended_use = 'exploratory_research' WHERE id = $1`,
        [f.dataset],
      ),
      '42501',
    )
    await expectDenied(
      writer.query(
        `SELECT api.ensure_parser($1, 'forged', 'Forged', 'csv', 1, '{}', '{}', NULL, 'approved')`,
        [workspace],
      ),
      '22023',
    )
    await migrator.query(
      `UPDATE api.workspace_memberships SET role = 'steward' WHERE user_id = 'provenance-writer'`,
    )
    try {
      await setActorJwt(migrator, 'provenance-writer', workspace)
      await migrator.query(
        'SELECT internal.record_parser_validation($1,$2,$3,$4,$5)',
        [
          f.version,
          f.file,
          'a'.repeat(64),
          { signature: { requiredHeaders: ['reading'] }, mapping: {} },
          {
            ok: true,
            fileId: f.file,
            checksum: 'a'.repeat(64),
            rowCount: 1,
            errors: [],
            headers: ['reading'],
          },
        ],
      )
      await writer.query('SELECT api.approve_parser_version($1)', [f.version])
      expect(await commit(f)).toMatchObject({ ok: true })
      await writer.query(
        `SELECT api.set_dataset_intended_use($1, 'controlled_development', 'Use reassessed')`,
        [f.dataset],
      )
      expect(
        (
          await migrator.query(
            'SELECT intended_use FROM api.datasets WHERE id = $1',
            [f.dataset],
          )
        ).rows[0].intended_use,
      ).toBe('controlled_development')
      expect(
        (
          await migrator.query(
            `SELECT actor_user_id, payload FROM api.change_events
             WHERE entity_uuid = $1 AND payload->>'reason' = 'Use reassessed'`,
            [f.dataset],
          )
        ).rows,
      ).toEqual([
        {
          actor_user_id: 'provenance-writer',
          payload: {
            intendedUse: 'controlled_development',
            reason: 'Use reassessed',
          },
        },
      ])
    } finally {
      await migrator.query(
        `UPDATE api.workspace_memberships SET role = 'member' WHERE user_id = 'provenance-writer'`,
      )
    }
  })

  it('does not replay another dataset receipt under the same workspace key', async () => {
    const f = await fixture()
    const other = await fixture()
    const key = randomUUID()
    expect(await commit(f, { key })).toMatchObject({ ok: true })
    await expectDenied(commit(other, { key }), '22023')
  })

  it('refuses retired parsers even on exploratory datasets', async () => {
    const f = await fixture()
    await migrator.query(
      `UPDATE api.parser_versions SET status = 'retired' WHERE id = $1`,
      [f.version],
    )
    await expectDenied(commit(f), 'SB107')
  })

  it('commits once and retains the exact imported row membership and frozen parser', async () => {
    const f = await fixture()
    const key = randomUUID()
    const result = await commit(f, { key })
    expect(result).toMatchObject({ ok: true, idempotent: false })
    const receipt = (
      await migrator.query('SELECT * FROM api.dataset_imports WHERE id = $1', [
        result.importId,
      ])
    ).rows[0]
    expect(receipt.parser_id).toBe(f.parser)
    expect(receipt.parser_version_id).toBe(f.version)
    expect(receipt.imported_row_ids).toEqual(
      result.rows.map((r: { rowId: string }) => r.rowId),
    )
    expect(receipt.parser_provenance).toMatchObject({
      parserId: f.parser,
      parserVersionId: f.version,
      version: 1,
      status: 'draft',
      signature: { requiredHeaders: ['reading'] },
    })
    expect(
      (
        await outsider.query('SELECT * FROM api.dataset_import_list($1)', [
          f.dataset,
        ])
      ).rows,
    ).toEqual([])
    await migrator.query(
      `UPDATE api.parser_versions SET signature = '{"changed":true}' WHERE id = $1`,
      [f.version],
    )
    expect(
      (
        await migrator.query(
          'SELECT parser_provenance FROM api.dataset_imports WHERE id = $1',
          [result.importId],
        )
      ).rows[0].parser_provenance,
    ).toEqual(receipt.parser_provenance)
    expect(await commit(f, { key })).toMatchObject({
      ok: true,
      idempotent: true,
      importId: result.importId,
    })
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int n FROM api.dataset_rows WHERE dataset_id = $1',
          [f.dataset],
        )
      ).rows[0].n,
    ).toBe(1)
  })
})
