import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS = '19000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-local-owner'
const MEMBER = 'sheet-local-member'
const ROW = '19000000-0000-4000-8000-000000000002'
const TEXT = '19000000-0000-4000-8000-000000000003'
const RECORD = '19000000-0000-4000-8000-000000000004'
let migrator: Client
let owner: Client
let member: Client

const field = (
  fieldId: string,
  key: string,
  logicalType: string,
  extra: Record<string, unknown> = {},
) => ({
  fieldId,
  key,
  label: key,
  description: null,
  logicalType,
  nullable: false,
  defaultValue: null,
  cardinality: 'one',
  quantity: null,
  validation: {},
  category: null,
  relationship: null,
  computation: { mode: 'stored' },
  lifecycle: 'active',
  ...extra,
})

function localConfiguration() {
  const configuration: any = structuredClone(
    validSheetDefinitionConfiguration(),
  )
  const column = configuration.columns[0]
  column.source = { kind: 'declared' }
  column.field.logicalType = 'reference'
  column.field.relationship = {
    target: { kind: 'model', modelKey: 'sample' },
    cardinality: 'one',
  }
  configuration.parameters = []
  configuration.bindings = []
  configuration.joins = []
  configuration.columns = [column]
  configuration.calculations = []
  configuration.writeBackRules = []
  configuration.actions = []
  configuration.rowIdentity = { kind: 'local', columnIds: [column.id] }
  configuration.presentation = {
    columnOrder: [column.id],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  }
  return configuration
}

const state = () => ({
  bindings: [],
  localFields: [field(TEXT, 'observation', 'text', { nullable: true })],
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
})

async function instance() {
  const definition = (
    await owner.query(
      `select api.create_sheet_definition($1,$2,'Local values',null,$3::jsonb) result`,
      [
        WS,
        `local_${crypto.randomUUID().replaceAll('-', '')}`,
        JSON.stringify(localConfiguration()),
      ],
    )
  ).rows[0].result
  await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
    definition.version.id,
  ])
  const created = (
    await owner.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,'Local',null,$2,null,null,$3::jsonb,'[]'::jsonb)) result`,
      [WS, definition.version.id, JSON.stringify(state())],
    )
  ).rows[0].result
  return (
    await owner.query(
      `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
      [created.id],
    )
  ).rows[0].result
}

async function mutate(
  id: string,
  revision: number,
  token: string,
  changes: unknown[],
  cells: unknown[],
) {
  return (
    await owner.query(
      `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)) result`,
      [
        id,
        revision,
        token,
        JSON.stringify(changes),
        JSON.stringify([{ kind: 'local', rowKey: ROW }]),
        JSON.stringify(cells),
      ],
    )
  ).rows[0].result
}

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','sheet-local@test.invalid',true),($2,'Member','sheet-local-member@test.invalid',true)`,
    [OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-local','Sheet local')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id) values($1,$2,'sample','LOCAL-SAMPLE','Local sample',$3)`,
    [RECORD, WS, OWNER],
  )
  await owner.query('set role authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS }),
  ])
  member = await database.asRole('authenticator')
  await member.query('set role authenticated')
  await member.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: MEMBER, workspace_id: WS }),
  ])
})

afterAll(async () => {
  await owner?.end()
  await member?.end()
  await migrator?.end()
})

describe('controlled Sheet Instance local values', () => {
  it('adds, edits and retires stable fields; validates every ordered many item; and preserves history', async () => {
    const sheet = await instance()
    const many = crypto.randomUUID()
    const decimal = crypto.randomUUID()
    const boolean = crypto.randomUUID()
    const date = crypto.randomUUID()
    const timestamp = crypto.randomUUID()
    const category = crypto.randomUUID()
    const option = crypto.randomUUID()
    const reference = crypto.randomUUID()
    const defaulted = crypto.randomUUID()
    const token = crypto.randomUUID()
    const committed = await mutate(
      sheet.id,
      2,
      token,
      [
        {
          operation: 'add',
          field: field(many, 'replicates', 'integer', {
            cardinality: 'many',
          }),
        },
        { operation: 'add', field: field(decimal, 'decimal', 'decimal') },
        { operation: 'add', field: field(boolean, 'boolean', 'boolean') },
        { operation: 'add', field: field(date, 'date', 'date') },
        {
          operation: 'add',
          field: field(timestamp, 'timestamp', 'timestamp'),
        },
        {
          operation: 'add',
          field: field(category, 'category', 'category', {
            category: {
              kind: 'embedded',
              options: [
                {
                  id: option,
                  key: 'accepted',
                  label: 'Accepted',
                  displayOrder: 0,
                  lifecycle: 'active',
                },
              ],
            },
          }),
        },
        {
          operation: 'add',
          field: field(reference, 'reference', 'reference', {
            relationship: {
              target: { kind: 'model', modelKey: 'sample' },
              cardinality: 'one',
            },
          }),
        },
        {
          operation: 'add',
          field: field(defaulted, 'defaulted', 'text', {
            defaultValue: 'fallback',
          }),
        },
      ],
      [
        { rowKey: ROW, fieldId: TEXT, value: 'text' },
        { rowKey: ROW, fieldId: many, value: [3, 1, 2] },
        { rowKey: ROW, fieldId: decimal, value: 1.25 },
        { rowKey: ROW, fieldId: boolean, value: true },
        { rowKey: ROW, fieldId: date, value: '2026-08-15' },
        {
          rowKey: ROW,
          fieldId: timestamp,
          value: '2026-08-15T12:30:00Z',
        },
        { rowKey: ROW, fieldId: category, value: option },
        { rowKey: ROW, fieldId: reference, value: RECORD },
        { rowKey: ROW, fieldId: defaulted, value: null },
      ],
    )
    expect(committed.state.localValues[ROW][many]).toEqual([3, 1, 2])
    expect(committed.state.localValues[ROW]).toMatchObject({
      [TEXT]: 'text',
      [decimal]: 1.25,
      [boolean]: true,
      [date]: '2026-08-15',
      [timestamp]: '2026-08-15T12:30:00Z',
      [category]: option,
      [reference]: RECORD,
      [defaulted]: 'fallback',
    })
    expect(
      (
        await member.query(
          `select state from api.sheet_instances where id=$1`,
          [sheet.id],
        )
      ).rows[0].state.localValues[ROW][many],
    ).toEqual([3, 1, 2])
    const copy = (
      await owner.query(
        `select to_jsonb(api.duplicate_sheet_instance($1,3,'Local copy')) result`,
        [sheet.id],
      )
    ).rows[0].result
    await mutate(
      copy.id,
      1,
      crypto.randomUUID(),
      [],
      [{ rowKey: ROW, fieldId: TEXT, value: 'copy only' }],
    )
    expect(
      (
        await owner.query(`select state from api.sheet_instances where id=$1`, [
          sheet.id,
        ])
      ).rows[0].state.localValues[ROW][TEXT],
    ).toBe('text')
    const editedField = {
      ...committed.state.localFields.find(
        (item: { fieldId: string }) => item.fieldId === many,
      ),
      label: 'Replicate values',
    }
    const edited = await mutate(
      sheet.id,
      3,
      crypto.randomUUID(),
      [{ operation: 'edit', field: editedField }],
      [],
    )
    const retired = await mutate(
      sheet.id,
      4,
      crypto.randomUUID(),
      [{ operation: 'retire', fieldId: many }],
      [],
    )
    expect(retired.state.localValues[ROW][many]).toEqual([3, 1, 2])
    expect(
      retired.state.localFields.find(
        (item: { fieldId: string }) => item.fieldId === many,
      ).lifecycle,
    ).toBe('retired')
    expect(edited.revision).toBe(4)
    await expect(
      mutate(
        sheet.id,
        5,
        crypto.randomUUID(),
        [],
        [{ rowKey: ROW, fieldId: many, value: [4] }],
      ),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('enforces scalar/default/category/reference constraints atomically', async () => {
    const sheet = await instance()
    const integer = crypto.randomUUID()
    const date = crypto.randomUUID()
    const reference = crypto.randomUUID()
    const initialState = state()
    initialState.localFields = [
      field(reference, 'sample', 'reference', {
        relationship: {
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        },
      }),
    ]
    initialState.localValues = {
      [ROW]: { [reference]: crypto.randomUUID() },
    }
    await expect(
      owner.query(
        `select api.create_sheet_instance($1,'Invalid initial reference',null,null,null,null,$2::jsonb)`,
        [WS, JSON.stringify(initialState)],
      ),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      mutate(
        sheet.id,
        2,
        crypto.randomUUID(),
        [
          {
            operation: 'add',
            field: field(integer, 'count', 'integer', {
              validation: { min: 1 },
            }),
          },
          { operation: 'add', field: field(date, 'date', 'date') },
        ],
        [
          { rowKey: ROW, fieldId: integer, value: 2 },
          { rowKey: ROW, fieldId: date, value: '2025-02-29' },
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    const reloaded = (
      await owner.query(
        `select state,revision from api.sheet_instances where id=$1`,
        [sheet.id],
      )
    ).rows[0]
    expect(reloaded.revision).toBe('2')
    expect(reloaded.state.localFields).toHaveLength(1)
  })

  it('binds retries to the exact request/result and records actor, time and every address', async () => {
    const sheet = await instance()
    const token = crypto.randomUUID()
    const first = await mutate(
      sheet.id,
      2,
      token,
      [],
      [{ rowKey: ROW, fieldId: TEXT, value: 'changed' }],
    )
    const retry = await mutate(
      sheet.id,
      2,
      token,
      [],
      [{ rowKey: ROW, fieldId: TEXT, value: 'changed' }],
    )
    expect(retry).toEqual(first)
    await expect(
      mutate(
        sheet.id,
        2,
        token,
        [],
        [{ rowKey: ROW, fieldId: TEXT, value: 'different' }],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    const audit = (
      await owner.query(
        `select actor_user_id,created_at,operation,affected,result_revision from api.sheet_instance_local_mutations where instance_id=$1`,
        [sheet.id],
      )
    ).rows[0]
    expect(audit).toMatchObject({
      actor_user_id: OWNER,
      operation: 'local_mutation',
      result_revision: '3',
      affected: {
        rowKeys: [ROW],
        fieldIds: [TEXT],
        cells: [`${ROW}:${TEXT}`],
      },
    })
    expect(audit.created_at).toBeInstanceOf(Date)
  })

  it('rejects duplicates/empty batches and proves RLS, helper ACLs and the single enabled guard', async () => {
    const sheet = await instance()
    await expect(
      mutate(
        sheet.id,
        2,
        crypto.randomUUID(),
        [],
        [
          { rowKey: ROW, fieldId: TEXT, value: 'one' },
          { rowKey: ROW, fieldId: TEXT, value: 'two' },
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      owner.query(
        `select api.mutate_sheet_instance_local_state($1,2,$2,'[]','[]','[]')`,
        [sheet.id, crypto.randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      mutate(
        sheet.id,
        2,
        crypto.randomUUID(),
        [],
        [{ rowKey: ROW, fieldId: TEXT, value: 'initial' }],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    const privileges = (
      await migrator.query(
        `select has_function_privilege('authenticated','api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb)','EXECUTE') rpc,
          has_function_privilege('api_client','api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb)','EXECUTE') rpc_api_client,
          has_function_privilege('public','internal.sheet_local_cell_error(uuid,jsonb,jsonb)','EXECUTE') helper,
          (select count(*)::integer from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl left join pg_roles r on r.oid=acl.grantee where p.oid=any(array['internal.sheet_row_identity_array_text(jsonb)'::regprocedure,'internal.sheet_row_identity_key(jsonb,jsonb)'::regprocedure,'internal.sheet_local_cell_error(uuid,jsonb,jsonb)'::regprocedure,'internal.validate_sheet_instance_state_core037(jsonb)'::regprocedure]) and acl.privilege_type='EXECUTE' and (acl.grantee=0 or r.rolname in ('authenticated','api_client'))) helper_acl_count,
          has_table_privilege('authenticated','api.sheet_instance_local_mutations','INSERT') direct_audit_write,
          (select relrowsecurity from pg_class where oid='api.sheet_instance_local_mutations'::regclass) audit_rls,
          (select count(*)::integer from pg_trigger where tgrelid='api.sheet_instances'::regclass and not tgisinternal and tgname='guard_sheet_instance' and tgenabled='O') guards`,
      )
    ).rows[0]
    expect(privileges).toEqual({
      rpc: true,
      rpc_api_client: false,
      helper: false,
      helper_acl_count: 0,
      direct_audit_write: false,
      audit_rls: true,
      guards: 1,
    })
    await expect(
      owner.query(`update api.sheet_instances set state='{}' where id=$1`, [
        sheet.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('records the frozen-evidence boundary: submissions have no Sheet Instance embedding seam yet', async () => {
    const result = (
      await migrator.query(
        `select
          (select count(*)::integer from information_schema.columns where table_schema='api' and table_name='revisions' and column_name like '%sheet_instance%') columns,
          (select count(*)::integer from pg_constraint where contype='f' and confrelid='api.sheet_instances'::regclass and conrelid='api.revisions'::regclass) foreign_keys`,
      )
    ).rows[0]
    expect(result).toEqual({ columns: 0, foreign_keys: 0 })
  })
})
