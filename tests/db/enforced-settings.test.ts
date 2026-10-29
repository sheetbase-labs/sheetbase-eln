/**
 * Settings that do what they say.
 *
 * Signature meanings, the pinned review workflow, lock-on-sign, the reason for
 * an amendment, the instrument gate on runs and imports, and the instrument
 * administration capabilities are workspace choices. Each is read where the
 * data changes, so saving a setting changes what the database accepts.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000e5e00'
const PROJECT = '00000000-0000-4000-8000-0000000e5e01'
const RECORD = '00000000-0000-4000-8000-0000000e5e02'
const RECORD_OPEN = '00000000-0000-4000-8000-0000000e5e03'
const DATASET = '00000000-0000-4000-8000-0000000e5e10'
const SCHEMA = '00000000-0000-4000-8000-0000000e5e11'
const SCHEMA_VERSION = '00000000-0000-4000-8000-0000000e5e12'
const DATASET_VERSION = '00000000-0000-4000-8000-0000000e5e13'
const IMPORT_FILE = '00000000-0000-4000-8000-0000000e5e14'

const OWNER = 'es-owner'
const STEWARD = 'es-steward'
const SCIENTIST = 'es-scientist'
const ANALYST = 'es-analyst'
const VIEWER = 'es-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let instrumentId: string
let importCount = 0

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function revisionFor(recordId: string): Promise<string> {
  const snapshot = {
    formatVersion: 1,
    record: {
      id: recordId,
      workspaceId: WS,
      title: 'Complete experiment',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [
      {
        id: 'b1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        order: 100,
      },
    ],
    links: [],
    scientificTables: [],
    formulas: [],
    files: [],
  }
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.revisions
       (record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, canonical_snapshot,
        integrity_algorithm, reason, created_by_user_id)
     values ($1, $2, 1, 1, $3, $4, $3, 'sha256', 'validate', $5)
     returning id`,
    [
      recordId,
      WS,
      JSON.stringify(snapshot),
      JSON.stringify(snapshot.blocks),
      OWNER,
    ],
  )
  return rows[0]!.id
}

async function submissionFor(
  recordId: string,
  reviewers: string[],
  workflow = 'default-scientific-review',
): Promise<string> {
  const revisionId = await revisionFor(recordId)
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.review_submissions
       (workspace_id, record_id, revision_id, state,
        workflow_definition_key, workflow_definition_version,
        assigned_reviewer_user_ids, submitted_by_user_id,
        submitted_session_id, submitted_role, submitted_at, idempotency_key)
     values ($1, $2, $3, 'submitted', $6, 1, $4, $5,
             'session-submit', 'authenticated', now(), $7)
     returning id`,
    [
      WS,
      recordId,
      revisionId,
      reviewers,
      OWNER,
      workflow,
      `submit-${revisionId}`,
    ],
  )
  return rows[0]!.id
}

async function signature(submissionId: string, meaning: string) {
  const { rows } = await migrator.query<{
    record_id: string
    revision_id: string
    integrity_digest: string
  }>(
    `select s.record_id, s.revision_id, r.integrity_digest
       from api.review_submissions s join api.revisions r on r.id = s.revision_id
      where s.id = $1`,
    [submissionId],
  )
  const s = rows[0]!
  return migrator.query(
    `insert into api.signatures
       (workspace_id, submission_id, revision_id, record_id, signature_meaning,
        assurance_level, revision_integrity_digest, signer_user_id, signer_name,
        signer_session_id, signer_role, auth_method, confirmation_phrase,
        signed_at, created_at)
     values ($1, $2, $3, $4, $5, 'standard', $6, $7, 'Signer', 'session-sign',
             'authenticated', 'password', 'Signer', now(), now())`,
    [
      WS,
      submissionId,
      s.revision_id,
      s.record_id,
      meaning,
      s.integrity_digest,
      SCIENTIST,
    ],
  )
}

async function setSettings(args: Record<string, unknown>) {
  const owner = await actor(OWNER)
  const names = Object.keys(args)
  await owner.query(
    `select * from api.update_workspace_settings(
       p_workspace_id => $1,
       ${names.map((name, i) => `${name} => $${i + 2}`).join(', ')})`,
    [WS, ...names.map((name) => args[name])],
  )
}

async function gate(mode: 'off' | 'warn' | 'block') {
  const owner = await actor(OWNER)
  await owner.query('select * from api.set_instrument_gate_mode($1,$2)', [
    WS,
    mode,
  ])
}

async function importFrom(instrument: string) {
  importCount += 1
  await setActorJwt(migrator, OWNER, WS)
  const { rows } = await migrator.query<{ outcome: unknown }>(
    `insert into api.dataset_imports
       (workspace_id, dataset_id, instrument_id, file_id, mapping, outcome,
        status, idempotency_key, imported_row_ids, parser_provenance,
        source_provenance, created_by_user_id, snapshot_version_id)
     values ($1, $2, $3, $4, '{}', '{}'::jsonb, 'committed', $5, '[]',
             '{}', '{}', $6, $7)
     returning outcome`,
    [
      WS,
      DATASET,
      instrument,
      IMPORT_FILE,
      `es-import-${importCount}`,
      OWNER,
      DATASET_VERSION,
    ],
  )
  return rows[0]!.outcome as { instrumentWarnings?: string[] }
}

async function startRun(client: Client, instrument: string, id: string) {
  const { rows } = await client.query<{ tags: string[] }>(
    `select * from api.create_instrument_run($1, $2, $3, $4)`,
    [WS, `Run ${id}`, id, instrument],
  )
  return rows[0]!.tags
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, STEWARD, SCIENTIST, ANALYST, VIEWER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'enforced','Enforced settings')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
       ($1,$2,'owner'),($1,$3,'steward'),($1,$4,'scientist'),($1,$5,'analyst'),($1,$6,'viewer')`,
    [WS, OWNER, STEWARD, SCIENTIST, ANALYST, VIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'ENF','Enforced',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records
       (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
     values
       ($1,$3,$4,'experiment','EXP-ENF-1','Locks','draft','{}','{}',$5),
       ($2,$3,$4,'experiment','EXP-ENF-2','Stays open','draft','{}','{}',$5)`,
    [RECORD, RECORD_OPEN, WS, PROJECT, OWNER],
  )

  const owner = await actor(OWNER)
  instrumentId = (
    await owner.query<{ id: string }>(
      `select * from api.create_instrument($1,'Plate reader','qpcr',null,'ENF-1',null,'Lab',null,'{}'::jsonb,0,'none')`,
      [WS],
    )
  ).rows[0]!.id

  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle,created_by_user_id)
     values($1,$2,'enforced','Enforced','active',$3)`,
    [SCHEMA, WS, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,revision,created_by_user_id)
     values($1,$2,1,'active',1,$3)`,
    [SCHEMA_VERSION, SCHEMA, OWNER],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,lifecycle,revision,intended_use,created_by_user_id)
     values($1,$2,$3,'Readings','active',1,'exploratory_research',$4)`,
    [DATASET, WS, SCHEMA_VERSION, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_versions(id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id)
     values($1,$2,$3,$4,1,'v1',$5)`,
    [DATASET_VERSION, DATASET, WS, SCHEMA_VERSION, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format,status,created_by_user_id)
     values($1,$2,'readings.csv',128,repeat('c',64),'enforced/readings.csv','csv','stored',$3)`,
    [IMPORT_FILE, WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('signature meanings follow the signature policy', () => {
  it('signs every meaning until a workspace switches one off', async () => {
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await expect(signature(submission, 'witnessed')).resolves.toBeDefined()
  })

  it('refuses a switched-off meaning, and always accepts authored', async () => {
    await setSettings({
      p_signature_policy: JSON.stringify({
        meanings: { Witnessed: false, Reviewed: true, Approved: false },
      }),
    })
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await expectDenied(signature(submission, 'witnessed'), 'SB130')
    await expectDenied(signature(submission, 'reviewed-and-approved'), 'SB130')
    await expect(signature(submission, 'reviewed')).resolves.toBeDefined()
    await expect(signature(submission, 'authored')).resolves.toBeDefined()
  })

  it('refuses a witness request when witnessing is off', async () => {
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await expectDenied(
      migrator.query(
        `insert into api.signature_witness_requests
           (workspace_id, submission_id, revision_digest, witness_user_id,
          requested_by_user_id, requested_session_id)
         values ($1, $2, repeat('a',64), $3, $4, 'session-ask')`,
        [WS, submission, VIEWER, OWNER],
      ),
      'SB130',
    )
  })

  it('accepts the meaning again once it is switched back on', async () => {
    await setSettings({
      p_signature_policy: JSON.stringify({
        meanings: { Witnessed: true, Reviewed: true, Approved: true },
      }),
    })
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await expect(signature(submission, 'witnessed')).resolves.toBeDefined()
  })
})

describe('lock on sign', () => {
  it('leaves a record open after approval when the workspace turns locking off', async () => {
    await setSettings({ p_lock_on_sign: false })
    const submission = await submissionFor(RECORD_OPEN, [SCIENTIST])
    await signature(submission, 'reviewed-and-approved')
    const { rows } = await migrator.query<{ locked_at: string | null }>(
      'select locked_at from api.records where id = $1',
      [RECORD_OPEN],
    )
    expect(rows[0]!.locked_at).toBeNull()
  })

  it('locks the record on the approving signature by default', async () => {
    await setSettings({ p_lock_on_sign: true })
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await signature(submission, 'reviewed-and-approved')
    const { rows } = await migrator.query<{ locked_at: string | null }>(
      'select locked_at from api.records where id = $1',
      [RECORD],
    )
    expect(rows[0]!.locked_at).not.toBeNull()
  })
})

describe('an amendment needs a reason when the workspace asks for one', () => {
  async function amend(note: string | null) {
    const owner = await actor(OWNER)
    await setActorJwt(owner, OWNER, WS, { session_id: 'es-owner-session' })
    return owner.query('select api.create_amendment($1,$2)', [RECORD, note])
  }

  it('refuses an amendment with no reason, and takes it with one', async () => {
    await migrator.query(
      `insert into internal."session"(id,"expiresAt",token,"userId")
       values ('es-owner-session','2099-01-01T00:00:00Z','token-es-owner',$1)
       on conflict (id) do nothing`,
      [OWNER],
    )
    await setSettings({ p_require_change_reason: true })
    await expectDenied(amend(null), 'SB133')
    await expectDenied(amend('   '), 'SB133')
    await expect(amend('Corrected the buffer volume')).resolves.toBeDefined()
  })

  it('lets the reason go when the workspace does not require one', async () => {
    await setSettings({ p_require_change_reason: false })
    // Lock again so there is something to amend.
    const submission = await submissionFor(RECORD, [SCIENTIST])
    await signature(submission, 'reviewed-and-approved')
    await expect(amend(null)).resolves.toBeDefined()
  })
})

describe('a pinned review workflow', () => {
  it('offers every workflow until the workspace pins one', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ definition_key: string }>(
      'select * from api.available_review_workflows()',
    )
    expect(rows.map((r) => r.definition_key)).toEqual([
      'controlled-scientific-review',
      'default-scientific-review',
    ])
  })

  it('offers only the pinned workflow and refuses another', async () => {
    await setSettings({
      p_review_workflow_enabled: true,
      p_review_workflow_config: JSON.stringify({
        workflow: 'controlled-scientific-review',
        minReviewers: 2,
      }),
    })
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ definition_key: string }>(
      'select * from api.available_review_workflows()',
    )
    expect(rows.map((r) => r.definition_key)).toEqual([
      'controlled-scientific-review',
    ])
    await expectDenied(
      submissionFor(RECORD_OPEN, [SCIENTIST, STEWARD]),
      'SB131',
    )
  })

  it('asks for the reviewer count the workspace names', async () => {
    await expectDenied(
      submissionFor(RECORD_OPEN, [SCIENTIST], 'controlled-scientific-review'),
      'SB132',
    )
    await expect(
      submissionFor(
        RECORD_OPEN,
        [SCIENTIST, STEWARD],
        'controlled-scientific-review',
      ),
    ).resolves.toBeDefined()
  })

  it('refuses a workflow that does not exist or a nonsense reviewer count', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        'select * from api.update_workspace_settings($1,null,null,$2)',
        [WS, JSON.stringify({ workflow: 'no-such-workflow' })],
      ),
      'SB057',
    )
    await expectDenied(
      owner.query(
        'select * from api.update_workspace_settings($1,null,null,$2)',
        [WS, JSON.stringify({ minReviewers: 0 })],
      ),
      'SB057',
    )
  })

  it('leaves submissions alone once the workspace turns the pin off', async () => {
    await setSettings({ p_review_workflow_enabled: false })
    await expect(
      submissionFor(RECORD_OPEN, [SCIENTIST], 'default-scientific-review'),
    ).resolves.toBeDefined()
  })

  it('lets only someone who manages signatures change it', async () => {
    const scientist = await actor(SCIENTIST)
    await expectDenied(
      scientist.query(
        'select * from api.update_workspace_settings($1,null,true)',
        [WS],
      ),
      'SB056',
    )
  })
})

describe('instruments that are not ready', () => {
  it('flags a run and an import while calibration is overdue (the default)', async () => {
    await migrator.query(
      `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
       values($1,$2,now() - interval '60 days',now() - interval '5 days')`,
      [instrumentId, WS],
    )
    const owner = await actor(OWNER)
    expect(await startRun(owner, instrumentId, 'ES-RUN-1')).toContain(
      'flag:calibration_overdue',
    )
    expect((await importFrom(instrumentId)).instrumentWarnings).toContain(
      'calibration_overdue',
    )
  })

  it('names the person not being qualified as a finding', async () => {
    const owner = await actor(OWNER)
    expect(await startRun(owner, instrumentId, 'ES-RUN-2')).toContain(
      'flag:unqualified',
    )
  })

  it('takes the data without a flag when the rule is off', async () => {
    await gate('off')
    const owner = await actor(OWNER)
    expect(await startRun(owner, instrumentId, 'ES-RUN-3')).toEqual([])
    expect((await importFrom(instrumentId)).instrumentWarnings).toBeUndefined()
  })

  it('refuses runs and imports when the rule blocks', async () => {
    await gate('block')
    const owner = await actor(OWNER)
    await expectDenied(startRun(owner, instrumentId, 'ES-RUN-4'), 'SB115')
    await expectDenied(importFrom(instrumentId), 'SB115')
  })

  it('refuses a calibration-overdue instrument once the person is qualified', async () => {
    await migrator.query(
      `insert into api.instrument_qualifications(instrument_id,workspace_id,user_id,valid_until)
       values($1,$2,$3,now() + interval '30 days')`,
      [instrumentId, WS, OWNER],
    )
    const owner = await actor(OWNER)
    await expectDenied(startRun(owner, instrumentId, 'ES-RUN-5'), 'SB116')
    await expectDenied(importFrom(instrumentId), 'SB116')
  })

  it('accepts data again once a new calibration is recorded', async () => {
    const scientist = await actor(SCIENTIST)
    await scientist.query(
      `select * from api.record_instrument_calibration($1, now() - interval '1 day', now() + interval '90 days')`,
      [instrumentId],
    )
    const owner = await actor(OWNER)
    await expect(startRun(owner, instrumentId, 'ES-RUN-6')).resolves.toEqual([])
    expect((await importFrom(instrumentId)).instrumentWarnings).toBeUndefined()
  })

  it('refuses data for a retired instrument when the rule blocks', async () => {
    const owner = await actor(OWNER)
    await owner.query('select * from api.set_instrument_retired($1,true)', [
      instrumentId,
    ])
    await expectDenied(startRun(owner, instrumentId, 'ES-RUN-7'), 'SB134')
    await owner.query('select * from api.set_instrument_retired($1,false)', [
      instrumentId,
    ])
  })

  it('lets only someone who manages instruments choose the rule', async () => {
    const scientist = await actor(SCIENTIST)
    await expectDenied(
      scientist.query('select * from api.set_instrument_gate_mode($1,$2)', [
        WS,
        'off',
      ]),
      'SB056',
    )
    const steward = await actor(STEWARD)
    await expect(
      steward.query('select * from api.set_instrument_gate_mode($1,$2)', [
        WS,
        'warn',
      ]),
    ).resolves.toBeDefined()
    await expectDenied(
      steward.query('select * from api.set_instrument_gate_mode($1,$2)', [
        WS,
        'sometimes',
      ]),
      'SB057',
    )
  })
})

describe('instrument administration is a capability, not "not a viewer"', () => {
  const register = (client: Client, name: string) =>
    client.query(
      `select * from api.create_instrument($1,$2,'qpcr',null,$2,null,'Lab',null,'{}'::jsonb,0,'none')`,
      [WS, name],
    )

  it('lets an admin-level role register and retire instruments, and refuses a scientist', async () => {
    const steward = await actor(STEWARD)
    await expect(register(steward, 'Steward reader')).resolves.toBeDefined()
    const scientist = await actor(SCIENTIST)
    await expectDenied(register(scientist, 'Scientist reader'), '42501')
    await expectDenied(
      scientist.query('select * from api.set_instrument_retired($1,true)', [
        instrumentId,
      ]),
      '42501',
    )
    await expectDenied(
      scientist.query(
        `select * from api.create_calendar_resource($1,'Reader','RDR-9','instrument')`,
        [WS],
      ),
      '42501',
    )
  })

  it('still lets a scientist register a room', async () => {
    const scientist = await actor(SCIENTIST)
    await expect(
      scientist.query(
        `select * from api.create_calendar_resource($1,'Quiet room','ROOM-9','room')`,
        [WS],
      ),
    ).resolves.toBeDefined()
  })

  it('follows the Roles page when an admin gives scientists the Instruments area', async () => {
    const owner = await actor(OWNER)
    await owner.query(
      `select * from api.set_settings_access($1,'instruments','scientist','manage')`,
      [WS],
    )
    const scientist = await actor(SCIENTIST)
    await expect(register(scientist, 'Scientist reader')).resolves.toBeDefined()
    await owner.query(
      `select * from api.set_settings_access($1,'instruments','scientist','none')`,
      [WS],
    )
  })

  it('records calibrations for the people who run instruments, not analysts or viewers', async () => {
    const record = (client: Client) =>
      client.query(
        `select * from api.record_instrument_calibration($1, now() - interval '1 day', now() + interval '90 days')`,
        [instrumentId],
      )
    await expect(record(await actor(SCIENTIST))).resolves.toBeDefined()
    await expectDenied(record(await actor(ANALYST)), '42501')
    await expectDenied(record(await actor(VIEWER)), '42501')
  })
})

describe('governance functions check the capability the Roles page grants', () => {
  const NIL = '00000000-0000-4000-8000-000000000000'
  const calls: Array<[string, string]> = [
    [
      'add a schema field',
      `select api.add_dataset_schema_field('${NIL}','f','F','text')`,
    ],
    ['publish a schema', `select api.publish_dataset_schema('${NIL}')`],
    [
      'retire a schema field',
      `select api.retire_dataset_schema_field('${NIL}')`,
    ],
    [
      'write a parser version',
      `select api.create_parser_version('${WS}','k','K','csv',1,'{}'::jsonb)`,
    ],
  ]

  it.each(calls)('refuses a scientist who tries to %s', async (_name, sql) => {
    await expectDenied((await actor(SCIENTIST)).query(sql), '42501')
  })

  it.each(calls)(
    'lets a data steward past the check to %s',
    async (_name, sql) => {
      const error = await (await actor(STEWARD)).query(sql).then(
        () => null,
        (e: { code?: string; message?: string }) => e,
      )
      expect(error?.message ?? '').not.toMatch(/^not permitted: needs/)
    },
  )

  it('refuses a viewer who tries to link a record to a study', async () => {
    await expectDenied(
      (await actor(VIEWER)).query(
        `select api.link_study_project('${NIL}','${PROJECT}')`,
      ),
      '42501',
    )
  })
})

describe('every write is a permission the Roles page can change', () => {
  const NIL = '00000000-0000-4000-8000-000000000000'
  const setWork = async (role: string, area: string, level: string) =>
    (await actor(OWNER)).query(
      `select * from api.set_settings_access($1,$2,$3,$4)`,
      [WS, area, role, level],
    )
  const needs = (permission: string) =>
    new RegExp(`^not permitted: needs work\\.${permission}$`)
  const ask = (client: Client) =>
    client.query(`select api.withdraw_sample('${NIL}', 1, 1, '${NIL}')`).then(
      () => '',
      (e: { message?: string }) => e.message ?? '',
    )

  it('lets everyone who could write before keep writing, and not a viewer', async () => {
    expect(await ask(await actor(SCIENTIST))).not.toMatch(needs('samples'))
    expect(await ask(await actor(ANALYST))).not.toMatch(needs('samples'))
    expect(await ask(await actor(STEWARD))).not.toMatch(needs('samples'))
    expect(await ask(await actor(VIEWER))).toMatch(needs('samples'))
  })

  it('takes a kind of work away from one role without touching the others', async () => {
    await setWork('scientist', 'work_samples', 'none')
    expect(await ask(await actor(SCIENTIST))).toMatch(needs('samples'))
    expect(await ask(await actor(ANALYST))).not.toMatch(needs('samples'))
    const comment = await (
      await actor(SCIENTIST)
    )
      .query(`select api.reply_to_comment('${NIL}', 'x', '{}'::text[])`)
      .then(
        () => '',
        (e: { message?: string }) => e.message ?? '',
      )
    expect(comment).not.toMatch(needs('comments'))
    await setWork('scientist', 'work_samples', 'manage')
    expect(await ask(await actor(SCIENTIST))).not.toMatch(needs('samples'))
  })

  it('can give a viewer a kind of work, and the workspace admin always keeps it', async () => {
    await setWork('viewer', 'work_samples', 'manage')
    expect(await ask(await actor(VIEWER))).not.toMatch(needs('samples'))
    await setWork('viewer', 'work_samples', 'none')
    await setWork('steward', 'work_samples', 'none')
    expect(await ask(await actor(STEWARD))).toMatch(needs('samples'))
    expect(await ask(await actor(OWNER))).not.toMatch(needs('samples'))
    await setWork('steward', 'work_samples', 'manage')
  })

  it('lets only the workspace admin change it', async () => {
    await expectDenied(
      (await actor(STEWARD)).query(
        `select * from api.set_settings_access($1,'work_samples','scientist','none')`,
        [WS],
      ),
      'SB056',
    )
  })

  it('leaves client messaging to the client and the team', async () => {
    expect(
      await (
        await actor(VIEWER)
      )
        .query(`select api.post_client_portal_message('${NIL}', NULL, 'hi')`)
        .then(
          () => '',
          (e: { message?: string }) => e.message ?? '',
        ),
    ).not.toMatch(/^not permitted: needs work\./)
  })
})
