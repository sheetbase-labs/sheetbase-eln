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

async function approvedDefinition(
  author: Client,
  version: Version,
  fields: unknown[],
  migrate = false,
) {
  const saved = (
    await author.query<Version>(
      'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
      [
        version.id,
        version.revision,
        JSON.stringify({
          fields,
          migrationScope: migrate
            ? 'also-migrate-open-experiments'
            : 'new-records-only',
        }),
        'Review field evolution',
      ],
    )
  ).rows[0]!
  const request = await submit(author, saved)
  for (const reviewer of [QA, OWNER]) {
    const client = await actor(reviewer)
    await client.query('SELECT api.approve_approval_request($1)', [request.id])
  }
  return saved
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
    // An unapproved proposal must not change either the live registry or
    // capture under v1, even though it adds a default and changes a label.
    expect(
      (
        await author.query(
          'SELECT label FROM api.record_field_definitions WHERE id=$1',
          [fieldId],
        )
      ).rows,
    ).toEqual([{ label: 'Passage' }])
    const duringDraft = (
      await author.query(
        `SELECT custom_fields,model_version_id FROM api.create_model_record($1,'pinned_bank','During draft','draft','{}','{}','{"passage":8}')`,
        [PROJECT],
      )
    ).rows[0]
    expect(duringDraft).toEqual({
      custom_fields: { passage: 8 },
      model_version_id: first.id,
    })
    await expectDenied(
      author.query(
        `UPDATE api.records SET custom_fields='{"passage":51}' WHERE id=$1`,
        [record.id],
      ),
      'SB071',
    )
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
    // Publication must not force older records through v2 validation/defaults.
    await author.query(
      `UPDATE api.records SET custom_fields='{"passage":13}' WHERE id=$1`,
      [record.id],
    )
    await author.query(
      `UPDATE api.records SET custom_fields='{"passage":12}' WHERE id=$1`,
      [record.id],
    )
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

  it.each(['label', 'identity', 'remove'] as const)(
    'refuses %s reinterpretation of a stored category in explicit and publication upgrades',
    async (change) => {
      const author = await actor(AUTHOR)
      const { model, version } = await draft(
        author,
        `choice_${change}`,
        `C${change.slice(0, 3).toUpperCase()}`,
      )
      const field = {
        id: crypto.randomUUID(),
        field_name: 'release',
        label: 'Release',
        logical_type: 'category',
        nullable: true,
        display_order: 0,
        lifecycle: 'active',
        validation: {},
        default_value: null,
        cardinality: 'one',
        options: [
          {
            id: crypto.randomUUID(),
            key: 'pass',
            label: 'Meets release criteria',
            displayOrder: 0,
            lifecycle: 'active',
          },
        ],
      }
      const v1 = await approvedDefinition(author, version, [field])
      await publish(author, v1)
      const record = (
        await author.query(
          `SELECT * FROM api.create_model_record($1,$2,'Historical category','draft','{}','{}','{"release":"pass"}')`,
          [PROJECT, `choice_${change}`],
        )
      ).rows[0]
      const changed = {
        ...field,
        options:
          change === 'remove'
            ? []
            : [
                {
                  ...field.options[0],
                  ...(change === 'label'
                    ? { label: 'Fails release criteria' }
                    : { id: crypto.randomUUID() }),
                },
              ],
      }
      const next = async () =>
        (
          await author.query<Version>(
            'SELECT * FROM api.create_record_model_version($1,$2)',
            [model.id, 'Evolve choices'],
          )
        ).rows[0]!
      const v2 = await approvedDefinition(author, await next(), [changed])
      await publish(author, v2)
      await expectDenied(
        author.query('SELECT api.upgrade_record_model_record($1,$2,$3,$4)', [
          record.id,
          v2.id,
          record.metadata_version,
          'Adopt choices',
        ]),
        'SB071',
      )
      const v3 = await approvedDefinition(author, await next(), [changed], true)
      await expectDenied(publish(author, v3), 'SB071')
      expect(
        (
          await author.query(
            'SELECT lifecycle FROM api.record_model_versions WHERE id=$1',
            [v3.id],
          )
        ).rows,
      ).toEqual([{ lifecycle: 'draft' }])
      expect(
        (
          await author.query(
            'SELECT current_version FROM api.record_models WHERE id=$1',
            [model.id],
          )
        ).rows,
      ).toEqual([{ current_version: 2 }])
      expect(
        (
          await author.query(
            'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
            [record.id],
          )
        ).rows,
      ).toEqual([
        { model_version_id: v1.id, custom_fields: { release: 'pass' } },
      ])
      const compatible = {
        ...field,
        options: [
          { ...field.options[0], lifecycle: 'retired' },
          {
            id: crypto.randomUUID(),
            key: 'pending',
            label: 'Awaiting review',
            displayOrder: 1,
            lifecycle: 'active',
          },
        ],
      }
      const v4 = await approvedDefinition(
        author,
        await next(),
        [compatible],
        true,
      )
      await publish(author, v4)
      expect(
        (
          await author.query(
            'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
            [record.id],
          )
        ).rows,
      ).toEqual([
        { model_version_id: v4.id, custom_fields: { release: 'pass' } },
      ])
      expect(
        (
          await author.query(
            'SELECT count(*)::int AS n FROM api.record_model_version_upgrades WHERE record_id=$1',
            [record.id],
          )
        ).rows,
      ).toEqual([{ n: 1 }])
    },
  )

  it('requires explicit backfill before adopting a required field and never injects defaults on later edits', async () => {
    const author = await actor(AUTHOR)
    const { model, version } = await draft(author, 'backfill_bank', 'BF')
    const v1 = await approvedDefinition(author, version, [])
    await publish(author, v1)
    const record = (
      await author.query(
        `SELECT * FROM api.create_model_record($1,'backfill_bank','Before required field','draft','{}','{}','{}')`,
        [PROJECT],
      )
    ).rows[0]
    const field = {
      id: crypto.randomUUID(),
      field_name: 'dose',
      label: 'Dose',
      logical_type: 'integer',
      nullable: false,
      display_order: 0,
      lifecycle: 'active',
      validation: {},
      default_value: 25,
      cardinality: 'one',
      options: [],
    }
    const next = async () =>
      (
        await author.query<Version>(
          'SELECT * FROM api.create_record_model_version($1,$2)',
          [model.id, 'Add dose'],
        )
      ).rows[0]!
    const v2 = await approvedDefinition(author, await next(), [field])
    await publish(author, v2)
    await expectDenied(
      author.query('SELECT api.upgrade_record_model_record($1,$2,$3,$4)', [
        record.id,
        v2.id,
        record.metadata_version,
        'Adopt required dose',
      ]),
      'SB071',
    )
    const v3 = await approvedDefinition(author, await next(), [field], true)
    await expectDenied(publish(author, v3), 'SB071')
    expect(
      (
        await author.query(
          'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
          [record.id],
        )
      ).rows,
    ).toEqual([{ model_version_id: v1.id, custom_fields: {} }])
    const note = {
      ...field,
      id: crypto.randomUUID(),
      field_name: 'note',
      label: 'Note',
      logical_type: 'text',
      nullable: true,
      default_value: null,
    }
    const v4 = await approvedDefinition(
      author,
      await next(),
      [{ ...field, nullable: true }, note],
      true,
    )
    await publish(author, v4)
    await author.query(
      `UPDATE api.records SET custom_fields='{"note":"Reviewed without a measured dose"}' WHERE id=$1`,
      [record.id],
    )
    expect(
      (
        await author.query(
          'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
          [record.id],
        )
      ).rows,
    ).toEqual([
      {
        model_version_id: v4.id,
        custom_fields: { note: 'Reviewed without a measured dose' },
      },
    ])
    expect(
      (
        await author.query(
          `SELECT custom_fields FROM api.create_model_record($1,'backfill_bank','New default','draft','{}','{}','{}')`,
          [PROJECT],
        )
      ).rows[0].custom_fields,
    ).toMatchObject({ dose: 25 })
    // A real value, supplied while the field is optional, permits subsequent
    // requiredness without inventing a measurement from the capture default.
    await author.query(
      `UPDATE api.records SET custom_fields='{"dose":7,"note":"Measured dose"}' WHERE id=$1`,
      [record.id],
    )
    const v5 = await approvedDefinition(
      author,
      await next(),
      [field, note],
      true,
    )
    await publish(author, v5)
    expect(
      (
        await author.query(
          'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
          [record.id],
        )
      ).rows,
    ).toEqual([
      {
        model_version_id: v5.id,
        custom_fields: { dose: 7, note: 'Measured dose' },
      },
    ])
  })

  it('uses the canonical reference relationship and rejects conflicting legacy target metadata', async () => {
    const author = await actor(AUTHOR)
    const { version } = await draft(author, 'linked_bank', 'LB')
    const field = {
      id: crypto.randomUUID(),
      field_name: 'parent',
      label: 'Parent',
      logical_type: 'reference',
      nullable: true,
      display_order: 0,
      lifecycle: 'active',
      validation: {},
      relationship: {
        target: { kind: 'model', modelKey: 'linked_bank' },
        cardinality: 'one',
      },
      default_value: null,
      cardinality: 'one',
      options: [],
    }
    await expectDenied(
      author.query(
        'SELECT api.replace_record_model_version_definition($1,$2,$3,$4)',
        [
          version.id,
          version.revision,
          JSON.stringify({
            fields: [
              { ...field, validation: { targetModelKey: 'experiment' } },
            ],
          }),
          'Conflicting target',
        ],
      ),
      'SB071',
    )
    const v1 = await approvedDefinition(author, version, [field])
    await publish(author, v1)
    const target = (
      await author.query(
        `SELECT * FROM api.create_model_record($1,'linked_bank','Parent bank','draft','{}','{}','{}')`,
        [PROJECT],
      )
    ).rows[0]
    const source = (
      await author.query(
        `SELECT * FROM api.create_model_record($1,'linked_bank','Child bank','draft','{}','{}',$2)`,
        [PROJECT, JSON.stringify({ parent: target.id })],
      )
    ).rows[0]
    expect(source.custom_fields).toEqual({ parent: target.id })
    expect(source.model_version_id).toBe(v1.id)
  })

  it('honours eligible migration only during approved publication and refuses unit reinterpretation', async () => {
    const author = await actor(AUTHOR)
    const qa = await actor(QA)
    const owner = await actor(OWNER)
    const { model, version } = await draft(author, 'dose_bank', 'DB')
    const field = {
      id: '00000000-0000-4000-8000-00000000d318',
      field_name: 'dose',
      label: 'Dose',
      logical_type: 'decimal',
      nullable: false,
      display_order: 0,
      lifecycle: 'active',
      validation: { min: 0, max: 100 },
      default_value: null,
      cardinality: 'one',
      options: [],
      quantity: { kind: 'mass', dimension: 'mass', storageUnit: 'mg' },
    }
    async function save(v: Version, fields: unknown[], migrate = false) {
      return (
        await author.query<Version>(
          'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
          [
            v.id,
            v.revision,
            JSON.stringify({
              fields,
              migrationScope: migrate
                ? 'also-migrate-open-experiments'
                : 'new-records-only',
            }),
            'Evolve dose',
          ],
        )
      ).rows[0]!
    }
    async function approve(v: Version) {
      const request = await submit(author, v)
      await qa.query('SELECT api.approve_approval_request($1)', [request.id])
      await owner.query('SELECT api.approve_approval_request($1)', [request.id])
    }
    const v1 = await save(version, [field])
    await approve(v1)
    await publish(author, v1)
    const open = (
      await author.query(
        `SELECT * FROM api.create_model_record($1,'dose_bank','Open','draft','{}','{}','{"dose":10}')`,
        [PROJECT],
      )
    ).rows[0]
    const closed = (
      await author.query(
        `SELECT * FROM api.create_model_record($1,'dose_bank','Closed','approved','{}','{}','{"dose":20}')`,
        [PROJECT],
      )
    ).rows[0]
    const next = (
      await author.query<Version>(
        'SELECT * FROM api.create_record_model_version($1,$2)',
        [model.id, 'Clarify label'],
      )
    ).rows[0]!
    const v2 = await save(
      next,
      [{ ...field, label: 'Dose administered' }],
      true,
    )
    expect(
      (
        await author.query(
          'SELECT model_version_id FROM api.records WHERE id=$1',
          [open.id],
        )
      ).rows[0].model_version_id,
    ).toBe(v1.id)
    expect(
      (
        await author.query(
          'SELECT migratable_record_count FROM api.record_model_version_usage($1) WHERE version_id=$2',
          [model.id, v1.id],
        )
      ).rows[0].migratable_record_count,
    ).toBe(1)
    await expectDenied(publish(author, v2), 'SB084')
    await approve(v2)
    await publish(author, v2)
    expect(
      (
        await author.query(
          'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
          [open.id],
        )
      ).rows[0],
    ).toEqual({ model_version_id: v2.id, custom_fields: { dose: 10 } })
    expect(
      (
        await author.query(
          'SELECT model_version_id FROM api.records WHERE id=$1',
          [closed.id],
        )
      ).rows[0].model_version_id,
    ).toBe(v1.id)
    expect(
      (
        await author.query(
          'SELECT count(*)::int AS n FROM api.record_model_version_upgrades WHERE record_id=$1',
          [open.id],
        )
      ).rows[0].n,
    ).toBe(1)
    const third = (
      await author.query<Version>(
        'SELECT * FROM api.create_record_model_version($1,$2)',
        [model.id, 'Use grams for new captures'],
      )
    ).rows[0]!
    const v3 = await save(third, [
      { ...field, quantity: { ...field.quantity, storageUnit: 'g' } },
    ])
    await approve(v3)
    await publish(author, v3)
    await expectDenied(
      author.query('SELECT api.upgrade_record_model_record($1,$2,$3,$4)', [
        open.id,
        v3.id,
        open.metadata_version + 1,
        'Adopt grams',
      ]),
      'SB071',
    )
    await expectDenied(
      author.query('UPDATE api.records SET model_version_id=$1 WHERE id=$2', [
        v3.id,
        open.id,
      ]),
      '42501',
    )
    await author.query(
      `UPDATE api.records SET custom_fields='{"dose":11}' WHERE id=$1`,
      [open.id],
    )
    expect(
      (
        await author.query(
          'SELECT model_version_id,custom_fields FROM api.records WHERE id=$1',
          [open.id],
        )
      ).rows[0],
    ).toEqual({ model_version_id: v2.id, custom_fields: { dose: 11 } })
  })
})
