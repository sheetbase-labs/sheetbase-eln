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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

// Fresh identities per run: everything below is deleted in afterAll.
const SCHEMA_DEF_A = crypto.randomUUID()
const SCHEMA_VER_A = crypto.randomUUID()
const FIELD_SAMPLE = crypto.randomUUID()
const FIELD_PH = crypto.randomUUID()
const DATASET_A = crypto.randomUUID()
const SHEET_A = crypto.randomUUID()
const RECORD_A = crypto.randomUUID()
const REVISION_ID = crypto.randomUUID()

let admin: Client
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

  // Idempotent parents: reused across runs, never deleted.
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
  // Mutable children of this run are removed; the reusable parents above and
  // the immutable schema/version evidence remain by design.
  await admin.query(`delete from api.revisions where record_id=$1`, [RECORD_A])
  await admin.query(
    `delete from api.data_exports where object_id=any($1::uuid[])`,
    [[DATASET_A, SHEET_A, RECORD_A, REVISION_ID]],
  )
  await admin.query(`delete from api.blocks where record_id=$1`, [RECORD_A])
  await admin.query(`delete from api.record_links where source_record_id=$1`, [
    RECORD_A,
  ])
  await admin.query(`delete from api.records where id=$1`, [RECORD_A])
  await admin.end()
})

describe('DATA-02 dataset exports', () => {
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

    const second = await handleDatasetExport(
      exportRequest(url, '?format=csv'),
      DATASET_A,
      authDeps(OWNER_A, WS_A),
    )
    expect(await second.text()).toBe(body1)
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
      [JSON.stringify({ sub: OWNER_A, workspace_id: WS_A })],
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

    const denial = await handleRevisionEvidencePackage(
      exportRequest(`/api/export/revision/${REVISION_ID}/package`),
      REVISION_ID,
      authDeps(OWNER_B, WS_B),
    )
    expect(denial.status).toBe(404)
  })
})
