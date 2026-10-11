/**
 * R5-CONFIG-03 — draft edits are revision-checked, approval-gated and the
 * published version stays immutable.
 *
 * Proves the server contract the model editor now relies on:
 *  - a save whose expected revision is stale is refused (SB001) and the other
 *    editor's fields are untouched, so a conflict never silently wins;
 *  - a save with the current revision succeeds and returns the new revision;
 *  - a canonical SQL caller that holds the row lock may still omit the
 *    expectation (the deliberate compatibility choice in migration 0430);
 *  - a submitted draft is locked (SB085), an edit after a return is accepted on
 *    the same version, and a returned/withdrawn request cannot publish (SB084);
 *  - a published version and its fields cannot be changed (SB072).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000b230'
const EDITOR = 'r5config03-editor'
const OTHER_EDITOR = 'r5config03-other-editor'
const APPROVER = 'r5config03-approver'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Editor','r5-config-03-editor@test.invalid',true),
       ($2,'Other editor','r5-config-03-other@test.invalid',true),
       ($3,'Approver','r5-config-03-approver@test.invalid',true)`,
    [EDITOR, OTHER_EDITOR, APPROVER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'r5config03','R5-CONFIG-03')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),
       ($1,$3,'steward'),
       ($1,$4,'reviewer')`,
    [WS, EDITOR, OTHER_EDITOR, APPROVER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function createDraft(client: Client, key: string): Promise<string> {
  const { rows } = await client.query<{ schema_version_id: string }>(
    `SELECT api.create_dataset_schema_definition($1,$2,'R5-CONFIG-03 schema',null,'[]'::jsonb)->>'schema_version_id' AS schema_version_id`,
    [WS, key],
  )
  return rows[0]!.schema_version_id
}

async function save(
  client: Client,
  versionId: string,
  fields: { key: string; label?: string }[],
  expectedRevision?: number,
): Promise<{ revision: number; lifecycle: string }> {
  const payload = fields.map((field, index) => ({
    key: field.key,
    label: field.label ?? field.key,
    logical_type: 'text',
    nullable: true,
    display_order: index + 1,
  }))
  const args =
    expectedRevision === undefined
      ? [versionId, JSON.stringify(payload)]
      : [versionId, JSON.stringify(payload), expectedRevision]
  const { rows } = await client.query<{
    revision: string
    lifecycle: string
  }>(
    `SELECT revision, lifecycle FROM api.replace_dataset_schema_version_fields($1,$2::jsonb${
      expectedRevision === undefined ? '' : ',$3'
    })`,
    args,
  )
  return { revision: Number(rows[0]!.revision), lifecycle: rows[0]!.lifecycle }
}

async function fieldKeys(versionId: string): Promise<string[]> {
  const { rows } = await migrator.query<{ key: string }>(
    'SELECT key FROM api.dataset_schema_version_fields WHERE schema_version_id=$1 ORDER BY display_order',
    [versionId],
  )
  return rows.map((row) => row.key)
}

async function revisionOf(versionId: string): Promise<number> {
  const { rows } = await migrator.query<{ revision: string }>(
    'SELECT revision FROM api.dataset_schema_versions WHERE id=$1',
    [versionId],
  )
  return Number(rows[0]!.revision)
}

describe('R5-CONFIG-03 draft conflict handling', () => {
  it('refuses a stale save, leaves the other editor’s fields in place, and accepts the rebased save', async () => {
    const editor = await actor(EDITOR)
    const other = await actor(OTHER_EDITOR)
    const versionId = await createDraft(editor, 'r5config03_conflict')

    const saved = await save(editor, versionId, [{ key: 'viability' }], 1)
    expect(saved).toEqual({ revision: 2, lifecycle: 'draft' })
    expect(await fieldKeys(versionId)).toEqual(['viability'])

    await expectDenied(save(other, versionId, [{ key: 'biomass' }], 1), 'SB001')
    expect(await revisionOf(versionId)).toBe(2)
    expect(await fieldKeys(versionId)).toEqual(['viability'])

    const rebased = await save(
      other,
      versionId,
      [{ key: 'viability' }, { key: 'biomass' }],
      2,
    )
    expect(rebased.revision).toBe(3)
    expect(await fieldKeys(versionId)).toEqual(['viability', 'biomass'])
  })

  it('still accepts a save with no revision expectation', async () => {
    const editor = await actor(EDITOR)
    const versionId = await createDraft(editor, 'r5config03_legacy')
    const saved = await save(editor, versionId, [{ key: 'titre' }])
    expect(saved.revision).toBe(2)
  })
})

describe('R5-CONFIG-03 submit, return and publish', () => {
  it('locks a submitted draft, accepts an edit after it is returned, and refuses a returned approval', async () => {
    const submitter = await actor(EDITOR)
    const approver = await actor(APPROVER)
    const versionId = await createDraft(submitter, 'r5config03_approval')
    const first = await save(submitter, versionId, [{ key: 'viability' }], 1)

    const request = (
      await submitter.query<{ id: string }>(
        `SELECT id FROM api.submit_approval_request($1,'dataset_schema_version',$2,ARRAY['reviewer'],'Release the range',$3)`,
        [WS, versionId, true],
      )
    ).rows[0]!.id

    await expectDenied(
      save(submitter, versionId, [{ key: 'viability' }], first.revision),
      'SB085',
    )
    await expectDenied(
      submitter.query('SELECT api.delete_dataset_schema_version($1)', [
        versionId,
      ]),
      'SB085',
    )

    await approver.query(
      "SELECT api.return_approval_request($1,'Range needs a unit')",
      [request],
    )
    const afterReturn = await save(
      submitter,
      versionId,
      [{ key: 'viability' }, { key: 'freeze_range' }],
      first.revision,
    )
    expect(afterReturn.revision).toBe(3)
    await expectDenied(
      submitter.query('SELECT api.publish_dataset_schema_version($1)', [
        versionId,
      ]),
      'SB084',
    )

    const second = (
      await submitter.query<{ id: string }>(
        `SELECT id FROM api.submit_approval_request($1,'dataset_schema_version',$2,ARRAY['reviewer'],'Range now has a unit',$3)`,
        [WS, versionId, true],
      )
    ).rows[0]!.id
    await approver.query('SELECT api.approve_approval_request($1)', [second])
    await submitter.query('SELECT api.publish_dataset_schema_version($1)', [
      versionId,
    ])
    expect(
      (
        await migrator.query<{ lifecycle: string }>(
          'SELECT lifecycle FROM api.dataset_schema_versions WHERE id=$1',
          [versionId],
        )
      ).rows[0]!.lifecycle,
    ).toBe('active')
  })

  it('keeps a published version and its fields immutable', async () => {
    const editor = await actor(EDITOR)
    const versionId = await createDraft(editor, 'r5config03_immutable')
    await save(editor, versionId, [{ key: 'viability' }], 1)
    await editor.query('SELECT api.publish_dataset_schema_version($1)', [
      versionId,
    ])

    await expectDenied(
      save(editor, versionId, [{ key: 'changed' }], 2),
      'SB072',
    )
    await expectDenied(
      migrator.query(
        `UPDATE api.dataset_schema_version_fields SET label='Changed'
          WHERE schema_version_id=$1`,
        [versionId],
      ),
      'SB072',
    )
    await expectDenied(
      migrator.query(
        'DELETE FROM api.dataset_schema_version_fields WHERE schema_version_id=$1',
        [versionId],
      ),
      'SB072',
    )
    expect(await fieldKeys(versionId)).toEqual(['viability'])
  })
})
