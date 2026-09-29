import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '06300000-0000-4000-8000-000000000001'
const OTHER_WS = '06300000-0000-4000-8000-000000000002'
const OWNER = 'core-063-owner'
const MEMBER = 'core-063-member'
const OTHER = 'core-063-other'
const PARAMETER = '10000000-0000-4000-8000-000000000001'
const PLACEMENT_A = '06300000-0000-4000-8000-000000000010'
const PLACEMENT_B = '06300000-0000-4000-8000-000000000011'
const NARRATIVE = '06300000-0000-4000-8000-000000000012'
const TEMPLATE_PARAMETER = '06300000-0000-4000-8000-000000000013'
const TEMPLATE_PARAMETER_B = '06300000-0000-4000-8000-000000000014'
const DEFINITION_PARAMETER_B = '10000000-0000-4000-8000-000000000002'

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

function narrativeConfig() {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: NARRATIVE,
        kind: 'narrative',
        order: 1,
        blockType: 'rich_text',
        payload: {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      },
    ],
  }
}

function sheetMappings() {
  return [
    {
      templateParameterId: TEMPLATE_PARAMETER,
      definitionParameterId: PARAMETER,
    },
    {
      templateParameterId: TEMPLATE_PARAMETER_B,
      definitionParameterId: DEFINITION_PARAMETER_B,
    },
  ]
}

function sheetConfig(definitionVersionId: string, second = false) {
  const placements = [
    {
      id: PLACEMENT_A,
      kind: 'sheet' as const,
      order: 1,
      definitionVersionId,
      parameterMappings: sheetMappings(),
    },
  ]
  if (second) {
    placements.push({
      id: PLACEMENT_B,
      kind: 'sheet',
      order: 2,
      definitionVersionId,
      parameterMappings: sheetMappings(),
    })
  }
  return {
    formatVersion: 1,
    parameters: [
      {
        id: TEMPLATE_PARAMETER,
        key: 'results',
        label: 'Results',
        required: true,
        type: {
          kind: 'dataset',
          contract: {
            mode: 'exact',
            schemaVersionId: '90000000-0000-4000-8000-000000000001',
          },
        },
        constraints: {},
      },
      {
        id: TEMPLATE_PARAMETER_B,
        key: 'comparison',
        label: 'Comparison',
        required: true,
        type: {
          kind: 'dataset-version',
          contract: {
            mode: 'semantic',
            requiredFieldIds: ['40000000-0000-4000-8000-000000000002'],
          },
        },
        constraints: {},
      },
    ],
    placements,
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','core-063-owner@test.invalid',true),
      ($2,'Member','core-063-member@test.invalid',true),
      ($3,'Other','core-063-other@test.invalid',true)`,
    [OWNER, MEMBER, OTHER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
      ($1,'core-063','CORE-06.3'),
      ($2,'core-063-other','CORE-06.3 other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`,
    [WS, OWNER, MEMBER, OTHER_WS, OTHER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-06.3 / 06.4 Notebook Template versions', () => {
  it('creates draft versions, publishes immutably, and isolates workspaces', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)
    const other = await actor(OTHER, OTHER_WS)
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'purification_nb','Purification notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(narrativeConfig())],
      )
    ).rows[0].result
    expect(created.version.lifecycle).toBe('draft')
    expect(created.template.revision).toBe(1)

    await expectDenied(
      member.query(
        `select api.create_notebook_template($1,'member_nb','Nope',null,$2::jsonb)`,
        [WS, JSON.stringify(narrativeConfig())],
      ),
      '42501',
    )

    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    expect(published.lifecycle).toBe('published')

    await expectDenied(
      owner.query(
        `select api.update_notebook_template_version($1,$2,$3::jsonb)`,
        [
          created.version.id,
          published.revision,
          JSON.stringify(narrativeConfig()),
        ],
      ),
      'SB090',
    )

    const v2 = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [created.template.id, 1, JSON.stringify(narrativeConfig())],
      )
    ).rows[0].result
    expect(v2.version).toBe(2)
    expect(v2.lifecycle).toBe('draft')

    const hidden = await other.query(
      `select count(*)::int count from api.notebook_templates where id=$1`,
      [created.template.id],
    )
    expect(hidden.rows[0].count).toBe(0)
  })

  it('pins published Definition Versions, allows reuse, and maps parameters by id', async () => {
    const owner = await actor(OWNER, WS)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'tmpl_source','Template source',null,$2::jsonb) result`,
        [WS, JSON.stringify(validSheetDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'two_sheets','Two sheets',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(definition.version.id, true))],
      )
    ).rows[0].result
    expect(created.version.configuration.placements).toHaveLength(2)
    expect(
      created.version.configuration.placements.map(
        (placement: { definitionVersionId: string }) =>
          placement.definitionVersionId,
      ),
    ).toEqual([definition.version.id, definition.version.id])

    await expectDenied(
      owner.query(
        `select api.create_notebook_template($1,'bad_map','Bad map',null,$2::jsonb)`,
        [
          WS,
          JSON.stringify({
            formatVersion: 1,
            parameters: [
              {
                id: TEMPLATE_PARAMETER,
                key: 'batch',
                label: 'Batch',
                required: true,
                type: { kind: 'record', modelKey: 'sample' },
                constraints: {},
              },
            ],
            placements: [
              {
                id: PLACEMENT_A,
                kind: 'sheet',
                order: 1,
                definitionVersionId: definition.version.id,
                parameterMappings: [
                  {
                    templateParameterId: TEMPLATE_PARAMETER,
                    definitionParameterId: PARAMETER,
                  },
                ],
              },
            ],
          }),
        ],
      ),
      'SB091',
    )

    const deps = (
      await owner.query(
        `select api.discover_object_dependencies('notebook_template_version',$1) result`,
        [created.version.id],
      )
    ).rows[0].result
    expect(
      (deps.dependencies as Array<{ kind: string; id: string }>).map(
        (item) => item.id,
      ),
    ).toEqual([definition.version.id])
  })

  it('does not treat api.revisions as the Template version catalogue', async () => {
    const count = (
      await migrator.query(
        `select count(*)::int count from api.revisions r
         join api.notebook_templates t on t.id::text = r.record_id::text`,
      )
    ).rows[0].count
    expect(count).toBe(0)
  })
})
