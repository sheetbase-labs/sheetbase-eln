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
const DEF_OPTIONAL_PARAM = '06500000-0000-4000-8000-000000000014'
const TEMPLATE_OPTIONAL_PARAM = '06500000-0000-4000-8000-000000000015'
const PLACEMENT_OPTIONAL = '06500000-0000-4000-8000-000000000016'
const NARRATIVE_ONLY = '06500000-0000-4000-8000-000000000017'
const PLACEMENT_A = '06500000-0000-4000-8000-000000000018'
const PLACEMENT_B = '06500000-0000-4000-8000-000000000019'

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

function optionalScalarDefinitionConfiguration() {
  const configuration = localDefinitionConfiguration()
  configuration.parameters = [
    {
      id: DEF_OPTIONAL_PARAM,
      key: 'note',
      label: 'Note',
      required: false,
      type: { kind: 'scalar', valueType: 'text' },
      constraints: {},
    },
  ]
  return configuration
}

function templateWithOptionalMappedScalar(definitionVersionId: string) {
  return {
    formatVersion: 1,
    parameters: [
      {
        id: TEMPLATE_OPTIONAL_PARAM,
        key: 'optional_note',
        label: 'Optional note',
        required: false,
        type: { kind: 'scalar', valueType: 'text' },
        constraints: {},
      },
    ],
    placements: [
      {
        id: PLACEMENT_OPTIONAL,
        kind: 'sheet',
        order: 1,
        definitionVersionId,
        parameterMappings: [
          {
            templateParameterId: TEMPLATE_OPTIONAL_PARAM,
            definitionParameterId: DEF_OPTIONAL_PARAM,
          },
        ],
      },
    ],
  }
}

function narrativeOnlyTemplateConfig() {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: NARRATIVE_ONLY,
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

function dualSheetConfig(definitionVersionId: string) {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: PLACEMENT_A,
        kind: 'sheet',
        order: 1,
        definitionVersionId,
        parameterMappings: [],
      },
      {
        id: PLACEMENT_B,
        kind: 'sheet',
        order: 2,
        definitionVersionId,
        parameterMappings: [],
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

    await owner.query(`select api.delete_block($1,NULL)`, [created.block.id])
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
        [
          definition.definition.id,
          JSON.stringify(localDefinitionConfiguration()),
        ],
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

  it('instantiates when an optional mapped scalar Template input is omitted', async () => {
    const owner = await actor(OWNER, WS)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'optional_scalar','Optional scalar',null,$2::jsonb) result`,
        [WS, JSON.stringify(optionalScalarDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'optional_scalar_nb','Optional scalar notebook',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify(
            templateWithOptionalMappedScalar(definition.version.id),
          ),
        ],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result

    const result = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Omit optional','[]'::jsonb,'idem-optional-scalar') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result
    expect(result.idempotent).toBe(false)
    expect(result.record.source_notebook_template_version_id).toBe(published.id)

    const instance = (
      await owner.query(
        `select i.state->'parameterValues' parameter_values
           from api.blocks b
           join api.sheet_instances i on i.id = (b.payload->>'instanceId')::uuid
          where b.record_id = $1 and b.type = 'sheet'`,
        [result.record.id],
      )
    ).rows[0]
    expect(instance.parameter_values).toEqual([])
  })

  it('maps and upgrades two placements sharing one Definition independently', async () => {
    const owner = await actor(OWNER, WS)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'dual_placement','Dual placement',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const definitionV2 = (
      await owner.query(
        `select to_jsonb(api.create_sheet_definition_version($1,1,$2::jsonb)) result`,
        [
          definition.definition.id,
          JSON.stringify(localDefinitionConfiguration()),
        ],
      )
    ).rows[0].result
    const publishedDef2 = (
      await owner.query(
        `select to_jsonb(api.publish_sheet_definition_version($1,$2)) result`,
        [definitionV2.id, definitionV2.revision],
      )
    ).rows[0].result

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'dual_sheet_nb','Dual sheet notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(dualSheetConfig(definition.version.id))],
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
        `select api.instantiate_notebook_template_version($1,$2,'Dual sheets','[]'::jsonb,'idem-dual-sheet') result`,
        [v1.id, PROJECT],
      )
    ).rows[0].result

    const blocks = (
      await owner.query(
        `select b.payload->>'instanceId' instance_id,
                b.payload->>'templatePlacementId' placement_id
           from api.blocks b
          where b.record_id = $1 and b.type = 'sheet'
          order by b."order"`,
        [notebook.record.id],
      )
    ).rows
    expect(blocks).toHaveLength(2)
    expect(blocks[0].instance_id).not.toBe(blocks[1].instance_id)
    expect(
      blocks.map((row: { placement_id: string }) => row.placement_id).sort(),
    ).toEqual([PLACEMENT_A, PLACEMENT_B].sort())

    const v2draft = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [
          created.template.id,
          created.template.revision,
          JSON.stringify(dualSheetConfig(publishedDef2.id)),
        ],
      )
    ).rows[0].result
    const v2 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [v2draft.id, v2draft.revision],
      )
    ).rows[0].result

    const preview = (
      await owner.query(
        `select api.preview_notebook_template_upgrade($1,$2) result`,
        [notebook.record.id, v2.id],
      )
    ).rows[0].result
    const sheetUpgrades = preview.automatic.filter(
      (item: { kind: string }) => item.kind === 'sheet-definition-compatible',
    )
    expect(sheetUpgrades).toHaveLength(2)
    expect(sheetUpgrades[0].instanceId).not.toBe(sheetUpgrades[1].instanceId)
    expect(
      sheetUpgrades
        .map((item: { placementId: string }) => item.placementId)
        .sort(),
    ).toEqual([PLACEMENT_A, PLACEMENT_B].sort())

    const structureVersion = (
      await owner.query(
        `select structure_version from api.records where id=$1`,
        [notebook.record.id],
      )
    ).rows[0].structure_version

    await owner.query(
      `select api.apply_notebook_template_upgrade($1,$2,$3,'[]'::jsonb,'[]'::jsonb) result`,
      [notebook.record.id, structureVersion, v2.id],
    )

    const upgraded = (
      await owner.query(
        `select i.source_definition_version_id source
           from api.blocks b
           join api.sheet_instances i on i.id = (b.payload->>'instanceId')::uuid
          where b.record_id = $1 and b.type = 'sheet'
          order by b."order"`,
        [notebook.record.id],
      )
    ).rows
    expect(upgraded).toHaveLength(2)
    expect(
      upgraded.every(
        (row: { source: string }) => row.source === publishedDef2.id,
      ),
    ).toBe(true)
    expect(
      new Set(upgraded.map((row: { source: string }) => row.source)).size,
    ).toBe(1)
    const instanceIds = (
      await owner.query(
        `select b.payload->>'instanceId' instance_id
           from api.blocks b
          where b.record_id = $1 and b.type = 'sheet'
          order by b."order"`,
        [notebook.record.id],
      )
    ).rows.map((row: { instance_id: string }) => row.instance_id)
    expect(new Set(instanceIds).size).toBe(2)
  })

  it('keeps templatePlacementId system-managed at the data boundary while canonical placement assignment still works', async () => {
    const owner = await actor(OWNER, WS)
    const adHocNotebook = (
      await owner.query(
        `select to_jsonb(api.create_record($1,'experiment','Ad hoc sheet','draft','{}'::text[],'{}'::jsonb)) result`,
        [PROJECT],
      )
    ).rows[0].result
    const adHocInserted = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,NULL,NULL,NULL) result`,
        [adHocNotebook.id],
      )
    ).rows[0].result
    const adHocBlock = adHocInserted.block
    const adHocStructureVersion = (
      await owner.query(
        `select structure_version from api.records where id = $1`,
        [adHocNotebook.id],
      )
    ).rows[0].structure_version

    await expectDenied(
      owner.query(
        `select api.update_block_payload(
           $1,
           ($2::jsonb || jsonb_build_object('templatePlacementId', $5::text)),
           $3,
           $4
         )`,
        [
          adHocBlock.id,
          JSON.stringify(adHocBlock.payload),
          adHocBlock.version,
          adHocStructureVersion,
          crypto.randomUUID(),
        ],
      ),
      '23514',
    )

    await expectDenied(
      owner.query(`select api.insert_block($1,'sheet',$2::jsonb,1,NULL,NULL)`, [
        adHocNotebook.id,
        JSON.stringify({
          instanceId: adHocBlock.payload.instanceId,
          templatePlacementId: crypto.randomUUID(),
        }),
      ]),
      '23514',
    )

    await expectDenied(
      owner.query(
        `update api.blocks
            set payload = payload || jsonb_build_object('templatePlacementId', $2::text)
          where id = $1`,
        [adHocBlock.id, crypto.randomUUID()],
      ),
      '23514',
    )

    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'placement_lock','Placement lock',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'placement_lock_nb','Placement lock notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(definition.version.id))],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    const notebook = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Placement lock','[]'::jsonb,'idem-placement-lock') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result

    const block = (
      await owner.query(
        `select id, version, payload
           from api.blocks
          where record_id = $1 and type = 'sheet'
          limit 1`,
        [notebook.record.id],
      )
    ).rows[0]
    expect(block.payload.templatePlacementId).toBe(PLACEMENT)
    const structureVersion = (
      await owner.query(
        `select structure_version from api.records where id = $1`,
        [notebook.record.id],
      )
    ).rows[0].structure_version

    await expectDenied(
      owner.query(
        `select api.update_block_payload($1, ($2::jsonb - 'templatePlacementId'), $3, $4)`,
        [
          block.id,
          JSON.stringify(block.payload),
          block.version,
          structureVersion,
        ],
      ),
      '23514',
    )

    await expectDenied(
      owner.query(
        `select api.update_block_payload(
           $1,
           ($2::jsonb || jsonb_build_object('templatePlacementId', $5::text)),
           $3,
           $4
         )`,
        [
          block.id,
          JSON.stringify(block.payload),
          block.version,
          structureVersion,
          crypto.randomUUID(),
        ],
      ),
      '23514',
    )

    await expectDenied(
      owner.query(
        `update api.blocks
            set payload = jsonb_set(payload, '{templatePlacementId}', to_jsonb($2::text))
          where id = $1`,
        [block.id, crypto.randomUUID()],
      ),
      '23514',
    )
  })

  it('rejects templatePlacementId spoofing via api_client direct block writes', async () => {
    const owner = await actor(OWNER, WS)
    const notebook = (
      await owner.query(
        `select to_jsonb(api.create_record($1,'experiment','API client spoof','draft','{}'::text[],'{}'::jsonb)) result`,
        [PROJECT],
      )
    ).rows[0].result
    const inserted = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,NULL,NULL,NULL) result`,
        [notebook.id],
      )
    ).rows[0].result
    const block = inserted.block

    const apiClient = await asRole('authenticator')
    clients.push(apiClient)
    await apiClient.query('SET ROLE api_client')
    await apiClient.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        role: 'api_client',
        workspace_id: WS,
        credential_id: crypto.randomUUID(),
        scopes: ['notebooks:write'],
      }),
    ])

    // api_client holds no EXECUTE grant on insert_block: the forged insert
    // dies at the permission layer (42501) before any payload check fires.
    // The spoof fails either way; direct-update coverage below proves the
    // payload check itself fires where the caller can reach it.
    await expectDenied(
      apiClient.query(
        `select api.insert_block($1,'sheet',$2::jsonb,1,NULL,NULL)`,
        [
          notebook.id,
          JSON.stringify({
            instanceId: block.payload.instanceId,
            templatePlacementId: PLACEMENT,
          }),
        ],
      ),
      '42501',
    )

    await expectDenied(
      apiClient.query(
        `update api.blocks
            set payload = payload || jsonb_build_object('templatePlacementId', $2::text)
          where id = $1`,
        [block.id, PLACEMENT],
      ),
      '23514',
    )
  })

  it('rejects forged template placement assignment gate via set_config before direct writes', async () => {
    const owner = await actor(OWNER, WS)
    const notebook = (
      await owner.query(
        `select to_jsonb(api.create_record($1,'experiment','GUC forge','draft','{}'::text[],'{}'::jsonb)) result`,
        [PROJECT],
      )
    ).rows[0].result
    const inserted = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,NULL,NULL,NULL) result`,
        [notebook.id],
      )
    ).rows[0].result
    const block = inserted.block

    await owner.query(
      `select set_config('sheetbase.template_placement_assign', 'v1', true)`,
    )

    await expectDenied(
      owner.query(`select api.insert_block($1,'sheet',$2::jsonb,1,NULL,NULL)`, [
        notebook.id,
        JSON.stringify({
          instanceId: block.payload.instanceId,
          templatePlacementId: PLACEMENT,
        }),
      ]),
      '23514',
    )

    await expectDenied(
      owner.query(
        `update api.blocks
            set payload = payload || jsonb_build_object('templatePlacementId', $2::text)
          where id = $1`,
        [block.id, PLACEMENT],
      ),
      '23514',
    )

    const apiClient = await asRole('authenticator')
    clients.push(apiClient)
    await apiClient.query('SET ROLE api_client')
    await apiClient.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        role: 'api_client',
        workspace_id: WS,
        credential_id: crypto.randomUUID(),
        scopes: ['notebooks:write'],
      }),
    ])
    await apiClient.query(
      `select set_config('sheetbase.template_placement_assign', 'v1', true)`,
    )

    // Same permission-layer denial as above (no EXECUTE grant): the forged
    // GUC cannot promote the call past it.
    await expectDenied(
      apiClient.query(
        `select api.insert_block($1,'sheet',$2::jsonb,1,NULL,NULL)`,
        [
          notebook.id,
          JSON.stringify({
            instanceId: block.payload.instanceId,
            templatePlacementId: PLACEMENT,
          }),
        ],
      ),
      '42501',
    )

    await expectDenied(
      apiClient.query(
        `update api.blocks
            set payload = payload || jsonb_build_object('templatePlacementId', $2::text)
          where id = $1`,
        [block.id, PLACEMENT],
      ),
      '23514',
    )
  })

  it('applies an upgrade when a new placement omits an optional mapped scalar input', async () => {
    const owner = await actor(OWNER, WS)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'upgrade_optional','Upgrade optional scalar',null,$2::jsonb) result`,
        [WS, JSON.stringify(optionalScalarDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'upgrade_optional_nb','Upgrade optional notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(narrativeOnlyTemplateConfig())],
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
        `select api.instantiate_notebook_template_version($1,$2,'Before upgrade','[]'::jsonb,'idem-upgrade-optional') result`,
        [v1.id, PROJECT],
      )
    ).rows[0].result

    const v2draft = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [
          created.template.id,
          created.template.revision,
          JSON.stringify({
            ...narrativeOnlyTemplateConfig(),
            placements: [
              ...narrativeOnlyTemplateConfig().placements,
              {
                id: PLACEMENT_OPTIONAL,
                kind: 'sheet',
                order: 2,
                definitionVersionId: definition.version.id,
                parameterMappings: [
                  {
                    templateParameterId: TEMPLATE_OPTIONAL_PARAM,
                    definitionParameterId: DEF_OPTIONAL_PARAM,
                  },
                ],
              },
            ],
            parameters: templateWithOptionalMappedScalar(definition.version.id)
              .parameters,
          }),
        ],
      )
    ).rows[0].result
    const v2 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [v2draft.id, v2draft.revision],
      )
    ).rows[0].result

    const structureVersion = (
      await owner.query(
        `select structure_version from api.records where id=$1`,
        [notebook.record.id],
      )
    ).rows[0].structure_version

    const applied = (
      await owner.query(
        `select api.apply_notebook_template_upgrade($1,$2,$3,'[]'::jsonb,'[]'::jsonb) result`,
        [notebook.record.id, structureVersion, v2.id],
      )
    ).rows[0].result
    expect(applied.record.source_notebook_template_version_id).toBe(v2.id)

    const blocks = (
      await owner.query(
        `select type from api.blocks where record_id=$1 order by "order"`,
        [notebook.record.id],
      )
    ).rows.map((row: { type: string }) => row.type)
    expect(blocks).toEqual(['rich_text', 'sheet'])

    const instance = (
      await owner.query(
        `select i.state->'parameterValues' parameter_values
           from api.blocks b
           join api.sheet_instances i on i.id = (b.payload->>'instanceId')::uuid
          where b.record_id = $1 and b.type = 'sheet'`,
        [notebook.record.id],
      )
    ).rows[0]
    expect(instance.parameter_values).toEqual([])
  })

  it('REUSE-02 fails closed naming missing parameters and stores composition pins', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)

    const local = (
      await owner.query(
        `select api.create_sheet_definition($1,'reuse02_local','REUSE-02 local',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      local.version.id,
      local.version.revision,
    ])

    const config = {
      formatVersion: 1,
      parameters: [
        {
          id: TEMPLATE_PARAMETER,
          key: 'passage_count',
          label: 'Passage count',
          required: true,
          type: { kind: 'scalar', valueType: 'integer' },
          defaultValue: 3,
          constraints: { min: 1, max: 10 },
        },
      ],
      placements: [
        ...dualSheetConfig(local.version.id).placements,
        { ...narrativeConfig(NARRATIVE_ONLY, 3).placements[0] },
      ],
    }
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'reuse02_nb','REUSE-02 notebook',null,$2::jsonb) result`,
        [WS, JSON.stringify(config)],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result

    const recordCount = async () =>
      (
        await member.query(`select count(*)::int count from api.records`)
      ).rows[0].count as number
    const before = await recordCount()

    // Required inputs fail closed naming the missing key; nothing is created.
    const missing = await member
      .query(
        `select api.instantiate_notebook_template_version($1,$2,'Fail','[]'::jsonb,'reuse02-missing')`,
        [published.id, PROJECT],
      )
      .then(
        () => null,
        (error: { code?: string; message?: string }) => error,
      )
    expect(missing?.code).toBe('SB091')
    expect(String(missing?.message)).toContain('passage_count')
    expect(await recordCount()).toBe(before)

    // Duplicate and unknown inputs are rejected before any write.
    const duplicateInput = JSON.stringify([
      { parameterId: TEMPLATE_PARAMETER, kind: 'scalar', value: 3 },
      { parameterId: TEMPLATE_PARAMETER, kind: 'scalar', value: 4 },
    ])
    await expectDenied(
      member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Fail',$3::jsonb,'reuse02-duplicate')`,
        [published.id, PROJECT, duplicateInput],
      ),
      'SB091',
    )
    await expectDenied(
      member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Fail',$3::jsonb,'reuse02-unknown')`,
        [
          published.id,
          PROJECT,
          JSON.stringify([
            {
              parameterId: '06500000-0000-4000-8000-00ffffffff00',
              kind: 'scalar',
              value: 3,
            },
          ]),
        ],
      ),
      'SB091',
    )
    expect(await recordCount()).toBe(before)

    // A resolved instantiation stores per-part composition pins while each
    // composed part keeps independent working state.
    const supplied = JSON.stringify([
      { parameterId: TEMPLATE_PARAMETER, kind: 'scalar', value: 3 },
    ])
    const result = (
      await member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run C',$3::jsonb,'reuse02-ok') result`,
        [published.id, PROJECT, supplied],
      )
    ).rows[0].result
    expect(result.templateVersionId).toBe(published.id)
    expect(result.composition).toHaveLength(3)
    const sheets = result.composition.filter(
      (entry: { kind: string }) => entry.kind === 'sheet',
    )
    expect(sheets.map((entry: { placementId: string }) => entry.placementId)).toEqual(
      [PLACEMENT_A, PLACEMENT_B],
    )
    for (const entry of sheets) {
      expect(entry.definitionVersionId).toBe(local.version.id)
      expect(entry.instanceId).toBeTruthy()
      expect(entry.blockId).toBeTruthy()
    }
    expect(sheets[0].instanceId).not.toBe(sheets[1].instanceId)
    expect(sheets[0].blockId).not.toBe(sheets[1].blockId)
    const narrative = result.composition.find(
      (entry: { kind: string }) => entry.kind === 'narrative',
    )
    expect(narrative.placementId).toBe(NARRATIVE_ONLY)
    expect(narrative.blockType).toBe('rich_text')
    expect(narrative.blockId).toBeTruthy()

    // Pins are durable: the record, both instances and both blocks each name
    // their governed source, and the stored receipt carries the composition.
    const stored = (
      await member.query(
        `select result from api.notebook_template_instantiations
          where workspace_id=$1 and idempotency_key='reuse02-ok'`,
        [WS],
      )
    ).rows[0].result
    expect(stillPinned(stored)).toBe(true)
    function stillPinned(value: typeof result) {
      return (
        value.templateVersionId === published.id &&
        value.composition.filter(
          (entry: { kind: string }) => entry.kind === 'sheet',
        ).length === 2
      )
    }
    const instances = (
      await member.query(
        `select i.id, i.source_definition_version_id source
           from api.blocks b
           join api.sheet_instances i on i.id = (b.payload->>'instanceId')::uuid
          where b.record_id = $1 and b.type = 'sheet'
          order by b."order"`,
        [result.record.id],
      )
    ).rows
    expect(instances).toHaveLength(2)
    expect(instances[0].id).not.toBe(instances[1].id)
    for (const instance of instances) {
      expect(instance.source).toBe(local.version.id)
    }
    const placements = (
      await member.query(
        `select payload->>'templatePlacementId' placement
           from api.blocks
          where record_id = $1 and type = 'sheet'
          order by "order"`,
        [result.record.id],
      )
    ).rows.map((row: { placement: string }) => row.placement)
    expect(placements).toEqual([PLACEMENT_A, PLACEMENT_B])
  })

  it('REUSE-02 rejects malformed parameter inputs before any other check', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'reuse02_malformed','REUSE-02 malformed',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify({
            formatVersion: 1,
            parameters: [
              {
                id: TEMPLATE_PARAMETER,
                key: 'passage_count',
                label: 'Passage count',
                required: true,
                type: { kind: 'scalar', valueType: 'integer' },
                defaultValue: 3,
                constraints: { min: 1, max: 10 },
              },
            ],
            placements: narrativeConfig().placements,
          }),
        ],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    const empty = (
      await owner.query(
        `select api.create_notebook_template($1,'reuse02_empty','REUSE-02 empty',null,$2::jsonb) result`,
        [WS, JSON.stringify(narrativeOnlyTemplateConfig())],
      )
    ).rows[0].result
    const emptyPublished = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2)) result`,
        [empty.version.id, empty.version.revision],
      )
    ).rows[0].result

    const recordCount = async () =>
      (
        await member.query(`select count(*)::int count from api.records`)
      ).rows[0].count as number
    const before = await recordCount()
    const attempt = (versionId: string, inputs: unknown, key: string) =>
      member.query(
        `select api.instantiate_notebook_template_version($1,$2,'Fail',$3::jsonb,$4)`,
        [versionId, PROJECT, JSON.stringify(inputs), key],
      )

    // A NULL parameterId must read as malformed — the shape gate runs before
    // duplicate/unknown/required checks — never as a missing required key.
    const nullId = await attempt(
      published.id,
      [{ parameterId: null, kind: 'scalar', value: 3 }],
      'reuse02-malformed-null',
    ).then(
      () => null,
      (error: { code?: string; message?: string }) => error,
    )
    expect(nullId?.code).toBe('SB091')
    expect(String(nullId?.message)).toContain('malformed')
    await expectDenied(
      attempt(
        published.id,
        [
          { parameterId: null, kind: 'scalar', value: 1 },
          { parameterId: null, kind: 'scalar', value: 2 },
        ],
        'reuse02-malformed-null-pair',
      ),
      'SB091',
    )
    await expectDenied(
      attempt(
        published.id,
        [{ kind: 'scalar', value: 3 }],
        'reuse02-malformed-missing',
      ),
      'SB091',
    )
    await expectDenied(
      attempt(published.id, [3], 'reuse02-malformed-entry'),
      'SB091',
    )
    await expectDenied(
      attempt(
        published.id,
        [{ parameterId: TEMPLATE_PARAMETER, kind: 'scalar' }],
        'reuse02-malformed-value',
      ),
      'SB091',
    )
    await expectDenied(
      attempt(
        published.id,
        [{ parameterId: TEMPLATE_PARAMETER, kind: 'bogus', value: 3 }],
        'reuse02-malformed-kind',
      ),
      'SB091',
    )
    await expectDenied(
      attempt(
        published.id,
        [{ parameterId: 42, kind: 'scalar', value: 3 }],
        'reuse02-malformed-id-type',
      ),
      'SB091',
    )
    // On a template with no parameters at all, malformed entries were
    // previously dropped silently and instantiation succeeded; they now fail.
    await expectDenied(
      attempt(
        emptyPublished.id,
        [{ parameterId: null, kind: 'scalar', value: 3 }],
        'reuse02-malformed-empty',
      ),
      'SB091',
    )
    expect(await recordCount()).toBe(before)
  })
})
