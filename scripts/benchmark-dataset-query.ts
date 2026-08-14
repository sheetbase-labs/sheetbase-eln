/**
 * CORE-02.6 reproducible 100k-row query fixture and baseline measurement.
 * Run against a migrated local database with `pnpm tsx scripts/benchmark-dataset-query.ts`.
 */
import { config } from 'dotenv'
import { Client } from 'pg'

config({ path: ['.env.local', '.env'] })

const workspaceId = '02600000-0000-4000-8000-000000000001'
const userId = 'core-026-benchmark-user'
const schemaId = '02600000-0000-4000-8000-000000000002'
const schemaVersionId = '02600000-0000-4000-8000-000000000003'
const datasetId = '02600000-0000-4000-8000-000000000004'
const numericFieldId = '02600000-0000-4000-8000-000000000010'
const dateFieldId = '02600000-0000-4000-8000-000000000011'
const categoryFieldId = '02600000-0000-4000-8000-000000000012'
const textFieldId = '02600000-0000-4000-8000-000000000013'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function elapsed(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

async function main(): Promise<void> {
  const admin = new Client({ connectionString: required('DATABASE_URL') })
  const actor = new Client({ connectionString: required('PGRST_DB_URI') })
  await admin.connect()
  await actor.connect()
  try {
    await admin.query(
      `delete from api.dataset_bulk_commits where workspace_id='${workspaceId}';
       delete from api.dataset_rows where dataset_id='${datasetId}';
       delete from api.datasets where id='${datasetId}';
       delete from api.dataset_schema_definitions where id='${schemaId}';
       delete from api.workspace_memberships where workspace_id='${workspaceId}';
       delete from api.workspaces where id='${workspaceId}';
       delete from internal."user" where id='${userId}';`,
    )
    await admin.query(
      `insert into internal."user"(id,name,email,"emailVerified") values('${userId}','CORE benchmark','core-026@test.invalid',true);
       insert into api.workspaces(id,slug,name) values('${workspaceId}','core-026-benchmark','CORE-02.6 benchmark');
       insert into api.workspace_memberships(workspace_id,user_id,role) values('${workspaceId}','${userId}','owner');
       insert into api.dataset_schema_definitions(id,workspace_id,key,name,created_by_user_id) values('${schemaId}','${workspaceId}','benchmark','CORE benchmark','${userId}');
       insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,created_by_user_id) values('${schemaVersionId}','${schemaId}',1,'draft','${userId}');`,
    )
    await admin.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,display_order,category)
       values
         ($1,$2,'titre','Titre','decimal',1,null),
         ($1,$3,'observed_on','Observed on','date',2,null),
         ($1,$4,'qc_state','QC state','category',3, '{"kind":"embedded","options":[{"id":"02600000-0000-4000-8000-000000000100","lifecycle":"active"},{"id":"02600000-0000-4000-8000-000000000101","lifecycle":"active"},{"id":"02600000-0000-4000-8000-000000000102","lifecycle":"active"},{"id":"02600000-0000-4000-8000-000000000103","lifecycle":"active"},{"id":"02600000-0000-4000-8000-000000000104","lifecycle":"active"}]}'::jsonb),
         ($1,$5,'sample_code','Sample code','text',4,null),
         ($1,'02600000-0000-4000-8000-000000000014','batch','Batch','text',5,null),
         ($1,'02600000-0000-4000-8000-000000000015','operator','Operator','text',6,null),
         ($1,'02600000-0000-4000-8000-000000000016','temperature','Temperature','decimal',7,null),
         ($1,'02600000-0000-4000-8000-000000000017','volume','Volume','decimal',8,null),
         ($1,'02600000-0000-4000-8000-000000000018','run_date','Run date','date',9,null),
         ($1,'02600000-0000-4000-8000-000000000019','notes','Notes','text',10,null);`,
      [
        schemaVersionId,
        numericFieldId,
        dateFieldId,
        categoryFieldId,
        textFieldId,
      ],
    )
    await admin.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [schemaVersionId],
    )
    await admin.query(
      `insert into api.datasets(id,workspace_id,schema_version_id,name,created_by_user_id) values($1,$2,$3,'CORE 100k',$4)`,
      [datasetId, workspaceId, schemaVersionId, userId],
    )
    const seededAt = process.hrtime.bigint()
    await admin.query(
      `insert into api.dataset_rows(id,dataset_id,workspace_id)
       select ('02600000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'${datasetId}','${workspaceId}'
       from generate_series(1,100000) i;
       insert into api.dataset_row_values(row_id,field_id,numeric_value)
       select r.id,'${numericFieldId}',(substring(r.id::text,25,12)::numeric % 1000) * 1000000
       from api.dataset_rows r where r.dataset_id='${datasetId}';
       insert into api.dataset_row_values(row_id,field_id,date_value)
       select r.id,'${dateFieldId}',date '2024-01-01' + (substring(r.id::text,25,12)::integer % 365)
       from api.dataset_rows r where r.dataset_id='${datasetId}';
       insert into api.dataset_row_values(row_id,field_id,category_option_id)
       select r.id,'${categoryFieldId}',('02600000-0000-4000-8000-' || lpad(((substring(r.id::text,25,12)::integer % 5)+100)::text,12,'0'))::uuid
       from api.dataset_rows r where r.dataset_id='${datasetId}';
       insert into api.dataset_row_values(row_id,field_id,text_value)
       select r.id,'${textFieldId}','S-' || substring(r.id::text,25,12)
       from api.dataset_rows r where r.dataset_id='${datasetId}';
       analyze api.dataset_rows; analyze api.dataset_row_values;`,
    )
    console.log(`seed_100k_ms=${elapsed(seededAt).toFixed(1)}`)

    await actor.query('set role authenticated')
    await actor.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: userId, workspace_id: workspaceId }),
    ])
    const query = {
      filters: [{ fieldId: numericFieldId, operator: 'gte', value: 900000000 }],
      sort: { fieldId: dateFieldId, direction: 'desc' },
    }
    for (let run = 1; run <= 3; run++) {
      const startedAt = process.hrtime.bigint()
      const result = await actor.query<{
        result: { totalCount: number; rows: unknown[] }
      }>(`select api.query_dataset_rows($1,$2::jsonb,200,0) result`, [
        datasetId,
        JSON.stringify(query),
      ])
      console.log(
        `query_run_${run}_ms=${elapsed(startedAt).toFixed(1)} total=${result.rows[0].result.totalCount} rows=${result.rows[0].result.rows.length}`,
      )
    }
  } finally {
    await actor.end()
    await admin.end()
  }
}

void main()
