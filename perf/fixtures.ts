/**
 * PLAT-05 — deterministic performance fixtures.
 *
 * Creates a fixed-ID benchmark workspace with:
 *   - canonical Records (samples) for reference targets and search;
 *   - Dataset Schemas in three shapes (narrow / medium / wide);
 *   - Datasets at 1k / 10k / 50k / 100k rows on the medium schema, plus
 *     narrow@50k and wide@10k;
 *   - Dataset Versions seeded directly (set-based) so version reads and
 *     Pipeline inputs do not pay the snapshot cost in every harness run;
 *   - one published Pipeline Definition (with an input Dataset Version) and
 *     an optional schedule population for scheduler-scale runs.
 *
 * Fixture setup is privileged local SQL (like the CORE-02.6 benchmark).
 * Product-facing measurements always go through canonical RPCs.
 *
 * Run: `pnpm perf:seed` (all sizes) or `pnpm perf:seed --sizes 1k,10k`.
 */
import type { Client } from 'pg'

import { adminClient, assertPerfEnvironment, elapsed } from './lib/common'

export const FIXTURE = {
  workspace: '0f050000-0000-4000-8000-000000000001',
  user: 'plat-05-bench-user',
  recordsPrefix: '0f051000-0000-4000-8000-',
  recordCount: 20_000,
  schemas: {
    mediumDef: '0f050000-0000-4000-8000-000000000010',
    mediumVersion: '0f050000-0000-4000-8000-000000000011',
    narrowDef: '0f050000-0000-4000-8000-000000000012',
    narrowVersion: '0f050000-0000-4000-8000-000000000013',
    wideDef: '0f050000-0000-4000-8000-000000000014',
    wideVersion: '0f050000-0000-4000-8000-000000000015',
  },
  fieldPrefix: {
    medium: '0f05a100-0000-4000-8000-',
    narrow: '0f05a200-0000-4000-8000-',
    wide: '0f05a300-0000-4000-8000-',
  },
  datasets: {
    medium1k: '0f050000-0000-4000-8000-000000000100',
    medium10k: '0f050000-0000-4000-8000-000000000101',
    medium50k: '0f050000-0000-4000-8000-000000000102',
    medium100k: '0f050000-0000-4000-8000-000000000103',
    narrow50k: '0f050000-0000-4000-8000-000000000104',
    wide10k: '0f050000-0000-4000-8000-000000000105',
  },
  versions: {
    medium1k: '0f050000-0000-4000-8000-000000000200',
    medium10k: '0f050000-0000-4000-8000-000000000201',
    medium50k: '0f050000-0000-4000-8000-000000000202',
    medium100k: '0f050000-0000-4000-8000-000000000203',
    narrow50k: '0f050000-0000-4000-8000-000000000204',
    wide10k: '0f050000-0000-4000-8000-000000000205',
  },
  pipeline: {
    definition: '0f050000-0000-4000-8000-000000000300',
    version: '0f050000-0000-4000-8000-000000000301',
    schedulePrefix: '0f050000-0000-4000-8000-0000',
  },
} as const

const SCHEMA_KEYS = {
  medium: 'plat_05_medium',
  narrow: 'plat_05_narrow',
  wide: 'plat_05_wide',
} as const

export type SchemaShape = 'narrow' | 'medium' | 'wide'

export interface BenchField {
  id: string
  key: string
  label: string
  logicalType: string
  cardinality?: 'one' | 'many'
  relationship?: unknown
}

const fid = (prefix: string, ordinal: number) =>
  `${prefix}${String(ordinal).padStart(12, '0')}`

/** Reference fields must declare model relationship metadata to publish. */
const REFERENCE_FIELD = {
  target: { kind: 'model', modelKey: 'sample' },
  cardinality: 'one',
}

const CATEGORY_OPTIONS = Array.from({ length: 5 }, (_, index) => ({
  id: `0f05c000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
  key: `qc_${index}`,
  label: `QC ${index}`,
  lifecycle: 'active',
}))

function mediumFields(): BenchField[] {
  return [
    {
      id: fid(FIXTURE.fieldPrefix.medium, 1),
      key: 'sample',
      label: 'Sample',
      logicalType: 'reference',
      relationship: REFERENCE_FIELD,
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 2),
      key: 'titre',
      label: 'Titre',
      logicalType: 'decimal',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 3),
      key: 'observed_on',
      label: 'Observed on',
      logicalType: 'date',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 4),
      key: 'qc_state',
      label: 'QC state',
      logicalType: 'category',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 5),
      key: 'sample_code',
      label: 'Sample code',
      logicalType: 'text',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 6),
      key: 'batch',
      label: 'Batch',
      logicalType: 'text',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 7),
      key: 'temperature',
      label: 'Temperature',
      logicalType: 'decimal',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 8),
      key: 'volume',
      label: 'Volume',
      logicalType: 'decimal',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 9),
      key: 'captured_at',
      label: 'Captured at',
      logicalType: 'timestamp',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 10),
      key: 'replicate',
      label: 'Replicate',
      logicalType: 'integer',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 11),
      key: 'accepted',
      label: 'Accepted',
      logicalType: 'boolean',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 12),
      key: 'notes',
      label: 'Notes',
      logicalType: 'text',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 13),
      key: 'concentration',
      label: 'Concentration',
      logicalType: 'decimal',
    },
    {
      id: fid(FIXTURE.fieldPrefix.medium, 14),
      key: 'tags',
      label: 'Tags',
      logicalType: 'text',
      cardinality: 'many',
    },
  ]
}

function narrowFields(): BenchField[] {
  return [
    {
      id: fid(FIXTURE.fieldPrefix.narrow, 1),
      key: 'sample',
      label: 'Sample',
      logicalType: 'reference',
      relationship: REFERENCE_FIELD,
    },
    {
      id: fid(FIXTURE.fieldPrefix.narrow, 2),
      key: 'titre',
      label: 'Titre',
      logicalType: 'decimal',
    },
    {
      id: fid(FIXTURE.fieldPrefix.narrow, 3),
      key: 'observed_on',
      label: 'Observed on',
      logicalType: 'date',
    },
    {
      id: fid(FIXTURE.fieldPrefix.narrow, 4),
      key: 'batch',
      label: 'Batch',
      logicalType: 'text',
    },
    {
      id: fid(FIXTURE.fieldPrefix.narrow, 5),
      key: 'replicate',
      label: 'Replicate',
      logicalType: 'integer',
    },
  ]
}

const WIDE_TYPES: Array<BenchField['logicalType']> = [
  'text',
  'decimal',
  'integer',
  'date',
  'boolean',
  'timestamp',
  'text',
  'decimal',
  'text',
  'decimal',
  'integer',
  'text',
  'boolean',
  'timestamp',
  'decimal',
  'text',
  'decimal',
  'integer',
  'text',
  'date',
  'boolean',
  'decimal',
  'text',
  'timestamp',
  'integer',
  'text',
  'decimal',
  'date',
  'text',
  'boolean',
  'decimal',
  'text',
  'integer',
  'timestamp',
  'text',
  'decimal',
  'boolean',
  'text',
  'decimal',
  'date',
  'text',
  'integer',
  'decimal',
  'text',
  'timestamp',
  'boolean',
  'text',
  'decimal',
  'integer',
  'text',
  'date',
  'decimal',
  'text',
  'boolean',
  'timestamp',
  'integer',
  'text',
  'decimal',
  'text',
]

function wideFields(): BenchField[] {
  const fields: BenchField[] = [
    {
      id: fid(FIXTURE.fieldPrefix.wide, 1),
      key: 'sample',
      label: 'Sample',
      logicalType: 'reference',
      relationship: REFERENCE_FIELD,
    },
  ]
  WIDE_TYPES.forEach((logicalType, index) => {
    const ordinal = index + 2
    fields.push({
      id: fid(FIXTURE.fieldPrefix.wide, ordinal),
      key: `wide_field_${String(ordinal).padStart(2, '0')}`,
      label: `Wide field ${ordinal}`,
      logicalType,
    })
  })
  return fields
}

export function fieldsFor(shape: SchemaShape): BenchField[] {
  if (shape === 'narrow') return narrowFields()
  if (shape === 'medium') return mediumFields()
  return wideFields()
}

function valueColumn(logicalType: string): string {
  switch (logicalType) {
    case 'text':
      return 'text_value'
    case 'integer':
      return 'integer_value'
    case 'decimal':
      return 'numeric_value'
    case 'boolean':
      return 'boolean_value'
    case 'date':
      return 'date_value'
    case 'timestamp':
      return 'timestamp_value'
    case 'category':
      return 'category_option_id'
    case 'reference':
      return 'reference_id'
    default:
      return 'text_value'
  }
}

/** Deterministic per-(row-index, ordinal) value expression for the typed column. */
function valueExpr(
  field: BenchField,
  ordinal: number,
  recordCap: number,
): string {
  const i = 'i'
  switch (field.logicalType) {
    case 'reference':
      return `('${FIXTURE.recordsPrefix}'||lpad(((${i} % ${recordCap}) + 1)::text,12,'0'))::uuid`
    case 'decimal':
      return `((${i} % 1000) * 1000000 + ${ordinal} * 1000)::numeric`
    case 'integer':
      return `${1 + (ordinal % 5)} + ${i} % 3`
    case 'boolean':
      return `(${i} + ${ordinal}) % 5 <> 4`
    case 'date':
      return `date '2024-01-01' + ((${i} + ${ordinal} * 3) % 365)`
    case 'timestamp':
      return `timestamptz '2024-01-01 00:00:00+00' + make_interval(secs => (${i} + ${ordinal} * 7) % 31536000)`
    case 'category':
      return `('${CATEGORY_OPTIONS[0].id}'::uuid)` // fixed option 0 for stable selectivity
    case 'text':
    default:
      return `'W-'||lpad(${i}::text,8,'0')||'-'||${ordinal}`
  }
}

export async function seedSchema(
  admin: Client,
  shape: SchemaShape,
): Promise<void> {
  const schemaIds: Record<SchemaShape, { def: string; version: string }> = {
    narrow: {
      def: FIXTURE.schemas.narrowDef,
      version: FIXTURE.schemas.narrowVersion,
    },
    medium: {
      def: FIXTURE.schemas.mediumDef,
      version: FIXTURE.schemas.mediumVersion,
    },
    wide: {
      def: FIXTURE.schemas.wideDef,
      version: FIXTURE.schemas.wideVersion,
    },
  }
  const defId = schemaIds[shape].def
  const versionId = schemaIds[shape].version
  const key = SCHEMA_KEYS[shape]
  const fields = fieldsFor(shape)
  await admin.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,created_by_user_id)
     values($1,$2,$3,$4,$5)`,
    [defId, FIXTURE.workspace, key, `PLAT-05 ${shape} schema`, FIXTURE.user],
  )
  await admin.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,created_by_user_id)
     values($1,$2,1,'draft',$3)`,
    [versionId, defId, FIXTURE.user],
  )
  await admin.query(
    `insert into api.dataset_schema_version_fields(
       schema_version_id,field_id,key,label,logical_type,category,relationship,cardinality,display_order
     )
     select $1,(item->>'id')::uuid,item->>'key',item->>'label',item->>'logicalType',
       case when item->>'logicalType'='category' then $3::jsonb else null end,
       nullif(item->'relationship','null'::jsonb),
       coalesce(item->>'cardinality','one'),ordinality::integer
     from jsonb_array_elements($2::jsonb) with ordinality source(item,ordinality)`,
    [
      versionId,
      JSON.stringify(fields),
      JSON.stringify({
        kind: 'embedded',
        options: CATEGORY_OPTIONS,
      }),
    ],
  )
  await admin.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [versionId],
  )
}

export interface DatasetFixture {
  id: string
  versionId: string
  shape: SchemaShape
  rows: number
  schemaVersionId: string
  rowPrefix: string
}

export function datasetFixtures(): DatasetFixture[] {
  const versions = FIXTURE.versions
  const schemas = FIXTURE.schemas
  return [
    {
      id: FIXTURE.datasets.medium1k,
      versionId: versions.medium1k,
      shape: 'medium',
      rows: 1_000,
      schemaVersionId: schemas.mediumVersion,
      rowPrefix: '0f05b000-0000-4000-8000-',
    },
    {
      id: FIXTURE.datasets.medium10k,
      versionId: versions.medium10k,
      shape: 'medium',
      rows: 10_000,
      schemaVersionId: schemas.mediumVersion,
      rowPrefix: '0f05b001-0000-4000-8000-',
    },
    {
      id: FIXTURE.datasets.medium50k,
      versionId: versions.medium50k,
      shape: 'medium',
      rows: 50_000,
      schemaVersionId: schemas.mediumVersion,
      rowPrefix: '0f05b002-0000-4000-8000-',
    },
    {
      id: FIXTURE.datasets.medium100k,
      versionId: versions.medium100k,
      shape: 'medium',
      rows: 100_000,
      schemaVersionId: schemas.mediumVersion,
      rowPrefix: '0f05b003-0000-4000-8000-',
    },
    {
      id: FIXTURE.datasets.narrow50k,
      versionId: versions.narrow50k,
      shape: 'narrow',
      rows: 50_000,
      schemaVersionId: schemas.narrowVersion,
      rowPrefix: '0f05b100-0000-4000-8000-',
    },
    {
      id: FIXTURE.datasets.wide10k,
      versionId: versions.wide10k,
      shape: 'wide',
      rows: 10_000,
      schemaVersionId: schemas.wideVersion,
      rowPrefix: '0f05b200-0000-4000-8000-',
    },
  ]
}

async function seedRecords(admin: Client): Promise<void> {
  await admin.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
     select ('${FIXTURE.recordsPrefix}'||lpad(i::text,12,'0'))::uuid,$1,
       'sample','PLAT-S-'||lpad(i::text,8,'0'),'Plat sample '||i,$2
     from generate_series(1,$3::integer) i`,
    [FIXTURE.workspace, FIXTURE.user, FIXTURE.recordCount],
  )
}

async function seedDataset(
  admin: Client,
  fixture: DatasetFixture,
): Promise<void> {
  const fields = fieldsFor(fixture.shape)
  const { id: datasetId } = fixture
  await admin.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,created_by_user_id)
     values($1,$2,$3,$4,$5)`,
    [
      datasetId,
      FIXTURE.workspace,
      fixture.schemaVersionId,
      `PLAT-05 ${fixture.shape} ${fixture.rows}`,
      FIXTURE.user,
    ],
  )
  await admin.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id)
     select ($1||lpad(i::text,12,'0'))::uuid,$2,$3
     from generate_series(1,$4::integer) i`,
    [fixture.rowPrefix, datasetId, FIXTURE.workspace, fixture.rows],
  )
  // One INSERT with per-typed-column CASE expressions, keyed by display order.
  const ordinalExpr = (matching: Array<[number, string]>) => {
    if (matching.length === 0) return 'NULL'
    return `CASE f.display_order ${matching
      .map(([ord, expr]) => `WHEN ${ord} THEN ${expr}`)
      .join(' ')} END`
  }
  const text = [] as Array<[number, string]>
  const integer = [] as Array<[number, string]>
  const numeric = [] as Array<[number, string]>
  const boolean = [] as Array<[number, string]>
  const date = [] as Array<[number, string]>
  const timestamp = [] as Array<[number, string]>
  const category = [] as Array<[number, string]>
  const reference = [] as Array<[number, string]>
  const recordCap = FIXTURE.recordCount
  fields.forEach((field, index) => {
    const ordinal = index + 1
    const expr = valueExpr(field, ordinal, recordCap)
    const bucket =
      field.logicalType === 'text'
        ? text
        : field.logicalType === 'integer'
          ? integer
          : field.logicalType === 'decimal'
            ? numeric
            : field.logicalType === 'boolean'
              ? boolean
              : field.logicalType === 'date'
                ? date
                : field.logicalType === 'timestamp'
                  ? timestamp
                  : field.logicalType === 'category'
                    ? category
                    : reference
    bucket.push([ordinal, expr])
  })
  const sql = `
    insert into api.dataset_row_values(
      row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,
      date_value,timestamp_value,category_option_id,reference_id
    )
    select r.id,f.field_id,0,
      ${ordinalExpr(text)},
      ${ordinalExpr(integer)},
      ${ordinalExpr(numeric)},
      ${ordinalExpr(boolean)},
      ${ordinalExpr(date)},
      ${ordinalExpr(timestamp)},
      ${ordinalExpr(category)},
      ${ordinalExpr(reference)}
    from api.dataset_rows r
    cross join lateral (select substring(r.id::text,25,12)::integer i) n
    cross join api.dataset_schema_version_fields f
    where r.dataset_id = $1 and f.schema_version_id = $2 and f.lifecycle = 'active'
      and f.cardinality = 'one'`
  await admin.query(sql, [datasetId, fixture.schemaVersionId])
  // Single-value rows for `many` fields (v1 pipelines expose the first value).
  const manyFields = fields.filter((f) => f.cardinality === 'many')
  if (manyFields.length > 0) {
    const many = manyFields.map((f) => {
      const col = valueColumn(f.logicalType)
      return `('${f.id}'::uuid, '${f.key}', '${col}')`
    })
    await admin.query(
      `insert into api.dataset_row_values(row_id,field_id,ordinal,text_value)
       select r.id,f.field_id,0,
         'W-'||lpad(substring(r.id::text,25,12)::integer::text,8,'0')
       from api.dataset_rows r
       cross join (values ${many.join(',')}) f(field_id,key,col)
       where r.dataset_id = $1`,
      [datasetId],
    )
  }
}

/** Direct, set-based seeding of a Dataset Version (mirrors snapshot shape). */
async function seedVersion(
  admin: Client,
  fixture: DatasetFixture,
): Promise<void> {
  const { id: datasetId, versionId } = fixture
  await admin.query(
    `insert into api.dataset_versions(
       id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id
     )
     select $1,d.id,d.workspace_id,d.schema_version_id,d.revision,$2,$3
     from api.datasets d where d.id = $4`,
    [versionId, `PLAT-05 ${fixture.shape} version`, FIXTURE.user, datasetId],
  )
  await admin.query(
    `insert into api.dataset_version_rows(dataset_version_id,row_id,revision)
     select $1,id,revision from api.dataset_rows where dataset_id = $2`,
    [versionId, datasetId],
  )
  await admin.query(
    `insert into api.dataset_version_values(
       dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,
       boolean_value,date_value,timestamp_value,category_option_id,reference_id
     )
     select $1,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,
       v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
     from api.dataset_row_values v
     join api.dataset_rows r on r.id = v.row_id
     where r.dataset_id = $2`,
    [versionId, datasetId],
  )
}

async function seedPipeline(admin: Client): Promise<void> {
  // Definition + published version with a single 'measurements' input.
  await admin.query(
    `insert into api.pipeline_definitions(
       id,workspace_id,key,name,lifecycle,created_by_user_id
     ) values ($1,$2,$3,$4,'active',$5)`,
    [
      FIXTURE.pipeline.definition,
      FIXTURE.workspace,
      'plat_05_bench',
      'PLAT-05 bench',
      FIXTURE.user,
    ],
  )
  const configuration = {
    configVersion: 1,
    description: 'PLAT-05 benchmark transform',
    parameters: [
      { name: 'factor', type: 'decimal', required: false, default: 1 },
    ],
    inputs: [{ name: 'measurements', required: true }],
    transform: {
      language: 'sql',
      statement:
        'SELECT titre, titre * {{factor}} AS scaled, batch, sample_code, replicate FROM measurements',
    },
    output: {
      mode: 'create',
      schemaVersionId: FIXTURE.schemas.mediumVersion,
      datasetName: 'PLAT-05 pipeline output',
      datasetLabel: 'plat-05 output',
      fieldMapping: { scaled: 'concentration' },
    },
  }
  await admin.query(
    `insert into api.pipeline_definition_versions(
       id,definition_id,workspace_id,version,lifecycle,configuration,created_by_user_id
     ) values ($1,$2,$3,1,'published',$4,$5)`,
    [
      FIXTURE.pipeline.version,
      FIXTURE.pipeline.definition,
      FIXTURE.workspace,
      JSON.stringify(configuration),
      FIXTURE.user,
    ],
  )
}

export interface SchedulePopulation {
  count: number
  scheduleIds: string[]
  eventScheduleIds: string[]
}

/** Seed N interval schedules (not yet due) plus a few event schedules. */
export async function seedSchedules(
  admin: Client,
  count: number,
  eventCount = 3,
): Promise<SchedulePopulation> {
  const spec = { intervalMinutes: 60 }
  const eventSpec = {
    eventType: 'dataset_version_created',
    inputName: 'measurements',
    parameters: { factor: 1 },
  }
  const scheduleIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `${FIXTURE.pipeline.schedulePrefix}${String(index + 1).padStart(8, '0')}`
    scheduleIds.push(id)
    await admin.query(
      `insert into api.pipeline_schedules(
         id,workspace_id,definition_id,kind,spec,enabled,next_run_at,created_by_user_id
       ) values ($1,$2,$3,'interval',$4::jsonb,true,now() + interval '2 hours',$5)`,
      [
        id,
        FIXTURE.workspace,
        FIXTURE.pipeline.definition,
        JSON.stringify(spec),
        FIXTURE.user,
      ],
    )
  }
  const eventScheduleIds: string[] = []
  for (let index = 0; index < eventCount; index += 1) {
    const id = `${FIXTURE.pipeline.schedulePrefix}${String(count + index + 1).padStart(8, '0')}`
    eventScheduleIds.push(id)
    await admin.query(
      `insert into api.pipeline_schedules(
         id,workspace_id,definition_id,kind,spec,enabled,created_by_user_id
       ) values ($1,$2,$3,'event',$4::jsonb,true,$5)`,
      [
        id,
        FIXTURE.workspace,
        FIXTURE.pipeline.definition,
        JSON.stringify(eventSpec),
        FIXTURE.user,
      ],
    )
  }
  return { count, scheduleIds, eventScheduleIds }
}

export async function cleanup(admin: Client): Promise<void> {
  await admin.query(
    `delete from api.pipeline_trigger_failures where workspace_id=$1`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `delete from api.pipeline_schedules where workspace_id=$1`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `delete from api.pipeline_run_outputs where workspace_id=$1`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `delete from api.pipeline_run_logs
     where run_id in (select id from api.pipeline_runs where workspace_id=$1)`,
    [FIXTURE.workspace],
  )
  await admin.query(`delete from api.pipeline_runs where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  await admin.query(
    `delete from api.pipeline_definition_versions where definition_id=$1`,
    [FIXTURE.pipeline.definition],
  )
  await admin.query(
    `delete from api.pipeline_definitions where workspace_id=$1`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `delete from api.dataset_bulk_commits where workspace_id=$1`,
    [FIXTURE.workspace],
  )
  const versionIds = Object.values(FIXTURE.versions)
  // Immutable version tables require the mutation triggers disabled for
  // privileged cleanup of disposable benchmark objects (migrator owns the
  // tables, so trigger disable is authoritative).
  await admin.query(
    `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
  )
  await admin.query(
    `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
  )
  await admin.query(
    `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
  )
  try {
    // Leftover snapshot/benchmark versions may exist; clear children for EVERY
    // workspace version before any version row is deleted (the RI constraint
    // triggers stay enabled and reject a parent delete with live children).
    await admin.query(
      `delete from api.dataset_version_values
        where dataset_version_id in (select id from api.dataset_versions where workspace_id=$1)`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `delete from api.dataset_version_rows
        where dataset_version_id in (select id from api.dataset_versions where workspace_id=$1)`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `delete from api.dataset_version_values where dataset_version_id = any($1::uuid[])`,
      [versionIds],
    )
    await admin.query(
      `delete from api.dataset_version_rows where dataset_version_id = any($1::uuid[])`,
      [versionIds],
    )
    await admin.query(
      `delete from api.dataset_versions where workspace_id=$1`,
      [FIXTURE.workspace],
    )
  } finally {
    await admin.query(
      `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
    )
    await admin.query(
      `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
    )
    await admin.query(
      `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
    )
  }
  const datasetIds = Object.values(FIXTURE.datasets)
  await admin.query(
    `delete from api.dataset_rows where dataset_id = any($1::uuid[])`,
    [datasetIds],
  )
  await admin.query(`delete from api.datasets where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  await admin.query(`begin`)
  try {
    await admin.query(
      `alter table api.dataset_schema_versions disable trigger prevent_published_dataset_schema_version_mutation`,
    )
    await admin.query(
      `alter table api.dataset_schema_version_fields disable trigger prevent_published_dataset_schema_field_mutation`,
    )
    await admin.query(
      `delete from api.dataset_schema_version_fields where schema_version_id = any($1::uuid[])`,
      [
        [
          FIXTURE.schemas.mediumVersion,
          FIXTURE.schemas.narrowVersion,
          FIXTURE.schemas.wideVersion,
        ],
      ],
    )
    await admin.query(
      `delete from api.dataset_schema_versions where schema_id = any($1::uuid[])`,
      [
        [
          FIXTURE.schemas.mediumDef,
          FIXTURE.schemas.narrowDef,
          FIXTURE.schemas.wideDef,
        ],
      ],
    )
    await admin.query(
      `delete from api.dataset_schema_definitions where workspace_id=$1`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `alter table api.dataset_schema_version_fields enable trigger prevent_published_dataset_schema_field_mutation`,
    )
    await admin.query(
      `alter table api.dataset_schema_versions enable trigger prevent_published_dataset_schema_version_mutation`,
    )
    await admin.query(`commit`)
  } catch (error) {
    await admin.query(`rollback`)
    throw error
  }
  await admin.query(`delete from api.records where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  // Sheet artifacts guard deletes via user triggers; disable them for
  // privileged cleanup of disposable benchmark objects, like the dataset
  // version mutation triggers above.
  await admin.query(
    `alter table api.sheet_instances disable trigger guard_sheet_instance`,
  )
  await admin.query(
    `alter table api.sheet_definition_versions disable trigger guard_sheet_definition_version`,
  )
  await admin.query(
    `alter table api.sheet_definitions disable trigger guard_sheet_definition`,
  )
  try {
    await admin.query(`delete from api.sheet_instances where workspace_id=$1`, [
      FIXTURE.workspace,
    ])
    await admin.query(
      `delete from api.sheet_definition_versions
        where definition_id in (select id from api.sheet_definitions where workspace_id=$1)`,
      [FIXTURE.workspace],
    )
    await admin.query(`delete from api.sheet_definitions where workspace_id=$1`, [
      FIXTURE.workspace,
    ])
  } finally {
    await admin.query(
      `alter table api.sheet_definitions enable trigger guard_sheet_definition`,
    )
    await admin.query(
      `alter table api.sheet_definition_versions enable trigger guard_sheet_definition_version`,
    )
    await admin.query(
      `alter table api.sheet_instances enable trigger guard_sheet_instance`,
    )
  }
  await admin.query(`delete from api.projects where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  // The workspace, user and membership persist across runs (the seed is
  // idempotent); everything above is recreated from scratch each time.
}

async function main(): Promise<void> {
  const env = assertPerfEnvironment()
  const admin = await adminClient(env.migrationDatabaseUrl)
  try {
    const rawSizes = process.argv
      .find((arg) => arg.startsWith('--sizes='))
      ?.split('=')[1]
    const requested = rawSizes
      ? new Set(rawSizes.split(',').map((s) => s.trim()))
      : new Set(['1k', '10k', '50k', '100k'])
    await cleanup(admin)
    const startedAt = process.hrtime.bigint()
    await admin.query(
      `insert into internal."user"(id,name,email,"emailVerified")
       values($1,'PLAT-05 bench','plat-05@test.invalid',true)
       on conflict (id) do nothing`,
      [FIXTURE.user],
    )
    await admin.query(
      `insert into api.workspaces(id,slug,name) values($1,'plat-05-bench','PLAT-05 benchmark')
       on conflict (id) do nothing`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,'owner')
       on conflict do nothing`,
      [FIXTURE.workspace, FIXTURE.user],
    )
    await seedRecords(admin)
    await seedSchema(admin, 'narrow')
    await seedSchema(admin, 'medium')
    await seedSchema(admin, 'wide')
    for (const fixture of datasetFixtures()) {
      const label =
        fixture.rows >= 1000
          ? `${Math.round(fixture.rows / 1000)}k`
          : String(fixture.rows)
      if (!requested.has(label)) continue
      await seedDataset(admin, fixture)
      await seedVersion(admin, fixture)
      console.log(
        `seeded dataset=${fixture.shape} rows=${fixture.rows} values=${fixture.rows * fieldsFor(fixture.shape).length}`,
      )
    }
    await seedPipeline(admin)
    await admin.query(
      `analyze api.records; analyze api.dataset_rows; analyze api.dataset_row_values;
       analyze api.dataset_versions; analyze api.dataset_version_rows; analyze api.dataset_version_values;
       analyze api.pipeline_definitions; analyze api.pipeline_definition_versions`,
    )
    console.log(
      `fixture_seed_ms=${elapsed(startedAt).toFixed(1)} sizes=${[...requested].join(',')}`,
    )
    console.log('perf_seed_status=PASS')
  } finally {
    await admin.end()
  }
}

if (process.argv[1]?.endsWith('perf/fixtures.ts')) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
