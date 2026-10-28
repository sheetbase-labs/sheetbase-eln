import type { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e501'
const PROJECT = '00000000-0000-4000-8000-00000000e502'
const AUTHOR = 'subtype-author'
const QA = 'subtype-qa'
const OWNER = 'subtype-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

interface Version {
  id: string
  revision: number
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Author','subtype-author@test.invalid',true),
       ($2,'QA','subtype-qa@test.invalid',true),
       ($3,'Owner','subtype-owner@test.invalid',true)`,
    [AUTHOR, QA, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS}','subtypes','Subtypes');
     INSERT INTO api.projects(id,workspace_id,key,title) VALUES ('${PROJECT}','${WS}','subtypes','Subtypes');`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'reviewer'),($1,$4,'owner')`,
    [WS, AUTHOR, QA, OWNER],
  )
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

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

function textField(name: string, label = name) {
  return {
    id: randomUUID(),
    field_name: name,
    label,
    logical_type: 'text',
    nullable: true,
    display_order: 0,
    lifecycle: 'active',
    validation: {},
    default_value: null,
    cardinality: 'one',
    options: [],
  }
}

/** Create a subtype and publish its first version with the given fields. */
async function subtype(
  author: Client,
  parent: string,
  key: string,
  prefix: string,
  fields: unknown[],
) {
  const model = (
    await author.query<{ id: string; parent_key: string }>(
      'SELECT * FROM api.create_model_subtype($1,$2,$3,$3,$4,null)',
      [WS, parent, key, prefix],
    )
  ).rows[0]!
  await publishFields(author, model.id, fields)
  return model
}

async function publishFields(
  author: Client,
  modelId: string,
  fields: unknown[],
) {
  const initial = (
    await author.query<Version>(
      'SELECT * FROM api.create_record_model_version($1,$2)',
      [modelId, 'Define fields'],
    )
  ).rows[0]!
  const saved = (
    await author.query<Version>(
      'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
      [
        initial.id,
        initial.revision,
        JSON.stringify({ fields, migrationScope: 'new-records-only' }),
        'Define fields',
      ],
    )
  ).rows[0]!
  const request = (
    await author.query<{ id: string }>(
      `SELECT id FROM api.submit_approval_request($1,'record_model_version',$2,
        ARRAY['owner','reviewer'],'Review subtype',true,2,$3)`,
      [WS, saved.id, saved.revision],
    )
  ).rows[0]!
  for (const reviewer of [QA, OWNER]) {
    const client = await actor(reviewer)
    await client.query('SELECT api.approve_approval_request($1)', [request.id])
  }
  await author.query('SELECT api.publish_record_model_version($1)', [saved.id])
  return saved
}

async function experiment(author: Client, title: string) {
  return (
    await author.query<{ id: string; identifier: string }>(
      `SELECT * FROM api.create_model_record($1,'experiment',$2,'draft','{}','{}','{}')`,
      [PROJECT, title],
    )
  ).rows[0]!
}

describe('model subtypes', () => {
  it('keeps a subtype record an experiment, with its own prefix and the whole chain of fields', async () => {
    const author = await actor(AUTHOR)
    const owner = await actor(OWNER)
    await owner.query(
      `SELECT api.create_and_activate_model_field($1,'experiment','harvest_day','Harvest day','integer',true,null,'{}')`,
      [WS],
    )
    await subtype(author, 'experiment', 'cell_culture', 'CCX', [
      textField('cell_line', 'Cell line'),
    ])
    await subtype(author, 'cell_culture', 'perfusion_culture', 'PFX', [
      textField('perfusion_rate', 'Perfusion rate'),
    ])

    const record = await experiment(author, 'Perfusion run')
    expect(record.identifier).toMatch(/^EXP-/)
    const typed = (
      await author.query<{ result: Record<string, unknown> }>(
        `SELECT api.set_model_type('records',$1,'perfusion_culture',$2) AS result`,
        [
          record.id,
          JSON.stringify({
            harvest_day: 6,
            cell_line: 'CHO-K1',
            perfusion_rate: '1 VVD',
          }),
        ],
      )
    ).rows[0]!.result
    expect(typed).toMatchObject({
      kind: 'experiment',
      custom_fields: {
        harvest_day: 6,
        cell_line: 'CHO-K1',
        perfusion_rate: '1 VVD',
      },
    })
    expect(String(typed.identifier)).toMatch(/^PFX-\d{4}$/)

    await expectDenied(
      author.query('SELECT api.update_record_custom_fields($1,$2,$3)', [
        record.id,
        typed.metadata_version,
        JSON.stringify({ harvest_day: 'six' }),
      ]),
      'SB071',
    )
    await expectDenied(
      author.query('SELECT api.update_record_custom_fields($1,$2,$3)', [
        record.id,
        typed.metadata_version,
        JSON.stringify({ not_a_field: 1 }),
      ]),
      'SB070',
    )

    // Back to a plain experiment: subtype values are the caller's to drop.
    const plain = (
      await author.query<{ result: Record<string, unknown> }>(
        `SELECT api.set_model_type('records',$1,null,$2) AS result`,
        [record.id, JSON.stringify({ harvest_day: 6 })],
      )
    ).rows[0]!.result
    expect(plain.model_version_id).toBeNull()
    expect(String(plain.identifier)).toMatch(/^EXP-/)
  })

  it('refuses a field key already used anywhere in the family', async () => {
    const author = await actor(AUTHOR)
    const owner = await actor(OWNER)
    await expectDenied(
      subtype(author, 'experiment', 'clash_culture', 'CLX', [
        textField('harvest_day'),
      ]),
      'SB082',
    )
    // cell_line belongs to the Cell culture subtype; Experiment can't take it.
    await expectDenied(
      owner.query(
        `SELECT api.create_and_activate_model_field($1,'experiment','cell_line','Cell line','text',true,null,'{}')`,
        [WS],
      ),
      'SB082',
    )
  })

  it('refuses core and looping parents, and built-in prefixes', async () => {
    const author = await actor(AUTHOR)
    await expectDenied(
      author.query(
        "SELECT api.create_model_subtype($1,'study','study_kind','Study kind','STK',null)",
        [WS],
      ),
      'SB071',
    )
    await expectDenied(
      author.query(
        "SELECT api.create_model_subtype($1,'experiment','exp_again','Experiment again','EXP',null)",
        [WS],
      ),
      'SB082',
    )
    const model = (
      await author.query<{ id: string }>(
        "SELECT id FROM api.record_models WHERE workspace_id=$1 AND key='cell_culture'",
        [WS],
      )
    ).rows[0]!
    await expectDenied(
      author.query("SELECT api.reparent_record_model($1,'perfusion_culture')", [
        model.id,
      ]),
      'SB071',
    )
  })

  it('keeps a signed record on its type', async () => {
    const author = await actor(AUTHOR)
    const record = await experiment(author, 'Signed run')
    const revision = await migrator.query<{ id: string }>(
      `INSERT INTO api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,
                                 block_snapshot,reason,created_by_user_id)
       VALUES ($1,$2,1,1,'{}'::jsonb,'[]'::jsonb,'manual',$3) RETURNING id`,
      [record.id, WS, AUTHOR],
    )
    await migrator.query(
      'UPDATE api.records SET locked_at=now(), locked_by_revision_id=$2 WHERE id=$1',
      [record.id, revision.rows[0]!.id],
    )
    await expectDenied(
      author.query(
        `SELECT api.set_model_type('records',$1,'cell_culture','{}')`,
        [record.id],
      ),
      'SB011',
    )
  })

  it('gives a project subtype its own fields and prefix', async () => {
    const author = await actor(AUTHOR)
    await subtype(author, 'project', 'cleanroom_project', 'CRP', [
      textField('cleanroom_grade', 'Cleanroom grade'),
    ])
    const typed = (
      await author.query<{ result: Record<string, unknown> }>(
        `SELECT api.set_model_type('project',$1,'cleanroom_project',$2) AS result`,
        [PROJECT, JSON.stringify({ cleanroom_grade: 'B' })],
      )
    ).rows[0]!.result
    expect(typed).toMatchObject({ custom_fields: { cleanroom_grade: 'B' } })
    expect(String(typed.display_id)).toMatch(/^CRP-\d{4}$/)
    await expectDenied(
      author.query(
        `UPDATE api.projects SET model_version_id=null WHERE id=$1`,
        [PROJECT],
      ),
      '42501',
    )
  })

  it('moves a record type and its records under a new parent', async () => {
    const author = await actor(AUTHOR)
    const bank = (
      await author.query<{ id: string }>(
        "SELECT id FROM api.create_workspace_model($1,'cell_bank','Cell bank','CBK',null)",
        [WS],
      )
    ).rows[0]!
    await publishFields(author, bank.id, [textField('bank_tier', 'Tier')])
    const record = (
      await author.query<{ id: string; identifier: string }>(
        `SELECT * FROM api.create_model_record($1,'cell_bank','Master bank','draft','{}','{}','{"bank_tier":"MCB"}')`,
        [PROJECT],
      )
    ).rows[0]!
    await author.query("SELECT api.reparent_record_model($1,'sample')", [
      bank.id,
    ])
    const moved = (
      await migrator.query(
        'SELECT kind, identifier, custom_fields FROM api.records WHERE id=$1',
        [record.id],
      )
    ).rows[0]
    expect(moved).toEqual({
      kind: 'sample',
      identifier: record.identifier,
      custom_fields: { bank_tier: 'MCB' },
    })
  })
})
