import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '02000000-0000-4000-8000-000000000001'
const WS_B = '02000000-0000-4000-8000-000000000002'
const OWNER_A = 'dataset-owner-a'
const MEMBER_A = 'dataset-member-a'
const OWNER_B = 'dataset-owner-b'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let datasetId: string
let titreFieldId: string

async function createScalarFixture(owner: Client) {
  const key = `scalar_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'Scalar fixture') returning id`,
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
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,default_value,validation,display_order)
       values
       ($1,gen_random_uuid(),'text','Text','text',true,null,'{"minLength":3,"maxLength":5,"pattern":"^[A-Z]+$"}',1),
       ($1,gen_random_uuid(),'integer','Integer','integer',true,null,'{"min":2,"max":4}',2),
       ($1,gen_random_uuid(),'decimal','Decimal','decimal',true,null,'{}',3),
       ($1,gen_random_uuid(),'boolean','Boolean','boolean',true,null,'{}',4),
       ($1,gen_random_uuid(),'date','Date','date',true,null,'{}',5),
       ($1,gen_random_uuid(),'timestamp','Timestamp','timestamp',true,null,'{}',6),
       ($1,gen_random_uuid(),'required','Required','text',false,'"DEFAULT"'::jsonb,'{"pattern":"^[A-Z]+$"}',7),
       ($1,gen_random_uuid(),'required_no_default','Required no default','text',false,null,'{"pattern":"^[A-Z]+$"}',8),
       ($1,gen_random_uuid(),'nullable_default','Nullable default','text',true,'"OPTIONAL"'::jsonb,'{"pattern":"^[A-Z]+$"}',9)
       returning field_id,key`,
      [version.id],
    )
  ).rows
  await owner.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const dataset = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Scalar fixture') returning id`,
      [WS_A, version.id],
    )
  ).rows[0]
  return {
    datasetId: dataset.id as string,
    fields: Object.fromEntries(
      fields.map((field) => [field.key, field.field_id]),
    ) as Record<string, string>,
  }
}

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Owner A','dataset-owner-a@test.invalid',true),
      ('${MEMBER_A}','Member A','dataset-member-a@test.invalid',true),
      ('${OWNER_B}','Owner B','dataset-owner-b@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','dataset-a','Dataset A'),('${WS_B}','dataset-b','Dataset B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner'),('${WS_A}','${MEMBER_A}','member'),
      ('${WS_B}','${OWNER_B}','owner');
  `)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('canonical Dataset metadata', () => {
  it('rejects invalid draft FieldDefinition metadata when publishing while allowing a valid canonical field', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const create = async (key: string, fieldSql: string) => {
      const schema = (
        await owner.query(
          `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$2) returning id`,
          [WS_A, key],
        )
      ).rows[0]
      const version = (
        await owner.query(
          `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
          [schema.id],
        )
      ).rows[0]
      await owner.query(fieldSql, [version.id])
      return version.id as string
    }
    const valid = await create(
      'canonical_valid',
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,default_value,quantity,display_order) values($1,gen_random_uuid(),'count','Count','integer','2'::jsonb,'{"kind":"count","dimension":"count","storageUnit":"each"}'::jsonb,1)`,
    )
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [valid],
    )
    const invalidMany = await create(
      'canonical_invalid_many',
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,cardinality,default_value,display_order) values($1,gen_random_uuid(),'tags','Tags','text','many','"x"'::jsonb,1)`,
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
        [invalidMany],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    const invalidCategory = await create(
      'canonical_invalid_category',
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,category,display_order) values($1,gen_random_uuid(),'qc','QC','category','{"kind":"vocabulary","vocabularyId":"qc"}'::jsonb,1)`,
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
        [invalidCategory],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    const invalidRelationship = await create(
      'canonical_invalid_relationship',
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,relationship,display_order) values($1,gen_random_uuid(),'sample','Sample','reference','{"target":{"kind":"model","modelKey":"sample"},"cardinality":"many"}'::jsonb,1)`,
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
        [invalidRelationship],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    const invalidDefault = await create(
      'canonical_invalid_default',
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,default_value,validation,display_order) values($1,gen_random_uuid(),'count','Count','integer','1'::jsonb,'{"min":2}',1)`,
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
        [invalidDefault],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('rejects malformed validation and embedded option metadata at publication', async () => {
    const owner = await actor(OWNER_A, WS_A)
    for (const [key, logicalType, validation, category] of [
      ['bad_validation', 'text', '[]', null],
      ['bad_bounds', 'integer', '{"min":4,"max":2}', null],
      ['bad_pattern', 'text', '{"pattern":"["}', null],
      [
        'bad_option',
        'category',
        '{}',
        '{"kind":"embedded","options":[{"id":"not-a-uuid","key":"x","label":"X","lifecycle":"active"}]}',
      ],
    ]) {
      const schema = (
        await owner.query(
          `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$2) returning id`,
          [WS_A, `${key}_${crypto.randomUUID().slice(0, 8)}`],
        )
      ).rows[0]
      const version = (
        await owner.query(
          `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
          [schema.id],
        )
      ).rows[0]
      await owner.query(
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,validation,category,display_order) values($1,gen_random_uuid(),'field','Field',$2,$3::jsonb,$4::jsonb,1)`,
        [version.id, logicalType, validation, category],
      )
      await expect(
        owner.query(
          `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
          [version.id],
        ),
      ).rejects.toMatchObject({ code: 'SB071' })
    }
  })

  it('creates an independently addressable Dataset bound to an immutable schema version', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name,created_by_user_id)
         values($1,'assay_result','Assay result',$2) returning id`,
        [WS_A, OWNER_A],
      )
    ).rows[0]
    const version = (
      await owner.query(
        `insert into api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id)
         values($1,1,'draft',$2) returning id`,
        [schema.id, OWNER_A],
      )
    ).rows[0]
    const field = await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,display_order)
       values($1,gen_random_uuid(),'titre','Titre','decimal',1) returning field_id`,
      [version.id],
    )
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
      [version.id],
    )
    const dataset = await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       values($1,$2,'Stability results',$3) returning id,revision,lifecycle`,
      [WS_A, version.id, OWNER_A],
    )

    expect(dataset.rows[0]).toMatchObject({
      revision: '1',
      lifecycle: 'active',
    })
    datasetId = dataset.rows[0].id
    titreFieldId = field.rows[0].field_id
    expect(
      await owner.query(
        `select f.key from api.datasets d
         join api.dataset_schema_versions v on v.id=d.schema_version_id
         join api.dataset_schema_version_fields f on f.schema_version_id=v.id
         where d.id=$1`,
        [dataset.rows[0].id],
      ),
    ).toMatchObject({ rows: [{ key: 'titre' }] })
  })

  it('persists stable typed values and rejects mismatched storage types', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const row = await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS_A],
    )
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,numeric_value) values($1,$2,100000000)`,
      [row.rows[0].id, titreFieldId],
    )
    await expect(
      migrator.query(
        `insert into api.dataset_row_values(row_id,field_id,text_value) values($1,$2,'not numeric')`,
        [row.rows[0].id, titreFieldId],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('validates and atomically commits an idempotent typed row batch', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const firstRowId = '02000000-0000-4000-8000-000000000101'
    const secondRowId = '02000000-0000-4000-8000-000000000102'
    const batch = [
      {
        operation: 'create',
        rowId: firstRowId,
        values: { [titreFieldId]: 125000000 },
      },
      {
        operation: 'create',
        rowId: secondRowId,
        values: { [titreFieldId]: 135000000 },
      },
    ]

    const invalid = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
        [
          datasetId,
          1,
          JSON.stringify([
            batch[0],
            {
              ...batch[1],
              values: { [titreFieldId]: 'not a number' },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(invalid).toMatchObject({ ok: false })
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 2,
          rowId: secondRowId,
          fieldId: titreFieldId,
          code: 'invalid_value_type',
        }),
      ]),
    )
    expect(
      (
        await owner.query(
          `select * from api.dataset_rows where dataset_id=$1`,
          [datasetId],
        )
      ).rows,
    ).toHaveLength(1)

    const committed = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [datasetId, 1, JSON.stringify(batch), 'paste-001'],
      )
    ).rows[0].result
    expect(committed).toMatchObject({
      ok: true,
      datasetId,
      datasetRevision: 2,
      idempotent: false,
    })
    expect(committed.rows).toEqual([
      { rowId: firstRowId, revision: 1, operation: 'create' },
      { rowId: secondRowId, revision: 1, operation: 'create' },
    ])
    expect(
      (
        await owner.query(
          `select numeric_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
          [firstRowId, titreFieldId],
        )
      ).rows,
    ).toEqual([{ numeric_value: '125000000' }])

    const retried = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [datasetId, 1, JSON.stringify(batch), 'paste-001'],
      )
    ).rows[0].result
    expect(retried).toMatchObject({
      ok: true,
      datasetRevision: 2,
      idempotent: true,
    })
    await expect(
      owner.query(`select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)`, [
        datasetId,
        2,
        JSON.stringify(batch),
        'paste-001',
      ]),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('persists scalar types and applies required scalar defaults through controlled commits', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createScalarFixture(owner)
    const rowId = '02000000-0000-4000-8000-000000000157'
    const create = {
      operation: 'create',
      rowId,
      values: {
        [fixture.fields.text]: 'ABCD',
        [fixture.fields.integer]: 3,
        [fixture.fields.decimal]: 1.25,
        [fixture.fields.boolean]: true,
        [fixture.fields.date]: '2026-08-14',
        [fixture.fields.timestamp]: '2026-08-14T12:00:00Z',
        [fixture.fields.required_no_default]: 'REQUIRED',
      },
    }
    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'scalar-create')`,
      [fixture.datasetId, JSON.stringify([create])],
    )
    const read = (
      await owner.query(`select api.query_dataset_rows($1,'{}',10,0) result`, [
        fixture.datasetId,
      ])
    ).rows[0].result
    expect(read.rows[0].values).toMatchObject({
      [fixture.fields.text]: 'ABCD',
      [fixture.fields.integer]: 3,
      [fixture.fields.decimal]: 1.25,
      [fixture.fields.boolean]: true,
      [fixture.fields.date]: '2026-08-14',
      [fixture.fields.required]: 'DEFAULT',
      [fixture.fields.nullable_default]: 'OPTIONAL',
    })
    await owner.query(
      `select api.commit_dataset_row_batch($1,2,$2::jsonb,'scalar-null')`,
      [
        fixture.datasetId,
        JSON.stringify([
          {
            operation: 'update',
            rowId,
            expectedRevision: 1,
            values: { [fixture.fields.required]: null },
          },
        ]),
      ],
    )
    const afterNull = (
      await owner.query(
        `select text_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
        [rowId, fixture.fields.required],
      )
    ).rows
    expect(afterNull).toEqual([{ text_value: 'DEFAULT' }])
    await owner.query(
      `select api.commit_dataset_row_batch($1,3,$2::jsonb,'scalar-omit')`,
      [
        fixture.datasetId,
        JSON.stringify([
          {
            operation: 'update',
            rowId,
            expectedRevision: 2,
            values: { [fixture.fields.text]: 'ABCDE' },
          },
        ]),
      ],
    )
    expect(
      (
        await owner.query(
          `select text_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
          [rowId, fixture.fields.required],
        )
      ).rows,
    ).toEqual([{ text_value: 'DEFAULT' }])
    await owner.query(
      `select api.commit_dataset_row_batch($1,4,$2::jsonb,'scalar-nullable-null')`,
      [
        fixture.datasetId,
        JSON.stringify([
          {
            operation: 'update',
            rowId,
            expectedRevision: 3,
            values: { [fixture.fields.nullable_default]: null },
          },
        ]),
      ],
    )
    expect(
      (
        await owner.query(
          `select * from api.dataset_row_values where row_id=$1 and field_id=$2`,
          [rowId, fixture.fields.nullable_default],
        )
      ).rows,
    ).toEqual([])
  })

  it('returns structured scalar constraint and required errors', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await createScalarFixture(owner)
    const rowId = '02000000-0000-4000-8000-000000000158'
    const result = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [
          fixture.datasetId,
          JSON.stringify([
            {
              operation: 'create',
              rowId,
              values: {
                [fixture.fields.text]: 'ab',
                [fixture.fields.integer]: 9,
              },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 1,
          rowId,
          fieldId: fixture.fields.text,
          code: 'text_validation',
        }),
        expect.objectContaining({
          rowIndex: 1,
          rowId,
          fieldId: fixture.fields.integer,
          code: 'numeric_validation',
        }),
      ]),
    )
    expect(
      result.errors.filter(
        (error: { fieldId: string }) =>
          error.fieldId === fixture.fields.required_no_default,
      ),
    ).toEqual([
      expect.objectContaining({ rowIndex: 1, rowId, code: 'required_value' }),
    ])
    const explicit = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [
          fixture.datasetId,
          JSON.stringify([
            {
              operation: 'create',
              rowId: '02000000-0000-4000-8000-000000000159',
              values: { [fixture.fields.required_no_default]: 'bad' },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(
      explicit.errors.filter(
        (error: { fieldId: string }) =>
          error.fieldId === fixture.fields.required_no_default,
      ),
    ).toEqual([expect.objectContaining({ code: 'text_validation' })])
  })

  it('reports global row UUID conflicts structurally and commits no companion row', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const first = await createScalarFixture(owner)
    const second = await createScalarFixture(owner)
    const rowId = '02000000-0000-4000-8000-000000000160'
    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'global-row-first')`,
      [
        first.datasetId,
        JSON.stringify([
          {
            operation: 'create',
            rowId,
            values: { [first.fields.required_no_default]: 'FIRST' },
          },
        ]),
      ],
    )
    const companion = '02000000-0000-4000-8000-000000000161'
    const rows = [
      {
        operation: 'create',
        rowId,
        values: { [second.fields.required_no_default]: 'DUPLICATE' },
      },
      {
        operation: 'create',
        rowId: companion,
        values: { [second.fields.required_no_default]: 'COMPANION' },
      },
    ]
    const validation = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [second.datasetId, JSON.stringify(rows)],
      )
    ).rows[0].result
    expect(validation).toMatchObject({ ok: false })
    expect(
      validation.errors.filter(
        (error: { code: string }) => error.code === 'row_id_exists',
      ),
    ).toEqual([expect.objectContaining({ rowIndex: 1, rowId })])
    const committed = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,1,$2::jsonb,'global-row-second') result`,
        [second.datasetId, JSON.stringify(rows)],
      )
    ).rows[0].result
    expect(committed).toMatchObject({ ok: false, idempotent: false })
    expect(
      (
        await owner.query(`select * from api.dataset_rows where id=$1`, [
          companion,
        ])
      ).rows,
    ).toEqual([])
  })

  it('enforces active embedded category option UUIDs and retired field lifecycle', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Category fixture') returning id`,
        [
          WS_A,
          `category_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        ],
      )
    ).rows[0]
    const version = (
      await owner.query(
        `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
        [schema.id],
      )
    ).rows[0]
    const active = '02000000-0000-4000-8000-000000000301'
    const retired = '02000000-0000-4000-8000-000000000302'
    const category = (
      await owner.query(
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,category,display_order) values($1,gen_random_uuid(),'qc','QC','category',$2::jsonb,1) returning field_id`,
        [
          version.id,
          JSON.stringify({
            kind: 'embedded',
            options: [
              { id: active, key: 'pass', label: 'Pass', lifecycle: 'active' },
              { id: retired, key: 'old', label: 'Old', lifecycle: 'retired' },
            ],
          }),
        ],
      )
    ).rows[0]
    const retiredField = (
      await owner.query(
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,lifecycle,display_order) values($1,gen_random_uuid(),'old','Old','text','retired',2) returning field_id`,
        [version.id],
      )
    ).rows[0]
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
      [version.id],
    )
    const dataset = (
      await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Category fixture') returning id`,
        [WS_A, version.id],
      )
    ).rows[0]
    const rowId = '02000000-0000-4000-8000-000000000303'
    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'category-valid')`,
      [
        dataset.id,
        JSON.stringify([
          {
            operation: 'create',
            rowId,
            values: { [category.field_id]: active },
          },
        ]),
      ],
    )
    expect(
      (
        await owner.query(
          `select category_option_id from api.dataset_row_values where row_id=$1`,
          [rowId],
        )
      ).rows,
    ).toEqual([{ category_option_id: active }])
    const invalid = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,2,$2::jsonb) result`,
        [
          dataset.id,
          JSON.stringify([
            {
              operation: 'update',
              rowId,
              expectedRevision: 1,
              values: {
                [category.field_id]: retired,
                [retiredField.field_id]: 'x',
              },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 1,
          rowId,
          fieldId: category.field_id,
          code: 'invalid_category_option',
        }),
        expect.objectContaining({
          rowIndex: 1,
          rowId,
          fieldId: retiredField.field_id,
          code: 'unknown_field',
        }),
      ]),
    )
    const unknown = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,2,$2::jsonb) result`,
        [
          dataset.id,
          JSON.stringify([
            {
              operation: 'update',
              rowId,
              expectedRevision: 1,
              values: {
                [category.field_id]: '02000000-0000-4000-8000-000000000399',
              },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(unknown.errors).toContainEqual(
      expect.objectContaining({
        rowIndex: 1,
        rowId,
        fieldId: category.field_id,
        code: 'invalid_category_option',
      }),
    )
  })

  it('enforces compatible same-workspace Model Record references', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Reference fixture') returning id`,
        [
          WS_A,
          `reference_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        ],
      )
    ).rows[0]
    const version = (
      await owner.query(
        `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
        [schema.id],
      )
    ).rows[0]
    const field = (
      await owner.query(
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,relationship,display_order) values($1,gen_random_uuid(),'sample','Sample','reference','{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}',1) returning field_id`,
        [version.id],
      )
    ).rows[0]
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
      [version.id],
    )
    const dataset = (
      await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Reference fixture') returning id`,
        [WS_A, version.id],
      )
    ).rows[0]
    const records = (
      await migrator.query(
        `insert into api.records(workspace_id,kind,identifier,title,created_by_user_id,deleted_at) values ($1,'sample','S-1','Sample',$2,null),($1,'experiment','E-1','Experiment',$2,null),($1,'sample','S-2','Deleted',$2,now()),($3,'sample','S-3','Other',$4,null) returning id,kind,workspace_id,deleted_at`,
        [WS_A, OWNER_A, WS_B, OWNER_B],
      )
    ).rows
    const good = records.find(
      (record) =>
        record.kind === 'sample' &&
        record.workspace_id === WS_A &&
        !record.deleted_at,
    )!.id
    const wrong = records.find((record) => record.kind === 'experiment')!.id
    const deleted = records.find((record) => record.deleted_at)!.id
    const cross = records.find((record) => record.workspace_id === WS_B)!.id
    const rowId = '02000000-0000-4000-8000-000000000401'
    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'reference-valid')`,
      [
        dataset.id,
        JSON.stringify([
          { operation: 'create', rowId, values: { [field.field_id]: good } },
        ]),
      ],
    )
    expect(
      (
        await owner.query(
          `select reference_id from api.dataset_row_values where row_id=$1`,
          [rowId],
        )
      ).rows,
    ).toEqual([{ reference_id: good }])
    const invalid = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,2,$2::jsonb) result`,
        [
          dataset.id,
          JSON.stringify([
            {
              operation: 'update',
              rowId,
              expectedRevision: 1,
              values: { [field.field_id]: wrong },
            },
            {
              operation: 'create',
              rowId: '02000000-0000-4000-8000-000000000402',
              values: { [field.field_id]: cross },
            },
            {
              operation: 'create',
              rowId: '02000000-0000-4000-8000-000000000403',
              values: { [field.field_id]: deleted },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 1,
          rowId,
          fieldId: field.field_id,
          code: 'invalid_reference',
        }),
        expect.objectContaining({
          rowIndex: 2,
          fieldId: field.field_id,
          code: 'invalid_reference',
        }),
        expect.objectContaining({
          rowIndex: 3,
          fieldId: field.field_id,
          code: 'invalid_reference',
        }),
      ]),
    )
  })

  it('persists, queries, replaces, and snapshots ordered many values', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Many fixture') returning id`,
        [WS_A, `many_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`],
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
        `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,cardinality,display_order) values($1,gen_random_uuid(),'tags','Tags','text','many',1),($1,gen_random_uuid(),'rank','Rank','integer','one',2) returning field_id,key`,
        [version.id],
      )
    ).rows
    const ids = Object.fromEntries(
      fields.map((field) => [field.key, field.field_id]),
    ) as Record<string, string>
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active' where id=$1`,
      [version.id],
    )
    const dataset = (
      await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Many fixture') returning id`,
        [WS_A, version.id],
      )
    ).rows[0]
    const one = '02000000-0000-4000-8000-000000000501'
    const multi = '02000000-0000-4000-8000-000000000502'
    const tie = '02000000-0000-4000-8000-000000000503'
    const absent = '02000000-0000-4000-8000-000000000504'
    const invalid = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [
          dataset.id,
          JSON.stringify([
            {
              operation: 'create',
              rowId: one,
              values: { [ids.tags]: [], [ids.rank]: [1] },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 1,
          rowId: one,
          fieldId: ids.tags,
          code: 'invalid_cardinality',
        }),
        expect.objectContaining({
          fieldId: ids.rank,
          code: 'invalid_cardinality',
        }),
      ]),
    )
    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'many-create')`,
      [
        dataset.id,
        JSON.stringify([
          {
            operation: 'create',
            rowId: one,
            values: { [ids.tags]: ['only'], [ids.rank]: 2 },
          },
          {
            operation: 'create',
            rowId: multi,
            values: { [ids.tags]: ['z', 'a', 'm'], [ids.rank]: 1 },
          },
          {
            operation: 'create',
            rowId: tie,
            values: { [ids.tags]: ['z', 'x'], [ids.rank]: 3 },
          },
          { operation: 'create', rowId: absent, values: {} },
        ]),
      ],
    )
    let live = (
      await owner.query(
        `select api.query_dataset_rows($1,$2::jsonb,10,0) result`,
        [
          dataset.id,
          JSON.stringify({
            filters: [{ fieldId: ids.tags, operator: 'eq', value: 'a' }],
            sort: { fieldId: ids.tags, direction: 'asc' },
          }),
        ],
      )
    ).rows[0].result
    expect(live).toMatchObject({ totalCount: 1, hasMore: false })
    expect(live.rows[0].values[ids.tags]).toEqual(['z', 'a', 'm'])
    live = (
      await owner.query(
        `select api.query_dataset_rows($1,$2::jsonb,1,0) result`,
        [
          dataset.id,
          JSON.stringify({
            filters: [{ fieldId: ids.tags, operator: 'eq', value: 'z' }],
            sort: { fieldId: ids.tags, direction: 'asc' },
          }),
        ],
      )
    ).rows[0].result
    expect(live).toMatchObject({ totalCount: 2, hasMore: true })
    expect(live.rows.map((row: { rowId: string }) => row.rowId)).toEqual([
      multi,
    ])
    const absentRow = (
      await owner.query(`select api.query_dataset_rows($1,'{}',10,0) result`, [
        dataset.id,
      ])
    ).rows[0].result.rows.find((row: { rowId: string }) => row.rowId === absent)
    expect(absentRow.values).toMatchObject({ [ids.tags]: [], [ids.rank]: null })
    const oneLive = (
      await owner.query(`select api.query_dataset_rows($1,'{}',10,0) result`, [
        dataset.id,
      ])
    ).rows[0].result.rows.find((row: { rowId: string }) => row.rowId === one)
    expect(oneLive.values[ids.tags]).toEqual(['only'])
    const snapshot = (
      await owner.query(
        `select (api.snapshot_dataset($1,2,'many snapshot')).*`,
        [dataset.id],
      )
    ).rows[0]
    await owner.query(
      `select api.commit_dataset_row_batch($1,2,$2::jsonb,'many-replace')`,
      [
        dataset.id,
        JSON.stringify([
          {
            operation: 'update',
            rowId: multi,
            expectedRevision: 1,
            values: { [ids.tags]: ['m', 'z'] },
          },
        ]),
      ],
    )
    live = (
      await owner.query(`select api.query_dataset_rows($1,'{}',10,0) result`, [
        dataset.id,
      ])
    ).rows[0].result
    expect(
      live.rows.find((row: { rowId: string }) => row.rowId === multi).values[
        ids.tags
      ],
    ).toEqual(['m', 'z'])
    expect(
      (
        await owner.query(
          `select ordinal,text_value from api.dataset_row_values where row_id=$1 and field_id=$2 order by ordinal`,
          [multi, ids.tags],
        )
      ).rows,
    ).toEqual([
      { ordinal: 0, text_value: 'm' },
      { ordinal: 1, text_value: 'z' },
    ])
    const historical = (
      await owner.query(
        `select api.query_dataset_version_rows($1,10,0) result`,
        [snapshot.id],
      )
    ).rows[0].result
    expect(
      historical.rows.find((row: { rowId: string }) => row.rowId === multi)
        .values[ids.tags],
    ).toEqual(['z', 'a', 'm'])
    expect(
      historical.rows.find((row: { rowId: string }) => row.rowId === one)
        .values[ids.tags],
    ).toEqual(['only'])
    await expect(
      owner.query(`select api.query_dataset_rows($1,$2::jsonb,10,0)`, [
        dataset.id,
        JSON.stringify({
          filters: Array.from({ length: 9 }, () => ({
            fieldId: ids.rank,
            operator: 'eq',
            value: 1,
          })),
        }),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      owner.query(`select api.query_dataset_rows($1,$2::jsonb,10,0)`, [
        dataset.id,
        JSON.stringify({
          filters: [{ fieldId: ids.rank, operator: 'eq', value: 'bad' }],
        }),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('rejects stale row writes without changing another row in the batch', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const result = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [
          datasetId,
          2,
          JSON.stringify([
            {
              operation: 'update',
              rowId: '02000000-0000-4000-8000-000000000101',
              expectedRevision: 1,
              values: { [titreFieldId]: 140000000 },
            },
            {
              operation: 'update',
              rowId: '02000000-0000-4000-8000-000000000102',
              expectedRevision: 99,
              values: { [titreFieldId]: 150000000 },
            },
          ]),
          'paste-stale',
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({ ok: false, idempotent: false })
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'stale_row_revision' }),
      ]),
    )
    expect(
      (
        await owner.query(
          `select numeric_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
          ['02000000-0000-4000-8000-000000000101', titreFieldId],
        )
      ).rows,
    ).toEqual([{ numeric_value: '125000000' }])
  })

  it('rejects malformed batch conflict shapes before the controlled write boundary', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const row = '02000000-0000-4000-8000-000000000199'
    const call = (rows: unknown) =>
      owner.query(`select api.validate_dataset_row_batch($1,$2,$3::jsonb)`, [
        datasetId,
        2,
        JSON.stringify(rows),
      ])

    await expect(
      call([
        { operation: 'create', rowId: row, values: { [titreFieldId]: 1 } },
        { operation: 'create', rowId: row, values: { [titreFieldId]: 2 } },
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      call([
        {
          operation: 'create',
          rowId: '02000000-0000-4000-8000-000000000198',
          expectedRevision: 1,
          values: { [titreFieldId]: 1 },
        },
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      call([
        {
          operation: 'update',
          rowId: '02000000-0000-4000-8000-000000000101',
          expectedRevision: 0,
          values: { [titreFieldId]: 1 },
        },
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('returns a bounded canonical Dataset window with typed field filtering', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const result = (
      await owner.query(
        `select api.query_dataset_rows($1,$2::jsonb,$3,$4) result`,
        [
          datasetId,
          JSON.stringify({
            filters: [
              { fieldId: titreFieldId, operator: 'gte', value: 130000000 },
            ],
            sort: { fieldId: titreFieldId, direction: 'desc' },
          }),
          1,
          0,
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({
      datasetId,
      offset: 0,
      limit: 1,
      totalCount: 1,
      hasMore: false,
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        rowId: '02000000-0000-4000-8000-000000000102',
        revision: 1,
        values: { [titreFieldId]: 135000000 },
      }),
    ])
    await expect(
      owner.query(`select api.query_dataset_rows($1,$2::jsonb,$3,$4)`, [
        datasetId,
        JSON.stringify({
          filters: [
            { fieldId: titreFieldId, operator: 'contains', value: '13' },
          ],
        }),
        10,
        0,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('rejects malformed canonical query payloads before execution', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const invalid = [
      null,
      1,
      { extra: true },
      { filters: [{ fieldId: titreFieldId, operator: 'eq' }] },
      { filters: [{ fieldId: titreFieldId, operator: 'contains', value: 1 }] },
      { sort: { fieldId: titreFieldId, direction: 'sideways' } },
      { sort: { fieldId: titreFieldId, direction: 'asc', extra: true } },
    ]
    for (const query of invalid) {
      await expect(
        owner.query(`select api.query_dataset_rows($1,$2::jsonb,10,0)`, [
          datasetId,
          JSON.stringify(query),
        ]),
      ).rejects.toMatchObject({ code: '22023' })
    }
  })

  it('keeps Dataset and schema metadata workspace-isolated', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const member = await actor(MEMBER_A, WS_A)
    const outsider = await actor(OWNER_B, WS_B)

    expect(
      (await member.query(`select * from api.datasets`)).rows,
    ).toHaveLength(8)
    expect((await outsider.query(`select * from api.datasets`)).rows).toEqual(
      [],
    )
    await expect(
      member.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name)
         values($1,'member_schema','Member schema')`,
        [WS_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      (await owner.query(`select * from api.dataset_schema_definitions`)).rows,
    ).toHaveLength(17)
  })

  it('rejects cross-workspace Dataset schema, row, and primary-project bindings at the database boundary', async () => {
    const ownerA = await actor(OWNER_A, WS_A)
    const ownerB = await actor(OWNER_B, WS_B)
    const otherSchema = (
      await ownerB.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name,created_by_user_id)
         values($1,'other_assay','Other assay',$2) returning id`,
        [WS_B, OWNER_B],
      )
    ).rows[0]
    const otherVersion = (
      await ownerB.query(
        `insert into api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id)
         values($1,1,'draft',$2) returning id`,
        [otherSchema.id, OWNER_B],
      )
    ).rows[0]
    await expect(
      ownerA.query(
        `insert into api.datasets(workspace_id,schema_version_id,name)
         values($1,$2,'invalid schema workspace')`,
        [WS_A, otherVersion.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      migrator.query(
        `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2)`,
        [datasetId, WS_B],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    const projectB = (
      await migrator.query(
        `insert into api.projects(workspace_id,key,title) values($1,'other-project','Other project') returning id`,
        [WS_B],
      )
    ).rows[0]
    await expect(
      ownerA.query(
        `update api.datasets set primary_project_id=$1 where id=$2`,
        [projectB.id, datasetId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('does not permit a publisher to mutate an active Schema Version or its fields', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `select schema_version_id from api.datasets where id=$1`,
      [datasetId],
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set version=2 where id=$1`,
        [rows[0].schema_version_id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      owner.query(
        `update api.dataset_schema_version_fields set label='Changed' where schema_version_id=$1`,
        [rows[0].schema_version_id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('creates an immutable, schema-pinned Dataset Version unaffected by later live edits', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const label = `Submission evidence ${crypto.randomUUID()}`
    const snapshot = (
      await owner.query(`select (api.snapshot_dataset($1,$2,$3)).*`, [
        datasetId,
        2,
        label,
      ])
    ).rows[0]
    expect(snapshot).toMatchObject({
      dataset_id: datasetId,
      source_dataset_revision: '2',
      label,
    })

    await owner.query(
      `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)`,
      [
        datasetId,
        2,
        JSON.stringify([
          {
            operation: 'update',
            rowId: '02000000-0000-4000-8000-000000000101',
            expectedRevision: 1,
            values: { [titreFieldId]: 140000000 },
          },
        ]),
        'after-snapshot',
      ],
    )
    const historical = (
      await owner.query(
        `select api.query_dataset_version_rows($1,100,0) result`,
        [snapshot.id],
      )
    ).rows[0].result
    expect(historical).toMatchObject({
      datasetVersionId: snapshot.id,
      schemaVersionId: snapshot.schema_version_id,
      sourceDatasetRevision: 2,
    })
    expect(historical.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowId: '02000000-0000-4000-8000-000000000101',
          values: { [titreFieldId]: 125000000 },
        }),
      ]),
    )
    await expect(
      migrator.query(
        `update api.dataset_versions set label='changed' where id=$1`,
        [snapshot.id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
