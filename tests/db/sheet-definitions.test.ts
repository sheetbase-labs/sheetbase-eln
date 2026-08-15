import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  sheetDefinitionInvalidCases,
  sheetDefinitionValidCases,
  validSheetDefinitionConfiguration,
} from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS_A = '11000000-0000-4000-8000-000000000001'
const WS_B = '11000000-0000-4000-8000-000000000002'
const OWNER_A = 'sheet-definition-owner-a'
const ADMIN_A = 'sheet-definition-admin-a'
const MEMBER_A = 'sheet-definition-member-a'
const OWNER_B = 'sheet-definition-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

async function create(
  owner: Client,
  key = `definition_${crypto.randomUUID().slice(0, 8)}`,
) {
  const result = (
    await owner.query(
      `select api.create_sheet_definition($1,$2,$3,$4,$5::jsonb) result`,
      [
        WS_A,
        key,
        'Purification summary',
        'Reusable configuration',
        JSON.stringify(validSheetDefinitionConfiguration()),
      ],
    )
  ).rows[0].result
  return result as {
    definition: { id: string; revision: number; lifecycle: string }
    version: {
      id: string
      revision: number
      version: number
      lifecycle: string
    }
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner A','sheet-definition-owner-a@test.invalid',true),
      ($2,'Admin A','sheet-definition-admin-a@test.invalid',true),
      ($3,'Member A','sheet-definition-member-a@test.invalid',true),
      ($4,'Owner B','sheet-definition-owner-b@test.invalid',true)`,
    [OWNER_A, ADMIN_A, MEMBER_A, OWNER_B],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
      ($1,'sheet-definition-a','Sheet Definition A'),
      ($2,'sheet-definition-b','Sheet Definition B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member'),($5,$6,'owner')`,
    [WS_A, OWNER_A, ADMIN_A, MEMBER_A, WS_B, OWNER_B],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('Sheet Definition persistence and authority', () => {
  it('creates and reads an independent Definition without Notebook, block, table or Instance rows', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const created = await create(owner, 'independent_definition')
    expect(created.definition.id).toMatch(/[0-9a-f-]{36}/)
    expect(created.version).toMatchObject({ version: 1, lifecycle: 'draft' })
    const rows = await owner.query(
      `select d.key,v.version,v.configuration->>'formatVersion' format
       from api.sheet_definitions d join api.sheet_definition_versions v on v.definition_id=d.id
       where d.id=$1`,
      [created.definition.id],
    )
    expect(rows.rows).toEqual([
      { key: 'independent_definition', version: 1, format: '1' },
    ])
    expect(
      (
        await migrator.query(
          `select count(*)::integer count from api.blocks where payload->>'sheetDefinitionId'=$1`,
          [created.definition.id],
        )
      ).rows[0].count,
    ).toBe(0)
  })

  it('isolates workspaces, permits member reads, and restricts configuration to owner/admin RPCs', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const member = await actor(MEMBER_A, WS_A)
    const ownerB = await actor(OWNER_B, WS_B)
    const admin = await actor(ADMIN_A, WS_A)
    const created = await create(owner)
    expect(
      (
        await member.query(`select id from api.sheet_definitions where id=$1`, [
          created.definition.id,
        ])
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await ownerB.query(`select id from api.sheet_definitions where id=$1`, [
          created.definition.id,
        ])
      ).rowCount,
    ).toBe(0)
    await expect(create(member)).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(
        `update api.sheet_definitions set name='bypass' where id=$1`,
        [created.definition.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    const metadata = await admin.query(
      `select (api.update_sheet_definition($1,1,'{"name":"Admin update"}'::jsonb)).name name`,
      [created.definition.id],
    )
    expect(metadata.rows[0].name).toBe('Admin update')
  })

  it('strictly rejects malformed documents in every top-level section at the controlled DB boundary', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const sections = [
      'formatVersion',
      'parameters',
      'bindings',
      'rowIdentity',
      'joins',
      'columns',
      'calculations',
      'writeBackRules',
      'actions',
      'presentation',
    ] as const
    for (const section of sections) {
      const invalid = structuredClone(
        validSheetDefinitionConfiguration(),
      ) as Record<string, unknown>
      invalid[section] = null
      await expect(
        owner.query(
          `select api.create_sheet_definition($1,$2,'Invalid',null,$3::jsonb)`,
          [WS_A, `invalid_${section.toLowerCase()}`, JSON.stringify(invalid)],
        ),
      ).rejects.toMatchObject({ code: 'SB071' })
    }
  })

  it('rejects duplicate stable IDs and unresolved internal references at the DB boundary', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const invalidDocuments = [
      (value: any) => (value.bindings[1].id = value.bindings[0].id),
      (value: any) => (value.bindings[0].parameterId = crypto.randomUUID()),
      (value: any) => (value.rowIdentity.columnIds[0] = crypto.randomUUID()),
      (value: any) => (value.joins[0].leftBindingId = crypto.randomUUID()),
      (value: any) =>
        (value.calculations[0].inputColumnIds[0] = crypto.randomUUID()),
      (value: any) =>
        (value.writeBackRules[0].mappings[0].columnId = crypto.randomUUID()),
      (value: any) => (value.actions[0].parameterId = crypto.randomUUID()),
      (value: any) =>
        (value.presentation.hiddenColumnIds[0] = crypto.randomUUID()),
    ]
    for (const [index, mutate] of invalidDocuments.entries()) {
      const invalid = structuredClone(validSheetDefinitionConfiguration())
      mutate(invalid)
      await expect(
        owner.query(
          `select api.create_sheet_definition($1,$2,'Invalid',null,$3::jsonb)`,
          [WS_A, `invalid_reference_${index}`, JSON.stringify(invalid)],
        ),
      ).rejects.toMatchObject({ code: 'SB071' })
    }
  })

  it('matches typed shape, key, default, FieldDefinition and structural-reference rejection at the public DB boundary', async () => {
    const owner = await actor(OWNER_A, WS_A)
    for (const [index, testCase] of sheetDefinitionInvalidCases.entries()) {
      const invalid = structuredClone(validSheetDefinitionConfiguration())
      testCase.mutate(invalid)
      await expect(
        owner.query(
          `select api.create_sheet_definition($1,$2,'Invalid parity',null,$3::jsonb)`,
          [WS_A, `invalid_parity_${index}`, JSON.stringify(invalid)],
        ),
        testCase.name,
      ).rejects.toMatchObject({ code: 'SB071' })
    }
  })

  it('rejects PostgreSQL-only unbounded numeric Parameter metadata', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const configuration = structuredClone(validSheetDefinitionConfiguration())
    configuration.parameters[0].type = {
      kind: 'scalar',
      valueType: 'decimal',
    }
    configuration.parameters[0].constraints = {}
    await expect(
      owner.query(
        `select api.create_sheet_definition(
          $1,'unbounded_parameter','Invalid',null,
          jsonb_set($2::jsonb,'{parameters,0,constraints}','{"min":1e400}'::jsonb))`,
        [WS_A, JSON.stringify(configuration)],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('accepts all typed scalar defaults and RFC UUID versions at both public boundaries', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const defaults = [
      ['text', 'result'],
      ['integer', 12],
      ['decimal', 12.5],
      ['boolean', true],
      ['date', '2026-08-14'],
      ['timestamp', '2026-08-14T12:30:00Z'],
      ['category', 'a0000000-0000-7000-8000-000000000001'],
      ['reference', 'a0000000-0000-7000-8000-000000000002'],
    ] as const
    for (const [index, [valueType, defaultValue]] of defaults.entries()) {
      const configuration: any = structuredClone(
        validSheetDefinitionConfiguration(),
      )
      configuration.parameters[0].type = { kind: 'scalar', valueType }
      configuration.parameters[0].defaultValue = defaultValue
      configuration.columns[0].source.sourceFieldId =
        'a0000000-0000-7000-8000-000000000003'
      await expect(
        owner.query(
          `select api.create_sheet_definition($1,$2,'Valid parity',null,$3::jsonb)`,
          [WS_A, `valid_parity_${index}`, JSON.stringify(configuration)],
        ),
      ).resolves.toMatchObject({ rowCount: 1 })
    }
  })

  it('accepts the shared valid UUID and timestamp parity matrix at the public DB boundary', async () => {
    const owner = await actor(OWNER_A, WS_A)
    for (const [index, testCase] of sheetDefinitionValidCases.entries()) {
      const configuration = structuredClone(validSheetDefinitionConfiguration())
      testCase.mutate(configuration)
      await expect(
        owner.query(
          `select api.create_sheet_definition($1,$2,'Valid parity matrix',null,$3::jsonb)`,
          [WS_A, `valid_matrix_${index}`, JSON.stringify(configuration)],
        ),
        testCase.name,
      ).resolves.toMatchObject({ rowCount: 1 })
    }
  })

  it('keeps guard triggers enabled and internal validators unavailable to API roles', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const triggers = await migrator.query(
      `select count(*)::integer trigger_count,bool_and(tgenabled='O') enabled
       from pg_trigger
       where tgname in ('guard_sheet_definition','guard_sheet_definition_version')`,
    )
    expect(triggers.rows[0]).toEqual({ trigger_count: 2, enabled: true })
    await expect(
      owner.query(
        `select internal.validate_sheet_definition_configuration($1::jsonb)`,
        [JSON.stringify(validSheetDefinitionConfiguration())],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('enforces stable IDs, explicit monotonic versions and optimistic conflicts', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const created = await create(owner)
    const configuration = validSheetDefinitionConfiguration()
    const initialRevision = (
      await owner.query(
        `select revision from api.sheet_definition_versions where id=$1`,
        [created.version.id],
      )
    ).rows[0].revision
    expect(initialRevision).toBe('1')
    const updated = (
      await owner.query(
        `select result.* from api.update_sheet_definition_draft($1,$2,$3::jsonb) result`,
        [created.version.id, initialRevision, JSON.stringify(configuration)],
      )
    ).rows[0]
    expect(updated.revision).toBe('2')
    expect(
      updated.configuration.columns.map((column: { id: string }) => column.id),
    ).toEqual(configuration.columns.map((column) => column.id))
    await expect(
      owner.query(`select api.update_sheet_definition_draft($1,1,$2::jsonb)`, [
        created.version.id,
        JSON.stringify(configuration),
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    const versionTwo = (
      await owner.query(
        `select result.* from api.create_sheet_definition_version($1,1,$2::jsonb) result`,
        [created.definition.id, JSON.stringify(configuration)],
      )
    ).rows[0]
    expect(versionTwo.version).toBe(2)
    await expect(
      owner.query(
        `select api.create_sheet_definition_version($1,1,$2::jsonb)`,
        [created.definition.id, JSON.stringify(configuration)],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      migrator.query(
        `insert into api.sheet_definition_versions(definition_id,version,configuration) values($1,5,$2::jsonb)`,
        [created.definition.id, JSON.stringify(configuration)],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('freezes publication against RPC and direct-table bypass, then preserves readable retired targets', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const member = await actor(MEMBER_A, WS_A)
    const created = await create(owner)
    const initialRevision = (
      await owner.query(
        `select revision from api.sheet_definition_versions where id=$1`,
        [created.version.id],
      )
    ).rows[0].revision
    expect(initialRevision).toBe('1')
    const published = (
      await owner.query(
        `select result.* from api.publish_sheet_definition_version($1,$2) result`,
        [created.version.id, initialRevision],
      )
    ).rows[0]
    expect(published).toMatchObject({ lifecycle: 'published', revision: '2' })
    expect(published.published_by_user_id).toBe(OWNER_A)
    await expect(
      owner.query(`select api.update_sheet_definition_draft($1,2,$2::jsonb)`, [
        created.version.id,
        JSON.stringify(validSheetDefinitionConfiguration()),
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      migrator.query(
        `update api.sheet_definition_versions set configuration='{}'::jsonb where id=$1`,
        [created.version.id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
    const versionTwo = (
      await owner.query(
        `select result.* from api.create_sheet_definition_version($1,1,$2::jsonb) result`,
        [
          created.definition.id,
          JSON.stringify(validSheetDefinitionConfiguration()),
        ],
      )
    ).rows[0]
    const retiredDefinition = (
      await owner.query(
        `select result.* from api.retire_sheet_definition($1,2) result`,
        [created.definition.id],
      )
    ).rows[0]
    expect(retiredDefinition.lifecycle).toBe('retired')
    await expect(
      owner.query(`select api.update_sheet_definition_draft($1,1,$2::jsonb)`, [
        versionTwo.id,
        JSON.stringify(validSheetDefinitionConfiguration()),
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      owner.query(`select api.publish_sheet_definition_version($1,1)`, [
        versionTwo.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      owner.query(
        `select api.create_sheet_definition_version($1,3,$2::jsonb)`,
        [
          created.definition.id,
          JSON.stringify(validSheetDefinitionConfiguration()),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
    const retiredVersion = (
      await owner.query(
        `select result.* from api.retire_sheet_definition_version($1,2) result`,
        [created.version.id],
      )
    ).rows[0]
    expect(retiredVersion.lifecycle).toBe('retired')
    const readable = await member.query(
      `select d.lifecycle definition_lifecycle,v.lifecycle version_lifecycle,v.configuration
       from api.sheet_definitions d join api.sheet_definition_versions v on v.definition_id=d.id
       where d.id=$1 and v.id=$2`,
      [created.definition.id, created.version.id],
    )
    expect(readable.rows[0]).toMatchObject({
      definition_lifecycle: 'retired',
      version_lifecycle: 'retired',
      configuration: validSheetDefinitionConfiguration(),
    })
    await expect(
      migrator.query(
        `update api.sheet_definitions set key='changed' where id=$1`,
        [created.definition.id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
