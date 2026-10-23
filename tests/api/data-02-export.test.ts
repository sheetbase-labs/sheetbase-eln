/**
 * DATA-02 API contract proof: dataset/version/sheet/record/revision exports
 * through the real PostgREST stack.
 *
 * Key evidence: a Dataset Version export remains byte-identical to the frozen
 * snapshot AFTER the live Dataset is mutated, proving version exports are
 * historical evidence while live exports are not.
 *
 * Published Dataset Schema Versions and their fields are immutable evidence
 * (SB072), and Dataset Versions pin their parent dataset forever, so this
 * suite mints a fresh dataset/schema-version per run instead of deleting
 * them. Reusable parents (workspace, users, project, schema definition) are
 * idempotent fixtures.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { inflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  handleDatasetExport,
  handleRecordExport,
  handleRevisionEvidencePackage,
  handleSheetInstanceExport,
} from '#/lib/export/routes'
import { mintPostgrestToken } from '#/lib/postgrest-token'

config({ path: ['.env.local', '.env'] })

const WS_A = '0d020000-0000-4000-8000-00000000110a'
const WS_B = '0d020000-0000-4000-8000-00000000110b'
const PROJ_A = '0d020000-0000-4000-8000-00000000111a'
const OWNER_A = 'data-02-api-owner-a'
const OWNER_B = 'data-02-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

// Fresh identities per file; setup.ts drops the entire disposable database.
const SCHEMA_DEF_A = crypto.randomUUID()
const SCHEMA_VER_A = crypto.randomUUID()
const FIELD_SAMPLE = crypto.randomUUID()
const FIELD_PH = crypto.randomUUID()
const DATASET_A = crypto.randomUUID()
const SHEET_A = crypto.randomUUID()
const RECORD_A = crypto.randomUUID()
const REVISION_ID = crypto.randomUUID()

let admin: Client
let startedAt: Date
let fieldIdByKey: Record<string, string> = {}

function authDeps(userId: string, workspaceId: string) {
  return {
    getSession: async () => ({
      user: { id: userId },
      session: { id: 'data-02-session' },
    }),
    getWorkspaceForUser: async () => ({ id: workspaceId }),
    mintToken: (input: {
      userId: string
      workspaceId: string
      sessionId: string
    }) => mintPostgrestToken(SECRET, input),
  }
}

/**
 * Receipts persist asynchronously right after a stream closes; poll briefly
 * so assertions observe the committed audit row rather than racing it.
 */
async function pollForReceipts(
  query: () => Promise<boolean>,
  attempts = 40,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await query()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function exportRequest(path: string, search = '') {
  return new Request(`http://sheetbase.test/api/export/${path}${search}`, {
    headers: {},
  })
}

/** Minimal ZIP reader (store + raw-deflate entries). */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  for (let index = 0; index < count; index++) {
    const method = view.getUint16(offset + 10, true)
    const compact = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLen),
    )
    const localNameLen = view.getUint16(localOffset + 26, true)
    const dataStart =
      localOffset + 30 + localNameLen + view.getUint16(localOffset + 28, true)
    const compressed = bytes.subarray(dataStart, dataStart + compact)
    const raw =
      method === 0
        ? compressed.slice()
        : new Uint8Array(inflateRawSync(compressed))
    files.set(name, raw)
    offset += 46 + nameLen + extraLen
  }
  return files
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  startedAt = new Date()

  // Minimal parents owned by this file's disposable database.
  await admin.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','A','data-02-api-a@test.invalid',true),
      ('${OWNER_B}','B','data-02-api-b@test.invalid',true)
    on conflict (id) do nothing;
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','data-02-api-a','DATA-02 API A'),
      ('${WS_B}','data-02-api-b','DATA-02 API B')
    on conflict (id) do nothing;
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner'),
      ('${WS_B}','${OWNER_B}','owner')
    on conflict do nothing;
    insert into api.projects(id,workspace_id,key,title) values
      ('${PROJ_A}','${WS_A}','exp','Exports')
    on conflict (id) do nothing;
    insert into api.project_access
      (workspace_id,project_id,user_id,can_view,can_edit,can_manage,granted_by_user_id)
    values ('${WS_A}','${PROJ_A}','${OWNER_A}',true,true,true,'${OWNER_A}')
    on conflict (workspace_id,project_id,user_id) do nothing;
    insert into api.dataset_schema_definitions(id,workspace_id,key,name)
    select '${SCHEMA_DEF_A}'::uuid,'${WS_A}'::uuid,'exportschema' || substr(replace('${SCHEMA_DEF_A}'::text,'-',''),1,8),'Export schema'
    where not exists (
      select 1 from api.dataset_schema_definitions
      where workspace_id='${WS_A}'::uuid and key='exportschema' || substr(replace('${SCHEMA_DEF_A}'::text,'-',''),1,8)
    );
  `)

  // Per-run schema version: draft -> fields -> published.
  await admin.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle)
     values ($1,$2,1,'draft')`,
    [SCHEMA_VER_A, SCHEMA_DEF_A],
  )
  await admin.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order,quantity)
     values
      ($1,$2,'sample','Sample','text',false,1,null),
      ($1,$3,'ph','pH','decimal',true,2,'{"kind":"acidity","dimension":"acidity","storageUnit":"pH"}')`,
    [SCHEMA_VER_A, FIELD_SAMPLE, FIELD_PH],
  )
  await admin.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [SCHEMA_VER_A],
  )

  await admin.query(`
    insert into internal."user"(id,name,email,"emailVerified")
    values ('data-02-api-viewer','Viewer','data-02-api-viewer@test.invalid',true)
    on conflict (id) do nothing;
    insert into api.workspace_memberships(workspace_id,user_id,role)
    values ('${WS_A}','data-02-api-viewer','viewer')
    on conflict do nothing;
    insert into api.project_access
      (workspace_id,project_id,user_id,can_view,granted_by_user_id)
    values ('${WS_A}','${PROJ_A}','data-02-api-viewer',true,'${OWNER_A}')
    on conflict (workspace_id,project_id,user_id) do nothing;

    insert into api.datasets(id,workspace_id,primary_project_id,schema_version_id,name)
    values ('${DATASET_A}','${WS_A}','${PROJ_A}','${SCHEMA_VER_A}','Stability readings');
    insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
    values ('${RECORD_A}','${WS_A}','${PROJ_A}','experiment','EXP-2026-' || substr(replace('${RECORD_A}'::text,'-',''),1,8),'Export host','${OWNER_A}');
  `)

  const { rows: fieldRows } = await admin.query(
    `select field_id::text as id, key from api.dataset_schema_version_fields
      where schema_version_id=$1`,
    [SCHEMA_VER_A],
  )
  fieldIdByKey = Object.fromEntries(fieldRows.map((f) => [f.key, f.id]))

  // Two live rows written as migrator keep this suite independent of import
  // wiring; the export path itself reads only through canonical contracts.
  const rowIds = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [index, rowId] of rowIds.entries()) {
    await admin.query(
      `insert into api.dataset_rows(id,dataset_id,workspace_id) values ($1,$2,$3)`,
      [rowId, DATASET_A, WS_A],
    )
    await admin.query(
      `insert into api.dataset_row_values(row_id,field_id,text_value) values ($1,$2,$3)`,
      [rowId, FIELD_SAMPLE, `sample-${index + 1}`],
    )
    if (index === 0) {
      await admin.query(
        `insert into api.dataset_row_values(row_id,field_id,numeric_value) values ($1,$2,7.2)`,
        [rowId, FIELD_PH],
      )
    }
  }

  // Sheet Instance fixture: guard GUC required even for migrator inserts.
  await admin.query(
    `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
  )
  await admin.query(
    `insert into api.sheet_instances(id,workspace_id,project_id,name,state)
     values ($1,$2,$3,'Export sheet',
       '{"bindings":[],"localFields":[{"fieldId":"0d020000-0000-4000-8000-0000000020b1","key":"temp","label":"Temp","description":null,"logicalType":"decimal","nullable":true,"defaultValue":null,"cardinality":"one","quantity":null,"validation":{},"category":null,"relationship":null,"computation":{"mode":"stored"},"lifecycle":"active"}],"localValues":{"0d020000-0000-4000-8000-0000000030b1":{"0d020000-0000-4000-8000-0000000020b1":21.5}},"calculationOverrides":{},"presentation":{"columnOrder":[],"hiddenColumnIds":[],"columnWidths":{},"frozenColumnCount":0,"density":"standard"},"provenance":{"createdFrom":"ad_hoc"}}'::jsonb)`,
    [SHEET_A, WS_A, PROJ_A],
  )
})

afterAll(async () => {
  if (!admin) return
  await admin.end()
})

describe('DATA-02 dataset exports', () => {
  it('never closes a successful download or writes a receipt after schema, middle-page, revision or receipt faults', async () => {
    const dataset = crypto.randomUUID()
    await admin.query(
      `insert into api.datasets(id,workspace_id,schema_version_id,name) values($1,$2,$3,'Fault boundary')`,
      [dataset, WS_A, SCHEMA_VER_A],
    )
    await admin.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) select $1,$2 from generate_series(1,2001)`,
      [dataset, WS_A],
    )
    const realFetch = globalThis.fetch
    for (const fault of [
      'schema',
      'malformed_schema',
      'middle_page',
      'short_page',
      'revision',
      'late_revision',
      'receipt',
    ]) {
      let pages = 0
      const intercepted = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          const url = String(input)
          if (
            url.includes('/dataset_schema_version_fields') &&
            fault === 'schema'
          )
            return Response.json({}, { status: 503 })
          if (
            url.includes('/dataset_schema_version_fields') &&
            fault === 'malformed_schema'
          )
            return Response.json([{}])
          if (url.includes('/rpc/query_dataset_rows')) {
            pages++
            if (pages === 2 && fault === 'middle_page')
              return Response.json({}, { status: 503 })
            const response = await realFetch(input, init)
            if (pages === 2 && ['short_page', 'revision'].includes(fault)) {
              const body = await response.json()
              if (fault === 'short_page') body.rows.pop()
              else body.datasetRevision = '999999'
              return Response.json(body)
            }
            return response
          }
          if (
            fault === 'late_revision' &&
            pages > 0 &&
            url.includes('/datasets?')
          ) {
            const response = await realFetch(input, init)
            const body = await response.json()
            body[0].revision = '999999'
            return Response.json(body)
          }
          return realFetch(input, init)
        })
      if (fault === 'receipt')
        await admin.query(`create function internal.export_test_receipt_fault() returns trigger language plpgsql as $$ begin raise exception 'receipt unavailable'; end $$;
        create trigger export_test_receipt_fault before insert on api.data_exports for each row execute function internal.export_test_receipt_fault()`)
      try {
        const attempt = handleDatasetExport(
          exportRequest(`dataset/${dataset}`, '?format=json'),
          dataset,
          authDeps(OWNER_A, WS_A),
        )
        if (fault === 'schema' || fault === 'malformed_schema')
          await expect(attempt).rejects.toThrow()
        else {
          const response = await attempt
          await expect(response.text()).rejects.toThrow()
          if (fault === 'middle_page') expect(pages).toBe(2)
        }
        expect(
          (
            await admin.query(
              'select count(*)::int n from api.data_exports where object_id=$1',
              [dataset],
            )
          ).rows[0].n,
        ).toBe(0)
      } finally {
        intercepted.mockRestore()
        if (fault === 'receipt')
          await admin.query(
            `drop trigger export_test_receipt_fault on api.data_exports; drop function internal.export_test_receipt_fault()`,
          )
      }
    }
    const response = await handleDatasetExport(
      exportRequest(`dataset/${dataset}`, '?format=json'),
      dataset,
      authDeps(OWNER_A, WS_A),
    )
    expect((await response.json()).rows).toHaveLength(2001)
    expect(
      (
        await admin.query(
          'select row_count from api.data_exports where object_id=$1',
          [dataset],
        )
      ).rows,
    ).toEqual([{ row_count: 2001 }])
  })

  it('streams deterministic CSV of live rows', async () => {
    const url = `/api/export/dataset/${DATASET_A}`
    const first = await handleDatasetExport(
      exportRequest(url, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_A, WS_A),
    )
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toContain('text/csv')
    const body1 = await first.text()
    expect(body1.split('\r\n')[0]).toBe('Sample,pH')
    expect(body1).toContain('sample-1,7.2')
    expect(body1).toContain('sample-2')

    const second = await handleDatasetExport(
      exportRequest(url, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_A, WS_A),
    )
    expect(await second.text()).toBe(body1)

    // Mandatory receipt: actor attribution + exact streamed row count. The
    // receipt persists right after the stream closes, so allow the async
    // write to land before asserting.
    async function csvReceiptCount(): Promise<number> {
      const { rows } = await admin.query(
        `select count(*)::int as n from api.data_exports
          where workspace_id=$1 and object_id=$2 and format='csv'`,
        [WS_A, DATASET_A],
      )
      return rows[0].n
    }
    let receipts: number | null = null
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((receipts = await csvReceiptCount()) === 2) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    // Exactly one authoritative receipt per successful export: this describe
    // issued two identical exports, so exactly two rows exist.
    expect(receipts).toBe(2)
    const { rows: receiptRows } = await admin.query(
      `select actor_user_id, object_type, row_count
         from api.data_exports
        where workspace_id=$1 and object_id=$2 and format='csv'`,
      [WS_A, DATASET_A],
    )
    for (const receipt of receiptRows) {
      expect(receipt.actor_user_id).toBe(OWNER_A)
      expect(receipt.object_type).toBe('dataset')
      expect(Number(receipt.row_count)).toBe(2)
    }
    for (const receipt of receiptRows) {
      expect(receipt.actor_user_id).toBe(OWNER_A)
      expect(receipt.object_type).toBe('dataset')
      expect(Number(receipt.row_count)).toBe(2)
    }
  })

  it('embeds schema/unit metadata and live-state warning in JSON', async () => {
    const res = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=json'),
      DATASET_A,
      authDeps(OWNER_A, WS_A),
    )
    const doc = JSON.parse(await res.text())
    expect(doc._meta.kind).toBe('sheetbase.dataset.export')
    expect(doc._meta.state).toBe('live')
    expect(doc._meta.schema[1]).toEqual({
      key: 'ph',
      label: 'pH',
      logicalType: 'decimal',
      nullable: true,
      unit: 'pH',
    })
    expect(doc._meta.notes.join(' ')).toContain('NOT immutable evidence')
    expect(doc.rows).toHaveLength(2)
  })

  it('keeps version exports historically correct after live mutation', async () => {
    // Freeze the current two-row state. snapshot_dataset resolves the actor
    // workspace from request claims even on a migrator connection.
    await admin.query(
      `select set_config('request.jwt.claims', $1::text, false)`,
      [
        JSON.stringify({
          role: 'authenticated',
          sub: OWNER_A,
          workspace_id: WS_A,
        }),
      ],
    )
    const snap = await admin.query(
      `select (api.snapshot_dataset($1, (select revision from api.datasets where id=$1), 'export-proof')).id as version_id`,
      [DATASET_A],
    )
    const versionId = snap.rows[0].version_id as string

    const before = await handleDatasetExport(
      exportRequest(`/api/export/dataset-version/${versionId}`, '?format=csv'),
      versionId,
      authDeps(OWNER_A, WS_A),
      'version',
    )
    expect(before.status).toBe(200)
    const frozenCsv = await before.text()

    // Mutate the LIVE dataset afterwards: change the pH value and add a row.
    await admin.query(
      `update api.dataset_row_values set numeric_value = 9.9
        where field_id=$1`,
      [fieldIdByKey.ph],
    )
    const newRow = crypto.randomUUID()
    await admin.query(
      `insert into api.dataset_rows(id,dataset_id,workspace_id) values ($1,$2,$3)`,
      [newRow, DATASET_A, WS_A],
    )
    await admin.query(
      `insert into api.dataset_row_values(row_id,field_id,text_value) values ($1,$2,'sample-3')`,
      [newRow, fieldIdByKey.sample],
    )

    // Version export is unchanged; live export reflects the mutation.
    const afterVersion = await handleDatasetExport(
      exportRequest(`/api/export/dataset-version/${versionId}`, '?format=csv'),
      versionId,
      authDeps(OWNER_A, WS_A),
      'version',
    )
    expect(await afterVersion.text()).toBe(frozenCsv)

    const live = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_A, WS_A),
    )
    const liveCsv = await live.text()
    expect(liveCsv).not.toBe(frozenCsv)

    // The version meta marks frozen evidence; the live meta does not claim it.
    const versionJson = JSON.parse(
      await (
        await handleDatasetExport(
          exportRequest(
            `/api/export/dataset-version/${versionId}`,
            '?format=json',
          ),
          versionId,
          authDeps(OWNER_A, WS_A),
          'version',
        )
      ).text(),
    )
    expect(versionJson._meta.state).toBe('version')
    expect(versionJson._meta.notes.join(' ')).toContain('immutable snapshot')
    expect(versionJson.rows).toHaveLength(2)
  })

  it('fails the export body without a receipt after snapshot rows are pruned', async () => {
    const datasetId = crypto.randomUUID()
    const rowId = crypto.randomUUID()
    await admin.query(
      `insert into api.datasets(id,workspace_id,primary_project_id,schema_version_id,name)
       values ($1,$2,$3,$4,'Pruned export snapshot')`,
      [datasetId, WS_A, PROJ_A, SCHEMA_VER_A],
    )
    await admin.query(
      `insert into api.dataset_rows(id,dataset_id,workspace_id) values ($1,$2,$3)`,
      [rowId, datasetId, WS_A],
    )
    await admin.query(
      `insert into api.dataset_row_values(row_id,field_id,text_value) values ($1,$2,'pruned-sample')`,
      [rowId, FIELD_SAMPLE],
    )
    await admin.query(
      `select set_config('request.jwt.claims', $1::text, false)`,
      [
        JSON.stringify({
          role: 'authenticated',
          sub: OWNER_A,
          workspace_id: WS_A,
        }),
      ],
    )
    const snapshot = await admin.query<{ version_id: string }>(
      `select (api.snapshot_dataset($1, (select revision from api.datasets where id=$1), 'pruned-export-proof')).id as version_id`,
      [datasetId],
    )
    const versionId = snapshot.rows[0].version_id
    expect(
      (
        await admin.query(
          `select count(*)::int n from api.dataset_version_rows where dataset_version_id=$1`,
          [versionId],
        )
      ).rows[0].n,
    ).toBe(1)

    // Only this disposable dataset is archived beyond its retention period.
    // The real pruning job removes rows while retaining the version identity.
    await admin.query(
      `update api.datasets set lifecycle='archived',
         archived_at=now() - make_interval(years => coalesce(
           (select snapshot_uncited_retention_years from api.workspace_settings where workspace_id=$2), 2
         ) + 1)
       where id=$1`,
      [datasetId, WS_A],
    )
    const prune = await admin.query<{
      result: {
        pruned: Array<{ datasetVersionId: string; rowsRemoved: number }>
      }
    }>(`select api.prune_dataset_versions(100) as result`)
    expect(prune.rows[0].result.pruned).toContainEqual({
      datasetVersionId: versionId,
      rowsRemoved: 1,
    })
    expect(
      (
        await admin.query(
          `select count(*)::int n from api.dataset_version_rows where dataset_version_id=$1`,
          [versionId],
        )
      ).rows[0].n,
    ).toBe(0)

    for (const format of ['csv', 'json']) {
      const response = await handleDatasetExport(
        exportRequest(`dataset-version/${versionId}`, `?format=${format}`),
        versionId,
        authDeps(OWNER_A, WS_A),
        'version',
      )
      expect(response.status).toBe(200)
      await expect(response.text()).rejects.toThrow()
      expect(
        (
          await admin.query(
            `select count(*)::int n from api.data_exports where object_id=$1`,
            [versionId],
          )
        ).rows[0].n,
      ).toBe(0)
    }
  })

  it('rejects cross-workspace exports without existence leak', async () => {
    const res = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_B, WS_B),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
  })

  it('rejects unauthenticated exports', async () => {
    const anon = {
      getSession: async () => null,
      getWorkspaceForUser: async () => null,
      mintToken: authDeps(OWNER_A, WS_A).mintToken,
    }
    const res = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      anon,
    )
    expect(res.status).toBe(401)
  })
})

describe('DATA-02 receipt lifecycle invariant', () => {
  it('records every generated export exactly once with the acting user', async () => {
    const { rows: before } = await admin.query(
      `select object_type, count(*)::int as n from api.data_exports
        where workspace_id=$1 group by object_type`,
      [WS_A],
    )
    const base: Record<string, number> = Object.fromEntries(
      before.map((r) => [r.object_type, Number(r.n)]),
    )

    await handleRecordExport(
      exportRequest(`/api/export/record/${RECORD_A}`, '?format=json'),
      RECORD_A,
      authDeps(OWNER_A, WS_A),
    )
    await handleSheetInstanceExport(
      exportRequest(`/api/export/sheet-instance/${SHEET_A}`, '?format=csv'),
      SHEET_A,
      authDeps(OWNER_A, WS_A),
    )

    const { rows: final } = await admin.query(
      `select object_type, count(*)::int as n from api.data_exports
        where workspace_id=$1 group by object_type`,
      [WS_A],
    )
    await pollForReceipts(async () => {
      const { rows: current } = await admin.query(
        `select object_type, count(*)::int as n from api.data_exports
          where workspace_id=$1 group by object_type`,
        [WS_A],
      )
      const now: Record<string, number> = Object.fromEntries(
        current.map((r) => [r.object_type, Number(r.n)]),
      )
      return (
        (now['record'] ?? 0) - (base['record'] ?? 0) >= 1 &&
        (now['sheet_instance'] ?? 0) - (base['sheet_instance'] ?? 0) >= 1
      )
    })
    const { rows: after } = await admin.query(
      `select object_type, count(*)::int as n from api.data_exports
        where workspace_id=$1 group by object_type`,
      [WS_A],
    )
    const now: Record<string, number> = Object.fromEntries(
      final.map((r) => [r.object_type, Number(r.n)]),
    )
    expect((now['record'] ?? 0) - (base['record'] ?? 0)).toBe(1)
    expect((now['sheet_instance'] ?? 0) - (base['sheet_instance'] ?? 0)).toBe(1)

    // Only this run's receipts: the long-lived dev database keeps earlier,
    // pre-fix rows that must not leak into the attribution assertion.
    const { rows: actors } = await admin.query(
      `select distinct actor_user_id from api.data_exports
        where workspace_id=$1 and created_at >= $2`,
      [WS_A, startedAt],
    )
    expect(actors.length).toBeGreaterThan(0)
    for (const row of actors) {
      // Server-derived actor: always the session identity, never null/forged.
      expect(row.actor_user_id).toBe(OWNER_A)
    }
  })

  it('lets a viewer export readable data while recording their receipt', async () => {
    const VIEWER = 'data-02-api-viewer'
    const res = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      authDeps(VIEWER, WS_A),
    )
    // Export is read-plane: the read-only role may extract readable data.
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Sample,pH')

    await pollForReceipts(async () => {
      const { rows } = await admin.query(
        `select 1 from api.data_exports
          where workspace_id=$1 and object_id=$2 and format='csv'
            and actor_user_id=$3`,
        [WS_A, DATASET_A, VIEWER],
      )
      return rows.length === 1
    })
    const { rows } = await admin.query(
      `select actor_user_id from api.data_exports
        where workspace_id=$1 and object_id=$2 and format='csv'
          and actor_user_id=$3`,
      [WS_A, DATASET_A, VIEWER],
    )
    expect(rows).toHaveLength(1)
  })

  it('leaves no receipt when an export fails', async () => {
    const { rows: before } = await admin.query(
      `select count(*)::int as n from api.data_exports where workspace_id=$1`,
      [WS_A],
    )

    const denied = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_B, WS_B),
    )
    expect(denied.status).toBe(404)

    const invalid = await handleRecordExport(
      exportRequest(`/api/export/record/${RECORD_A}`, '?format=csv'),
      RECORD_A,
      authDeps(OWNER_A, WS_A),
    )
    expect(invalid.status).toBe(400)

    const anon = {
      getSession: async () => null,
      getWorkspaceForUser: async () => null,
      mintToken: authDeps(OWNER_A, WS_A).mintToken,
    }
    const unauth = await handleDatasetExport(
      exportRequest(`/api/export/dataset/${DATASET_A}`, '?format=csv'),
      DATASET_A,
      anon,
    )
    expect(unauth.status).toBe(401)

    const { rows: after } = await admin.query(
      `select count(*)::int as n from api.data_exports where workspace_id=$1`,
      [WS_A],
    )
    expect(after[0].n).toBe(before[0].n)
  })
})

describe('DATA-02 sheet, record and evidence exports', () => {
  it('renders sheet instance CSV from the local grid', async () => {
    const res = await handleSheetInstanceExport(
      exportRequest(`/api/export/sheet-instance/${SHEET_A}`, '?format=csv'),
      SHEET_A,
      authDeps(OWNER_A, WS_A),
    )
    const csv = await res.text()
    expect(csv.split('\r\n')[0]).toBe('Temp')
    expect(csv).toContain('21.5')
  })

  it('exports the canonical record document as JSON', async () => {
    const res = await handleRecordExport(
      exportRequest(`/api/export/record/${RECORD_A}`, '?format=json'),
      RECORD_A,
      authDeps(OWNER_A, WS_A),
    )
    const doc = JSON.parse(await res.text())
    const runId = RECORD_A.replaceAll('-', '').slice(0, 8)
    expect(doc.record.identifier).toBe(`EXP-2026-${runId}`)
    // A live Record export is never evidence, even for locked/archived rows.
    expect(doc._meta.state).toBe('live')
    expect(doc._meta.notes.join(' ')).toContain('NOT immutable evidence')
    expect(Array.isArray(doc.blocks)).toBe(true)

    const bad = await handleRecordExport(
      exportRequest(`/api/export/record/${RECORD_A}`, '?format=csv'),
      RECORD_A,
      authDeps(OWNER_A, WS_A),
    )
    expect(bad.status).toBe(400)
  })

  it('packages submitted revisions as verifiable evidence', async () => {
    // Insert a submitted revision as migrator: the retention trigger only
    // requires the canonical files array, which an empty manifest satisfies.
    await admin.query(
      `insert into api.revisions(id,workspace_id,record_id,reason,structure_version,metadata_version,metadata_snapshot,block_snapshot,canonical_snapshot,integrity_digest,created_by_user_id)
       values ($1,$2,$3,'submit',1,1,'{"title":"Export host"}','[]','{"files":[]}',repeat('c',64),$4)`,
      [REVISION_ID, WS_A, RECORD_A, OWNER_A],
    )

    const res = await handleRevisionEvidencePackage(
      exportRequest(`/api/export/revision/${REVISION_ID}/package`),
      REVISION_ID,
      authDeps(OWNER_A, WS_A),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    const bytes = new Uint8Array(await res.arrayBuffer())
    const entries = unzip(bytes)
    expect(entries.has('evidence.json')).toBe(true)
    expect(entries.has('README.md')).toBe(true)
    expect(entries.has('checksums.sha256')).toBe(true)
    const evidence = JSON.parse(
      new TextDecoder().decode(entries.get('evidence.json')),
    )
    expect(evidence.revision.id).toBe(REVISION_ID)
    expect(evidence.revision.integrityDigest).toBe('c'.repeat(64))

    const { rows: pkgReceipts } = await admin.query(
      `select actor_user_id, byte_size from api.data_exports
        where object_type='revision' and object_id=$1 and format='evidence-package-zip'`,
      [REVISION_ID],
    )
    expect(pkgReceipts).toHaveLength(1)
    expect(pkgReceipts[0].actor_user_id).toBe(OWNER_A)
    expect(Number(pkgReceipts[0].byte_size)).toBe(bytes.byteLength)

    const denial = await handleRevisionEvidencePackage(
      exportRequest(`/api/export/revision/${REVISION_ID}/package`),
      REVISION_ID,
      authDeps(OWNER_B, WS_B),
    )
    expect(denial.status).toBe(404)
  })
})
