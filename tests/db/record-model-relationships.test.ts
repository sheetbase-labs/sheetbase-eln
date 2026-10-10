/**
 * MDL-02.1 (ADR-0051) — typed relationship rules for workspace-owned record
 * models.
 *
 * Proves: a workspace record model (`api.record_models`) can be the source of
 * a relationship rule targeting a built-in record-backed model; another
 * workspace cannot configure a rule for a model it does not own and cannot see
 * that workspace's rules; an unknown source key is refused (SB071, both through
 * the stewardship RPC and the guard trigger); built-in sources keep working;
 * and a declared workspace-model rule actually constrains link creation.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000430a'
const WS_B = '00000000-0000-4000-8000-00000000430b'
const PROJECT_A = '00000000-0000-4000-8000-0000000043a1'
const PROJECT_B = '00000000-0000-4000-8000-0000000043b1'
const OWNER_A = 'record-model-relations-owner-a'
const OWNER_B = 'record-model-relations-owner-b'

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

async function configureRule(
  client: Client,
  workspaceId: string,
  source: string,
  linkType: string,
  target: string,
  min = 0,
  max: number | null = null,
  label: string | null = null,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.configure_model_relationship_rule($1, $2, $3, $4, $5, $6, $7)`,
    [workspaceId, source, linkType, target, min, max, label],
  )
  return rows[0]
}

async function createRecord(
  client: Client,
  projectId: string,
  kind: string,
  title: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record(
       $1, $2, $3, 'available', '{}'::text[], '{}'::jsonb, '{}'::jsonb
     )`,
    [projectId, kind, title],
  )
  return rows[0]
}

async function createLink(
  client: Client,
  sourceId: string,
  target: { kind: string; identifier: string; id: string; linkType: string },
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record_link($1, $2, $3, $4, $5, NULL)`,
    [sourceId, target.kind, target.identifier, target.linkType, target.id],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
       ('${OWNER_A}', 'RM Relations A', 'rm-relations-a@sheetbase.test', true),
       ('${OWNER_B}', 'RM Relations B', 'rm-relations-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
       ('${WS_A}', 'record-model-relations-a', 'Record Model Relations A'),
       ('${WS_B}', 'record-model-relations-b', 'Record Model Relations B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
       ('${WS_A}', '${OWNER_A}', 'owner'),
       ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
       ('${PROJECT_A}', '${WS_A}', 'rmra', 'Record Model Relations A', '${OWNER_A}'),
       ('${PROJECT_B}', '${WS_B}', 'rmrb', 'Record Model Relations B', '${OWNER_B}')`,
  )
  const owner = await asAuthenticated(OWNER_A, WS_A)
  await createModel(owner, WS_A, 'cell_bank', 'CB', 'Cell bank')
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('typed relationships for workspace record models', () => {
  it('lets a workspace record model declare a rule to a built-in target', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const rule = await configureRule(
      owner,
      WS_A,
      'cell_bank',
      'sample',
      'sample',
      1,
      2,
      'sources',
    )
    expect(rule).toMatchObject({
      workspace_id: WS_A,
      source_model_key: 'cell_bank',
      link_type: 'sample',
      target_model_key: 'sample',
      min_links: 1,
      max_links: 2,
      label: 'sources',
    })
    const seen = await owner.query(
      `SELECT source_model_key, target_model_key FROM api.model_relationship_rules
        WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(seen.rows).toEqual([
      { source_model_key: 'cell_bank', target_model_key: 'sample' },
    ])
  })

  it('refuses an unknown source model key with SB071', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Through the stewardship RPC...
    await expectDenied(
      configureRule(owner, WS_A, 'ghost_model', 'sample', 'sample'),
      'SB071',
    )
    // ...and through the guard trigger if the RPC is bypassed.
    await expectDenied(
      migrator.query(
        `INSERT INTO api.model_relationship_rules
           (workspace_id, source_model_key, link_type, target_model_key,
            created_by_user_id)
         VALUES ($1, 'ghost_model', 'sample', 'sample', $2)`,
        [WS_A, OWNER_A],
      ),
      'SB071',
    )
  })

  it('refuses another workspace its own view or use of the model', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    // WS_B does not own `cell_bank`, so it cannot declare a rule for it:
    // the key is neither a built-in kind nor a WS_B record model.
    await expectDenied(
      configureRule(ownerB, WS_B, 'cell_bank', 'sample', 'sample'),
      'SB071',
    )
    // WS_A's rules stay invisible to WS_B.
    const seenByB = await ownerB.query(
      `SELECT id FROM api.model_relationship_rules WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(seenByB.rows).toEqual([])
  })

  it('keeps built-in source models working', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const rule = await configureRule(
      owner,
      WS_A,
      'experiment',
      'sample',
      'sample',
    )
    expect(rule).toMatchObject({
      source_model_key: 'experiment',
      link_type: 'sample',
      target_model_key: 'sample',
    })
    // A built-in that is not record-backed is still refused as a source.
    await expectDenied(
      configureRule(owner, WS_A, 'project', 'sample', 'sample'),
      'SB071',
    )
  })

  it('enforces a workspace model rule when links are created', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Re-declare the cell_bank -> sample rule so this test is order-independent.
    await configureRule(owner, WS_A, 'cell_bank', 'sample', 'sample', 0, null)

    const cell = await createRecord(owner, PROJECT_A, 'cell_bank', 'CB source')
    const sample = await createRecord(
      owner,
      PROJECT_A,
      'sample',
      'Sample target',
    )
    const reagent = await createRecord(
      owner,
      PROJECT_A,
      'material',
      'Reagent target',
    )

    const allowed = await createLink(owner, cell.id, {
      kind: 'sample',
      identifier: sample.identifier,
      id: sample.id,
      linkType: 'sample',
    })
    expect(allowed.target_record_id).toBe(sample.id)

    // The source model's world is closed once it has a rule: an undeclared
    // target fails closed with SB080.
    await expect(
      createLink(owner, cell.id, {
        kind: 'material',
        identifier: reagent.identifier,
        id: reagent.id,
        linkType: 'sample',
      }),
    ).rejects.toMatchObject({ code: 'SB080' })
  })
})
