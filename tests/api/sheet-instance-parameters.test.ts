import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'

config({ path: ['.env.local', '.env'] })

const WS = '17000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-instance-parameter-api-owner'
const SCHEMA = '17000000-0000-4000-8000-000000000002'
const SCHEMA_VERSION = '17000000-0000-4000-8000-000000000003'
const DATASET = '17000000-0000-4000-8000-000000000004'
const PARAMETER = '17000000-0000-4000-8000-000000000005'
const BINDING = '17000000-0000-4000-8000-000000000006'
const COLUMN = '17000000-0000-4000-8000-000000000007'
const FIELD = '17000000-0000-4000-8000-000000000008'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''
let admin: Client

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => ({
      user: { id: OWNER },
      session: { id: 'sheet-instance-parameter-api-session' },
    }),
    getWorkspaceForUser: async () => ({ id: WS }),
    mintToken: (input) => mintPostgrestToken(SECRET, input),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function request(path: string, body: unknown) {
  return new Request(`http://sheetbase.test/api/db/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function configuration() {
  const value: any = structuredClone(validSheetDefinitionConfiguration())
  value.parameters = [
    {
      id: PARAMETER,
      key: 'source',
      label: 'Source',
      required: true,
      type: {
        kind: 'dataset',
        contract: { mode: 'exact', schemaVersionId: SCHEMA_VERSION },
      },
      constraints: {},
    },
  ]
  value.bindings = [{ id: BINDING, key: 'source', parameterId: PARAMETER }]
  const column = value.columns[0]
  column.id = COLUMN
  column.field.fieldId = COLUMN
  column.source = {
    kind: 'bound',
    bindingId: BINDING,
    sourceFieldId: FIELD,
  }
  value.columns = [column]
  value.rowIdentity = { kind: 'source', columnIds: [COLUMN] }
  value.joins = []
  value.calculations = []
  value.writeBackRules = []
  value.actions = []
  value.presentation = {
    columnOrder: [COLUMN],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  }
  return value
}

function state() {
  return {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
    provenance: { createdFrom: 'ad_hoc' },
    resolutionProvenance: {
      sourceDefinitionVersionId: crypto.randomUUID(),
      resolvedAt: new Date(0).toISOString(),
      resolvedByUserId: 'forged',
      parameters: [],
    },
  }
}

async function cleanup() {
  await admin.query('begin')
  try {
    for (const table of [
      'api.sheet_instances',
      'api.sheet_definition_versions',
      'api.sheet_definitions',
      'api.datasets',
      'api.dataset_schema_version_fields',
      'api.dataset_schema_versions',
      'api.dataset_schema_definitions',
    ])
      await admin.query(`alter table ${table} disable trigger user`)
    await admin.query(`delete from api.sheet_instances where workspace_id=$1`, [
      WS,
    ])
    await admin.query(
      `delete from api.sheet_definition_versions where definition_id in (select id from api.sheet_definitions where workspace_id=$1)`,
      [WS],
    )
    await admin.query(
      `delete from api.sheet_definitions where workspace_id=$1`,
      [WS],
    )
    await admin.query(`delete from api.datasets where workspace_id=$1`, [WS])
    await admin.query(
      `delete from api.dataset_schema_version_fields where schema_version_id=$1`,
      [SCHEMA_VERSION],
    )
    await admin.query(
      `delete from api.dataset_schema_versions where schema_id=$1`,
      [SCHEMA],
    )
    await admin.query(
      `delete from api.dataset_schema_definitions where workspace_id=$1`,
      [WS],
    )
    for (const table of [
      'api.dataset_schema_definitions',
      'api.dataset_schema_versions',
      'api.dataset_schema_version_fields',
      'api.datasets',
      'api.sheet_definitions',
      'api.sheet_definition_versions',
      'api.sheet_instances',
    ])
      await admin.query(`alter table ${table} enable trigger user`)
    await admin.query(`delete from api.workspaces where id=$1`, [WS])
    await admin.query(`delete from internal."user" where id=$1`, [OWNER])
    await admin.query('commit')
  } catch (error) {
    await admin.query('rollback').catch(() => undefined)
    throw error
  }
}

async function expectSheetInstanceGuardEnabled() {
  const result = await admin.query(
    `select tgenabled from pg_trigger
     where tgrelid='api.sheet_instances'::regclass
       and tgname='guard_sheet_instance'`,
  )
  expect(result.rows).toEqual([{ tgenabled: 'O' }])
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await cleanup()
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Parameter API Owner','parameter-api@test.invalid',true)`,
    [OWNER],
  )
  await admin.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-instance-parameter-api','Parameter API')`,
    [WS],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await admin.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) values($1,$2,'api_source','API source','active')`,
    [SCHEMA, WS],
  )
  await admin.query(
    `insert into api.dataset_schema_versions(id,schema_id,version) values($1,$2,1)`,
    [SCHEMA_VERSION, SCHEMA],
  )
  await admin.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,lifecycle,display_order) values($1,$2,'result','Result','text','active',0)`,
    [SCHEMA_VERSION, FIELD],
  )
  await admin.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [SCHEMA_VERSION],
  )
  await admin.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name) values($1,$2,$3,'API candidate')`,
    [DATASET, WS, SCHEMA_VERSION],
  )
})

afterAll(async () => {
  if (admin) {
    try {
      await cleanup()
      await expectSheetInstanceGuardEnabled()
    } finally {
      await admin.end()
    }
  }
})

describe('Definition-derived Sheet Instance HTTP API contract', () => {
  it('resolves compatible inputs authoritatively and rejects a missing required input', async () => {
    const createDefinition = await proxy(
      request('rpc/create_sheet_definition', {
        p_workspace_id: WS,
        p_key: 'parameter_api_definition',
        p_name: 'Parameter API Definition',
        p_description: null,
        p_configuration: configuration(),
      }),
      'rpc/create_sheet_definition',
    )
    expect(createDefinition.status).toBe(200)
    const createdDefinition = await createDefinition.json()
    const versionId = createdDefinition.version.id
    const publish = await proxy(
      request('rpc/publish_sheet_definition_version', {
        p_version_id: versionId,
        p_expected_revision: 1,
      }),
      'rpc/publish_sheet_definition_version',
    )
    expect(publish.status).toBe(200)

    const createInstance = (inputs: unknown[]) =>
      proxy(
        request('rpc/create_sheet_instance_from_definition', {
          p_workspace_id: WS,
          p_name: 'Resolved through API',
          p_description: null,
          p_source_definition_version_id: versionId,
          p_project_id: null,
          p_notebook_record_id: null,
          p_state: state(),
          p_parameter_inputs: inputs,
        }),
        'rpc/create_sheet_instance_from_definition',
      )
    const success = await createInstance([
      { parameterId: PARAMETER, kind: 'dataset', datasetId: DATASET },
    ])
    expect(success.status).toBe(200)
    const instance = await success.json()
    expect(instance.state.bindings[0]).toMatchObject({
      parameterId: PARAMETER,
      datasetId: DATASET,
      resolution: {
        compatibilityMode: 'exact',
        candidateSchemaVersionId: SCHEMA_VERSION,
      },
    })
    expect(instance.state.resolutionProvenance).toMatchObject({
      sourceDefinitionVersionId: versionId,
      resolvedByUserId: OWNER,
    })

    const missing = await createInstance([])
    expect(missing.status).toBeGreaterThanOrEqual(400)
    expect((await missing.json()).error.category).toBe('validation_error')
  })
})
