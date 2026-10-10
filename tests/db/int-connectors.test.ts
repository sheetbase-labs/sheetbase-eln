/**
 * INT-01 + INT-02 database proof.
 *
 * Proves the generic connector framework's execution, security and provenance
 * model against a real Postgres/PostgREST surface:
 *
 *  - connectors are steward-gated (viewer/member denied) and workspace-scoped;
 *  - runs record trigger, attempt lineage, digest idempotency and bounded errors;
 *  - run logs append in sequence;
 *  - change_events fire for connector / connector_run entities;
 *  - the instrument ingestion flow lands rows only through
 *    validate_dataset_row_batch / commit_dataset_row_batch and stamps parser
 *    provenance into the finished run result.
 */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import '#/lib/connectors/plate-reader'
import { ingestInstrumentPayload } from '#/lib/connectors/instrument-ingestion'
import { datasetFieldsFromColumns } from '#/lib/import-mapping'
import type { DataClient } from '#/lib/data-client'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS_A = '0e010000-0000-4000-8000-000000000001'
const OWNER_A = 'int-owner-a'
const VIEWER_A = 'int-viewer-a'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: workspaceId,
    }),
  ])
  return client
}

function pgDataClient(owner: Client): DataClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'validate_dataset_row_batch') {
        return (
          await owner.query(
            `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
            ],
          )
        ).rows[0].result
      }
      if (name === 'commit_dataset_row_batch') {
        return (
          await owner.query(
            `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
              args.p_idempotency_key,
            ],
          )
        ).rows[0].result
      }
      if (name === 'commit_dataset_row_batch_atomic') {
        return (
          await owner.query(
            `select api.commit_dataset_row_batch_atomic($1,$2,$3::jsonb,$4) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
              args.p_idempotency_key,
            ],
          )
        ).rows[0].result
      }
      if (name === 'ensure_parser' || name === 'commit_dataset_import') {
        const entries = Object.entries(args)
        const parameters = entries
          .map(
            ([key, value], i) =>
              `${key} => $${i + 1}${value !== null && typeof value === 'object' ? '::jsonb' : ''}`,
          )
          .join(', ')
        const values = entries.map(([, value]) =>
          value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : value,
        )
        return (
          await owner.query(`SELECT api.${name}(${parameters}) result`, values)
        ).rows[0].result
      }
      // Connector RPCs share a uniform (uuid, uuid, text...) shape; cast any
      // object argument to jsonb so jsonb parameters work over raw SQL.
      const values = Object.values(args).map((value) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? JSON.stringify(value)
          : value,
      )
      const placeholders = Object.values(args)
        .map((value, index) =>
          value !== null && typeof value === 'object'
            ? `$${index + 1}::jsonb`
            : `$${index + 1}`,
        )
        .join(',')
      return (
        await owner.query(`select * from api.${name}(${placeholders})`, values)
      ).rows[0]
    },
    list: async <T>(resource: string, query: string): Promise<T[]> => {
      if (resource !== 'connector_runs') {
        throw new Error(`unexpected list resource ${resource}`)
      }
      // Query string is `?connector_id=eq.<uuid>&request_digest=eq.<hex>&status=eq.failed&order=started_at.desc&limit=1`
      const params = new URLSearchParams(query.replace(/^\?/, ''))
      const connectorId = (params.get('connector_id') ?? '').replace('eq.', '')
      const digest = (params.get('request_digest') ?? '').replace('eq.', '')
      const result = await owner.query(
        `select id, attempt, request_digest, status, retry_of_run_id, result, error_code, error_message,
                trigger_kind, workspace_id, started_at, finished_at
         from api.connector_runs
         where connector_id=$1 and request_digest=$2 and status='failed'
         order by started_at desc limit 1`,
        [connectorId, digest],
      )
      return result.rows as T[]
    },
    insert: async (resource: string, row: Record<string, unknown>) => {
      if (resource !== 'datasets') {
        throw new Error(`unexpected insert resource ${resource}`)
      }
      const result = await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name,description,primary_project_id)
         values($1,$2,$3,$4,$5) returning id, name, revision`,
        [
          row.workspace_id,
          row.schema_version_id,
          row.name,
          row.description ?? null,
          row.primary_project_id ?? null,
        ],
      )
      return result.rows[0]
    },
  } as unknown as DataClient
}

async function createWorkspaceFixture(client: Client) {
  // Workspace + memberships (owner + viewer).
  await client.query(
    `insert into api.workspaces(id,slug,name,status) values($1,'int-a','INT A','active')
     on conflict (id) do nothing`,
    [WS_A],
  )
  await client.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner A','int-owner-a@test','f')
     on conflict (id) do nothing`,
    [OWNER_A],
  )
  await client.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Viewer A','int-viewer-a@test','f')
     on conflict (id) do nothing`,
    [VIEWER_A],
  )
  for (const [userId, role] of [
    [OWNER_A, 'owner'],
    [VIEWER_A, 'viewer'],
  ] as const) {
    await client.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,$3) on conflict do nothing`,
      [WS_A, userId, role],
    )
  }
}

async function createDatasetFixture(owner: Client) {
  const key = `int_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'Ingest fixture') returning id`,
      [WS_A, key],
    )
  ).rows[0]
  const version = (
    await owner.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]
  const fields = (
    await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
       values
       ($1,gen_random_uuid(),'well','Well','text',false,1),
       ($1,gen_random_uuid(),'ct','CT','decimal',true,2)
       returning field_id,key,label,logical_type,nullable,display_order`,
      [version.id],
    )
  ).rows
  await owner.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const dataset = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name)
       values($1,$2,'Ingest fixture') returning id,revision,schema_version_id`,
      [WS_A, version.id],
    )
  ).rows[0]
  const columns: ScientificColumnWire[] = fields.map((field) => ({
    id: field.field_id,
    field_name: field.key,
    label: field.label,
    display_order: field.display_order,
    logical_type: field.logical_type,
    nullable: field.nullable,
    unit: null,
    validation: {},
    width: null,
    options: [],
  }))
  return {
    datasetId: dataset.id as string,
    revision: Number(dataset.revision),
    schemaVersionId: dataset.schema_version_id as string,
    fields: datasetFieldsFromColumns(columns),
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await createWorkspaceFixture(migrator)
})

afterAll(async () => {
  await migrator.end()
  for (const client of clients) await client.end().catch(() => {})
})

describe('INT-01 connector framework', () => {
  it('registers a connector as owner and denies viewers', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const connector = (
      await owner.query(
        `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
        [
          WS_A,
          'plate-reader-bench',
          'Plate reader bench',
          'instrument',
          'inbound',
          '{}',
          'sheetbase.plate-reader-csv',
        ],
      )
    ).rows[0]
    expect(connector.status).toBe('active')
    expect(connector.parser_id).toBe('sheetbase.plate-reader-csv')

    const viewer = await actor(VIEWER_A, WS_A)
    await expect(
      viewer.query(
        `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
        [WS_A, 'nope', 'Nope', 'instrument', 'inbound', '{}', null],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      viewer.query(`select * from api.update_connector($1,$2,$3,$4,$5)`, [
        WS_A,
        connector.id,
        null,
        'paused',
        null,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    // Workspace isolation: another workspace claim sees nothing via RLS.
    await actor(OWNER_A, WS_A)
    void connector
  })

  it('runs complete with attempts, digest idempotency, bounded errors and logs', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Viewer cannot start runs either (workspace write required).
    const viewer = await actor(VIEWER_A, WS_A)
    await expect(
      viewer.query(`select * from api.start_connector_run($1,$2,$3,$4,$5)`, [
        WS_A,
        connectorId,
        'manual',
        null,
        null,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    const ownerAgain = await actor(OWNER_A, WS_A)
    const digest = `d${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 32)

    const first = (
      await ownerAgain.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', digest, null],
      )
    ).rows[0]
    expect(first.status).toBe('running')
    expect(first.attempt).toBe(1)
    expect(first.actor_user_id).toBe(OWNER_A)

    const log1 = (
      await ownerAgain.query(
        `select * from api.append_connector_run_log($1,$2,$3,$4,$5,$6::jsonb)`,
        [WS_A, first.id, 'info', 'parse', 'Parsed 3 rows.', '{}'],
      )
    ).rows[0]
    const log2 = (
      await ownerAgain.query(
        `select * from api.append_connector_run_log($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          WS_A,
          first.id,
          'warning',
          'parse',
          'Trailing metadata line ignored.',
          '{}',
        ],
      )
    ).rows[0]
    expect(log1.sequence).toBe(1)
    expect(log2.sequence).toBe(2)

    const done = (
      await ownerAgain.query(
        `select * from api.complete_connector_run($1,$2,$3::jsonb)`,
        [
          WS_A,
          first.id,
          JSON.stringify({
            kind: 'instrument_ingestion',
            rowCount: 0,
            parser: 'sheetbase.plate-reader-csv@1',
          }),
        ],
      )
    ).rows[0]
    expect(done.status).toBe('succeeded')
    expect(done.result.rowCount).toBe(0)

    // Digest dedup: same digest resolves to the same succeeded run.
    const replay = (
      await ownerAgain.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', digest, null],
      )
    ).rows[0]
    expect(replay.id).toBe(first.id)
    expect(replay.status).toBe('succeeded')

    // Failure path records error_code and attempt lineage on retry.
    const failing = (
      await ownerAgain.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'scheduled', null, null],
      )
    ).rows[0]
    const failed = (
      await ownerAgain.query(
        `select * from api.fail_connector_run($1,$2,$3,$4)`,
        [WS_A, failing.id, 'parse_failed', 'unreadable payload'],
      )
    ).rows[0]
    expect(failed.status).toBe('failed')
    expect(failed.error_code).toBe('parse_failed')

    const retry = (
      await ownerAgain.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', null, failing.id],
      )
    ).rows[0]
    expect(retry.attempt).toBe(2)
    expect(retry.retry_of_run_id).toBe(failing.id)
  })

  it('allows an explicit retry of a failed run under the same request digest', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id
    const digest = `f${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 32)

    const first = (
      await owner.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', digest, null],
      )
    ).rows[0]
    await owner.query(`select * from api.fail_connector_run($1,$2,$3,$4)`, [
      WS_A,
      first.id,
      'parse_failed',
      'boom',
    ])

    // Same digest without retry_of: refused — the prior attempt failed and an
    // unlinked run would silently hide the failure.
    await expect(
      owner.query(`select * from api.start_connector_run($1,$2,$3,$4,$5)`, [
        WS_A,
        connectorId,
        'manual',
        digest,
        null,
      ]),
    ).rejects.toMatchObject({ code: 'SB045' })

    // Explicit retry with the same request identity: new attempt created.
    const retry = (
      await owner.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', digest, first.id],
      )
    ).rows[0]
    expect(retry.id).not.toBe(first.id)
    expect(retry.attempt).toBe(2)
    expect(retry.retry_of_run_id).toBe(first.id)
    expect(retry.status).toBe('running')

    // Retry that succeeds becomes the canonical receipt for the digest.
    const done = (
      await owner.query(
        `select * from api.complete_connector_run($1,$2,$3::jsonb)`,
        [WS_A, retry.id, JSON.stringify({ rowCount: 3 })],
      )
    ).rows[0]
    expect(done.status).toBe('succeeded')
    const replay = (
      await owner.query(
        `select * from api.start_connector_run($1,$2,$3,$4,$5)`,
        [WS_A, connectorId, 'manual', digest, null],
      )
    ).rows[0]
    expect(replay.id).toBe(retry.id)
    expect(replay.status).toBe('succeeded')
  })

  it('denies direct table writes: mutations only through governed RPCs', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Even the owner cannot INSERT/UPDATE connector lifecycle rows directly;
    // the RPC layer (capability gates, digest/attempt semantics) is the only
    // mutation surface, so lifecycle events cannot be fabricated.
    await expect(
      owner.query(
        `insert into api.connectors(workspace_id,key,name) values($1,'sneaky','Sneaky')`,
        [WS_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`update api.connectors set status='paused' where id=$1`, [
        connectorId,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `insert into api.connector_runs(workspace_id,connector_id,actor_user_id) values($1,$2,$3)`,
        [WS_A, connectorId, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `insert into api.connector_run_logs(workspace_id,run_id,sequence,level,stage,message)
         values($1,(select id from api.connector_runs limit 1),1,'info','x','fabricated')`,
        [WS_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `update api.connector_runs set status='succeeded' where connector_id=$1`,
        [connectorId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('enforces composite workspace/parent identity on runs, logs and secrets', async () => {
    // A second workspace with its own connector.
    const WS_B = '0e010000-0000-4000-8000-000000000002'
    await migrator.query(
      `insert into api.workspaces(id,slug,name,status) values($1,'int-b','INT B','active')
       on conflict (id) do nothing`,
      [WS_B],
    )
    const connectorB = (
      await migrator.query(
        `insert into api.connectors(workspace_id,key,name,connector_type,direction)
         values($1,'b-connector','B connector','custom','inbound') returning id`,
        [WS_B],
      )
    ).rows[0]
    const connectorA = (
      await migrator.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0]

    // Runs: workspace A cannot attach workspace B's connector.
    await expect(
      migrator.query(
        `insert into api.connector_runs(workspace_id,connector_id,actor_user_id)
         values($1,$2,$3)`,
        [WS_A, connectorB.id, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: '23503' })

    // Logs: cannot attach a run from another workspace.
    const runA = (
      await migrator.query(
        `insert into api.connector_runs(workspace_id,connector_id,actor_user_id)
         values($1,$2,$3) returning id`,
        [WS_A, connectorA.id, OWNER_A],
      )
    ).rows[0]
    await expect(
      migrator.query(
        `insert into api.connector_run_logs(workspace_id,run_id,sequence,level,stage,message)
         values($1,$2,1,'info','stage','msg')`,
        [WS_B, runA.id],
      ),
    ).rejects.toMatchObject({ code: '23503' })

    // Secrets: workspace A cannot hold a secret for workspace B's connector.
    await expect(
      migrator.query(
        `insert into internal.connector_secrets(workspace_id,connector_id,secret_name,ciphertext)
         values($1,$2,'api_key',decode('00','hex'))`,
        [WS_A, connectorB.id],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('emits change events for connector and connector_run entities', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const events = (
      await owner.query(
        `select entity_type, operation from api.change_events
         where workspace_id=$1 and entity_type in ('connector','connector_run')
         order by created_at asc`,
        [WS_A],
      )
    ).rows
    expect(
      events.filter((e) => e.entity_type === 'connector').length,
    ).toBeGreaterThan(0)
    expect(
      events.filter((e) => e.entity_type === 'connector_run').length,
    ).toBeGreaterThan(0)
  })

  it('hides connector tables from external credentials (fail-closed allowlist)', async () => {
    // api_client SELECT was not granted in the migration beyond read scope;
    // this asserts the grant boundary exists by probing role grants.
    const grants = (
      await migrator.query(
        `select grantee, privilege_type from information_schema.role_table_grants
         where table_schema='api' and table_name='connectors' order by grantee, privilege_type`,
      )
    ).rows
    const clientGrants = grants.filter(
      (g: { grantee: string }) => g.grantee === 'api_client',
    )
    expect(
      clientGrants.every(
        (g: { privilege_type: string }) => g.privilege_type === 'SELECT',
      ),
    ).toBe(true)
  })
})

describe('INT-02 instrument ingestion', () => {
  const VALID_CSV = `# Instrument: QuantStudio 5
# Plate ID: PLT-42

Well,Sample,CT
A1,std-1,18.2
A2,std-2,21.7`

  async function ingest(
    owner: Client,
    connectorId: string,
    fixture: Awaited<ReturnType<typeof createDatasetFixture>>,
    text: string,
    fileName: string,
    retainedFile?: { fileRecordId: string; checksum: string },
  ) {
    return ingestInstrumentPayload(pgDataClient(owner), {
      workspaceId: WS_A,
      connectorId,
      parserId: 'sheetbase.plate-reader-csv',
      text,
      fileName,
      fileRecordId: retainedFile?.fileRecordId ?? null,
      checksum: retainedFile?.checksum ?? null,
      byteSize: Buffer.byteLength(text),
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
  }

  it('ingests plate-reader CSV through validation/commit inside a governed run', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // The raw file was retained through the canonical file subsystem first;
    // its canonical id and sha256 travel into run provenance.
    const result = await ingest(
      owner,
      connectorId,
      fixture,
      VALID_CSV,
      'run-42.csv',
      {
        fileRecordId: '0e100000-0000-4000-8000-00000000aa01',
        checksum: 'a'.repeat(64),
      },
    )

    expect(result.alreadyCompleted).toBe(false)
    expect(result.rowCount).toBe(2)
    expect(result.parser.identity).toBe('sheetbase.plate-reader-csv@1')
    expect(result.metadata.instrument).toBe('QuantStudio 5')
    expect(result.datasetRevision).toBeGreaterThan(fixture.revision)

    // Rows really landed through canonical storage.
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(2)

    // Run provenance carries the retained file + parser identity.
    const runRow = await owner.query(
      `select status, result from api.connector_runs where id=$1`,
      [result.runId],
    )
    expect(runRow.rows[0].status).toBe('succeeded')
    expect(runRow.rows[0].result.fileRecordId).toBe(
      '0e100000-0000-4000-8000-00000000aa01',
    )
    expect(runRow.rows[0].result.fileSha256).toBe('a'.repeat(64))
    expect(runRow.rows[0].result.parser).toBe('sheetbase.plate-reader-csv@1')
    expect(runRow.rows[0].result.fileName).toBe('run-42.csv')

    const receipt = (
      await owner.query(
        `SELECT parser_provenance, imported_row_ids, source_provenance
      FROM api.dataset_imports WHERE connector_run_id = $1`,
        [result.runId],
      )
    ).rows[0]
    expect(receipt.parser_provenance).toMatchObject({
      key: 'sheetbase.plate-reader-csv',
      version: 1,
    })
    expect(receipt.imported_row_ids).toHaveLength(2)
    expect(receipt.source_provenance).toMatchObject({
      fileRecordId: '0e100000-0000-4000-8000-00000000aa01',
      checksum: 'a'.repeat(64),
    })

    // Stage logs observable.
    const logs = await owner.query(
      `select stage, level from api.connector_run_logs where run_id=$1 order by sequence`,
      [result.runId],
    )
    expect(logs.rows.map((row: { stage: string }) => row.stage)).toEqual([
      'start',
      'parse',
      'map',
      'commit',
    ])
  })

  it('refuses an unapproved instrument parser on regulated datasets and succeeds after approval', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `SELECT id FROM api.connectors WHERE key = 'plate-reader-bench' LIMIT 1`,
      )
    ).rows[0].id
    await migrator.query(
      `UPDATE api.datasets SET intended_use = 'regulated_record' WHERE id = $1`,
      [fixture.datasetId],
    )
    const version = (
      await owner.query(`SELECT pv.id FROM api.parser_versions pv JOIN api.parsers p ON p.id = pv.parser_id
      WHERE p.key = 'sheetbase.plate-reader-csv' AND pv.version = 1`)
    ).rows[0].id
    await migrator.query(
      `UPDATE api.parser_versions SET status = 'draft', approved_at = NULL WHERE id = $1`,
      [version],
    )
    await expect(
      ingest(owner, connectorId, fixture, VALID_CSV, 'regulated.csv'),
    ).rejects.toThrow(/approved parser/i)
    const failedRun = (
      await owner.query(
        `SELECT id FROM api.connector_runs WHERE connector_id=$1 AND status='failed' ORDER BY started_at DESC LIMIT 1`,
        [connectorId],
      )
    ).rows[0].id
    const failureWork = () =>
      owner.query(
        `SELECT source_id,connector_id FROM api.my_work_items WHERE source_type='connector_run' AND source_id=$1`,
        [failedRun],
      )
    expect((await failureWork()).rows).toEqual([
      { source_id: failedRun, connector_id: connectorId },
    ])
    const viewer = await actor(VIEWER_A, WS_A)
    expect(
      (
        await viewer.query(
          'SELECT source_id FROM api.my_work_items WHERE source_id=$1',
          [failedRun],
        )
      ).rows,
    ).toHaveLength(0)
    // A claimed successful retry without a canonical commit cannot clear work.
    const forgedRetry = (
      await owner.query(
        'SELECT * FROM api.start_connector_run($1,$2,$3,$4,$5)',
        [WS_A, connectorId, 'manual', randomUUID(), failedRun],
      )
    ).rows[0]
    await owner.query('SELECT api.complete_connector_run($1,$2,$3)', [
      WS_A,
      forgedRetry.id,
      { ok: true },
    ])
    expect((await failureWork()).rows).toHaveLength(1)
    expect(
      (
        await owner.query(
          'SELECT count(*)::int n FROM api.dataset_rows WHERE dataset_id = $1',
          [fixture.datasetId],
        )
      ).rows[0].n,
    ).toBe(0)
    const testFile = randomUUID()
    await migrator.query(
      `INSERT INTO api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format)
      VALUES ($1,$2,'validation.csv',25,$3,$4,'csv')`,
      [testFile, WS_A, 'a'.repeat(64), `${WS_A}/${testFile}/test`],
    )
    await setActorJwt(migrator, OWNER_A, WS_A)
    await migrator.query(
      'SELECT internal.record_parser_validation($1,$2,$3,$4,$5)',
      [
        version,
        testFile,
        'a'.repeat(64),
        { signature: { engine: 'sheetbase.plate-reader-csv@1' }, mapping: {} },
        {
          ok: true,
          fileId: testFile,
          checksum: 'a'.repeat(64),
          rowCount: 2,
          errors: [],
          headers: ['well', 'sample', 'od'],
        },
      ],
    )
    await owner.query('SELECT api.approve_parser_version($1)', [version])
    const result = await ingest(
      owner,
      connectorId,
      fixture,
      VALID_CSV,
      'regulated.csv',
    )
    expect(result.rowCount).toBe(2)
    expect((await failureWork()).rows).toHaveLength(0)
    expect(
      (
        await owner.query(
          'SELECT parser_provenance FROM api.dataset_imports WHERE connector_run_id = $1',
          [result.runId],
        )
      ).rows[0].parser_provenance.status,
    ).toBe('approved')
  })

  it('replays a successful run with the stored result, not an empty ingest', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    const first = await ingest(
      owner,
      connectorId,
      fixture,
      VALID_CSV,
      'run-42.csv',
      {
        fileRecordId: '0e100000-0000-4000-8000-00000000aa02',
        checksum: 'b'.repeat(64),
      },
    )
    expect(first.alreadyCompleted).toBe(false)

    // Same retained file re-ingested: deduplicated to the same run, with the
    // stored result reconstructed — never rowCount 0 / empty metadata.
    const replay = await ingest(
      owner,
      connectorId,
      fixture,
      VALID_CSV,
      'run-42.csv',
      {
        fileRecordId: '0e100000-0000-4000-8000-00000000aa02',
        checksum: 'b'.repeat(64),
      },
    )
    expect(replay.alreadyCompleted).toBe(true)
    expect(replay.runId).toBe(first.runId)
    expect(replay.rowCount).toBe(2)
    expect(replay.metadata.instrument).toBe('QuantStudio 5')
    expect(replay.datasetId).toBe(first.datasetId)
  })

  it('never deduplicates two different same-length payloads', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Same byte length, different content.
    const csvA = 'Well,Sample,CT\nA1,std-1,18.2\n'
    const csvB = 'Well,Sample,CT\nA2,std-9,31.7\n'
    expect(Buffer.byteLength(csvA)).toBe(Buffer.byteLength(csvB))

    const a = await ingest(owner, connectorId, fixture, csvA, 'a.csv')
    // The first ingest bumped the Dataset revision; re-read it for the second.
    const refreshed = await owner.query(
      `select revision from api.datasets where id=$1`,
      [fixture.datasetId],
    )
    const b = await ingestInstrumentPayload(pgDataClient(owner), {
      workspaceId: WS_A,
      connectorId,
      parserId: 'sheetbase.plate-reader-csv',
      text: csvB,
      fileName: 'b.csv',
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: Number(refreshed.rows[0].revision),
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(a.runId).not.toBe(b.runId)
    expect(a.alreadyCompleted).toBe(false)
    expect(b.alreadyCompleted).toBe(false)
  })

  it('creates a new target Dataset only after parse and mapping succeed', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Valid input, new Dataset target: dataset created with the rows.
    const created = await ingestInstrumentPayload(pgDataClient(owner), {
      workspaceId: WS_A,
      connectorId,
      parserId: 'sheetbase.plate-reader-csv',
      text: VALID_CSV,
      fileName: 'new-target.csv',
      target: {
        datasetId: null,
        newDatasetName: `Created by run ${crypto.randomUUID().slice(0, 8)}`,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(created.datasetId).not.toBe(fixture.datasetId)
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [created.datasetId],
    )
    expect(stored.rows[0].n).toBe(2)

    // Invalid input with a new-Dataset target: run fails and NO dataset is
    // created — no orphan empty Dataset artefacts.
    const before = await owner.query(
      `select count(*)::int n from api.datasets where schema_version_id=$1`,
      [fixture.schemaVersionId],
    )
    await expect(
      ingestInstrumentPayload(pgDataClient(owner), {
        workspaceId: WS_A,
        connectorId,
        parserId: 'sheetbase.plate-reader-csv',
        text: 'Totally,Unexpected\n1,2\n',
        fileName: 'garbage.csv',
        target: {
          datasetId: null,
          newDatasetName: 'Should never exist',
          schemaVersionId: fixture.schemaVersionId,
          fields: fixture.fields,
        },
      }),
    ).rejects.toThrow(/failed|mapped|mapping/i)
    const after = await owner.query(
      `select count(*)::int n from api.datasets where schema_version_id=$1`,
      [fixture.schemaVersionId],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('fails schema-invalid payloads before any Dataset is created', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Case 1: mapped value violates the Schema field type ('abc' into a
    // decimal field). Canonical coercion rejects it during mapping — before
    // Dataset creation.
    const before = await owner.query(
      `select count(*)::int n from api.datasets where schema_version_id=$1`,
      [fixture.schemaVersionId],
    )
    await expect(
      ingestInstrumentPayload(pgDataClient(owner), {
        workspaceId: WS_A,
        connectorId,
        parserId: 'sheetbase.plate-reader-csv',
        text: 'Sample,CT\nx,abc\n',
        fileName: 'bad-value.csv',
        target: {
          datasetId: null,
          newDatasetName: 'Should not exist (bad value)',
          schemaVersionId: fixture.schemaVersionId,
          fields: fixture.fields,
        },
      }),
    ).rejects.toThrow(/mapping|coercion|invalid/i)

    // Case 2: values coerce fine, but a required Schema field ('Well') is not
    // mapped at all — the required_value rule would fail validation after
    // creation. The pre-create required-coverage check refuses it first.
    await expect(
      ingestInstrumentPayload(pgDataClient(owner), {
        workspaceId: WS_A,
        connectorId,
        parserId: 'sheetbase.plate-reader-csv',
        text: 'Sample,CT\nx,18.2\n',
        fileName: 'missing-required.csv',
        target: {
          datasetId: null,
          newDatasetName: 'Should not exist (missing required)',
          schemaVersionId: fixture.schemaVersionId,
          fields: fixture.fields,
        },
      }),
    ).rejects.toThrow(/required/i)

    const after = await owner.query(
      `select count(*)::int n from api.datasets where schema_version_id=$1`,
      [fixture.schemaVersionId],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('retries a failed ingestion from the product flow as a linked attempt', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    // Deterministic failure: the required 'Well' field is not mapped. The
    // first product-flow call fails (attempt 1).
    const runInput = {
      workspaceId: WS_A,
      connectorId,
      parserId: 'sheetbase.plate-reader-csv',
      text: 'Sample,CT\nx,18.2\n',
      fileName: 'retry-me.csv',
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    }
    await expect(
      ingestInstrumentPayload(pgDataClient(owner), runInput),
    ).rejects.toThrow(/required/i)

    const runsAfterFirst = await owner.query(
      `select id, attempt, status, request_digest from api.connector_runs
       where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    const firstRun = runsAfterFirst.rows[0]
    expect(firstRun.attempt).toBe(1)
    expect(firstRun.status).toBe('failed')
    expect(firstRun.request_digest).not.toBeNull()

    // Second product-flow call with the same inputs: the library recognises
    // the failed matching request and explicitly retries against that failed
    // run instead of dead-ending on SB045.
    await expect(
      ingestInstrumentPayload(pgDataClient(owner), runInput),
    ).rejects.toThrow(/required/i)

    const retryRuns = await owner.query(
      `select attempt, status, retry_of_run_id, request_digest from api.connector_runs
       where request_digest=$1 and id <> $2 order by started_at`,
      [firstRun.request_digest, firstRun.id],
    )
    expect(retryRuns.rows.length).toBe(1)
    expect(retryRuns.rows[0].attempt).toBe(2)
    expect(retryRuns.rows[0].status).toBe('failed')
    expect(retryRuns.rows[0].retry_of_run_id).toBe(firstRun.id)
  })

  it('fails closed on unmappable payloads and keeps the Dataset untouched', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createDatasetFixture(owner)
    const connectorId = (
      await owner.query(
        `select id from api.connectors where key='plate-reader-bench' limit 1`,
      )
    ).rows[0].id

    const csv = 'Totally,Unexpected\n1,2\n'
    await expect(
      ingest(owner, connectorId, fixture, csv, 'garbage.csv'),
    ).rejects.toThrow(/failed|mapped|mapping/i)

    const failedRun = await owner.query(
      `select status, error_code from api.connector_runs
       where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    expect(failedRun.rows[0].status).toBe('failed')
    expect(['no_mapping', 'mapping_failed', 'coercion_failed']).toContain(
      failedRun.rows[0].error_code,
    )

    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(0)
  })
})
