import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '06500000-0000-4000-8000-000000000001'
const OTHER_WS = '06500000-0000-4000-8000-000000000002'
const PROJECT = '06500000-0000-4000-8000-000000000003'
const OTHER_PROJECT = '06500000-0000-4000-8000-000000000004'
const OWNER = 'core-065-owner'
const MEMBER = 'core-065-member'
const OTHER = 'core-065-other'
const NARRATIVE = '06500000-0000-4000-8000-000000000010'
const PLACEMENT = '06500000-0000-4000-8000-000000000011'
const NARRATIVE_V2 = '06500000-0000-4000-8000-000000000012'
const TEMPLATE_PARAMETER = '06500000-0000-4000-8000-000000000013'
const RECORD_B = '06500000-0000-4000-8000-000000000020'

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

function localDefinitionConfiguration() {
  const configuration: Record<string, unknown> = structuredClone(
    validSheetDefinitionConfiguration(),
  )
  const columns = configuration.columns as Array<{
    id: string
    source: { kind: string }
    field: { logicalType: string; relationship: unknown }
  }>
  const column = columns[0]
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

function narrativeConfig(id = NARRATIVE, order = 1) {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id,
        kind: 'narrative',
        order,
        blockType: 'rich_text',
        payload: {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      },
    ],
  }
}

function sheetConfig(definitionVersionId: string, extraNarrative = false) {
  const placements: unknown[] = [
    {
      id: PLACEMENT,
      kind: 'sheet',
      order: 1,
      definitionVersionId,
      parameterMappings: [],
    },
  ]
  if (extraNarrative) {
    placements.push({
      id: NARRATIVE_V2,
      kind: 'narrative',
      order: 2,
      blockType: 'rich_text',
      payload: {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    })
  }
  return { formatVersion: 1, parameters: [], placements }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','core-065-owner@test.invalid',true),
      ($2,'Member','core-065-member@test.invalid',true),
      ($3,'Other','core-065-other@test.invalid',true)`,
    [OWNER, MEMBER, OTHER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
      ($1,'core-065','CORE-06.5'),
      ($2,'core-065-other','CORE-06.5 other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`,
    [WS, OWNER, MEMBER, OTHER_WS, OTHER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values
      ($1,$3,'C65','CORE-06.5'),
      ($2,$4,'C65O','CORE-06.5 other')`,
    [PROJECT, OTHER_PROJECT, WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values ($1,$2,$3,'experiment','C65-B','Share target',$4)`,
    [RECORD_B, WS, PROJECT, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-06.5 / 06.6 / 06.10 instantiate, share and upgrade', () => {
  it('creates independent Instances, is idempotent, and rolls back failed parameters', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)
    const other = await actor(OTHER, OTHER_WS)

    const local = (
      await owner.query(
        `select api.create_sheet_definition($1,'nb_local','Notebook local',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      local.version.id,
      local.version.revision,
    ])

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'purification_run','Purification run',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(local.version.id))],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result

    const first = (
      await member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run A','[]'::jsonb,'idem-a') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result
    const second = (
      await member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run B','[]'::jsonb,'idem-b') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result
    expect(first.record.source_notebook_template_version_id).toBe(published.id)
    expect(first.idempotent).toBe(false)

    const instances = (
      await member.query(
        `select b.record_id, b.payload->>'instanceId' instance_id
           from api.blocks b
          where b.record_id in ($1,$2) and b.type='sheet'
          order by b.record_id`,
        [first.record.id, second.record.id],
      )
    ).rows
    expect(instances).toHaveLength(2)
    expect(instances[0].instance_id).not.toBe(instances[1].instance_id)

    const replay = (
      await member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run A','[]'::jsonb,'idem-a') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result
    expect(replay.idempotent).toBe(true)
    expect(replay.record.id).toBe(first.record.id)

    await expectDenied(
      other.query(
        `select api.instantiate_notebook_template_version($1,$2,'Nope','[]'::jsonb,'other')`,
        [published.id, PROJECT],
      ),
      'SB090',
    )

    const required = (
      await owner.query(
        `select api.create_notebook_template($1,'needs_params','Needs params',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify({
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
            ],
            placements: narrativeConfig().placements,
          }),
        ],
      )
    ).rows[0].result
    const requiredPublished = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [required.version.id, required.version.revision],
      )
    ).rows[0].result
    const before = (
      await member.query(`select count(*)::int count from api.records`)
    ).rows[0].count
    await expectDenied(
      member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Fail','[]'::jsonb,'idem-fail')`,
        [requiredPublished.id, PROJECT],
      ),
      'SB091',
    )
    const after = (
      await member.query(`select count(*)::int count from api.records`)
    ).rows[0].count
    expect(after).toBe(before)
  })

  it('embeds a shared live Instance without destroying it when one placement is deleted', async () => {
    const owner = await actor(OWNER, WS)
    const created = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,NULL,NULL,NULL) result`,
        [RECORD_B],
      )
    ).rows[0].result
    const instanceId = created.instance.id as string
    const notebookA = (
      await owner.query(
        `select to_jsonb(api.create_record($1,'experiment','Shared host','draft','{}'::text[],'{}'::jsonb)) result`,
        [PROJECT],
      )
    ).rows[0].result
    await owner.query(
      `select api.insert_sheet_instance_block($1,NULL,NULL,$2)`,
      [notebookA.id, instanceId],
    )

    const embeddings = (
      await owner.query(
        `select api.sheet_instance_notebook_embeddings($1) result`,
        [instanceId],
      )
    ).rows[0].result
    expect(embeddings.count).toBe(2)

    await owner.query(`select api.delete_block($1,NULL)`, [
      created.block.id,
    ])
    const remaining = (
      await owner.query(
        `select lifecycle from api.sheet_instances where id=$1`,
        [instanceId],
      )
    ).rows[0]
    expect(remaining.lifecycle).toBe('active')
    const afterDelete = (
      await owner.query(
        `select api.sheet_instance_notebook_embeddings($1) result`,
        [instanceId],
      )
    ).rows[0].result
    expect(afterDelete.count).toBe(1)
  })

  it('keeps existing Notebooks on Template v1 until an explicit upgrade', async () => {
    const owner = await actor(OWNER, WS)
    const local = (
      await owner.query(
        `select api.create_sheet_definition($1,'upgrade_local','Upgrade local',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      local.version.id,
      local.version.revision,
    ])
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'upgrade_nb','Upgrade notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(local.version.id))],
      )
    ).rows[0].result
    const v1 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    const notebook = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Pinned v1','[]'::jsonb,'idem-upgrade') result`,
        [v1.id, PROJECT],
      )
    ).rows[0].result

    const v2draft = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [
          created.template.id,
          created.template.revision,
          JSON.stringify(sheetConfig(local.version.id, true)),
        ],
      )
    ).rows[0].result
    const v2 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [v2draft.id, v2draft.revision],
      )
    ).rows[0].result

    const stillV1 = (
      await owner.query(
        `select source_notebook_template_version_id source, structure_version
           from api.records where id=$1`,
        [notebook.record.id],
      )
    ).rows[0]
    expect(stillV1.source).toBe(v1.id)
    const blocksBefore = (
      await owner.query(
        `select count(*)::int count from api.blocks where record_id=$1`,
        [notebook.record.id],
      )
    ).rows[0].count
    expect(blocksBefore).toBe(1)

    await expectDenied(
      owner.query(
        `select api.apply_notebook_template_upgrade($1,$2,$3,'[]'::jsonb,'[]'::jsonb)`,
        [notebook.record.id, stillV1.structure_version + 1, v2.id],
      ),
      'SB001',
    )

    const preview = (
      await owner.query(
        `select api.preview_notebook_template_upgrade($1,$2) result`,
        [notebook.record.id, v2.id],
      )
    ).rows[0].result
    expect(preview.automatic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'placement-added',
          placementId: NARRATIVE_V2,
        }),
      ]),
    )

    const applied = (
      await owner.query(
        `select api.apply_notebook_template_upgrade($1,$2,$3,'[]'::jsonb,'[]'::jsonb) result`,
        [notebook.record.id, stillV1.structure_version, v2.id],
      )
    ).rows[0].result
    expect(applied.record.source_notebook_template_version_id).toBe(v2.id)
    const blocksAfter = (
      await owner.query(
        `select type from api.blocks where record_id=$1 order by "order"`,
        [notebook.record.id],
      )
    ).rows.map((row: { type: string }) => row.type)
    expect(blocksAfter).toEqual(['sheet', 'rich_text'])
  })

  it('retargets a draft Template placement without rewriting published Notebooks', async () => {
    const owner = await actor(OWNER, WS)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'retarget_src','Retarget source',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const v2def = (
      await owner.query(
        `select to_jsonb(api.create_sheet_definition_version($1,1,$2::jsonb)) result`,
        [definition.definition.id, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    const publishedDef2 = (
      await owner.query(
        `select to_jsonb(api.publish_sheet_definition_version($1,$2)) result`,
        [v2def.id, v2def.revision],
      )
    ).rows[0].result

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'retarget_nb','Retarget notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(definition.version.id))],
      )
    ).rows[0].result
    const v1 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    const notebook = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Stay on v1','[]'::jsonb,'idem-retarget') result`,
        [v1.id, PROJECT],
      )
    ).rows[0].result

    const draft = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [
          created.template.id,
          created.template.revision,
          JSON.stringify(sheetConfig(definition.version.id)),
        ],
      )
    ).rows[0].result
    const retargeted = (
      await owner.query(
        `select to_jsonb(api.retarget_notebook_template_sheet_placement($1,$2,$3,$4)) result`,
        [draft.id, draft.revision, PLACEMENT, publishedDef2.id],
      )
    ).rows[0].result
    expect(retargeted.configuration.placements[0].definitionVersionId).toBe(
      publishedDef2.id,
    )

    await expectDenied(
      owner.query(
        `select api.retarget_notebook_template_sheet_placement($1,$2,$3,$4)`,
        [v1.id, v1.revision, PLACEMENT, publishedDef2.id],
      ),
      'SB090',
    )

    const instance = (
      await owner.query(
        `select i.source_definition_version_id source
           from api.blocks b
           join api.sheet_instances i on i.id = (b.payload->>'instanceId')::uuid
          where b.record_id=$1 and b.type='sheet'`,
        [notebook.record.id],
      )
    ).rows[0]
    expect(instance.source).toBe(definition.version.id)
    const pinned = (
      await owner.query(
        `select source_notebook_template_version_id from api.records where id=$1`,
        [notebook.record.id],
      )
    ).rows[0]
    expect(pinned.source_notebook_template_version_id).toBe(v1.id)
  })
})
