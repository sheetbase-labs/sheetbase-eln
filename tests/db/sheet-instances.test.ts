import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS_A = '13000000-0000-4000-8000-000000000001'
const WS_B = '13000000-0000-4000-8000-000000000002'
const OWNER = 'sheet-instance-owner'
const MEMBER = 'sheet-instance-member'
const OUTSIDER = 'sheet-instance-outsider'
const PROJECT_A = '13000000-0000-4000-8000-000000000020'
const PROJECT_B = '13000000-0000-4000-8000-000000000021'
const RECORD_A = '13000000-0000-4000-8000-000000000030'
const RECORD_B = '13000000-0000-4000-8000-000000000031'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const state = (value = 'one') => ({
  bindings: [],
  localFields: [
    {
      fieldId: '13000000-0000-4000-8000-000000000010',
      key: 'observation',
      label: 'Observation',
      description: null,
      logicalType: 'text',
      nullable: true,
      defaultValue: null,
      cardinality: 'one',
      quantity: null,
      validation: {},
      category: null,
      relationship: null,
      computation: { mode: 'stored' },
      lifecycle: 'active',
    },
  ],
  localValues: {
    '13000000-0000-4000-8000-000000000011': {
      '13000000-0000-4000-8000-000000000010': value,
    },
  },
  calculationOverrides: {},
  presentation: {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
  provenance: {
    createdFrom: 'duplicate',
    duplicatedFromInstanceId: crypto.randomUUID(),
  },
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

async function create(client: Client, value = 'one') {
  return (
    await client.query(
      `select to_jsonb(api.create_sheet_instance($1,'Working sheet',null,null,null,null,$2::jsonb)) result`,
      [WS_A, JSON.stringify(state(value))],
    )
  ).rows[0].result
}

function bindingState(binding: Record<string, unknown>) {
  return { ...state(), bindings: [binding] }
}

function definitionWithoutParameters() {
  const configuration: any = structuredClone(
    validSheetDefinitionConfiguration(),
  )
  const column = configuration.columns[0]
  column.source = { kind: 'declared' }
  configuration.parameters = []
  configuration.bindings = []
  configuration.joins = []
  configuration.columns = [column]
  configuration.calculations = []
  configuration.writeBackRules = []
  configuration.actions = []
  column.field.logicalType = 'reference'
  column.field.relationship = {
    target: { kind: 'model', modelKey: 'sample' },
    cardinality: 'one',
  }
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

function sourceDefinition() {
  const configuration: any = structuredClone(
    validSheetDefinitionConfiguration(),
  )
  const column = configuration.columns[0]
  configuration.parameters = [
    {
      id: configuration.parameters[0].id,
      key: 'source_name',
      label: 'Source name',
      required: true,
      type: { kind: 'scalar', valueType: 'text' },
      constraints: {},
    },
  ]
  configuration.bindings = [
    {
      ...configuration.bindings[0],
      parameterId: configuration.parameters[0].id,
    },
  ]
  configuration.columns = [column]
  configuration.rowIdentity = { kind: 'source', columnIds: [column.id] }
  configuration.joins = []
  configuration.calculations = []
  configuration.writeBackRules = []
  configuration.actions = []
  configuration.presentation = {
    columnOrder: [column.id],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  }
  return configuration
}

async function createDatasetFixture(workspaceId: string, name: string) {
  const key = `sheet_instance_${crypto.randomUUID().replaceAll('-', '')}`
  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$3) returning id`,
      [workspaceId, key, name],
    )
  ).rows[0]
  const schemaVersion = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version,lifecycle,published_at) values($1,1,'active',now()) returning id`,
      [schema.id],
    )
  ).rows[0]
  return (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,$3) returning id`,
      [workspaceId, schemaVersion.id, name],
    )
  ).rows[0].id as string
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','si-owner@test.invalid',true),($2,'Member','si-member@test.invalid',true),($3,'Outsider','si-outsider@test.invalid',true)`,
    [OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'si-a','SI A'),($2,'si-b','SI B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'member'),($2,$5,'owner')`,
    [WS_A, WS_B, OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values ($1,$3,'si-project-a','A'),($2,$4,'si-project-b','B')`,
    [PROJECT_A, PROJECT_B, WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) values ($1,$3,$5,'experiment','SI-A','A',$7),($2,$4,$6,'experiment','SI-B','B',$8)`,
    [RECORD_A, RECORD_B, WS_A, WS_B, PROJECT_A, PROJECT_B, OWNER, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('Sheet Instance durability and authority', () => {
  it('rejects cross-workspace project and Notebook context while keeping Record and Instance identities distinct', async () => {
    const owner = await actor(OWNER, WS_A)
    const createWithContext = (
      projectId: string | null,
      recordId: string | null,
    ) =>
      owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Context',null,null,$2,$3,$4::jsonb)) result`,
        [WS_A, projectId, recordId, JSON.stringify(state())],
      )
    await expect(createWithContext(PROJECT_B, null)).rejects.toMatchObject({
      code: 'SB073',
    })
    await expect(createWithContext(PROJECT_A, RECORD_B)).rejects.toMatchObject({
      code: 'SB073',
    })
    const instance = (await createWithContext(PROJECT_A, RECORD_A)).rows[0]
      .result
    expect(instance.notebook_record_id).toBe(RECORD_A)
    expect(instance.id).not.toBe(RECORD_A)
  })

  it('rejects nonexistent/cross-workspace Dataset and Record bindings and mismatched Dataset Versions', async () => {
    const owner = await actor(OWNER, WS_A)
    const datasetA = await createDatasetFixture(WS_A, 'Dataset A')
    const otherDatasetA = await createDatasetFixture(WS_A, 'Other Dataset A')
    const datasetB = await createDatasetFixture(WS_B, 'Dataset B')
    const versionA = (
      await owner.query(
        `select to_jsonb(api.snapshot_dataset($1,1,'Version A')) result`,
        [datasetA],
      )
    ).rows[0].result.id
    const createBound = (binding: Record<string, unknown>) =>
      owner.query(
        `select api.create_sheet_instance($1,'Bound',null,null,null,null,$2::jsonb)`,
        [WS_A, JSON.stringify(bindingState(binding))],
      )
    const datasetBinding = (datasetId: string, datasetVersionId?: string) => ({
      bindingId: crypto.randomUUID(),
      parameterId: crypto.randomUUID(),
      kind: 'dataset',
      datasetId,
      policy: datasetVersionId
        ? { mode: 'version', datasetVersionId }
        : { mode: 'live' },
    })
    for (const id of [datasetB, crypto.randomUUID()]) {
      await expect(createBound(datasetBinding(id))).rejects.toMatchObject({
        code: 'SB073',
      })
    }
    for (const id of [RECORD_B, crypto.randomUUID()]) {
      await expect(
        createBound({
          bindingId: crypto.randomUUID(),
          parameterId: crypto.randomUUID(),
          kind: 'record',
          recordId: id,
          policy: 'live',
        }),
      ).rejects.toMatchObject({ code: 'SB073' })
    }
    await expect(
      createBound(datasetBinding(otherDatasetA, versionA)),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('strips forged resolution and Record model metadata from ad hoc create and update', async () => {
    const owner = await actor(OWNER, WS_A)
    const datasetId = await createDatasetFixture(WS_A, 'Ad hoc metadata')
    const forgedBindings = [
      {
        bindingId: crypto.randomUUID(),
        parameterId: crypto.randomUUID(),
        kind: 'dataset',
        datasetId,
        policy: { mode: 'live' },
        resolution: {
          compatibilityMode: 'exact',
          candidateSchemaVersionId: crypto.randomUUID(),
          baselineSchemaVersionId: crypto.randomUUID(),
          requiredFieldIds: [],
        },
      },
      {
        bindingId: crypto.randomUUID(),
        parameterId: crypto.randomUUID(),
        kind: 'record',
        recordId: RECORD_A,
        modelKey: 'sample',
        policy: 'live',
      },
    ]
    const forgedState = {
      ...state(),
      bindings: forgedBindings,
      parameterValues: [
        {
          parameterId: crypto.randomUUID(),
          kind: 'scalar',
          valueType: 'text',
          value: 'forged',
          source: 'supplied',
        },
      ],
      resolutionProvenance: {
        sourceDefinitionVersionId: crypto.randomUUID(),
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: 'forged',
        parameters: [],
      },
    }
    const created = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Ad hoc metadata',null,null,null,null,$2::jsonb)) result`,
        [WS_A, JSON.stringify(forgedState)],
      )
    ).rows[0].result
    expect(created.state).not.toHaveProperty('parameterValues')
    expect(created.state).not.toHaveProperty('resolutionProvenance')
    expect(created.state.bindings[0]).not.toHaveProperty('resolution')
    expect(created.state.bindings[1]).not.toHaveProperty('modelKey')

    const updated = (
      await owner.query(
        `select to_jsonb(api.update_sheet_instance($1,1,$2::jsonb)) result`,
        [created.id, JSON.stringify({ ...forgedState, localValues: {} })],
      )
    ).rows[0].result
    expect(updated.state).not.toHaveProperty('parameterValues')
    expect(updated.state).not.toHaveProperty('resolutionProvenance')
    expect(updated.state.bindings[0]).not.toHaveProperty('resolution')
    expect(updated.state.bindings[1]).not.toHaveProperty('modelKey')
  })

  it('rejects the legacy client-authored Definition binding path', async () => {
    const owner = await actor(OWNER, WS_A)
    const configuration = validSheetDefinitionConfiguration()
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'binding_source','Binding source',null,$2::jsonb) result`,
        [WS_A, JSON.stringify(configuration)],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
      definition.version.id,
    ])
    const datasetId = await createDatasetFixture(WS_A, 'Pinned binding')
    const createPinned = (parameterId: string) =>
      owner.query(
        `select api.create_sheet_instance($1,'Pinned binding',null,$2,null,null,$3::jsonb)`,
        [
          WS_A,
          definition.version.id,
          JSON.stringify(
            bindingState({
              bindingId: configuration.bindings[0].id,
              parameterId,
              kind: 'dataset',
              datasetId,
              policy: { mode: 'live' },
            }),
          ),
        ],
      )
    await expect(
      createPinned(configuration.bindings[0].parameterId),
    ).rejects.toMatchObject({ code: 'SB074' })
  })

  it('rejects malformed and oversized nested state at the public DB boundary', async () => {
    const owner = await actor(OWNER, WS_A)
    const createState = (value: unknown) =>
      owner.query(
        `select api.create_sheet_instance($1,'Invalid state',null,null,null,null,$2::jsonb)`,
        [WS_A, JSON.stringify(value)],
      )
    await expect(
      createState({ ...state(), presentation: { density: 'standard' } }),
    ).rejects.toMatchObject({ code: 'SB073' })
    const oversized = state()
    oversized.localValues[Object.keys(oversized.localValues)[0]] =
      Object.fromEntries(
        Array.from({ length: 257 }, (_, index) => [crypto.randomUUID(), index]),
      )
    await expect(createState(oversized)).rejects.toMatchObject({
      code: 'SB073',
    })
  })

  it('pins two independent Instances to one exact published Definition Version despite a later version', async () => {
    const owner = await actor(OWNER, WS_A)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'instance_source','Instance source',null,$2::jsonb) result`,
        [WS_A, JSON.stringify(definitionWithoutParameters())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
      definition.version.id,
    ])
    const createPinned = () =>
      owner.query(
        `select to_jsonb(api.create_sheet_instance_from_definition($1,'Pinned',null,$2,null,null,$3::jsonb,'[]'::jsonb)) result`,
        [WS_A, definition.version.id, JSON.stringify(state())],
      )
    const first = (await createPinned()).rows[0].result
    const second = (await createPinned()).rows[0].result
    const resolved = (
      await owner.query(
        `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
        [first.id],
      )
    ).rows[0].result
    expect(resolved.state.resolvedRowIdentity).toMatchObject({
      formatVersion: 1,
      kind: 'local',
      columnIds: [definitionWithoutParameters().columns[0].id],
      logicalTypes: ['reference'],
      sourceBindingId: null,
      sourceFieldId: null,
    })
    await expect(
      owner.query(`select api.resolve_sheet_instance_row_identity($1,1)`, [
        first.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    const repeated = (
      await owner.query(
        `select to_jsonb(api.resolve_sheet_instance_row_identity($1,2)) result`,
        [first.id],
      )
    ).rows[0].result
    expect(repeated.revision).toBe(2)
    await owner.query(
      `select api.create_sheet_definition_version($1,1,$2::jsonb)`,
      [definition.definition.id, JSON.stringify(definitionWithoutParameters())],
    )
    expect(first.id).not.toBe(second.id)
    expect(
      (
        await owner.query(
          `select distinct source_definition_version_id from api.sheet_instances where id=any($1)`,
          [[first.id, second.id]],
        )
      ).rows,
    ).toEqual([{ source_definition_version_id: definition.version.id }])
  })

  it('persists immutable source binding provenance through the controlled resolver', async () => {
    const owner = await actor(OWNER, WS_A)
    const config = sourceDefinition()
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'source_identity','Source identity',null,$2::jsonb) result`,
        [WS_A, JSON.stringify(config)],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
      definition.version.id,
    ])
    const instance = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance_from_definition($1,'Source',null,$2,null,null,$3::jsonb,$4::jsonb)) result`,
        [
          WS_A,
          definition.version.id,
          JSON.stringify(state()),
          JSON.stringify([
            {
              parameterId: config.parameters[0].id,
              kind: 'scalar',
              value: 'source',
            },
          ]),
        ],
      )
    ).rows[0].result
    const resolved = (
      await owner.query(
        `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
        [instance.id],
      )
    ).rows[0].result
    expect(resolved.state.resolvedRowIdentity).toMatchObject({
      kind: 'source',
      sourceBindingId: config.bindings[0].id,
      sourceFieldId: config.columns[0].source.sourceFieldId,
    })
  })

  it('creates independent durable identities, updates one with optimistic revision, and reloads isolation', async () => {
    const owner = await actor(OWNER, WS_A)
    const first = await create(owner)
    const second = await create(owner)
    expect(first.id).not.toBe(second.id)
    await owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
      first.id,
      JSON.stringify(state('changed')),
    ])
    const rows = (
      await owner.query(
        `select id,revision,state#>>'{localValues,13000000-0000-4000-8000-000000000011,13000000-0000-4000-8000-000000000010}' value from api.sheet_instances where id=any($1) order by id`,
        [[first.id, second.id]],
      )
    ).rows
    expect(rows.map((row) => row.value).sort()).toEqual(['changed', 'one'])
    await expect(
      owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
        first.id,
        JSON.stringify(state()),
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('duplicates copied local state under a new identity and then isolates mutation', async () => {
    const owner = await actor(OWNER, WS_A)
    const source = await create(owner)
    const copy = (
      await owner.query(
        `select to_jsonb(api.duplicate_sheet_instance($1,1,'Copy')) result`,
        [source.id],
      )
    ).rows[0].result
    expect(copy.id).not.toBe(source.id)
    expect(copy.duplicated_from_instance_id).toBe(source.id)
    expect(copy.state.provenance).toEqual({
      createdFrom: 'duplicate',
      duplicatedFromInstanceId: source.id,
    })
    await owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
      copy.id,
      JSON.stringify(state('copy changed')),
    ])
    expect(
      (
        await owner.query(`select state from api.sheet_instances where id=$1`, [
          source.id,
        ])
      ).rows[0].state.localValues['13000000-0000-4000-8000-000000000011'][
        '13000000-0000-4000-8000-000000000010'
      ],
    ).toBe('one')
  })

  it('keeps archives readable and rejects update, repeat archive and reduplication', async () => {
    const owner = await actor(OWNER, WS_A)
    const row = await create(owner)
    const archived = (
      await owner.query(
        `select to_jsonb(api.archive_sheet_instance($1,1)) result`,
        [row.id],
      )
    ).rows[0].result
    expect(archived.lifecycle).toBe('archived')
    expect(
      (
        await owner.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(1)
    await expect(
      owner.query(`select api.update_sheet_instance($1,2,$2::jsonb)`, [
        row.id,
        JSON.stringify(state()),
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query(`select api.archive_sheet_instance($1,2)`, [row.id]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query(`select api.duplicate_sheet_instance($1,2,'No')`, [row.id]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('permits member reads, hides rows from non-members, and denies every direct uncontrolled write', async () => {
    const owner = await actor(OWNER, WS_A)
    const row = await create(owner)
    const member = await actor(MEMBER, WS_A)
    const outsider = await actor(OUTSIDER, WS_B)
    expect(
      (
        await member.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await outsider.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(0)
    await expect(
      member.query(
        `insert into api.sheet_instances(workspace_id,name,state) values($1,'Bypass',$2::jsonb)`,
        [WS_A, JSON.stringify(state())],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(`update api.sheet_instances set name='Bypass' where id=$1`, [
        row.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(`delete from api.sheet_instances where id=$1`, [row.id]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      migrator.query(`delete from api.sheet_instances where id=$1`, [row.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('has exactly one named enabled guard trigger and revokes both helper ACLs from all public roles', async () => {
    expect(
      (
        await migrator.query(
          `select tgname,tgenabled,count(*)::integer count from pg_trigger where tgrelid='api.sheet_instances'::regclass and not tgisinternal group by tgname,tgenabled`,
        )
      ).rows,
    ).toEqual([{ tgname: 'guard_sheet_instance', tgenabled: 'O', count: 1 }])
    expect(
      (
        await migrator.query(
          `select p.oid::regprocedure::text function_name,coalesce(r.rolname,'PUBLIC') role_name
           from pg_proc p
           cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
           left join pg_roles r on r.oid=acl.grantee
           where p.oid=any(array['internal.validate_sheet_instance_state(jsonb)'::regprocedure,'internal.guard_sheet_instance()'::regprocedure])
             and acl.privilege_type='EXECUTE'
             and (acl.grantee=0 or r.rolname in ('authenticated','api_client'))`,
        )
      ).rows,
    ).toEqual([])
  })
})
