/**
 * MDL-02 step 2 integration proof: workspace-owned model rules.
 *
 * One engine, evaluated on the canonical record write path
 * (`internal.guard_model_custom_fields`) and the canonical submit path
 * (`api.submit_record_revision`):
 *
 * - `block`             refuses the write (and any later submit);
 * - `flag_block_submit` accepts the write but refuses submission;
 * - `warn`              accepts both and reports a non-blocking notice;
 * - rules are workspace-owned: members read, `schema.edit` writes, and
 *   another workspace's rules never apply.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ensureSessions, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000290a'
const WS_B = '00000000-0000-4000-8000-00000000290b'
const PROJ_A = '00000000-0000-4000-8000-00000000291a'
const PROJ_B = '00000000-0000-4000-8000-00000000291b'
const OWNER_A = 'model-rule-owner-a'
const MEMBER_A = 'model-rule-member-a'
const OWNER_B = 'model-rule-owner-b'

const REVIEW_WORKFLOW = 'default-scientific-review'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: `session-${userId}`,
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createField(
  client: Client,
  workspaceId: string,
  modelKey: string,
  fieldName: string,
  logicalType: string,
): Promise<void> {
  await client.query(
    `SELECT api.create_and_activate_model_field(
       $1::uuid, $2, $3, $3, $4, true, NULL::jsonb, '{}'::jsonb, '[]'::jsonb, NULL::jsonb
     )`,
    [workspaceId, modelKey, fieldName, logicalType],
  )
}

async function createRule(
  client: Client,
  workspaceId: string,
  modelKey: string,
  name: string,
  fieldKeys: string[],
  condition: unknown,
  effect: string,
  message: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_rule($1::uuid, $2, $3, $4::text[], $5::jsonb, $6, $7)`,
    [
      workspaceId,
      modelKey,
      name,
      fieldKeys,
      JSON.stringify(condition),
      effect,
      message,
    ],
  )
  return rows[0]
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  customFields: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record($1::uuid, $2, $3, 'draft', ARRAY[]::text[], '{}'::jsonb, $4::jsonb)`,
    [project, kind, title, JSON.stringify(customFields)],
  )
  return rows[0]
}

async function submit(
  client: Client,
  recordId: string,
  idempotencyKey: string,
): Promise<Record<string, any>> {
  const { rows: preview } = await client.query(
    `SELECT api.preview_submission_digest($1) AS result`,
    [recordId],
  )
  const digest = preview[0].result.sourceDigest as string
  const { rows } = await client.query(
    `SELECT api.submit_record_revision($1,$2,$3,1,$4,true,$5) AS result`,
    [recordId, digest, REVIEW_WORKFLOW, `{${OWNER_A}}`, idempotencyKey],
  )
  return rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
       ('${OWNER_A}', 'Rule Owner A', 'rule-owner-a@sheetbase.test', true),
       ('${MEMBER_A}', 'Rule Member A', 'rule-member-a@sheetbase.test', true),
       ('${OWNER_B}', 'Rule Owner B', 'rule-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
       ('${WS_A}', 'model-rule-a', 'Model Rule A'),
       ('${WS_B}', 'model-rule-b', 'Model Rule B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
       ('${WS_A}', '${OWNER_A}', 'owner'), ('${WS_A}', '${MEMBER_A}', 'member'),
       ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
       ('${PROJ_A}', '${WS_A}', 'rule-a', 'Rule A', '${OWNER_A}'),
       ('${PROJ_B}', '${WS_B}', 'rule-b', 'Rule B', '${OWNER_B}')`,
  )
  await ensureSessions(migrator, [OWNER_A, MEMBER_A, OWNER_B])
  const owner = await asAuthenticated(OWNER_A, WS_A)
  const ownerB = await asAuthenticated(OWNER_B, WS_B)
  await createField(owner, WS_A, 'experiment', 'dose', 'decimal')
  await createField(owner, WS_A, 'experiment', 'load', 'text')
  await createField(owner, WS_A, 'sample', 'dose', 'decimal')
  await createField(owner, WS_A, 'material', 'dose', 'decimal')
  await createField(ownerB, WS_B, 'experiment', 'dose', 'decimal')
})

beforeEach(async () => {
  await migrator.query('DELETE FROM api.model_rules')
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('rule stewardship and isolation', () => {
  it('lets schema.edit create/update/remove rules and refuses a plain member', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const member = await asAuthenticated(MEMBER_A, WS_A)

    const rule = await createRule(
      owner,
      WS_A,
      'experiment',
      'Dose upper bound',
      ['dose'],
      { field: 'dose', op: 'gt', value: 100 },
      'block',
      'Dose is out of range',
    )
    expect(rule).toMatchObject({
      model_key: 'experiment',
      field_keys: ['dose'],
      effect: 'block',
      message: 'Dose is out of range',
    })

    // Members read; a plain member cannot author.
    const listed = await member.query(
      `SELECT id FROM api.list_model_rules($1)`,
      [WS_A],
    )
    expect(listed.rows).toHaveLength(1)
    await expect(
      createRule(
        member,
        WS_A,
        'experiment',
        'member rule',
        ['dose'],
        {},
        'warn',
        'nope',
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(`SELECT api.update_model_rule($1,$2::jsonb)`, [
        rule.id,
        JSON.stringify({ effect: 'warn' }),
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(`SELECT api.remove_model_rule($1)`, [rule.id]),
    ).rejects.toMatchObject({ code: '42501' })

    // Owners update in place.
    const updated = (
      await owner.query(`SELECT * FROM api.update_model_rule($1,$2::jsonb)`, [
        rule.id,
        JSON.stringify({ effect: 'warn', message: 'Dose looks high' }),
      ])
    ).rows[0]
    expect(updated).toMatchObject({
      effect: 'warn',
      message: 'Dose looks high',
    })

    await owner.query(`SELECT api.remove_model_rule($1)`, [rule.id])
    expect(
      (await owner.query(`SELECT id FROM api.model_rules`)).rows,
    ).toHaveLength(0)
  })

  it('validates model key, fields, effect and condition', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expect(
      createRule(owner, WS_A, 'mystery', 'x', ['dose'], {}, 'warn', 'm'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      createRule(owner, WS_A, 'experiment', 'x', ['nope'], {}, 'warn', 'm'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      createRule(owner, WS_A, 'experiment', 'x', ['dose'], {}, 'nope', 'm'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      createRule(owner, WS_A, 'experiment', 'x', [], {}, 'warn', 'm'),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('keeps rules workspace-scoped', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)

    // A rule owned by workspace B that would block any non-null dose.
    await createRule(
      ownerB,
      WS_B,
      'experiment',
      'B blocks everything',
      ['dose'],
      { field: 'dose', op: 'gt', value: 0 },
      'block',
      'B rule',
    )
    // The same model key in workspace A is unaffected.
    const record = await createRecord(owner, PROJ_A, 'experiment', 'A record', {
      dose: 5,
    })
    expect(record.id).toBeTruthy()

    // B cannot see A's rules and vice versa.
    expect(
      (await owner.query(`SELECT id FROM api.list_model_rules($1)`, [WS_A]))
        .rows,
    ).toHaveLength(0)
    expect(
      (await ownerB.query(`SELECT id FROM api.list_model_rules($1)`, [WS_B]))
        .rows,
    ).toHaveLength(1)
    // B cannot author into A.
    await expect(
      createRule(ownerB, WS_A, 'experiment', 'x', ['dose'], {}, 'warn', 'm'),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('block effect', () => {
  it('refuses the write on insert and update', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createRule(
      owner,
      WS_A,
      'experiment',
      'Dose upper bound',
      ['dose'],
      { field: 'dose', op: 'gt', value: 100 },
      'block',
      'Dose must not exceed 100',
    )

    await expect(
      createRecord(owner, PROJ_A, 'experiment', 'Blocked', { dose: 150 }),
    ).rejects.toMatchObject({ code: 'SB083' })

    const allowed = await createRecord(owner, PROJ_A, 'experiment', 'Allowed', {
      dose: 50,
    })
    expect(allowed.custom_fields.dose).toBe(50)

    // The same gate covers the canonical partial-update RPC.
    await expect(
      owner.query(`SELECT api.update_record_custom_fields($1,$2,$3::jsonb)`, [
        allowed.id,
        allowed.metadata_version,
        JSON.stringify({ dose: 200 }),
      ]),
    ).rejects.toMatchObject({ code: 'SB083' })

    const report = (
      await owner.query(`SELECT api.model_record_validation($1) AS result`, [
        allowed.id,
      ])
    ).rows[0].result
    expect(report.blocked).toBe(false)
  })
})

describe('flag_block_submit effect', () => {
  it('accepts the record but refuses submission until resolved', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createRule(
      owner,
      WS_A,
      'sample',
      'Dose needs review',
      ['dose'],
      { field: 'dose', op: 'gt', value: 100 },
      'flag_block_submit',
      'Dose above 100 must be resolved before submit',
    )

    const flagged = await createRecord(owner, PROJ_A, 'sample', 'Flagged', {
      dose: 150,
    })
    expect(flagged.id).toBeTruthy()

    const report = (
      await owner.query(`SELECT api.model_record_validation($1) AS result`, [
        flagged.id,
      ])
    ).rows[0].result
    expect(report.blockSubmit).toBe(true)
    expect(report.submitBlocks[0].message).toBe(
      'Dose above 100 must be resolved before submit',
    )

    await expect(
      submit(owner, flagged.id, 'rule-flag-blocked'),
    ).rejects.toMatchObject({ code: 'SB083' })

    // A record that does not match the rule submits normally.
    const clean = await createRecord(owner, PROJ_A, 'sample', 'Clean', {
      dose: 10,
    })
    const accepted = await submit(owner, clean.id, 'rule-flag-clean')
    expect(accepted.submission.state).toBe('submitted')
  })
})

describe('warn effect', () => {
  it('is non-blocking and reported as a notice', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createRule(
      owner,
      WS_A,
      'material',
      'Dose advisory',
      ['dose'],
      { field: 'dose', op: 'gt', value: 100 },
      'warn',
      'Dose is unusually high',
    )

    const notices: string[] = []
    owner.on('notice', (notice) => {
      notices.push(notice.message ?? '')
    })

    const warned = await createRecord(owner, PROJ_A, 'material', 'Warned', {
      dose: 150,
    })
    expect(warned.id).toBeTruthy()
    expect(
      notices.some((message) => message.includes('Dose is unusually high')),
    ).toBe(true)

    const report = (
      await owner.query(`SELECT api.model_record_validation($1) AS result`, [
        warned.id,
      ])
    ).rows[0].result
    expect(report.warnings[0].message).toBe('Dose is unusually high')
    expect(report.blockSubmit).toBe(false)

    // Warnings never block submission.
    const accepted = await submit(owner, warned.id, 'rule-warn-submit')
    expect(accepted.submission.state).toBe('submitted')

    // And a record below the threshold reports nothing.
    const quiet = await createRecord(owner, PROJ_A, 'material', 'Quiet', {
      dose: 10,
    })
    const quietReport = (
      await owner.query(`SELECT api.model_record_validation($1) AS result`, [
        quiet.id,
      ])
    ).rows[0].result
    expect(quietReport.warnings).toHaveLength(0)
  })
})

describe('condition DSL', () => {
  it('supports combinators and operators', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createRule(
      owner,
      WS_A,
      'experiment',
      'High dose on high load',
      ['dose', 'load'],
      {
        all: [
          { field: 'dose', op: 'gte', value: 10 },
          { field: 'load', op: 'in', value: ['high', 'critical'] },
        ],
      },
      'block',
      'High load requires a low dose',
    )
    await expect(
      createRecord(owner, PROJ_A, 'experiment', 'Match', {
        dose: 20,
        load: 'critical',
      }),
    ).rejects.toMatchObject({ code: 'SB083' })
    // Only one branch matches: allowed.
    const allowed = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'One branch',
      {
        dose: 20,
        load: 'low',
      },
    )
    expect(allowed.id).toBeTruthy()
  })
})
