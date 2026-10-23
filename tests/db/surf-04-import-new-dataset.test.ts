/**
 * R5-SURF-04 — the new-Dataset import branch writes through the same canonical
 * commit as the append branch, so a new-Dataset import produces exactly one
 * Dataset with the same provenance (file, parser version, mapping, outcome and
 * one snapshot) as an append into an existing Dataset.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { resolveImportTarget } from '#/lib/import/data'
import {
  datasetFieldsFromColumns,
  mapImportSheet,
  suggestImportMappings,
} from '#/lib/import-mapping'
import { parseImportText } from '#/lib/import-parse'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'

import { ensureSessions, prepareTestDatabase } from './helpers'

const WS = '0d040000-0000-4000-8000-000000000004'
const OWNER = 'surf-04-owner'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
      session_id: `session-${userId}`,
    }),
  ])
  return client
}

/**
 * The two canonical writes this branch uses: the catalogue insert behind
 * `createDataset` (through `resolveImportTarget`) and the import commit RPC.
 */
function pgDataClient(owner: Client): DataClient {
  return {
    insert: async (table: string, values: Record<string, unknown>) => {
      if (table !== 'datasets') {
        throw new Error(`unexpected insert into ${table}`)
      }
      const result = await owner.query(
        `insert into api.datasets(workspace_id, schema_version_id, name, description, primary_project_id)
         values($1,$2,$3,$4,$5) returning id, revision, name`,
        [
          values.workspace_id,
          values.schema_version_id,
          values.name,
          values.description ?? null,
          values.primary_project_id ?? null,
        ],
      )
      return [result.rows[0]]
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'commit_dataset_import') {
        throw new Error(`unexpected RPC ${name}`)
      }
      const result = await owner.query(
        `select api.commit_dataset_import($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9) result`,
        [
          args.p_dataset_id,
          args.p_expected_dataset_revision,
          JSON.stringify(args.p_rows),
          args.p_idempotency_key,
          args.p_file_id,
          JSON.stringify(args.p_mapping),
          JSON.stringify(args.p_outcome),
          args.p_parser_id,
          args.p_parser_version_id,
        ],
      )
      return result.rows[0].result
    },
  } as unknown as DataClient
}

async function createFixture(owner: Client) {
  const key = `surf04_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'SURF-04 fixture') returning id`,
      [WS, key],
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
       ($1,gen_random_uuid(),'sample','Sample','text',false,1),
       ($1,gen_random_uuid(),'ph','pH','decimal',true,2)
       returning field_id,key,label,logical_type,nullable,display_order`,
      [version.id],
    )
  ).rows
  await owner.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const existing = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name)
       values($1,$2,'SURF-04 append target') returning id,revision`,
      [WS, version.id],
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
  const parser = (
    await owner.query(
      `SELECT api.ensure_parser($1,$2,'CSV fixture','csv',1,'{}') result`,
      [WS, key],
    )
  ).rows[0].result
  const file = (
    await owner.query(
      `SELECT * FROM api.create_dataset_import_file($1,'surf-04.csv','text/csv',20,$2,$3,'csv',$4)`,
      [WS, 'b'.repeat(64), key, existing.id],
    )
  ).rows[0]
  const preview = parseImportText('Sample,pH\nA,7.4\nB,7.1', { format: 'csv' })
  const sheet = preview.sheets[0]!
  const mapped = mapImportSheet(
    sheet,
    suggestImportMappings(sheet.headers, datasetFieldsFromColumns(columns)),
    version.id,
  )
  expect(mapped.errors).toEqual([])
  return {
    schemaVersionId: version.id as string,
    appendDatasetId: existing.id as string,
    appendRevision: Number(existing.revision),
    rows: mapped.rows.map((row) => ({
      operation: 'create' as const,
      rowId: row.rowId,
      values: row.values,
    })),
    provenance: {
      fileId: file.id as string,
      parserId: parser.parserId as string,
      parserVersionId: parser.parserVersionId as string,
    },
    mapping: {
      sources: fields.map((field) => ({
        source: field.label,
        fieldId: field.field_id,
        unit: null,
      })),
    },
    outcome: { total: 2, added: 2, planned: 0, new: 2, flagged: 0, skipped: 0 },
  }
}

interface Receipt {
  file_id: string
  parser_id: string
  parser_version_id: string
  mapping: Record<string, unknown>
  outcome: Record<string, unknown>
  experiment_record_id: string | null
  instrument_id: string | null
  status: string
  snapshot_version_id: string | null
}

async function readReceipt(owner: Client, importId: string): Promise<Receipt> {
  const result = await owner.query(
    `select file_id, parser_id, parser_version_id, mapping, outcome,
            experiment_record_id, instrument_id, status, snapshot_version_id
       from api.dataset_imports where id = $1`,
    [importId],
  )
  expect(result.rows).toHaveLength(1)
  return result.rows[0] as Receipt
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','SURF-04 owner','surf-04@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','surf-04','SURF-04');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner');
  `)
  await ensureSessions(migrator, [OWNER])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('R5-SURF-04 new-Dataset import branch', () => {
  it('validates notebook import pins, refuses pending submission, and retains frozen import evidence', async () => {
    const owner = await actor(OWNER, WS)
    const fixture = await createFixture(owner)
    const other = await createFixture(owner)
    const project = (
      await migrator.query(
        `insert into api.projects(workspace_id,key,title,lead_user_id) values($1,'import-block','Import block',$2) returning id`,
        [WS, OWNER],
      )
    ).rows[0].id
    const record = (
      await owner.query(
        `select * from api.create_record($1,'experiment','Import notebook','draft',ARRAY[]::text[],'{}')`,
        [project],
      )
    ).rows[0].id
    const block = (
      await owner.query(
        `insert into api.blocks(record_id,type,payload,"order",created_by_user_id) values($1,'dataset_import','{}',1,$2) returning id`,
        [record, OWNER],
      )
    ).rows[0].id
    const save = (payload: unknown) =>
      owner.query(`update api.blocks set payload=$2::jsonb where id=$1`, [
        block,
        JSON.stringify(payload),
      ])
    const pins = {
      fileId: fixture.provenance.fileId,
      datasetId: fixture.appendDatasetId,
    }
    for (const payload of [
      [],
      { fileId: pins.fileId },
      { ...pins, fileId: null },
      { ...pins, sheetName: 3 },
      { ...pins, search: { dataset: other.appendDatasetId } },
      { ...pins, search: { step: 'upload' } },
    ]) {
      await expect(save(payload)).rejects.toMatchObject({ code: '23514' })
    }
    await expect(
      save({ ...pins, fileId: other.provenance.fileId }),
    ).rejects.toMatchObject({ code: '23514' })
    const foreignWorkspace = crypto.randomUUID()
    await migrator.query(
      `insert into api.workspaces(id,slug,name) values($1,'foreign-import','Foreign import')`,
      [foreignWorkspace],
    )
    const foreignFile = (
      await migrator.query(
        `insert into api.dataset_import_files(workspace_id,filename,byte_size,checksum,storage_key,format)
       values($1,'foreign.csv',10,$2,'foreign-import','csv') returning id`,
        [foreignWorkspace, 'd'.repeat(64)],
      )
    ).rows[0].id
    await expect(save({ ...pins, fileId: foreignFile })).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      owner.query(`select api.preview_submission_digest($1)`, [record]),
    ).rejects.toThrow('pending import')
    await save({
      ...pins,
      search: {
        step: 'check',
        map: 'Sample:field',
        units: '',
        parser: 'csv',
        sheet: 'Sheet 1',
        instrument: '',
      },
    })
    await expect(
      owner.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,'pending-import')`,
        [record, '0'.repeat(64), OWNER],
      ),
    ).rejects.toThrow('pending import')

    const committed = await pgDataClient(owner).rpc<{
      ok: boolean
      importId: string
      snapshotVersionId: string
    }>('commit_dataset_import', {
      p_dataset_id: fixture.appendDatasetId,
      p_expected_dataset_revision: fixture.appendRevision,
      p_rows: fixture.rows,
      p_idempotency_key: 'notebook-import',
      p_file_id: pins.fileId,
      p_mapping: { ...fixture.mapping, sheetName: 'Sheet 1' },
      p_outcome: fixture.outcome,
      p_parser_id: fixture.provenance.parserId,
      p_parser_version_id: fixture.provenance.parserVersionId,
    })
    expect(committed.ok).toBe(true)
    const complete = {
      ...pins,
      importId: committed.importId,
      datasetVersionId: committed.snapshotVersionId,
      sheetName: 'Sheet 1',
    }
    const alternateVersion = (
      await owner.query(`select (api.snapshot_dataset($1,$2,'Other')).id`, [
        other.appendDatasetId,
        other.appendRevision,
      ])
    ).rows[0].id
    for (const payload of [
      { ...complete, fileId: other.provenance.fileId },
      { ...complete, datasetId: other.appendDatasetId },
      { ...complete, datasetVersionId: alternateVersion },
      { ...complete, importId: crypto.randomUUID() },
      { ...complete, sheetName: 'Wrong worksheet' },
      { ...complete, search: {} },
    ])
      await expect(save(payload)).rejects.toMatchObject({ code: '23514' })
    await save(complete)

    // A member can edit this notebook but cannot cite a restricted Dataset.
    await owner.query(
      `update api.records set status='in_progress' where id=$1`,
      [record],
    )
    await migrator.query(`insert into internal."user"(id,name,email,"emailVerified") values('import-member','Member','import-member@test.invalid',true);
      insert into api.workspace_memberships(workspace_id,user_id,role) values('${WS}','import-member','member')`)
    await migrator.query(
      `insert into api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
      values($1,$2,'import-member',true,true,false,false,$3)`,
      [WS, project, OWNER],
    )
    const member = await actor('import-member', WS)
    const privateProject = (
      await migrator.query(
        `insert into api.projects(workspace_id,key,title,lead_user_id) values($1,'private-import','Private import',$2) returning id`,
        [WS, OWNER],
      )
    ).rows[0].id
    await owner.query(
      `update api.datasets set primary_project_id=$2 where id=$1`,
      [other.appendDatasetId, privateProject],
    )
    const memberDraft = (
      await member.query(
        `insert into api.blocks(record_id,type,payload,"order",created_by_user_id) values($1,'dataset_import','{}',2,'import-member') returning id`,
        [record],
      )
    ).rows[0].id
    await member.query(`delete from api.blocks where id=$1`, [memberDraft])
    await expect(
      member.query(
        `insert into api.blocks(record_id,type,payload,"order",created_by_user_id) values($1,'dataset_import',$2,2,'import-member')`,
        [
          record,
          JSON.stringify({
            fileId: other.provenance.fileId,
            datasetId: other.appendDatasetId,
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    const preview = (
      await owner.query(`select api.preview_submission_digest($1) result`, [
        record,
      ])
    ).rows[0].result
    const submitted = (
      await owner.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,'completed-import') result`,
        [record, preview.sourceDigest, OWNER],
      )
    ).rows[0].result
    const revisionId = submitted.revision.id
    const frozen = (
      await migrator.query(
        `select canonical_snapshot,integrity_digest from api.revisions where id=$1`,
        [revisionId],
      )
    ).rows[0]
    expect(frozen.canonical_snapshot.importEvidence[0]).toMatchObject({
      ...pins,
      importId: committed.importId,
      datasetVersionId: committed.snapshotVersionId,
      blockId: block,
      receipt: {
        id: committed.importId,
        mapping: { sheetName: 'Sheet 1' },
        outcome: fixture.outcome,
      },
      file: { id: pins.fileId, checksum: 'b'.repeat(64) },
      version: {
        id: committed.snapshotVersionId,
        schema_version_id: fixture.schemaVersionId,
      },
    })
    expect(frozen.canonical_snapshot.importEvidence[0].fields).toHaveLength(2)
    expect(
      (
        await migrator.query(
          `select internal.revision_integrity_digest(canonical_snapshot) digest from api.revisions where id=$1`,
          [revisionId],
        )
      ).rows[0].digest,
    ).toBe(frozen.integrity_digest)
    // The immutable revision alone retains sources after the live block goes.
    await owner.query(
      `select api.withdraw_review($1,'Continue editing','submitted',$2)`,
      [submitted.submission.id, frozen.integrity_digest],
    )
    await owner.query(`delete from api.blocks where id=$1`, [block])
    expect(
      (await owner.query(`select id from api.blocks where id=$1`, [block]))
        .rows,
    ).toHaveLength(0)
    // Live edits cannot change the receipt snapshot or its field interpretation.
    await owner.query(
      `update api.datasets set name='Renamed live Dataset' where id=$1`,
      [pins.datasetId],
    )
    for (const query of [
      `delete from api.dataset_import_files where id='${pins.fileId}'`,
      `delete from api.dataset_imports where id='${committed.importId}'`,
    ])
      await expect(migrator.query(query)).rejects.toMatchObject({
        code: '23503',
      })
    await expect(
      migrator.query(
        `update api.dataset_import_files set checksum=$2 where id=$1`,
        [pins.fileId, 'c'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      migrator.query(
        `update api.dataset_imports set outcome='{}' where id=$1`,
        [committed.importId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await migrator.query(
      `update api.datasets set lifecycle='archived',archived_at=now()-interval '20 years' where id=$1`,
      [pins.datasetId],
    )
    await migrator.query(`select api.prune_dataset_versions()`)
    expect(
      (
        await migrator.query(
          `select count(*)::int n from api.dataset_version_rows where dataset_version_id=$1`,
          [committed.snapshotVersionId],
        )
      ).rows[0].n,
    ).toBe(2)
    expect(
      (
        await owner.query(`select api.dataset_version_retention($1) result`, [
          committed.snapshotVersionId,
        ])
      ).rows[0].result.reason,
    ).toBe('notebook_import_evidence')
    expect(
      (
        await migrator.query(
          `select canonical_snapshot from api.revisions where id=$1`,
          [revisionId],
        )
      ).rows[0].canonical_snapshot,
    ).toEqual(frozen.canonical_snapshot)
  })

  it('creates exactly one Dataset and writes the same provenance as an append', async () => {
    const owner = await actor(OWNER, WS)
    const fixture = await createFixture(owner)
    const client = pgDataClient(owner)

    // Append: commit into the Dataset that already exists.
    const append = await client.rpc<{
      ok: boolean
      importId: string
      snapshotVersionId: string
    }>('commit_dataset_import', {
      p_dataset_id: fixture.appendDatasetId,
      p_expected_dataset_revision: fixture.appendRevision,
      p_rows: fixture.rows,
      p_idempotency_key: 'surf-04-append',
      p_file_id: fixture.provenance.fileId,
      p_mapping: fixture.mapping,
      p_outcome: fixture.outcome,
      p_parser_id: fixture.provenance.parserId,
      p_parser_version_id: fixture.provenance.parserVersionId,
    })
    expect(append.ok).toBe(true)

    // New dataset: the same target resolver the flow calls, then the same RPC.
    const before = await owner.query(
      `select count(*)::int as n from api.datasets where workspace_id=$1`,
      [WS],
    )
    const target = await resolveImportTarget(client, {
      mode: 'new',
      workspaceId: WS,
      schemaVersionId: fixture.schemaVersionId,
      name: 'SURF-04 new dataset',
    })
    expect(target.created).toBe(true)
    const after = await owner.query(
      `select count(*)::int as n from api.datasets where workspace_id=$1`,
      [WS],
    )
    expect(after.rows[0].n - before.rows[0].n).toBe(1)

    const created = await owner.query(
      `select name, schema_version_id, lifecycle from api.datasets where id=$1`,
      [target.datasetId],
    )
    expect(created.rows).toHaveLength(1)
    expect(created.rows[0].name).toBe('SURF-04 new dataset')
    expect(created.rows[0].schema_version_id).toBe(fixture.schemaVersionId)
    expect(created.rows[0].lifecycle).toBe('active')

    const fresh = await client.rpc<{
      ok: boolean
      importId: string
      snapshotVersionId: string
    }>('commit_dataset_import', {
      p_dataset_id: target.datasetId,
      p_expected_dataset_revision: 1,
      // Row ids are workspace-unique: the second import carries its own, while
      // the file, parser, mapping and outcome stay identical.
      p_rows: fixture.rows.map((row) => ({
        ...row,
        rowId: crypto.randomUUID(),
      })),
      p_idempotency_key: 'surf-04-new',
      p_file_id: fixture.provenance.fileId,
      p_mapping: fixture.mapping,
      p_outcome: fixture.outcome,
      p_parser_id: fixture.provenance.parserId,
      p_parser_version_id: fixture.provenance.parserVersionId,
    })
    expect(fresh.ok).toBe(true)

    // Same provenance, exactly one receipt and one snapshot per Dataset. The
    // snapshot ids differ by construction (one per commit); everything the
    // receipt records about the import is identical.
    const appendReceipt = await readReceipt(owner, append.importId)
    const freshReceipt = await readReceipt(owner, fresh.importId)
    expect(freshReceipt.file_id).toBe(appendReceipt.file_id)
    expect(freshReceipt.parser_id).toBe(appendReceipt.parser_id)
    expect(freshReceipt.parser_version_id).toBe(appendReceipt.parser_version_id)
    expect(freshReceipt.mapping).toEqual(appendReceipt.mapping)
    expect(freshReceipt.outcome).toEqual(appendReceipt.outcome)
    expect(freshReceipt.experiment_record_id).toBeNull()
    expect(freshReceipt.instrument_id).toBeNull()
    expect(freshReceipt.status).toBe('committed')
    expect(freshReceipt.snapshot_version_id).toBe(fresh.snapshotVersionId)

    for (const datasetId of [fixture.appendDatasetId, target.datasetId]) {
      const receipts = await owner.query(
        `select count(*)::int as n from api.dataset_imports where dataset_id=$1`,
        [datasetId],
      )
      expect(receipts.rows[0].n).toBe(1)
      const snapshots = await owner.query(
        `select count(*)::int as n from api.dataset_versions where dataset_id=$1`,
        [datasetId],
      )
      expect(snapshots.rows[0].n).toBe(1)
      const rows = await owner.query(
        `select count(*)::int as n from api.dataset_rows where dataset_id=$1`,
        [datasetId],
      )
      expect(rows.rows[0].n).toBe(2)
    }

    // The receipt's own Dataset is the one the rows landed in.
    const landed = await owner.query(
      `select dataset_id from api.dataset_imports where id=$1`,
      [fresh.importId],
    )
    expect(landed.rows[0].dataset_id).toBe(target.datasetId)
  })

  it('refuses a new Dataset with no name or no Model, creating nothing', async () => {
    const owner = await actor(OWNER, WS)
    const fixture = await createFixture(owner)
    const client = pgDataClient(owner)
    const before = await owner.query(
      `select count(*)::int as n from api.datasets where workspace_id=$1`,
      [WS],
    )

    await expect(
      resolveImportTarget(client, {
        mode: 'new',
        workspaceId: WS,
        schemaVersionId: fixture.schemaVersionId,
        name: '   ',
      }),
    ).rejects.toThrow('Name the new Dataset.')
    await expect(
      resolveImportTarget(client, {
        mode: 'new',
        workspaceId: WS,
        schemaVersionId: '',
        name: 'No model',
      }),
    ).rejects.toThrow('Choose the Model the new Dataset is built on.')

    const after = await owner.query(
      `select count(*)::int as n from api.datasets where workspace_id=$1`,
      [WS],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
