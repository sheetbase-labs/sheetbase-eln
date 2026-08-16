/**
 * CORE-02.6 deterministic Dataset scale/correctness gate.
 *
 * Fixture setup and the future composition/projection/aggregate proofs use the
 * privileged local connection. Product-facing reads and every bulk operation
 * use the authenticated canonical RPCs with their normal RLS checks.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import type { QueryResult } from 'pg'

import { assertSafeDatasetBenchmarkEnvironment } from './dataset-benchmark-safety'

config({ path: ['.env.local', '.env'] })

const ids = {
  workspace: '02600000-0000-4000-8000-000000000001',
  user: 'core-026-benchmark-user',
  primarySchema: '02600000-0000-4000-8000-000000000002',
  primaryVersion: '02600000-0000-4000-8000-000000000003',
  primaryDataset: '02600000-0000-4000-8000-000000000004',
  secondarySchema: '02600000-0000-4000-8000-000000000005',
  secondaryVersion: '02600000-0000-4000-8000-000000000006',
  secondaryDataset: '02600000-0000-4000-8000-000000000007',
} as const

const categoryOptions = Array.from({ length: 5 }, (_, index) => ({
  id: `02600000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
  key: `qc_${index}`,
  label: `QC ${index}`,
  lifecycle: 'active',
}))

type Field = {
  id: string
  key: string
  label: string
  logicalType: string
  category?: unknown
  relationship?: unknown
  cardinality?: 'one' | 'many'
}

function fields(prefix: '02621000' | '02631000'): Field[] {
  const id = (ordinal: number) =>
    `${prefix}-0000-4000-8000-${String(ordinal).padStart(12, '0')}`
  return [
    {
      id: id(1),
      key: 'sample',
      label: 'Sample',
      logicalType: 'reference',
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
    },
    { id: id(2), key: 'titre', label: 'Titre', logicalType: 'decimal' },
    {
      id: id(3),
      key: 'observed_on',
      label: 'Observed on',
      logicalType: 'date',
    },
    {
      id: id(4),
      key: 'qc_state',
      label: 'QC state',
      logicalType: 'category',
      category: { kind: 'embedded', options: categoryOptions },
    },
    {
      id: id(5),
      key: 'sample_code',
      label: 'Sample code',
      logicalType: 'text',
    },
    { id: id(6), key: 'batch', label: 'Batch', logicalType: 'text' },
    {
      id: id(7),
      key: 'temperature',
      label: 'Temperature',
      logicalType: 'decimal',
    },
    { id: id(8), key: 'volume', label: 'Volume', logicalType: 'decimal' },
    {
      id: id(9),
      key: 'captured_at',
      label: 'Captured at',
      logicalType: 'timestamp',
    },
    {
      id: id(10),
      key: 'replicate',
      label: 'Replicate',
      logicalType: 'integer',
    },
    {
      id: id(11),
      key: 'accepted',
      label: 'Accepted',
      logicalType: 'boolean',
    },
    { id: id(12), key: 'notes', label: 'Notes', logicalType: 'text' },
    {
      id: id(13),
      key: 'concentration',
      label: 'Concentration',
      logicalType: 'decimal',
    },
    {
      id: id(14),
      key: 'tags',
      label: 'Tags',
      logicalType: 'text',
      cardinality: 'many',
    },
  ]
}

const primaryFields = fields('02621000')
const secondaryFields = fields('02631000')
const field = (set: Field[], key: string) =>
  set.find((item) => item.key === key)!.id

const limits = {
  seedMs: 240_000,
  rpcMs: 5_000,
  planMs: 5_000,
  bulkValidateMs: 10_000,
  bulkCommitMs: 30_000,
} as const

function elapsed(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`benchmark assertion failed: ${message}`)
}

async function assertCleanupPostconditions(admin: Client): Promise<void> {
  const remaining = (
    await admin.query(
      `select
        (select count(*)::integer from api.workspaces where id=$1) workspaces,
        (select count(*)::integer from internal."user" where id=$2) users,
        (select count(*)::integer from api.dataset_schema_definitions where id=any($3::uuid[])) schemas,
        (select count(*)::integer from api.dataset_schema_versions where id=any($4::uuid[])) schema_versions,
        (select count(*)::integer from api.datasets where id=any($5::uuid[])) datasets,
        (select count(*)::integer from api.records where workspace_id=$1 or id::text like '02610000-%') records,
        (select count(*)::integer from api.dataset_bulk_commits where workspace_id=$1) bulk_commits,
        (select count(*)::integer from api.dataset_rows where id::text like '02620000-%' or id::text like '02630000-%' or id::text like '02640000-%') dataset_rows`,
      [
        ids.workspace,
        ids.user,
        [ids.primarySchema, ids.secondarySchema],
        [ids.primaryVersion, ids.secondaryVersion],
        [ids.primaryDataset, ids.secondaryDataset],
      ],
    )
  ).rows[0] as Record<string, number>
  const leftovers = Object.entries(remaining).filter(([, count]) => count !== 0)
  assert(
    leftovers.length === 0,
    `cleanup left fixed fixture objects: ${leftovers.map(([name]) => name).join(', ')}`,
  )
  const triggers = (
    await admin.query(
      `select count(*)::integer total,
        count(*) filter (where tgenabled='O')::integer enabled
       from pg_trigger where tgname=any($1::text[])`,
      [
        [
          'prevent_published_dataset_schema_version_mutation',
          'prevent_published_dataset_schema_field_mutation',
        ],
      ],
    )
  ).rows[0]
  assert(
    triggers.total === 2 && triggers.enabled === 2,
    'cleanup did not restore both Dataset Schema immutability triggers',
  )
  console.log('cleanup_status=PASS remaining=0 immutability_triggers_enabled=2')
}

async function cleanup(admin: Client): Promise<void> {
  await admin.query(
    'delete from api.dataset_bulk_commits where workspace_id=$1',
    [ids.workspace],
  )
  await admin.query('delete from api.datasets where workspace_id=$1', [
    ids.workspace,
  ])
  await admin.query('begin')
  try {
    await admin.query(
      'alter table api.dataset_schema_versions disable trigger prevent_published_dataset_schema_version_mutation',
    )
    await admin.query(
      'alter table api.dataset_schema_version_fields disable trigger prevent_published_dataset_schema_field_mutation',
    )
    await admin.query(
      'delete from api.dataset_schema_definitions where workspace_id=$1',
      [ids.workspace],
    )
    await admin.query(
      'alter table api.dataset_schema_version_fields enable trigger prevent_published_dataset_schema_field_mutation',
    )
    await admin.query(
      'alter table api.dataset_schema_versions enable trigger prevent_published_dataset_schema_version_mutation',
    )
    await admin.query('commit')
  } catch (error) {
    await admin.query('rollback')
    throw error
  }
  await admin.query('delete from api.records where workspace_id=$1', [
    ids.workspace,
  ])
  await admin.query(
    'delete from api.workspace_memberships where workspace_id=$1',
    [ids.workspace],
  )
  await admin.query('delete from api.workspaces where id=$1', [ids.workspace])
  await admin.query('delete from internal."user" where id=$1', [ids.user])
  await assertCleanupPostconditions(admin)
}

async function createSchema(
  admin: Client,
  schemaId: string,
  versionId: string,
  key: string,
  fieldSet: Field[],
): Promise<void> {
  await admin.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,created_by_user_id)
     values($1,$2,$3,$4,$5)`,
    [schemaId, ids.workspace, key, `${key} benchmark schema`, ids.user],
  )
  await admin.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,created_by_user_id)
     values($1,$2,1,'draft',$3)`,
    [versionId, schemaId, ids.user],
  )
  await admin.query(
    `insert into api.dataset_schema_version_fields(
       schema_version_id,field_id,key,label,logical_type,category,relationship,cardinality,display_order
     )
     select $1,(item->>'id')::uuid,item->>'key',item->>'label',item->>'logicalType',
       nullif(item->'category','null'::jsonb),nullif(item->'relationship','null'::jsonb),
       coalesce(item->>'cardinality','one'),ordinality::integer
     from jsonb_array_elements($2::jsonb) with ordinality source(item,ordinality)`,
    [versionId, JSON.stringify(fieldSet)],
  )
  await admin.query(
    `update api.dataset_schema_versions
     set lifecycle='active',published_at=now() where id=$1`,
    [versionId],
  )
}

async function seedDataset(
  admin: Client,
  datasetId: string,
  versionId: string,
  name: string,
  rowPrefix: string,
  count: number,
  fieldSet: Field[],
): Promise<void> {
  await admin.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,created_by_user_id)
     values($1,$2,$3,$4,$5)`,
    [datasetId, ids.workspace, versionId, name, ids.user],
  )
  await admin.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id)
     select ($1||lpad(i::text,12,'0'))::uuid,$2,$3
     from generate_series(1,$4::integer) i`,
    [rowPrefix, datasetId, ids.workspace, count],
  )
  const common = [datasetId, fieldSet.map((item) => item.id)]
  await admin.query(
    `insert into api.dataset_row_values(
       row_id,field_id,reference_id,numeric_value,date_value,category_option_id,
       text_value,timestamp_value,integer_value,boolean_value
     )
     select r.id,f.field_id,
       case f.ordinal when 1 then ('02610000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid end,
       case f.ordinal when 2 then (i%1000)*1000000::numeric
                            when 7 then 18+(i%120)/10.0
                            when 8 then 100+(i%900)/10.0 end,
       case f.ordinal when 3 then date '2024-01-01'+(i%365) end,
       case f.ordinal when 4 then ('02600000-0000-4000-8000-'||lpad((100+i%5)::text,12,'0'))::uuid end,
       case f.ordinal when 5 then 'S-'||lpad(i::text,8,'0')
                            when 6 then 'B-'||lpad((i%1000)::text,4,'0')
                            when 12 then 'deterministic row '||i end,
       case f.ordinal when 9 then timestamptz '2024-01-01 00:00:00+00'+make_interval(secs=>i%31536000) end,
       case f.ordinal when 10 then 1+i%3 end,
       case f.ordinal when 11 then i%5<>4 end
     from api.dataset_rows r
     cross join lateral (select substring(r.id::text,25,12)::integer i) n
     cross join unnest($2::uuid[]) with ordinality f(field_id,ordinal)
     where r.dataset_id=$1 and f.ordinal between 1 and 12`,
    common,
  )
}

type Plan = {
  'Node Type': string
  'Index Name'?: string
  'Shared Hit Blocks'?: number
  'Shared Read Blocks'?: number
  Plans?: Plan[]
}

function planSummary(result: QueryResult): Record<string, unknown> {
  const envelope = result.rows[0]['QUERY PLAN'][0]
  const indexes = new Set<string>()
  let hitBlocks = 0
  let readBlocks = 0
  const visit = (node: Plan) => {
    if (node['Index Name']) indexes.add(node['Index Name'])
    hitBlocks += node['Shared Hit Blocks'] ?? 0
    readBlocks += node['Shared Read Blocks'] ?? 0
    node.Plans?.forEach(visit)
  }
  visit(envelope.Plan)
  return {
    executionMs: envelope['Execution Time'],
    planningMs: envelope['Planning Time'],
    root: envelope.Plan['Node Type'],
    indexes: [...indexes].sort(),
    sharedHitBlocks: hitBlocks,
    sharedReadBlocks: readBlocks,
  }
}

async function explain(
  admin: Client,
  name: string,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const result = await admin.query(
    `explain (analyze,buffers,format json) ${sql}`,
    params,
  )
  const summary = planSummary(result)
  assert(
    Number(summary.executionMs) <= limits.planMs,
    `${name} plan exceeded ${limits.planMs} ms`,
  )
  console.log(`plan_${name}=${JSON.stringify(summary)}`)
  return summary
}

async function rpc(
  actor: Client,
  name: string,
  query: unknown,
  offset: number,
): Promise<{ ms: number; result: Record<string, unknown> }> {
  const startedAt = process.hrtime.bigint()
  const response = await actor.query(
    `select api.query_dataset_rows($1,$2::jsonb,200,$3) result`,
    [ids.primaryDataset, JSON.stringify(query), offset],
  )
  const ms = elapsed(startedAt)
  assert(ms <= limits.rpcMs, `${name} RPC exceeded ${limits.rpcMs} ms`)
  const result = response.rows[0].result as Record<string, unknown>
  console.log(
    `${name}_ms=${ms.toFixed(1)} total=${result.totalCount} rows=${(result.rows as unknown[]).length} offset=${result.offset} hasMore=${result.hasMore}`,
  )
  return { ms, result }
}

async function main(): Promise<void> {
  const environment = assertSafeDatasetBenchmarkEnvironment(process.env)
  const admin = new Client({ connectionString: environment.databaseUrl })
  const actor = new Client({ connectionString: environment.pgrstDatabaseUrl })
  await admin.connect()
  await actor.connect()
  let fixtureCreated = false
  try {
    await cleanup(admin)
    fixtureCreated = true
    const version = (await admin.query('show server_version')).rows[0]
      .server_version
    console.log(`postgres_version=${version}`)
    console.log(`thresholds=${JSON.stringify(limits)}`)

    const seededAt = process.hrtime.bigint()
    await admin.query(
      `insert into internal."user"(id,name,email,"emailVerified")
       values($1,'CORE benchmark','core-026@test.invalid',true)`,
      [ids.user],
    )
    await admin.query(
      `insert into api.workspaces(id,slug,name)
       values($1,'core-026-benchmark','CORE-02.6 benchmark')`,
      [ids.workspace],
    )
    await admin.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,'owner')`,
      [ids.workspace, ids.user],
    )
    await createSchema(
      admin,
      ids.primarySchema,
      ids.primaryVersion,
      'core_026_primary',
      primaryFields,
    )
    await createSchema(
      admin,
      ids.secondarySchema,
      ids.secondaryVersion,
      'core_026_secondary',
      secondaryFields,
    )
    await admin.query(
      `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
       select ('02610000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,$1,
         'sample','CORE-S-'||lpad(i::text,8,'0'),'CORE sample '||i,$2
       from generate_series(1,100000) i`,
      [ids.workspace, ids.user],
    )
    await seedDataset(
      admin,
      ids.primaryDataset,
      ids.primaryVersion,
      'CORE primary 100k',
      '02620000-0000-4000-8000-',
      100_000,
      primaryFields,
    )
    await seedDataset(
      admin,
      ids.secondaryDataset,
      ids.secondaryVersion,
      'CORE secondary 80k',
      '02630000-0000-4000-8000-',
      80_000,
      secondaryFields,
    )
    await admin.query(
      'analyze api.records; analyze api.dataset_rows; analyze api.dataset_row_values',
    )
    const seedMs = elapsed(seededAt)
    assert(seedMs <= limits.seedMs, `fixture seed exceeded ${limits.seedMs} ms`)
    const sizes = (
      await admin.query(
        `select d.id,count(distinct r.id)::integer rows,count(v.*)::integer values
         from api.datasets d join api.dataset_rows r on r.dataset_id=d.id
         join api.dataset_row_values v on v.row_id=r.id
         where d.id=any($1::uuid[]) group by d.id order by d.id`,
        [[ids.primaryDataset, ids.secondaryDataset]],
      )
    ).rows
    assert(
      sizes[0].rows === 100_000 && sizes[0].values === 1_200_000,
      'primary fixture shape',
    )
    assert(
      sizes[1].rows === 80_000 && sizes[1].values === 960_000,
      'secondary fixture shape',
    )
    console.log(`seed_ms=${seedMs.toFixed(1)} fixture=${JSON.stringify(sizes)}`)

    await actor.query('set role authenticated')
    await actor.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: ids.user, workspace_id: ids.workspace }),
    ])
    const rangeQuery = {
      filters: [
        {
          fieldId: field(primaryFields, 'titre'),
          operator: 'gte',
          value: 900_000_000,
        },
      ],
      sort: { fieldId: field(primaryFields, 'observed_on'), direction: 'desc' },
    }
    const first = await rpc(actor, 'range_date_window_coldish', rangeQuery, 0)
    assert(first.result.totalCount === 10_000, 'numeric range total')
    assert(
      (first.result.rows as unknown[]).length === 200 &&
        first.result.hasMore === true,
      'first window semantics',
    )
    for (let run = 1; run <= 2; run++)
      await rpc(actor, `range_date_window_warm_${run}`, rangeQuery, 0)

    const qcQuery = {
      filters: [
        {
          fieldId: field(primaryFields, 'qc_state'),
          operator: 'eq',
          value: categoryOptions[0].id,
        },
      ],
    }
    const qc = await rpc(actor, 'qc_filter', qcQuery, 0)
    assert(qc.result.totalCount === 20_000, 'QC/category total')
    const later = await rpc(actor, 'later_page', rangeQuery, 5_000)
    assert(
      later.result.totalCount === 10_000 && later.result.hasMore === true,
      'later page total/hasMore',
    )
    const final = await rpc(actor, 'final_page', rangeQuery, 9_800)
    assert(
      final.result.totalCount === 10_000 && final.result.hasMore === false,
      'final page semantics',
    )

    const projectionFields = primaryFields.slice(0, 12).map((item) => item.id)
    const projectionSql = `
      with selected as materialized (
        select r.id,sort.date_value
        from api.dataset_rows r
        join api.dataset_row_values filter on filter.row_id=r.id and filter.field_id=$2 and filter.numeric_value>=900000000
        join api.dataset_row_values sort on sort.row_id=r.id and sort.field_id=$3
        where r.dataset_id=$1 order by sort.date_value desc,r.id limit 200
      )
      select s.id,jsonb_object_agg(v.field_id,v.value order by v.field_id) values
      from selected s join lateral (
        select field_id,coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),
          to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),
          to_jsonb(category_option_id),to_jsonb(reference_id)) value
        from api.dataset_row_values where row_id=s.id and field_id=any($4::uuid[])
      ) v on true group by s.id,s.date_value order by s.date_value desc,s.id`
    const projectedAt = process.hrtime.bigint()
    const projected = await admin.query(projectionSql, [
      ids.primaryDataset,
      field(primaryFields, 'titre'),
      field(primaryFields, 'observed_on'),
      projectionFields,
    ])
    const projectionMs = elapsed(projectedAt)
    assert(projected.rowCount === 200, 'projection row count')
    assert(
      projected.rows.every((row) => Object.keys(row.values).length === 12),
      '12-field projection width',
    )
    assert(projectionMs <= limits.planMs, 'projection threshold')
    console.log(
      `projection_12_fields_ms=${projectionMs.toFixed(1)} rows=200 fields_per_row=12`,
    )
    await explain(admin, 'projection_12_fields', projectionSql, [
      ids.primaryDataset,
      field(primaryFields, 'titre'),
      field(primaryFields, 'observed_on'),
      projectionFields,
    ])

    const compositionSql = `
      select count(*)::integer matches,count(distinct p.reference_id)::integer samples
      from api.dataset_row_values p
      join api.dataset_row_values s on s.field_id=$2 and s.reference_id=p.reference_id
      where p.field_id=$1`
    const compositionAt = process.hrtime.bigint()
    const composition = (
      await admin.query(compositionSql, [
        field(primaryFields, 'sample'),
        field(secondaryFields, 'sample'),
      ])
    ).rows[0]
    const compositionMs = elapsed(compositionAt)
    assert(
      composition.matches === 80_000 && composition.samples === 80_000,
      'stable Sample composition cardinality',
    )
    assert(compositionMs <= limits.planMs, 'composition threshold')
    console.log(
      `composition_join_ms=${compositionMs.toFixed(1)} matches=80000 distinct_samples=80000`,
    )
    await explain(admin, 'composition_join', compositionSql, [
      field(primaryFields, 'sample'),
      field(secondaryFields, 'sample'),
    ])

    const aggregateSql = `
      select count(*)::integer count,min(n.numeric_value)::numeric min,
        max(n.numeric_value)::numeric max,avg(n.numeric_value)::numeric average
      from api.dataset_row_values n join api.dataset_row_values q on q.row_id=n.row_id
      where n.field_id=$1 and q.field_id=$2 and q.category_option_id=$3`
    const aggregateAt = process.hrtime.bigint()
    const aggregate = (
      await admin.query(aggregateSql, [
        field(primaryFields, 'titre'),
        field(primaryFields, 'qc_state'),
        categoryOptions[0].id,
      ])
    ).rows[0]
    const aggregateMs = elapsed(aggregateAt)
    assert(
      aggregate.count === 20_000 &&
        aggregate.min === '0' &&
        aggregate.max === '995000000' &&
        Number(aggregate.average) === 497_500_000,
      'numeric aggregate values',
    )
    assert(aggregateMs <= limits.planMs, 'aggregate threshold')
    console.log(
      `numeric_aggregate_ms=${aggregateMs.toFixed(1)} result=${JSON.stringify(aggregate)}`,
    )
    await explain(admin, 'numeric_aggregate', aggregateSql, [
      field(primaryFields, 'titre'),
      field(primaryFields, 'qc_state'),
      categoryOptions[0].id,
    ])

    const createBatch = Array.from({ length: 1_000 }, (_, index) => ({
      operation: 'create',
      rowId: `02640000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      values: {
        [field(primaryFields, 'sample')]:
          `02610000-0000-4000-8000-${String(90_001 + index).padStart(12, '0')}`,
        [field(primaryFields, 'titre')]: 500_000_000 + index,
        [field(primaryFields, 'observed_on')]: '2026-08-14',
        [field(primaryFields, 'qc_state')]: categoryOptions[0].id,
      },
    }))
    const validateCreateAt = process.hrtime.bigint()
    const validateCreate = (
      await actor.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [ids.primaryDataset, JSON.stringify(createBatch)],
      )
    ).rows[0].result
    const validateCreateMs = elapsed(validateCreateAt)
    assert(
      validateCreate.ok === true && validateCreate.errors.length === 0,
      'bulk create validation',
    )
    assert(
      validateCreateMs <= limits.bulkValidateMs,
      'bulk create validation threshold',
    )
    const commitCreateAt = process.hrtime.bigint()
    const commitCreate = (
      await actor.query(
        `select api.commit_dataset_row_batch($1,1,$2::jsonb,'core-026-create-1000') result`,
        [ids.primaryDataset, JSON.stringify(createBatch)],
      )
    ).rows[0].result
    const commitCreateMs = elapsed(commitCreateAt)
    assert(
      commitCreate.ok === true &&
        commitCreate.datasetRevision === 2 &&
        commitCreate.rows.length === 1_000,
      'bulk create commit',
    )
    assert(
      commitCreateMs <= limits.bulkCommitMs,
      'bulk create commit threshold',
    )
    const retryAt = process.hrtime.bigint()
    const retry = (
      await actor.query(
        `select api.commit_dataset_row_batch($1,1,$2::jsonb,'core-026-create-1000') result`,
        [ids.primaryDataset, JSON.stringify(createBatch)],
      )
    ).rows[0].result
    const retryMs = elapsed(retryAt)
    assert(
      retry.idempotent === true && retry.datasetRevision === 2,
      'bulk create idempotent retry',
    )

    const updateBatch = createBatch.map((item, index) => ({
      operation: 'update',
      rowId: item.rowId,
      expectedRevision: 1,
      values: { [field(primaryFields, 'titre')]: 600_000_000 + index },
    }))
    const validateUpdateAt = process.hrtime.bigint()
    const validateUpdate = (
      await actor.query(
        `select api.validate_dataset_row_batch($1,2,$2::jsonb) result`,
        [ids.primaryDataset, JSON.stringify(updateBatch)],
      )
    ).rows[0].result
    const validateUpdateMs = elapsed(validateUpdateAt)
    assert(
      validateUpdate.ok === true && validateUpdate.errors.length === 0,
      'bulk update validation',
    )
    assert(
      validateUpdateMs <= limits.bulkValidateMs,
      'bulk update validation threshold',
    )
    const commitUpdateAt = process.hrtime.bigint()
    const commitUpdate = (
      await actor.query(
        `select api.commit_dataset_row_batch($1,2,$2::jsonb,'core-026-update-1000') result`,
        [ids.primaryDataset, JSON.stringify(updateBatch)],
      )
    ).rows[0].result
    const commitUpdateMs = elapsed(commitUpdateAt)
    assert(
      commitUpdate.ok === true &&
        commitUpdate.datasetRevision === 3 &&
        commitUpdate.rows.every(
          (row: { revision: number }) => row.revision === 2,
        ),
      'bulk update revisions',
    )
    assert(
      commitUpdateMs <= limits.bulkCommitMs,
      'bulk update commit threshold',
    )
    const retryUpdateAt = process.hrtime.bigint()
    const retryUpdate = (
      await actor.query(
        `select api.commit_dataset_row_batch($1,2,$2::jsonb,'core-026-update-1000') result`,
        [ids.primaryDataset, JSON.stringify(updateBatch)],
      )
    ).rows[0].result
    const retryUpdateMs = elapsed(retryUpdateAt)
    assert(
      retryUpdate.idempotent === true && retryUpdate.datasetRevision === 3,
      'bulk update idempotent retry',
    )
    const persisted = (
      await admin.query(
        `select count(*)::integer rows,min(revision)::integer min_revision,max(revision)::integer max_revision,
          min(v.numeric_value)::numeric min_value,max(v.numeric_value)::numeric max_value
         from api.dataset_rows r join api.dataset_row_values v on v.row_id=r.id and v.field_id=$2
         where r.id::text like '02640000-%' and r.dataset_id=$1`,
        [ids.primaryDataset, field(primaryFields, 'titre')],
      )
    ).rows[0]
    assert(
      persisted.rows === 1_000 &&
        persisted.min_revision === 2 &&
        persisted.max_revision === 2 &&
        persisted.min_value === '600000000' &&
        persisted.max_value === '600000999',
      'bulk update persisted values/revisions',
    )
    console.log(
      `bulk_create_1000 validate_ms=${validateCreateMs.toFixed(1)} commit_ms=${commitCreateMs.toFixed(1)} retry_ms=${retryMs.toFixed(1)} revision=2 idempotent=true`,
    )
    console.log(
      `bulk_update_1000 validate_ms=${validateUpdateMs.toFixed(1)} commit_ms=${commitUpdateMs.toFixed(1)} retry_ms=${retryUpdateMs.toFixed(1)} revision=3 row_revisions=2 idempotent=true`,
    )
    console.log('benchmark_status=PASS')
  } finally {
    try {
      if (fixtureCreated) await cleanup(admin)
    } finally {
      await actor.end()
      await admin.end()
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
