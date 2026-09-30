import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS = '06700000-0000-4000-8000-000000000001'
const PROJECT = '06700000-0000-4000-8000-000000000002'
const OWNER = 'core-067-owner'
const MEMBER = 'core-067-member'
const REVIEWER = 'core-067-reviewer'
const PLACEMENT = '06700000-0000-4000-8000-000000000010'
const PLACEMENT_B = '06700000-0000-4000-8000-000000000011'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
      session_id: `session-${userId}`,
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

function sheetConfig(definitionVersionId: string, placementId = PLACEMENT) {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: placementId,
        kind: 'sheet',
        order: 1,
        definitionVersionId,
        parameterMappings: [],
      },
    ],
  }
}

const field = (fieldId: string, key: string) => ({
  fieldId,
  key,
  label: key,
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
})

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','core-067-owner@test.invalid',true),
      ($2,'Member','core-067-member@test.invalid',true),
      ($3,'Reviewer','core-067-reviewer@test.invalid',true)`,
    [OWNER, MEMBER, REVIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'core-067','CORE-06.7')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member')`,
    [WS, OWNER, MEMBER, REVIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values ($1,$2,'C67','CORE-06.7')`,
    [PROJECT, WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-06.7 / 06.8 / 06.13 frozen Sheet evidence', () => {
  it('freezes Instance state on submit and ignores later live mutations', async () => {
    const owner = await actor(OWNER)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'purification_summary','Purification Summary',null,$2::jsonb) result`,
        [WS, JSON.stringify(localDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const templateA = (
      await owner.query(
        `select api.create_notebook_template($1,'purification_a','Purification A',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(definition.version.id))],
      )
    ).rows[0].result
    const publishedA = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'Published for test')) result`,
        [templateA.version.id, templateA.version.revision],
      )
    ).rows[0].result
    const templateB = (
      await owner.query(
        `select api.create_notebook_template($1,'purification_b','Purification B',null,$2::jsonb) result`,
        [WS, JSON.stringify(sheetConfig(definition.version.id, PLACEMENT_B))],
      )
    ).rows[0].result
    await owner.query(
      `select api.publish_notebook_template_version($1,$2,'Published for test')`,
      [templateB.version.id, templateB.version.revision],
    )

    const notebookA = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run A','[]'::jsonb,'ev-a') result`,
        [publishedA.id, PROJECT],
      )
    ).rows[0].result
    const notebookB = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run B','[]'::jsonb,'ev-b') result`,
        [
          (
            await owner.query(
              `select id from api.notebook_template_versions where template_id=$1 and lifecycle='published'`,
              [templateB.template.id],
            )
          ).rows[0].id,
          PROJECT,
        ],
      )
    ).rows[0].result
    const instanceA = (
      await owner.query(
        `select payload->>'instanceId' id from api.blocks where record_id=$1 and type='sheet'`,
        [notebookA.record.id],
      )
    ).rows[0].id as string
    const instanceB = (
      await owner.query(
        `select payload->>'instanceId' id from api.blocks where record_id=$1 and type='sheet'`,
        [notebookB.record.id],
      )
    ).rows[0].id as string
    expect(instanceA).not.toBe(instanceB)

    await owner.query(
      `select api.insert_sheet_instance_block($1,NULL,NULL,$2)`,
      [notebookB.record.id, instanceA],
    )

    const preview = (
      await owner.query(`select api.preview_submission_digest($1) result`, [
        notebookA.record.id,
      ])
    ).rows[0].result
    const submitted = (
      await owner.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,'submit-a') result`,
        [notebookA.record.id, preview.sourceDigest, REVIEWER],
      )
    ).rows[0].result
    expect(submitted.idempotent).toBe(false)

    const frozen = (
      await owner.query(
        `select canonical_snapshot->'sheetEvidence' evidence
           from api.revisions where id=$1`,
        [submitted.revision.id],
      )
    ).rows[0].evidence as Array<{ instanceState: { localFields: unknown[] } }>
    expect(frozen).toHaveLength(1)
    const fieldCountBefore = frozen[0].instanceState.localFields.length

    const live = (
      await owner.query(
        `select revision, state->'localFields' fields from api.sheet_instances where id=$1`,
        [instanceA],
      )
    ).rows[0]
    await owner.query(
      `select api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [
        instanceA,
        live.revision,
        crypto.randomUUID(),
        JSON.stringify([
          {
            operation: 'add',
            field: field(crypto.randomUUID(), 'observation'),
          },
        ]),
      ],
    )
    const frozenAfter = (
      await owner.query(
        `select canonical_snapshot->'sheetEvidence'->0->'instanceState'->'localFields' fields
           from api.revisions where id=$1`,
        [submitted.revision.id],
      )
    ).rows[0].fields as unknown[]
    expect(frozenAfter).toHaveLength(fieldCountBefore)
    const liveAfter = (
      await owner.query(
        `select jsonb_array_length(state->'localFields') count from api.sheet_instances where id=$1`,
        [instanceA],
      )
    ).rows[0].count
    expect(liveAfter).toBeGreaterThan(fieldCountBefore)

    const stored = (
      await owner.query(
        `select instance_id, instance_state from api.revision_sheet_evidence where revision_id=$1`,
        [submitted.revision.id],
      )
    ).rows
    expect(stored).toHaveLength(1)
    expect(stored[0].instance_id).toBe(instanceA)
  })
})
