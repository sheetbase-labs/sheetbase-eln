import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { validateAndCommitImport } from '#/lib/import-commit'
import {
  datasetFieldsFromColumns,
  mapImportSheet,
  suggestImportMappings,
} from '#/lib/import-mapping'
import { parseImportText } from '#/lib/import-parse'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'

import { prepareTestDatabase } from './helpers'

const WS_A = '0d010000-0000-4000-8000-000000000001'
const OWNER_A = 'data-01-owner-a'
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
    }),
  ])
  return client
}

function pgDataClient(owner: Client): DataClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'validate_dataset_row_batch') {
        const result = await owner.query(
          `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
          [
            args.p_dataset_id,
            args.p_expected_dataset_revision,
            JSON.stringify(args.p_rows),
          ],
        )
        return result.rows[0].result
      }
      if (name === 'commit_dataset_import') {
        const result = await owner.query(
          `select api.commit_dataset_import($1,$2,$3::jsonb,$4,$5,'{}','{}',$6,$7) result`,
          [
            args.p_dataset_id,
            args.p_expected_dataset_revision,
            JSON.stringify(args.p_rows),
            args.p_idempotency_key,
            args.p_file_id,
            args.p_parser_id,
            args.p_parser_version_id,
          ],
        )
        return result.rows[0].result
      }
      throw new Error(`unexpected RPC ${name}`)
    },
  } as unknown as DataClient
}

async function createImportFixture(owner: Client) {
  const key = `imp_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'Import fixture') returning id`,
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
  const dataset = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Import fixture') returning id,revision,schema_version_id`,
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
  const parser = (
    await owner.query(
      `SELECT api.ensure_parser($1, $2, 'CSV fixture', 'csv', 1, '{}') result`,
      [WS_A, key],
    )
  ).rows[0].result
  const file = (
    await owner.query(
      `SELECT * FROM api.create_dataset_import_file($1, 'fixture.csv', 'text/csv', 20, $2, $3, 'csv', $4)`,
      [WS_A, 'a'.repeat(64), key, dataset.id],
    )
  ).rows[0]
  return {
    datasetId: dataset.id as string,
    revision: Number(dataset.revision),
    schemaVersionId: dataset.schema_version_id as string,
    columns,
    provenance: {
      fileId: file.id,
      parserId: parser.parserId,
      parserVersionId: parser.parserVersionId,
    },
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Owner A','data-01-owner@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','data-01','DATA-01');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner');
  `)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('DATA-01 import against canonical Dataset writers', () => {
  it('maps CSV, validates, then commits live rows pinned to the Schema Version', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createImportFixture(owner)
    const preview = parseImportText('Sample,pH\nA,7.4\nB,7.1', {
      format: 'csv',
    })
    const fields = datasetFieldsFromColumns(fixture.columns)
    const mapped = mapImportSheet(
      preview.sheets[0]!,
      suggestImportMappings(preview.sheets[0]!.headers, fields),
      fixture.schemaVersionId,
    )
    expect(mapped.errors).toEqual([])
    const result = await validateAndCommitImport(
      pgDataClient(owner),
      {
        kind: 'dataset',
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        ...fixture.provenance,
      },
      mapped,
      'data-01-happy',
    )
    expect(result.ok).toBe(true)
    expect(result.committed).toBe(2)
    expect(result.schemaVersionId).toBe(fixture.schemaVersionId)
    const stored = await owner.query(
      `select count(*)::int as n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(2)
  })

  it('fails closed on invalid decimals and does not commit', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createImportFixture(owner)
    const preview = parseImportText('Sample,pH\nA,not-a-number', {
      format: 'csv',
    })
    const fields = datasetFieldsFromColumns(fixture.columns)
    const mapped = mapImportSheet(
      preview.sheets[0]!,
      suggestImportMappings(preview.sheets[0]!.headers, fields),
      fixture.schemaVersionId,
    )
    expect(mapped.errors[0]?.code).toBe('coercion_failed')
    const result = await validateAndCommitImport(
      pgDataClient(owner),
      {
        kind: 'dataset',
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        ...fixture.provenance,
      },
      mapped,
      'data-01-coerce',
    )
    expect(result.ok).toBe(false)
    expect(result.committed).toBe(0)
    const stored = await owner.query(
      `select count(*)::int as n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(0)
  })

  it('rejects fields that are not on the pinned Schema Version', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createImportFixture(owner)
    const mapped = mapImportSheet(
      {
        name: 'Sheet 1',
        headers: ['pH'],
        rows: [{ pH: '7.4' }],
      },
      [
        {
          source: 'pH',
          kind: 'field',
          field: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            label: 'Ghost',
            logicalType: 'decimal',
            nullable: true,
            kind: 'dataset-field',
          },
        },
      ],
      fixture.schemaVersionId,
    )
    const result = await validateAndCommitImport(
      pgDataClient(owner),
      {
        kind: 'dataset',
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        ...fixture.provenance,
      },
      mapped,
      'data-01-mismatch',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'unknown_field')).toBe(
      true,
    )
    const stored = await owner.query(
      `select count(*)::int as n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(0)
  })
})
