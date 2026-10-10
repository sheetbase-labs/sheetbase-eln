import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d303'
const OTHER_WS = '00000000-0000-4000-8000-00000000d304'
const PROJECT = '00000000-0000-4000-8000-00000000d305'
const AUTHOR = 'record-version-author'
const QA = 'record-version-qa'
const OWNER = 'record-version-owner'
const OUTSIDER = 'record-version-outsider'
const SECOND_QA = 'record-version-second-qa'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

interface Version {
  id: string
  model_id: string
  version: number
  revision: number
  lifecycle: string
  definition: {
    fields: Array<{ id: string; field_name: string; label: string }>
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Author','record-version-author@test.invalid',true),
       ($2,'QA','record-version-qa@test.invalid',true),
       ($3,'Model owner','record-version-owner@test.invalid',true),
       ($4,'Outsider','record-version-outsider@test.invalid',true),
       ($5,'Second QA','record-version-second-qa@test.invalid',true)`,
    [AUTHOR, QA, OWNER, OUTSIDER, SECOND_QA],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ('${WS}','record-versions','Record versions'),
       ('${OTHER_WS}','other-record-versions','Other record versions');
     INSERT INTO api.projects(id,workspace_id,key,title)
       VALUES ('${PROJECT}','${WS}','version-proof','Version proof');`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'reviewer'),($1,$4,'owner'),($5,$6,'owner'),
       ($1,$7,'reviewer')`,
    [WS, AUTHOR, QA, OWNER, OTHER_WS, OUTSIDER, SECOND_QA],
  )
  // The fixture project needs a lead/owner rule so the author can create
  // Records in it; project visibility is RLS-enforced and explicit.
  await migrator.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
     VALUES ($1,$2,$3,true,true,true,true,$3)`,
    [WS, PROJECT, AUTHOR],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function draft(client: Client, key: string, prefix: string) {
  const model = (
    await client.query<{ id: string }>(
      'SELECT id FROM api.create_workspace_model($1,$2,$2,$3,null)',
      [WS, key, prefix],
    )
  ).rows[0]!
  const version = (
    await client.query<Version>(
      'SELECT * FROM api.create_record_model_version($1,$2)',
      [model.id, 'Initial definition'],
    )
  ).rows[0]!
  return { model, version }
}

async function submit(
  client: Client,
  version: Version,
  suppliedRevision = version.revision,
) {
  return (
    await client.query<{
      id: string
      state: string
      object_revision: number
    }>(
      `SELECT id,state,object_revision FROM api.submit_approval_request(
        $1,'record_model_version',$2,ARRAY['owner','reviewer'],
        'Review this definition',true,2,$3)`,
      [WS, version.id, suppliedRevision],
    )
  ).rows[0]!
}

async function publish(client: Client, version: Version) {
  await client.query('SELECT api.publish_record_model_version($1)', [
    version.id,
  ])
}

describe('MDL-03 workspace Record Model version authority', () => {
  it('refuses a fabricated Record Model version through the generic approval RPC', async () => {
    const author = await actor(AUTHOR)
    await expectDenied(
      author.query(
        `SELECT api.submit_approval_request($1,'record_model_version',$2,
          ARRAY['owner','reviewer'],'Fabricated target',true,2,1)`,
        [WS, '00000000-0000-4000-8000-00000000d399'],
      ),
      '42501',
    )
    expect(
      (
        await author.query(
          "SELECT id FROM api.approval_requests WHERE object_kind='record_model_version' AND object_id=$1",
          ['00000000-0000-4000-8000-00000000d399'],
        )
      ).rows,
    ).toEqual([])
  })

  it('requires independent approvals from every named role, even with Dataset policy disabled', async () => {
    const author = await actor(AUTHOR)
    const { version } = await draft(author, 'approval_bank', 'AB')
    await expectDenied(publish(author, version), 'SB084')
    await expectDenied(
      author.query(
        `SELECT api.submit_approval_request($1,'record_model_version',$2,
          ARRAY['owner','reviewer'],'Bypass independence and role coverage',false,1,99)`,
        [WS, version.id],
      ),
      '22023',
    )
    const request = await submit(author, version)
    await expectDenied(
      author.query('SELECT api.approve_approval_request($1)', [request.id]),
      '42501',
    )
    const qa = await actor(QA)
    await qa.query('SELECT api.approve_approval_request($1)', [request.id])
    await expectDenied(publish(author, version), 'SB084')
    // Two QA users meet the generic count, but do not supply an owner approval.
    const secondQa = await actor(SECOND_QA)
    await secondQa.query('SELECT api.approve_approval_request($1)', [
      request.id,
    ])
    expect(
      (
        await author.query(
          'SELECT state FROM api.approval_requests WHERE id=$1',
          [request.id],
        )
      ).rows,
    ).toEqual([{ state: 'pending' }])
    await expectDenied(publish(author, version), 'SB084')
    await expectDenied(
      qa.query('SELECT api.approve_approval_request($1)', [request.id]),
      'SB086',
    )
    const owner = await actor(OWNER)
    await owner.query('SELECT api.approve_approval_request($1)', [request.id])
    await publish(author, version)
    const trail = await author.query(
      'SELECT user_id FROM api.approval_request_decisions WHERE request_id=$1 ORDER BY user_id',
      [request.id],
    )
    expect(trail.rows).toEqual(
      [{ user_id: OWNER }, { user_id: QA }, { user_id: SECOND_QA }].sort(
        (a, b) => a.user_id.localeCompare(b.user_id),
      ),
    )
  })

  it('locks pending drafts on both RPC and direct writes, then unlocks after return or withdrawal', async () => {
    const author = await actor(AUTHOR)
    const { version } = await draft(author, 'returned_bank', 'RB')
    const request = await submit(author, version)
    await expectDenied(
      author.query(
        'SELECT api.replace_record_model_version_definition($1,$2,$3,$4)',
        [
          version.id,
          version.revision,
          JSON.stringify(version.definition),
          'Change',
        ],
      ),
      'SB085',
    )
    await expectDenied(
      author.query(
        "UPDATE api.record_model_versions SET definition='{}' WHERE id=$1",
        [version.id],
      ),
      '42501',
    )
    const qa = await actor(QA)
    await expectDenied(
      qa.query("SELECT api.return_approval_request($1,'')", [request.id]),
      '22023',
    )
    await qa.query(
      "SELECT api.return_approval_request($1,'Explain the new field')",
      [request.id],
    )
    await expectDenied(publish(author, version), 'SB084')
    const edited = (
      await author.query<Version>(
        'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
        [
          version.id,
          version.revision,
          JSON.stringify(version.definition),
          'Clarify',
        ],
      )
    ).rows[0]!
    expect(edited.revision).toBe(version.revision + 1)
    // The shared RPC's client-supplied revision is not target authority.
    const resubmitted = await submit(author, edited, 99)
    // object_revision is bigint; the node driver returns it as a string.
    expect(Number(resubmitted.object_revision)).toBe(edited.revision)
    await expectDenied(
      qa.query("SELECT api.withdraw_approval_request($1,'Not mine')", [
        resubmitted.id,
      ]),
      '42501',
    )
    await author.query(
      "SELECT api.withdraw_approval_request($1,'Continue drafting')",
      [resubmitted.id],
    )
    await expectDenied(publish(author, edited), 'SB084')
  })

  it('isolates version reads, editing, approvals and publication by the object workspace', async () => {
    const author = await actor(AUTHOR)
    const { version } = await draft(author, 'isolated_bank', 'IB')
    const request = await submit(author, version)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(
      (
        await outsider.query(
          'SELECT id FROM api.record_model_versions WHERE id=$1',
          [version.id],
        )
      ).rows,
    ).toEqual([])
    await expectDenied(publish(outsider, version), '42501')
    await expectDenied(
      outsider.query('SELECT api.approve_approval_request($1)', [request.id]),
      '42501',
    )
  })

  it('keeps the published definition current and old records readable, and upgrades only the explicit pin', async () => {
    const author = await actor(AUTHOR)
    const qa = await actor(QA)
    const owner = await actor(OWNER)
    const { model, version: initial } = await draft(author, 'pinned_bank', 'PB')
    const fieldId = '00000000-0000-4000-8000-00000000d306'
    const firstDefinition = {
      ...initial.definition,
      fields: [
        {
          id: fieldId,
          field_name: 'passage',
          label: 'Passage',
          logical_type: 'integer',
          nullable: false,
          display_order: 0,
          lifecycle: 'active',
          validation: { min: 0, max: 50 },
          default_value: null,
          cardinality: 'one',
          options: [],
        },
      ],
    }
    const first = (
      await author.query<Version>(
        'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
        [
          initial.id,
          initial.revision,
          JSON.stringify(firstDefinition),
          'Define passage',
        ],
      )
    ).rows[0]!
    const firstRequest = await submit(author, first)
    await qa.query('SELECT api.approve_approval_request($1)', [firstRequest.id])
    await owner.query('SELECT api.approve_approval_request($1)', [
      firstRequest.id,
    ])
    await publish(author, first)
    const record = (
      await author.query<{
        id: string
        metadata_version: number
        model_version_id: string
        custom_fields: unknown
      }>(
        `SELECT * FROM api.create_model_record($1,'pinned_bank','Old bank','draft',
        '{}'::text[],'{}'::jsonb,'{"passage":12}'::jsonb)`,
        [PROJECT],
      )
    ).rows[0]!
    expect(record.model_version_id).toBe(first.id)
    const second = (
      await author.query<Version>(
        'SELECT * FROM api.create_record_model_version($1,$2)',
        [model.id, 'Add optional viability'],
      )
    ).rows[0]!
    expect(second.version).toBe(first.version + 1)
    expect(second.definition.fields).toContainEqual(
      expect.objectContaining({
        id: fieldId,
        field_name: 'passage',
        label: 'Passage',
      }),
    )
    const secondDefinition = {
      ...firstDefinition,
      fields: [
        { ...firstDefinition.fields[0], label: 'Passage at banking' },
        {
          id: '00000000-0000-4000-8000-00000000d307',
          field_name: 'viability',
          label: 'Viability',
          logical_type: 'decimal',
          nullable: true,
          display_order: 1,
          lifecycle: 'active',
          validation: { min: 0, max: 100 },
          default_value: 90,
          cardinality: 'one',
          options: [],
        },
      ],
    }
    const edited = (
      await author.query<Version>(
        'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
        [
          second.id,
          second.revision,
          JSON.stringify(secondDefinition),
          'Add viability',
        ],
      )
    ).rows[0]!
    const secondRequest = await submit(author, edited)
    expect(
      (
        await author.query(
          'SELECT current_version FROM api.record_models WHERE id=$1',
          [model.id],
        )
      ).rows,
    ).toEqual([{ current_version: first.version }])
    await expectDenied(publish(author, edited), 'SB084')
    await qa.query('SELECT api.approve_approval_request($1)', [
      secondRequest.id,
    ])
    await owner.query('SELECT api.approve_approval_request($1)', [
      secondRequest.id,
    ])
    await publish(author, edited)
    const before = (
      await author.query(
        'SELECT model_version_id,custom_fields,metadata_version FROM api.records WHERE id=$1',
        [record.id],
      )
    ).rows[0]
    expect(before).toEqual({
      model_version_id: first.id,
      custom_fields: { passage: 12 },
      metadata_version: record.metadata_version,
    })
    expect(
      (
        await author.query<Version>(
          'SELECT * FROM api.record_model_versions WHERE id=$1',
          [first.id],
        )
      ).rows[0]?.definition.fields,
    ).toContainEqual(expect.objectContaining({ id: fieldId, label: 'Passage' }))
    const newRecord = (
      await author.query<{
        model_version_id: string
        custom_fields: unknown
      }>(
        `SELECT * FROM api.create_model_record($1,'pinned_bank','New bank','draft',
        '{}'::text[],'{}'::jsonb,'{"passage":7}'::jsonb)`,
        [PROJECT],
      )
    ).rows[0]!
    expect(newRecord).toMatchObject({
      model_version_id: edited.id,
      custom_fields: { passage: 7, viability: 90 },
    })
    await expectDenied(
      author.query('SELECT api.upgrade_record_model_record($1,$2,$3,$4)', [
        record.id,
        edited.id,
        record.metadata_version + 1,
        'Stale attempt',
      ]),
      'SB001',
    )
    await author.query('SELECT api.upgrade_record_model_record($1,$2,$3,$4)', [
      record.id,
      edited.id,
      record.metadata_version,
      'Adopt optional viability',
    ])
    const after = (
      await author.query(
        'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
        [record.id],
      )
    ).rows[0]
    expect(after).toEqual({
      model_version_id: edited.id,
      custom_fields: { passage: 12 },
    })
    expect(
      (
        await author.query(
          'SELECT id,field_name FROM api.record_field_definitions WHERE id=$1',
          [fieldId],
        )
      ).rows,
    ).toEqual([{ id: fieldId, field_name: 'passage' }])
  })
})
