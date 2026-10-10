/**
 * SHEET-03 / MDL-03 — a genuinely signed Record-bound Sheet survives an
 * explicit Record Model pin upgrade.
 *
 * The source is a workspace Record Model Record pinned to a published version.
 * A Sheet whose column is sourced from that Record is embedded in a notebook
 * and the notebook is submitted with a real author signature, which freezes
 * revision_sheet_evidence and an integrity digest. Publishing a second model
 * version and explicitly upgrading the Record's pin must not change the Record
 * identity or values, the Instance identity, the frozen composed grid, the
 * revision digest or the frozen comment anchors.
 */
import { createHmac } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'

import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '19000000-0000-4000-8000-000000000001'
const PROJECT = '19000000-0000-4000-8000-000000000002'
const OWNER = 'pin-upgrade-owner'
const REVIEWER = 'pin-upgrade-reviewer'
const VERIFIER = 'pin-upgrade-verifier'
const PASSWORD = 'pin-upgrade-native-test-password'
const MODEL_KEY = 'pin_bank'
const FIELD_ID = '19000000-0000-4000-8000-000000000010'
const SECOND_FIELD_ID = '19000000-0000-4000-8000-000000000011'
const PARAMETER = '19000000-0000-4000-8000-000000000012'
const BINDING = '19000000-0000-4000-8000-000000000013'
const COLUMN = '19000000-0000-4000-8000-000000000014'
const SCHEMA_FIELD = '19000000-0000-4000-8000-000000000015'
const DATASET_PARAMETER = '19000000-0000-4000-8000-000000000016'
const DATASET_BINDING = '19000000-0000-4000-8000-000000000017'
const DATASET_COLUMN = '19000000-0000-4000-8000-000000000018'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>

function authHeaders() {
  const token = `pin-upgrade-${OWNER}`
  const signature = createHmac(
    'sha256',
    z.string().min(32).parse(process.env.BETTER_AUTH_SECRET),
  )
    .update(token)
    .digest('base64')
  return new Headers({
    origin: 'https://sheetbase.test',
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function signingToken(input: object) {
  const response = await handleSignatureStepUp(
    new Request('https://sheetbase.test/api/signatures/step-up', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ workspaceId: WS, password: PASSWORD, ...input }),
    }),
    { database, authentication },
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return z.object({ token: z.string().min(32) }).parse(await response.json())
    .token
}

async function actor(userId = OWNER) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS, { session_id: `pin-upgrade-${userId}` })
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Owner','pin-upgrade-owner@test.invalid',true),
       ($2,'Reviewer','pin-upgrade-reviewer@test.invalid',true),
       ($3,'Verifier','pin-upgrade-verifier@test.invalid',true)`,
    [OWNER, REVIEWER, VERIFIER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'pin-upgrade','Pin upgrade')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'reviewer'),($1,$4,'admin')`,
    [WS, OWNER, REVIEWER, VERIFIER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'pin','Pin')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
     VALUES ($1,$2,$3,true,true,true,true,$3),($1,$2,$4,true,false,true,false,$3)`,
    [WS, PROJECT, OWNER, REVIEWER],
  )
  for (const userId of [OWNER, REVIEWER, VERIFIER]) {
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ($1,$1,$2,now()+interval '1 hour')`,
      [`pin-upgrade-${userId}`, userId],
    )
  }
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  await authentication.api.setPassword({
    headers: authHeaders(),
    body: { newPassword: PASSWORD },
  })
  const owner = await actor()
  await owner.query('SELECT api.request_signature_identity_verification()')
  const verifier = await actor(VERIFIER)
  await verifier.query('SELECT api.verify_signature_identity($1,$2)', [
    OWNER,
    'pin-upgrade-owner@test.invalid',
  ])
  await owner.query('SELECT api.certify_signature($1,1,$2)', [
    WS,
    await signingToken({ purpose: 'certify' }),
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function publishVersion(
  owner: Client,
  reviewer: Client,
  versionId: string,
) {
  const request = (
    await owner.query(
      `SELECT id FROM api.submit_approval_request($1,'record_model_version',$2,ARRAY['reviewer'],'Publish',true,1,NULL)`,
      [WS, versionId],
    )
  ).rows[0].id as string
  await reviewer.query('SELECT api.approve_approval_request($1)', [request])
  await owner.query('SELECT api.publish_record_model_version($1)', [versionId])
}

function recordSheetConfiguration(schemaVersionId: string) {
  return {
    formatVersion: 1,
    parameters: [
      {
        id: DATASET_PARAMETER,
        key: 'rows',
        label: 'Rows',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId },
        },
        constraints: {},
      },
      {
        id: PARAMETER,
        key: 'record_source',
        label: 'Record',
        required: true,
        type: { kind: 'record', modelKey: MODEL_KEY },
        constraints: {},
      },
    ],
    bindings: [
      { id: DATASET_BINDING, key: 'rows', parameterId: DATASET_PARAMETER },
      { id: BINDING, key: 'record_source', parameterId: PARAMETER },
    ],
    rowIdentity: { kind: 'source', columnIds: [DATASET_COLUMN] },
    joins: [],
    columns: [
      {
        id: DATASET_COLUMN,
        field: {
          fieldId: DATASET_COLUMN,
          key: 'sample',
          label: 'Sample',
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
        source: {
          kind: 'bound',
          bindingId: DATASET_BINDING,
          sourceFieldId: SCHEMA_FIELD,
        },
      },
      {
        id: COLUMN,
        field: {
          fieldId: COLUMN,
          key: 'passage',
          label: 'Passage',
          description: null,
          logicalType: 'integer',
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
        source: {
          kind: 'bound',
          bindingId: BINDING,
          sourceFieldId: FIELD_ID,
        },
      },
    ],
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: [DATASET_COLUMN, COLUMN],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
  }
}

describe('SHEET-03 signed Record-bound Sheet across a Model pin upgrade', () => {
  it('keeps frozen evidence, instance identity and comment anchors stable while the pin moves', async () => {
    const owner = await actor()
    const reviewer = await actor(REVIEWER)

    // A workspace model with a published version 1.
    const model = (
      await owner.query<{ id: string }>(
        `SELECT id FROM api.create_workspace_model($1,$2,'Pin bank','PB',null)`,
        [WS, MODEL_KEY],
      )
    ).rows[0]
    const first = (
      await owner.query<{ id: string; revision: number }>(
        `SELECT id, revision FROM api.create_record_model_version($1,'Initial definition')`,
        [model.id],
      )
    ).rows[0]
    await owner.query(
      `SELECT api.replace_record_model_version_definition($1,$2,$3::jsonb,'Define passage')`,
      [
        first.id,
        first.revision,
        JSON.stringify({
          fields: [
            {
              id: FIELD_ID,
              field_name: 'passage',
              label: 'Passage',
              logical_type: 'integer',
              nullable: true,
              display_order: 0,
              lifecycle: 'active',
              validation: {},
              default_value: null,
              cardinality: 'one',
            },
          ],
        }),
      ],
    )
    await publishVersion(owner, reviewer, first.id)

    const record = (
      await owner.query<{
        id: string
        metadata_version: number
        model_version_id: string
        custom_fields: unknown
      }>(
        `SELECT * FROM api.create_model_record($1,$2,'Bank A','draft','{}'::text[],'{}'::jsonb,'{"passage":12}'::jsonb)`,
        [PROJECT, MODEL_KEY],
      )
    ).rows[0]
    expect(record.model_version_id).toBe(first.id)
    expect(record.custom_fields).toEqual({ passage: 12 })

    // A Sheet sourced from that Record, embedded in a notebook.
    const notebook = crypto.randomUUID()
    await migrator.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       VALUES($1,$2,$3,'experiment',$4,'Pin notebook','draft',$5)`,
      [notebook, WS, PROJECT, `EXP-${notebook.slice(0, 8)}`, OWNER],
    )
    // A Dataset row source plus the Record as a constant projection.
    const schema = (
      await owner.query<{ schema_version_id: string }>(
        `SELECT api.create_dataset_schema_definition($1,'pin_rows','Pin rows',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify([
            {
              field_id: SCHEMA_FIELD,
              key: 'sample',
              label: 'Sample',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    await owner.query('SELECT api.publish_dataset_schema_version($1)', [
      schema.schema_version_id,
    ])
    const datasetId = (
      await migrator.query<{ id: string }>(
        `INSERT INTO api.datasets(workspace_id,schema_version_id,name) VALUES($1,$2,'Pin rows') RETURNING id`,
        [WS, schema.schema_version_id],
      )
    ).rows[0].id
    const datasetRowId = (
      await migrator.query<{ id: string }>(
        `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES($1,$2) RETURNING id`,
        [datasetId, WS],
      )
    ).rows[0].id
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,text_value) VALUES($1,$2,'R1')`,
      [datasetRowId, SCHEMA_FIELD],
    )

    const definition = (
      await owner.query<{ version: { id: string } }>(
        `SELECT api.create_sheet_definition($1,$2,'Record sheet',null,$3::jsonb) result`,
        [
          WS,
          `record_sheet_${crypto.randomUUID().replaceAll('-', '')}`,
          JSON.stringify(recordSheetConfiguration(schema.schema_version_id)),
        ],
      )
    ).rows[0].result
    await owner.query(`SELECT api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      1,
    ])
    const instance = (
      await owner.query<{ id: string; revision: string }>(
        `SELECT to_jsonb(api.create_sheet_instance_from_definition($1,'Record sheet',null,$2,null,$3,$4::jsonb,$5::jsonb)) result`,
        [
          WS,
          definition.version.id,
          notebook,
          JSON.stringify({
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
            provenance: { createdFrom: 'definition_version' },
          }),
          JSON.stringify([
            {
              parameterId: DATASET_PARAMETER,
              kind: 'dataset',
              datasetId,
            },
            { parameterId: PARAMETER, kind: 'record', recordId: record.id },
          ]),
        ],
      )
    ).rows[0].result
    await owner.query(
      `SELECT api.insert_sheet_instance_block($1,null,null,$2)`,
      [notebook, instance.id],
    )

    // Genuine author submission: freezes revision_sheet_evidence and a digest.
    const digest = (
      await owner.query<{ digest: string }>(
        `SELECT api.preview_submission_digest($1)->>'sourceDigest' digest`,
        [notebook],
      )
    ).rows[0].digest
    const submissionInput = {
      purpose: 'author-submit',
      recordId: notebook,
      revisionDigest: digest,
      workflowDefinitionKey: 'controlled-scientific-review',
      workflowDefinitionVersion: 1,
      reviewerUserIds: [REVIEWER],
      confirmed: true,
      idempotencyKey: crypto.randomUUID(),
      dueAt: null,
    }
    const submitted = (
      await owner.query<{
        revision: { id: string; integrityDigest: string }
      }>(
        `SELECT api.submit_record_revision($1,$2,$3,1,ARRAY[$4]::text[],true,$5,NULL,$6,$7) result`,
        [
          notebook,
          digest,
          submissionInput.workflowDefinitionKey,
          REVIEWER,
          submissionInput.idempotencyKey,
          await signingToken(submissionInput),
          'Owner',
        ],
      )
    ).rows[0].result
    const revisionId = submitted.revision.id
    const evidence = (
      await owner.query<{
        instance_state: unknown
        composed_grid: { rowKeys: string[] }
      }>(
        `SELECT instance_state, composed_grid FROM api.revision_sheet_evidence WHERE revision_id=$1`,
        [revisionId],
      )
    ).rows[0]
    expect(evidence.composed_grid.rowKeys.length).toBeGreaterThan(0)
    const frozenRowKey = evidence.composed_grid.rowKeys[0]
    const digestBefore = (
      await owner.query<{ integrity_digest: string }>(
        `SELECT integrity_digest FROM api.revisions WHERE id=$1`,
        [revisionId],
      )
    ).rows[0].integrity_digest
    const anchor = (
      await reviewer.query<{ result: { id: string } }>(
        `SELECT api.create_comment($1,'sheet_cell',$2::jsonb,'Frozen passage','{}') result`,
        [
          revisionId,
          JSON.stringify({
            instanceId: instance.id,
            rowKeys: [frozenRowKey],
            fieldIds: [COLUMN],
          }),
        ],
      )
    ).rows[0].result

    // Version 2 adds an optional field; publish it, then explicitly upgrade.
    const second = (
      await owner.query<{ id: string; revision: number }>(
        `SELECT id, revision FROM api.create_record_model_version($1,'Add optional viability')`,
        [model.id],
      )
    ).rows[0]
    await owner.query(
      `SELECT api.replace_record_model_version_definition($1,$2,$3::jsonb,'Add viability')`,
      [
        second.id,
        second.revision,
        JSON.stringify({
          fields: [
            {
              id: FIELD_ID,
              field_name: 'passage',
              label: 'Passage at banking',
              logical_type: 'integer',
              nullable: true,
              display_order: 0,
              lifecycle: 'active',
              validation: {},
              default_value: null,
              cardinality: 'one',
            },
            {
              id: SECOND_FIELD_ID,
              field_name: 'viability',
              label: 'Viability',
              logical_type: 'decimal',
              nullable: true,
              display_order: 1,
              lifecycle: 'active',
              validation: {},
              default_value: 90,
              cardinality: 'one',
            },
          ],
        }),
      ],
    )
    await publishVersion(owner, reviewer, second.id)

    // The signed notebook is unchanged before the upgrade.
    expect(
      (
        await owner.query(
          'SELECT instance_state, composed_grid FROM api.revision_sheet_evidence WHERE revision_id=$1',
          [revisionId],
        )
      ).rows[0],
    ).toEqual(evidence)

    await owner.query(
      `SELECT api.upgrade_record_model_record($1,$2,$3,'Adopt optional viability')`,
      [record.id, second.id, record.metadata_version],
    )

    // Record identity and values are preserved; only the pin moves.
    const after = (
      await owner.query<{
        id: string
        custom_fields: unknown
        model_version_id: string
      }>(
        'SELECT id, custom_fields, model_version_id FROM api.records WHERE id=$1',
        [record.id],
      )
    ).rows[0]
    expect(after).toEqual({
      id: record.id,
      custom_fields: { passage: 12 },
      model_version_id: second.id,
    })

    // The frozen Sheet evidence, instance identity, digest and anchors are
    // unchanged by the pin upgrade.
    const evidenceAfter = (
      await owner.query<{ instance_state: unknown; composed_grid: unknown }>(
        `SELECT instance_state, composed_grid FROM api.revision_sheet_evidence WHERE revision_id=$1`,
        [revisionId],
      )
    ).rows[0]
    expect(evidenceAfter).toEqual(evidence)
    expect(
      (
        await owner.query(
          'SELECT integrity_digest FROM api.revisions WHERE id=$1',
          [revisionId],
        )
      ).rows[0].integrity_digest,
    ).toBe(digestBefore)
    const instanceRow = (
      await owner.query<{ id: string; revision: string }>(
        'SELECT id, revision FROM api.sheet_instances WHERE id=$1',
        [instance.id],
      )
    ).rows[0]
    expect(instanceRow.id).toBe(instance.id)
    // revision is bigint; the node driver returns it as a string.
    expect(Number(instanceRow.revision)).toBe(Number(instance.revision))
    expect(
      (
        await owner.query('SELECT id FROM api.comments WHERE id=$1', [
          anchor.id,
        ])
      ).rows,
    ).toEqual([{ id: anchor.id }])
    // A new comment on the same frozen anchor still resolves.
    await reviewer.query(
      `SELECT api.create_comment($1,'sheet_cell',$2::jsonb,'Still frozen','{}')`,
      [
        revisionId,
        JSON.stringify({
          instanceId: instance.id,
          rowKeys: [frozenRowKey],
          fieldIds: [COLUMN],
        }),
      ],
    )

    // New Records take the new version and its defaults; old values never move.
    const fresh = (
      await owner.query<{ model_version_id: string; custom_fields: unknown }>(
        `SELECT * FROM api.create_model_record($1,$2,'Bank B','draft','{}'::text[],'{}'::jsonb,'{"passage":7}'::jsonb)`,
        [PROJECT, MODEL_KEY],
      )
    ).rows[0]
    expect(fresh).toMatchObject({
      model_version_id: second.id,
      custom_fields: { passage: 7, viability: 90 },
    })
    expect(
      (
        await owner.query(
          'SELECT label FROM api.record_field_definitions WHERE id=$1',
          [FIELD_ID],
        )
      ).rows[0].label,
    ).toBe('Passage at banking')
  })
}, 120_000)
