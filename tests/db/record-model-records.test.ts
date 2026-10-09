/**
 * MDL-01 step 2 (ADR-0051) — records of a workspace-owned record model.
 *
 * Proves: a record of a workspace model is created through
 * `api.create_model_record` with the model's own prefix identifier and is
 * validated against the model's active `record_field_definitions`; an unknown
 * kind is refused; another workspace cannot create (or read) a record of a
 * model it does not own; a built-in record still works; and such records are
 * searchable and linkable like built-ins.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000420a'
const WS_B = '00000000-0000-4000-8000-00000000420b'
const PROJECT_A = '00000000-0000-4000-8000-0000000042a1'
const PROJECT_B = '00000000-0000-4000-8000-0000000042b1'
const OWNER_A = 'record-model-records-owner-a'
const OWNER_B = 'record-model-records-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
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

async function createModel(
  client: Client,
  workspaceId: string,
  key: string,
  prefix: string,
  name = key,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_workspace_model($1, $2, $3, $4, $5)`,
    [workspaceId, key, name, prefix, null],
  )
  // MDL-03: a workspace model needs a published version before records may be
  // created from it; seed version 1 directly (no approval flow under test here).
  await client.query(
    `INSERT INTO api.record_model_versions(workspace_id, model_id, version, revision, lifecycle, definition, published_at, created_by_user_id, updated_by_user_id)
     SELECT $1, $2, 1, 1, 'published', '{"fields":[]}'::jsonb, now(), api.current_user_id(), api.current_user_id()`,
    [workspaceId, rows[0].id],
  )
  await client.query(
    `UPDATE api.record_models SET current_version = 1, lifecycle = 'published' WHERE id = $1`,
    [rows[0].id],
  )
  return rows[0]
}

async function createRecord(
  client: Client,
  projectId: string,
  kind: string,
  title: string,
  customFields: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record(
       $1, $2, $3, 'available', '{}'::text[], '{}'::jsonb, $4::jsonb
     )`,
    [projectId, kind, title, JSON.stringify(customFields)],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
       ('${OWNER_A}', 'RM Records A', 'rm-records-a@sheetbase.test', true),
       ('${OWNER_B}', 'RM Records B', 'rm-records-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
       ('${WS_A}', 'record-model-records-a', 'Record Model Records A'),
       ('${WS_B}', 'record-model-records-b', 'Record Model Records B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
       ('${WS_A}', '${OWNER_A}', 'owner'),
       ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
       ('${PROJECT_A}', '${WS_A}', 'rmra', 'Record Model Records A', '${OWNER_A}'),
       ('${PROJECT_B}', '${WS_B}', 'rmrb', 'Record Model Records B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('records of a workspace model', () => {
  it('creates the model and an active field definition', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const model = await createModel(owner, WS_A, 'cell_bank', 'CB', 'Cell bank')
    expect(model).toMatchObject({
      key: 'cell_bank',
      identifier_prefix: 'CB',
    })

    // Field editing for workspace models is MDL-02; seed an active definition
    // through the canonical field store to exercise write-time validation.
    // The new `record_field_definitions_kind_guard` must accept the workspace
    // model key (this insert would previously fail the model_kinds FK).
    await migrator.query(
      `INSERT INTO api.record_field_definitions
         (workspace_id, kind, field_name, label, display_order, logical_type,
          nullable, validation, lifecycle, created_by_user_id)
       VALUES ($1, 'cell_bank', 'passage', 'Passage', 1, 'integer',
               false, '{}'::jsonb, 'active', $2)`,
      [WS_A, OWNER_A],
    )
    const { rows } = await migrator.query(
      `SELECT lifecycle FROM api.record_field_definitions
        WHERE workspace_id = $1 AND kind = 'cell_bank' AND field_name = 'passage'`,
      [WS_A],
    )
    expect(rows).toEqual([{ lifecycle: 'active' }])
  })

  it('refuses a field definition whose kind is neither built-in nor owned', async () => {
    await expect(
      migrator.query(
        `INSERT INTO api.record_field_definitions
           (workspace_id, kind, field_name, label, display_order, logical_type,
            nullable, validation, lifecycle, created_by_user_id)
         VALUES ($1, 'ghost_model', 'x', 'X', 1, 'text',
                 true, '{}'::jsonb, 'draft', $2)`,
        [WS_A, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('creates a record with the model prefix and validates its fields', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)

    const first = await createRecord(
      owner,
      PROJECT_A,
      'cell_bank',
      'CHO K1 bank',
      {
        passage: 12,
      },
    )
    expect(first).toMatchObject({
      kind: 'cell_bank',
      identifier: 'CB-0001',
      title: 'CHO K1 bank',
      workspace_id: WS_A,
    })
    expect(first.custom_fields).toEqual({ passage: 12 })

    const second = await createRecord(
      owner,
      PROJECT_A,
      'cell_bank',
      'CHO K1 bank 2',
      {
        passage: 13,
      },
    )
    expect(second.identifier).toBe('CB-0002')

    // Wrong logical type is refused by the model's active definition.
    await expect(
      createRecord(owner, PROJECT_A, 'cell_bank', 'Bad type', {
        passage: 'twelve',
      }),
    ).rejects.toMatchObject({ code: 'SB071' })

    // A required field cannot be omitted.
    await expect(
      createRecord(owner, PROJECT_A, 'cell_bank', 'Missing field', {}),
    ).rejects.toMatchObject({ code: 'SB071' })

    // An undeclared field is refused.
    await expect(
      createRecord(owner, PROJECT_A, 'cell_bank', 'Unknown field', {
        passage: 1,
        bogus: 'x',
      }),
    ).rejects.toMatchObject({ code: 'SB070' })
  })

  it('refuses an unknown record kind', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Same SQLSTATE the old fixed CHECK constraint raised.
    await expect(
      createRecord(owner, PROJECT_A, 'not_a_model', 'Nope'),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps a built-in record working', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createRecord(owner, PROJECT_A, 'sample', 'Sample one')
    expect(sample.kind).toBe('sample')
    expect(sample.identifier).toMatch(/^SMP-\d+$/)
  })

  it('refuses another workspace that does not own the model', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    // The model key is not a built-in and not owned by WS_B, so it fails the
    // kind allowlist exactly as an unknown kind would.
    await expect(
      createRecord(ownerB, PROJECT_B, 'cell_bank', 'Not mine', { passage: 1 }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps workspace records isolated', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const created = await createRecord(
      owner,
      PROJECT_A,
      'cell_bank',
      'Isolated',
      {
        passage: 7,
      },
    )

    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const seenByB = await ownerB.query(
      `SELECT id FROM api.records WHERE id = $1`,
      [created.id],
    )
    expect(seenByB.rows).toEqual([])
    const fieldsByB = await ownerB.query(
      `SELECT id FROM api.record_field_definitions WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(fieldsByB.rows).toEqual([])
  })

  it('makes workspace model records searchable and linkable', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const created = await createRecord(
      owner,
      PROJECT_A,
      'cell_bank',
      'Searchable CB',
      {
        passage: 3,
      },
    )

    const search = await owner.query<{ record_id: string }>(
      `SELECT record_id FROM api.search('Searchable')`,
    )
    expect(search.rows.map((row) => row.record_id)).toContain(created.id)

    const sample = await createRecord(owner, PROJECT_A, 'sample', 'Link source')
    await owner.query(
      `INSERT INTO api.record_links
         (source_record_id, target_record_id, target_kind, target_identifier,
          link_type, created_by_user_id)
       VALUES ($1, $2, 'cell_bank', $3, 'general', $4)`,
      [sample.id, created.id, created.identifier, OWNER_A],
    )
    const link = await owner.query(
      `SELECT target_record_id, target_kind FROM api.record_links
        WHERE source_record_id = $1`,
      [sample.id],
    )
    expect(link.rows).toEqual([
      { target_record_id: created.id, target_kind: 'cell_bank' },
    ])
  })

  it('resolves duplicate model keys without claims and keeps field contracts workspace-local', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await createModel(ownerB, WS_B, 'cell_bank', 'CB', 'Cell bank B')
    const definitionB = await migrator.query<{ id: string }>(
      `INSERT INTO api.record_field_definitions
         (workspace_id, kind, field_name, label, display_order, logical_type,
          nullable, validation, lifecycle, created_by_user_id)
       VALUES ($1, 'cell_bank', 'bank_code', 'Bank code', 1, 'text',
               false, '{}'::jsonb, 'active', $2) RETURNING id`,
      [WS_B, OWNER_B],
    )
    await migrator.query("SELECT set_config('request.jwt.claims', '{}', false)")
    const records = await migrator.query<{
      id: string
      workspace_id: string
      custom_fields: Record<string, unknown>
    }>(
      `INSERT INTO api.records
         (workspace_id, kind, identifier, title, custom_fields, created_by_user_id)
       VALUES ($1, 'cell_bank', 'CB-DUP-A', 'Bank A', '{"passage":17}', $3),
              ($2, 'cell_bank', 'CB-DUP-B', 'Bank B', '{"bank_code":"B-42"}', $4)
       RETURNING id, workspace_id, custom_fields`,
      [WS_A, WS_B, OWNER_A, OWNER_B],
    )
    expect(records.rows.map((record) => record.custom_fields)).toEqual([
      { passage: 17 },
      { bank_code: 'B-42' },
    ])
    for (const record of records.rows) {
      const manifest = await migrator.query<{
        result: { definitions: Array<{ id: string; fieldName: string }> }
      }>('SELECT internal.model_field_manifest($1) result', [record.id])
      expect(
        manifest.rows[0].result.definitions.map((field) => field.fieldName),
      ).toEqual([record.workspace_id === WS_A ? 'passage' : 'bank_code'])
      if (record.workspace_id === WS_B)
        expect(manifest.rows[0].result.definitions[0].id).toBe(
          definitionB.rows[0].id,
        )
      await expect(
        migrator.query(
          'UPDATE api.records SET custom_fields=$2::jsonb WHERE id=$1',
          [
            record.id,
            JSON.stringify(
              record.workspace_id === WS_A ? { passage: 'bad' } : {},
            ),
          ],
        ),
      ).rejects.toMatchObject({ code: 'SB071' })
      await expect(
        migrator.query(
          'UPDATE api.records SET custom_fields=$2::jsonb WHERE id=$1',
          [record.id, JSON.stringify({ passage: 17, bank_code: 'B-42' })],
        ),
      ).rejects.toMatchObject({ code: 'SB070' })
    }
    await expect(
      migrator.query(
        `INSERT INTO api.records(workspace_id,kind,identifier,title,created_by_user_id)
         VALUES ($1,'never_defined','UNKNOWN-1','Unknown kind',$2)`,
        [WS_B, OWNER_B],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
