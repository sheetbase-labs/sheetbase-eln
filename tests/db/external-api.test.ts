/**
 * API-005 follow-up integration proof: a scoped external credential can read
 * and write projects through the api_client role + RLS, while a wrong-scope,
 * revoked, or cross-workspace token cannot. Runs against a freshly migrated
 * sheetbase_test database.
 *
 * The test mints real api_client JWTs (signed with PGRST_JWT_SECRET) and sets
 * request.jwt.claims + SET ROLE api_client against an authenticator client,
 * which is exactly what PostgREST does per request. resolveExternalToken is
 * exercised against the real credential row so revocation-at-use and scope
 * enforcement are tested against the database, not stubbed.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  createCredential,
  mintApiClientToken,
  revokeCredential,
} from '#/lib/api-credentials'
import {
  ExternalTokenError,
  resolveExternalToken,
} from '#/lib/external-token'
import type { ProxyPath } from '#/lib/postgrest-path'
import { migratorUrl, prepareTestDatabase } from './helpers'

const SECRET = process.env.PGRST_JWT_SECRET ?? 'test-jwt-secret-at-least-32-chars!!'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let db: ReturnType<typeof drizzle<typeof schema>>
const clients: Array<Client> = []

const WS_A = '00000000-0000-4000-8000-00000000070a'
const WS_B = '00000000-0000-4000-8000-00000000070b'
const OWNER_A = 'ext-owner-a'
const OWNER_B = 'ext-owner-b'
const PROJ_A = '00000000-0000-4000-8000-00000000080a'

const readPath: ProxyPath = { kind: 'table', resource: 'projects' }
const rpcPath: ProxyPath = { kind: 'rpc', resource: 'create_project' }

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  await db.insert(schema.user).values([
    {
      id: OWNER_A,
      name: 'Owner A',
      email: 'ext-a@sheetbase.test',
      emailVerified: true,
    },
    {
      id: OWNER_B,
      name: 'Owner B',
      email: 'ext-b@sheetbase.test',
      emailVerified: true,
    },
  ])
  await db.insert(schema.workspaces).values([
    { id: WS_A, slug: 'ext-ws-a', name: 'Ext WS A' },
    { id: WS_B, slug: 'ext-ws-b', name: 'Ext WS B' },
  ])
  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS_A, userId: OWNER_A, role: 'owner' },
    { workspaceId: WS_B, userId: OWNER_B, role: 'owner' },
  ])
  await db.insert(schema.projects).values({
    id: PROJ_A,
    workspaceId: WS_A,
    key: 'ext-proj-a',
    title: 'External Project A',
  })
})

afterAll(async () => {
  for (const c of clients) await c.end()
  await db.$client.end()
  await migrator.end()
})

/**
 * Simulates what PostgREST does: connects as authenticator, switches to
 * api_client, and installs the jwt claims as a GUC. Returns a client that
 * sees exactly what an external request with this token would see.
 */
async function asApiClient(claims: Record<string, unknown>): Promise<Client> {
  // Reuse the authenticator connection helper from the db test layer.
  const { Client } = await import('pg')
  const url = new URL(process.env.PGRST_DB_URI ?? '')
  url.hostname = 'localhost'
  url.port = process.env.POSTGRES_PORT ?? '5432'
  url.pathname = '/sheetbase_test'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(claims),
  ])
  return client
}

async function projectTitles(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ title: string }>(
    'SELECT title FROM api.projects ORDER BY title',
  )
  return rows.map((r) => r.title)
}

describe('api_client RLS isolation', () => {
  it('reads only the workspace the token is scoped to', async () => {
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: 'cred-unused-here',
      scopes: ['projects:read'],
    })
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: 'cred-unused-here',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    expect(await projectTitles(client)).toEqual(['External Project A'])
  })

  it('cannot see another workspace', async () => {
    const client = await asApiClient({
      workspace_id: WS_B,
      credential_id: 'cred-unused-here',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    expect(await projectTitles(client)).toEqual([])
  })

  it('cannot insert into another workspace', async () => {
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: 'cred-unused-here',
      scopes: ['projects:write'],
      role: 'api_client',
    })
    // Attempt to insert a row claiming WS_B while the active workspace claim
    // is WS_A — RLS WITH CHECK must reject it.
    await expect(
      client.query(
        `INSERT INTO api.projects (workspace_id, key, title) VALUES ('${WS_B}', 'sneaky', 'Sneaky')`,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('resolveExternalToken (revocation + scope at use time)', () => {
  it('allows a projects:read GET on a table', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'reader',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    const result = await resolveExternalToken(db, token, SECRET, 'GET', readPath)
    expect(result.workspaceId).toBe(WS_A)
  })

  it('rejects a projects:write POST when the credential only has projects:read', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'read-only',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', readPath),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('rejects a create_project RPC without projects:write', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'rpc-reader',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', rpcPath),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('rejects a revoked credential even with a still-valid token', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'to-revoke',
      scopes: ['projects:read', 'projects:write'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await revokeCredential(db, {
      workspaceId: WS_A,
      credentialId: cred.id,
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'GET', readPath),
    ).rejects.toMatchObject({ code: 'revoked' })
  })

  it('rejects a token whose workspace_id does not match the credential row', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'mismatched',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_B, // tampered / misconfigured
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'GET', readPath),
    ).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects a garbage token', async () => {
    await expect(
      resolveExternalToken(db, 'not-a-jwt', SECRET, 'GET', readPath),
    ).rejects.toBeInstanceOf(ExternalTokenError)
  })
})

describe('API-07 Core allowlist', () => {
  it('allows query_dataset_rows with datasets:read and denies writes', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'dataset-reader',
      scopes: ['datasets:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['datasets:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'query_dataset_rows',
      }),
    ).resolves.toEqual({ workspaceId: WS_A })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'commit_dataset_row_batch',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'create_dataset_schema_definition',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('does not let sheets:write author Sheet Definitions', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'sheet-writer',
      scopes: ['sheets:write'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['sheets:write'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'mutate_sheet_instance_local_state',
      }),
    ).resolves.toEqual({ workspaceId: WS_A })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'create_sheet_definition',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('grants EXECUTE on mapped Core RPCs and still denies schema authoring', async () => {
    const { rows } = await migrator.query<{
      proname: string
      api_client: boolean
    }>(
      `select p.proname,
              bool_or(has_function_privilege('api_client', p.oid, 'EXECUTE')) api_client
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api'
          and p.proname = any($1::text[])
        group by p.proname
        order by p.proname`,
      [
        [
          'query_dataset_rows',
          'commit_dataset_row_batch',
          'mutate_sheet_instance_local_state',
          'preview_submission_digest',
          'submit_record_revision',
          'run_revision_checks',
          'instantiate_notebook_template_version',
          'search',
          'create_dataset_schema_definition',
          'create_sheet_definition',
        ],
      ],
    )
    const byName = Object.fromEntries(rows.map((row) => [row.proname, row.api_client]))
    expect(byName).toMatchObject({
      query_dataset_rows: true,
      commit_dataset_row_batch: true,
      mutate_sheet_instance_local_state: true,
      preview_submission_digest: true,
      submit_record_revision: false,
      run_revision_checks: false,
      instantiate_notebook_template_version: true,
      search: true,
      create_dataset_schema_definition: false,
      create_sheet_definition: false,
    })
  })

  it('keeps submit and revision checks off the credential proxy even with reviews scopes', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'reviewer-key',
      scopes: ['reviews:read', 'reviews:write'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['reviews:read', 'reviews:write'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'preview_submission_digest',
      }),
    ).resolves.toEqual({ workspaceId: WS_A })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'submit_record_revision',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'run_revision_checks',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'sign_revision',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })
})

async function asOwner(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

describe('API-07 api_client data-plane writes', () => {
  const FIELD = '00000000-0000-4000-8000-00000000091a'
  const ROW = '00000000-0000-4000-8000-00000000091b'
  const RECORD = '00000000-0000-4000-8000-00000000091c'
  const TEXT = '00000000-0000-4000-8000-00000000091d'

  async function publishDataset() {
    const owner = await asOwner(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name)
         values($1,$2,'API-07 scalar') returning id`,
        [WS_A, `api07_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`],
      )
    ).rows[0]
    const version = (
      await owner.query(
        `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
        [schema.id],
      )
    ).rows[0]
    await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
       values($1,$2,'note','Note','text',true,1)`,
      [version.id, FIELD],
    )
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [version.id],
    )
    const dataset = (
      await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'API-07 dataset') returning id,revision`,
        [WS_A, version.id],
      )
    ).rows[0]
    return {
      datasetId: dataset.id as string,
      revision: Number(dataset.revision),
      schemaVersionId: version.id as string,
    }
  }

  it('queries, commits, and snapshots Dataset rows without a sub claim', async () => {
    const fixture = await publishDataset()
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'dataset-writer',
      scopes: ['datasets:read', 'datasets:write'],
    })
    const claims = {
      workspace_id: WS_A,
      credential_id: cred.id,
      scopes: ['datasets:read', 'datasets:write'],
      role: 'api_client',
    }
    const client = await asApiClient(claims)
    const queried = (
      await client.query(`select api.query_dataset_rows($1) result`, [
        fixture.datasetId,
      ])
    ).rows[0].result
    expect(queried).toMatchObject({
      datasetId: fixture.datasetId,
      totalCount: 0,
    })

    const rowId = crypto.randomUUID()
    const batch = [
      {
        operation: 'create',
        rowId,
        values: { [FIELD]: 'OK' },
      },
    ]
    const validated = (
      await client.query(
        `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
        [fixture.datasetId, fixture.revision, JSON.stringify(batch)],
      )
    ).rows[0].result
    expect(validated).toMatchObject({ ok: true })

    const committed = (
      await client.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [
          fixture.datasetId,
          fixture.revision,
          JSON.stringify(batch),
          'api07-commit-1',
        ],
      )
    ).rows[0].result
    expect(committed).toMatchObject({
      ok: true,
      datasetId: fixture.datasetId,
      idempotent: false,
    })

    const visible = (
      await client.query(`select api.query_dataset_rows($1) result`, [
        fixture.datasetId,
      ])
    ).rows[0].result
    expect(visible.totalCount).toBe(1)
    expect(visible.rows[0]).toMatchObject({
      rowId,
      values: { [FIELD]: 'OK' },
    })

    const actor = (
      await client.query(
        `select actor_user_id, actor_credential_id
           from api.dataset_bulk_commits
          where dataset_id=$1 and idempotency_key='api07-commit-1'`,
        [fixture.datasetId],
      )
    ).rows[0]
    expect(actor.actor_user_id).toBeNull()
    expect(actor.actor_credential_id).toBe(cred.id)

    const snapshot = (
      await client.query(
        `select to_jsonb(api.snapshot_dataset($1,$2,'API-07 snapshot')) result`,
        [fixture.datasetId, committed.datasetRevision],
      )
    ).rows[0].result
    expect(snapshot.created_by_user_id).toBeNull()
    expect(snapshot.created_by_credential_id).toBe(cred.id)
  })

  it('rejects commit_dataset_row_batch at the proxy when the credential only has datasets:read', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'dataset-reader-sql',
      scopes: ['datasets:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['datasets:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', {
        kind: 'rpc',
        resource: 'commit_dataset_row_batch',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('mutates Sheet local state without a sub claim and records the credential', async () => {
    const owner = await asOwner(OWNER_A, WS_A)
    const state = {
      bindings: [],
      localFields: [
        {
          fieldId: TEXT,
          key: 'observation',
          label: 'observation',
          description: null,
          logicalType: 'text',
          nullable: true,
          defaultValue: null,
          cardinality: 'one',
          quantity: null,
          validation: {},
          category: null,
          relationship: null,
          computation: { mode: 'stored' },
          lifecycle: 'active',
        },
      ],
      localValues: { [ROW]: { [TEXT]: 'initial' } },
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
      provenance: { createdFrom: 'ad_hoc' },
    }
    const created = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'API-07 local',null,null,null,null,$2::jsonb)) result`,
        [WS_A, JSON.stringify(state)],
      )
    ).rows[0].result

    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'sheet-mutator',
      scopes: ['sheets:read', 'sheets:write'],
    })
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: cred.id,
      scopes: ['sheets:read', 'sheets:write'],
      role: 'api_client',
    })
    const retry = crypto.randomUUID()
    const mutated = (
      await client.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)) result`,
        [
          created.id,
          created.revision,
          retry,
          JSON.stringify([{ kind: 'local', rowKey: ROW }]),
          JSON.stringify([{ rowKey: ROW, fieldId: TEXT, value: 'from-api' }]),
        ],
      )
    ).rows[0].result
    expect(mutated.state.localValues[ROW][TEXT]).toBe('from-api')
    expect(mutated.updated_by_user_id).toBeNull()
    expect(mutated.updated_by_credential_id).toBe(cred.id)

    const mutation = (
      await client.query(
        `select actor_user_id, actor_credential_id
           from api.sheet_instance_local_mutations
          where instance_id=$1 and retry_token=$2`,
        [created.id, retry],
      )
    ).rows[0]
    expect(mutation.actor_user_id).toBeNull()
    expect(mutation.actor_credential_id).toBe(cred.id)
  })

  it('updates record custom fields as api_client and stamps the credential', async () => {
    const owner = await asOwner(OWNER_A, WS_A)
    const definition = (
      await owner.query(
        `select * from api.create_model_field($1,'sample','lot','Lot','text',true,null,'{}'::jsonb)`,
        [WS_A],
      )
    ).rows[0]
    await owner.query(`select api.activate_model_field($1)`, [definition.id])
    await migrator.query(
      `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
       values($1,$2,'sample','API07-SMP','API-07 sample',$3)`,
      [RECORD, WS_A, OWNER_A],
    )
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'model-writer',
      scopes: ['models:write'],
    })
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: cred.id,
      scopes: ['models:write'],
      role: 'api_client',
    })
    const updated = (
      await client.query(
        `select to_jsonb(api.update_record_custom_fields($1,1,$2::jsonb)) result`,
        [RECORD, JSON.stringify({ lot: 'A1' })],
      )
    ).rows[0].result
    expect(updated.custom_fields).toMatchObject({ lot: 'A1' })
    expect(updated.updated_by_user_id).toBeNull()
    expect(updated.updated_by_credential_id).toBe(cred.id)
  })
})
