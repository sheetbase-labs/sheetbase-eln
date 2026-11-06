/**
 * The validation pack (migration 0106): the checks, the run record and the
 * exported pack.
 *
 * Proves, against a freshly migrated database:
 *  - runs are only recorded for a workspace with Regulated lab on, and only an
 *    audit manager may start one;
 *  - every check reports a result against real data, and the immutability and
 *    isolation checks really try (and fail) to change things;
 *  - a run is kept, announced, and can never be edited or deleted;
 *  - the exported pack verifies offline and says it is not a compliance claim.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  generateWorkspaceKeyPair,
  keyFingerprint,
  signWithKey,
} from '../../src/lib/export/bundle-key'
import { runChecks } from '../../src/lib/validation/checks.server'
import type { CheckDeps } from '../../src/lib/validation/checks.server'
import { buildValidationPack } from '../../src/lib/validation/pack'
import type { ValidationRunRecord } from '../../src/lib/validation/types'
import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f100'
const PROJECT = '00000000-0000-4000-8000-00000000f101'
const RECORD = '00000000-0000-4000-8000-00000000f102'
const ADMIN = 'val-admin'
const MEMBER = 'val-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
const keys = generateWorkspaceKeyPair()

async function as(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, user, WS)
  return client
}

function deps(): CheckDeps {
  return {
    db: migrator,
    workspaceId: WS,
    userId: ADMIN,
    now: () => new Date(),
    idleSecondsFor: async () => 1800,
    exportKey: async () => ({
      publicKeyPem: keys.publicKeyPem,
      fingerprint: keyFingerprint(keys.publicKeyPem),
      sign: (data) => signWithKey(keys.privateKeyPem, data),
    }),
    fetch: (async () =>
      new Response('{}', { status: 200 })) as unknown as typeof fetch,
    config: {
      postgrestUrl: 'http://postgrest.invalid',
      publicUrl: 'https://lab.example',
      expectedMigration: 'untracked',
    },
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,$1,'val-admin@test.invalid',true),($2,$2,'val-member@test.invalid',true)`,
    [ADMIN, MEMBER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'val','Validation lab')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'scientist')`,
    [WS, ADMIN, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'VAL','V',$3)`,
    [PROJECT, WS, ADMIN],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-V','Signed',$4)`,
    [RECORD, WS, PROJECT, ADMIN],
  )
  const revision = await migrator.query<{
    id: string
    integrity_digest: string
  }>(
    `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,
                               block_snapshot,reason,created_by_user_id,updated_at)
     values($1,1,1,'{"title":"Signed"}'::jsonb,'[]'::jsonb,'submit',$2,now())
     returning id,integrity_digest`,
    [RECORD, ADMIN],
  )
  const submission = await migrator.query<{ id: string }>(
    `insert into api.review_submissions(workspace_id,record_id,revision_id,workflow_definition_key,
                                        workflow_definition_version,assigned_reviewer_user_ids,
                                        submitted_by_user_id,submitted_session_id,submitted_role,
                                        submitted_at,idempotency_key)
     values($1,$2,$3,'default-scientific-review',1,array[$4],$4,'sess-v','author',now(),'sub-v')
     returning id`,
    [WS, RECORD, revision.rows[0]!.id, ADMIN],
  )
  await migrator.query(
    `insert into api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,
                                assurance_level,revision_integrity_digest,signer_user_id,
                                signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
     values($1,$2,$3,$4,'reviewed-and-approved','standard',$5,$6,'sess-v','reviewer','password','I confirm',now())`,
    [
      WS,
      submission.rows[0]!.id,
      revision.rows[0]!.id,
      RECORD,
      revision.rows[0]!.integrity_digest,
      ADMIN,
    ],
  )
  await setActorJwt(migrator, ADMIN, WS)
  await migrator.query(
    `select internal.emit_change_event($1,'record',$2,'update',$2,$3,'{"n":1}'::jsonb)`,
    [WS, RECORD, PROJECT],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()))
  await migrator?.end()
})

describe('who may run the checks', () => {
  it('is nobody until Regulated lab is on, then only an audit manager', async () => {
    const admin = await as(ADMIN)
    expect(
      (await admin.query(`select api.can_run_validation($1::uuid) as ok`, [WS]))
        .rows[0].ok,
    ).toBe(false)
    await expect(
      migrator.query(
        `select internal.record_validation_run($1,$2,'t',null,'[]'::jsonb,now())`,
        [WS, ADMIN],
      ),
    ).rejects.toThrow(/regulated labs/)

    await migrator.query(
      `update api.workspace_settings set regulated_lab = true where workspace_id = $1`,
      [WS],
    )
    const settings = await migrator.query(
      `select regulated_lab from api.workspace_settings where workspace_id = $1`,
      [WS],
    )
    if (settings.rows.length === 0) {
      await migrator.query(
        `insert into api.workspace_settings(workspace_id,created_by_user_id,regulated_lab) values($1,$2,true)`,
        [WS, ADMIN],
      )
    }
    expect(
      (await admin.query(`select api.can_run_validation($1::uuid) as ok`, [WS]))
        .rows[0].ok,
    ).toBe(true)
    const member = await as(MEMBER)
    expect(
      (
        await member.query(`select api.can_run_validation($1::uuid) as ok`, [
          WS,
        ])
      ).rows[0].ok,
    ).toBe(false)
  })
})

describe('the checks', () => {
  let run: ValidationRunRecord

  it('give a result for every check against real data', async () => {
    const results = await runChecks(deps())
    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(Object.keys(byId)).toHaveLength(results.length)
    for (const id of [
      'iq.database',
      'iq.roles',
      'iq.clock',
      'iq.address',
      'iq.postgrest',
      'oq.session_idle',
      'oq.audit_chain',
      'oq.signed_revisions',
      'oq.audit_immutable',
      'oq.signature_immutable',
      'oq.export_key',
      'oq.workspace_isolation',
    ]) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('passed')
    }
    expect(byId['oq.timestamps']?.status).toBe('skipped')
    expect(byId['oq.audit_immutable']?.evidence.message).toMatch(
      /audit|change/i,
    )
    // The immutability checks only tried: the data is intact afterwards.
    const intact = await migrator.query<{ ok: boolean }>(
      `select ok from internal.verify_audit_chain($1)`,
      [WS],
    )
    expect(intact.rows[0]!.ok).toBe(true)
    // Not-yet-configured settings are reported as a failure, not hidden.
    expect(byId['oq.regulated_settings']?.status).toBeDefined()
  })

  it('reports a failure when the audit trail has been tampered with', async () => {
    await migrator.query(
      `alter table api.change_events disable trigger refuse_change_event_mutation`,
    )
    await migrator.query(
      `alter table api.change_events disable trigger chain_audit_entry`,
    )
    const { rows } = await migrator.query<{ id: string }>(
      `select id from api.change_events where workspace_id = $1 order by sequence limit 1`,
      [WS],
    )
    await migrator.query(
      `update api.change_events set payload = '{"tampered":true}' where id = $1`,
      [rows[0]!.id],
    )
    await migrator.query(
      `alter table api.change_events enable trigger refuse_change_event_mutation`,
    )
    await migrator.query(
      `alter table api.change_events enable trigger chain_audit_entry`,
    )
    const results = await runChecks(deps())
    expect(results.find((r) => r.id === 'oq.audit_chain')?.status).toBe(
      'failed',
    )
  })

  it('are kept as a run that cannot be changed', async () => {
    await migrator.query(`delete from api.change_events where false`)
    const results = await runChecks(deps())
    const { rows } = await migrator.query<ValidationRunRecord>(
      `select * from internal.record_validation_run($1,$2,'1.2.3','m1',$3::jsonb,now())`,
      [WS, ADMIN, JSON.stringify(results)],
    )
    run = rows[0]!
    expect(run.status).toBe('failed')
    expect(run.passed + run.failed + run.skipped).toBe(results.length)
    const admin = await as(ADMIN)
    expect(
      (await admin.query(`select id from api.validation_runs`)).rows,
    ).toHaveLength(1)
    const member = await as(MEMBER)
    expect(
      (await member.query(`select id from api.validation_runs`)).rows,
    ).toHaveLength(0)
    await expect(
      migrator.query(
        `update api.validation_runs set status = 'passed' where id = $1`,
        [run.id],
      ),
    ).rejects.toThrow(/cannot be changed/)
    await expect(
      migrator.query(`delete from api.validation_runs where id = $1`, [run.id]),
    ).rejects.toThrow(/cannot be changed/)
    const events = await migrator.query(
      `select payload from api.change_events where workspace_id = $1 and entity_type = 'validation_run'`,
      [WS],
    )
    expect(events.rows).toHaveLength(1)
    await expectDenied(
      admin.query(
        `insert into api.validation_runs(workspace_id,app_version,status,passed,failed,skipped,results,started_at) values($1,'x','passed',0,0,0,'[]',now())`,
        [WS],
      ),
      '42501',
    )
  })

  it('go into a pack that verifies offline', async () => {
    const { rows } = await migrator.query<ValidationRunRecord>(
      `select * from api.validation_runs where workspace_id = $1 order by finished_at desc`,
      [WS],
    )
    const zip = await buildValidationPack({
      workspaceName: 'Validation lab',
      generatedAt: '2026-11-06T12:00:00Z',
      appVersion: '1.2.3',
      migration: 'm1',
      system: { node: 'v26' },
      runs: rows,
      publicKeyPem: keys.publicKeyPem,
      fingerprint: keyFingerprint(keys.publicKeyPem),
      sign: (m) => signWithKey(keys.privateKeyPem, m),
    })
    const dir = mkdtempSync(join(tmpdir(), 'sheetbase-pack-'))
    writeFileSync(join(dir, 'pack.zip'), zip)
    execFileSync('unzip', ['-q', 'pack.zip', '-d', 'out'], { cwd: dir })
    const out = join(dir, 'out')
    const verify = spawnSync(
      'node',
      ['verify.mjs', '--key-fingerprint', keyFingerprint(keys.publicKeyPem)],
      { cwd: out, encoding: 'utf8' },
    )
    expect(verify.stdout).toContain('Bundle verified.')
    expect(verify.status).toBe(0)
    const listing = execFileSync('unzip', ['-Z1', 'pack.zip'], {
      cwd: dir,
      encoding: 'utf8',
    }).split('\n')
    for (const name of [
      'README.md',
      'requirements.csv',
      'trace.csv',
      'trace.md',
      'protocol.md',
      'system.json',
      `runs/${rows[0]!.id}.json`,
    ]) {
      expect(listing).toContain(name)
    }
    const readme = execFileSync('unzip', ['-p', 'pack.zip', 'README.md'], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(readme).toMatch(/does not say that Sheetbase/)
    // Altering a file is caught.
    writeFileSync(join(out, 'requirements.csv'), 'edited')
    const tampered = spawnSync('node', ['verify.mjs'], {
      cwd: out,
      encoding: 'utf8',
    })
    expect(tampered.status).toBe(1)
  })
})
