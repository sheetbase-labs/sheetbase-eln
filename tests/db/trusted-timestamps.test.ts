/**
 * Trusted timestamps and the export signing key (migration 0104).
 *
 * Proves, against a freshly migrated database:
 *  - an audit manager turns timestamps on, picks an authority and nobody else can;
 *  - nothing is due while it is off, and a signature is due once it is on;
 *  - a stamp is kept beside the signature and announced on the change feed;
 *  - failures back off, give up after six attempts, and can be asked for again;
 *  - the export key is made once per workspace and only its public half is readable.
 */
import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sweepTimestamps } from '../../src/lib/timestamps/stamper.server'
import { sha256Hex } from '../../src/lib/timestamps/signed-data'
import {
  createTestAuthority,
  opensslAvailable,
} from '../../src/lib/timestamps/test-authority'
import { verifyTimestampResponse } from '../../src/lib/timestamps/tsp'
import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e100'
const OTHER_WS = '00000000-0000-4000-8000-00000000e200'
const PROJECT = '00000000-0000-4000-8000-00000000e101'
const RECORD = '00000000-0000-4000-8000-00000000e102'
const OWNER = 'ts-owner'
const MEMBER = 'ts-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let signatureId: string
const clients: Client[] = []

async function as(user: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, user, workspace)
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,$1,'ts-owner@test.invalid',true),($2,$2,'ts-member@test.invalid',true)`,
    [OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'ts','Timestamps'),($2,'ts2','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
       ($1,$2,'owner'),($1,$3,'scientist'),($4,$2,'owner')`,
    [WS, OWNER, MEMBER, OTHER_WS],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'TS1','T',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-TS','Signed',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  const revision = await migrator.query<{ id: string; integrity_digest: string }>(
    `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,
                               block_snapshot,reason,created_by_user_id,updated_at)
     values($1,1,1,'{"title":"Signed"}'::jsonb,'[]'::jsonb,'submit',$2,now())
     returning id,integrity_digest`,
    [RECORD, OWNER],
  )
  const submission = await migrator.query<{ id: string }>(
    `insert into api.review_submissions(workspace_id,record_id,revision_id,workflow_definition_key,
                                        workflow_definition_version,assigned_reviewer_user_ids,
                                        submitted_by_user_id,submitted_session_id,submitted_role,
                                        submitted_at,idempotency_key)
     values($1,$2,$3,'default-scientific-review',1,array[$4],$4,'sess-ts','author',now(),'sub-ts')
     returning id`,
    [WS, RECORD, revision.rows[0]!.id, OWNER],
  )
  const signature = await migrator.query<{ id: string }>(
    `insert into api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,
                                assurance_level,revision_integrity_digest,signer_user_id,
                                signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
     values($1,$2,$3,$4,'reviewed-and-approved','standard',$5,$6,'sess-ts','reviewer','password',
            'I confirm',now())
     returning id`,
    [WS, submission.rows[0]!.id, revision.rows[0]!.id, RECORD, revision.rows[0]!.integrity_digest, OWNER],
  )
  signatureId = signature.rows[0]!.id
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

const due = async () =>
  (await migrator.query(`select * from internal.signatures_due_timestamp(50)`)).rows

describe('timestamp settings', () => {
  it('start switched off and only an audit manager can change them', async () => {
    const member = await as(MEMBER)
    const { rows } = await member.query(
      `select api.timestamp_settings($1::uuid) as s`,
      [WS],
    )
    expect(rows[0].s).toMatchObject({ enabled: false })
    await expectDenied(
      member.query(`select api.set_timestamp_settings($1::uuid, true, 'dfn')`, [WS]),
      'SB060',
    )
    expect(await due()).toHaveLength(0)
  })

  it('validates the authority and keeps the chosen address', async () => {
    const owner = await as(OWNER)
    await expect(
      owner.query(`select api.set_timestamp_settings($1::uuid, true, 'nope')`, [WS]),
    ).rejects.toThrow(/choose a time-stamping authority/)
    await expect(
      owner.query(
        `select api.set_timestamp_settings($1::uuid, true, 'custom', 'ftp://x')`,
        [WS],
      ),
    ).rejects.toThrow(/starting with http/)
    const { rows } = await owner.query(
      `select api.set_timestamp_settings($1::uuid, true, 'custom', 'https://tsa.lab.test/tsr') as s`,
      [WS],
    )
    expect(rows[0].s).toEqual({
      enabled: true,
      authority: 'custom',
      url: 'https://tsa.lab.test/tsr',
    })
  })

  it('is invisible to another workspace', async () => {
    const other = await as(OWNER, OTHER_WS)
    await expectDenied(
      other.query(`select api.timestamp_settings($1::uuid)`, [WS]),
      'SB033',
    )
  })
})

describe('stamping', () => {
  it('lists a signature as due once timestamps are on', async () => {
    const rows = await due()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      signature_id: signatureId,
      authority: 'custom',
      authority_url: 'https://tsa.lab.test/tsr',
    })
  })

  it('backs off after a failure and gives up after six', async () => {
    for (let n = 1; n <= 5; n++) {
      await migrator.query(
        `select internal.record_signature_timestamp_failure($1, 'authority down')`,
        [signatureId],
      )
      await migrator.query(
        `update api.signature_timestamps set next_attempt_at = now() where signature_id = $1`,
        [signatureId],
      )
    }
    expect((await due())).toHaveLength(1)
    await migrator.query(
      `select internal.record_signature_timestamp_failure($1, 'authority down')`,
      [signatureId],
    )
    const { rows } = await migrator.query(
      `select status, attempts, last_error from api.signature_timestamps where signature_id = $1`,
      [signatureId],
    )
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 6, last_error: 'authority down' })
    expect(await due()).toHaveLength(0)
    const events = await migrator.query(
      `select payload from api.change_events
        where workspace_id = $1 and entity_type = 'signature_timestamp' and payload->>'action' = 'timestamp-failed'`,
      [WS],
    )
    expect(events.rows).toHaveLength(1)
  })

  it('lets an audit manager ask again, and nobody else', async () => {
    const member = await as(MEMBER)
    await expectDenied(
      member.query(`select * from api.request_signature_timestamp($1)`, [signatureId]),
      'SB060',
    )
    const owner = await as(OWNER)
    const { rows } = await owner.query(
      `select * from api.request_signature_timestamp($1)`,
      [signatureId],
    )
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(await due()).toHaveLength(1)
  })

  it('keeps a stamp beside the signature and announces it', async () => {
    const signedData = '{"format":"sheetbase-signature/1"}'
    const imprint = createHash('sha256').update(signedData).digest('hex')
    const stamp = () =>
      migrator.query(
        `select * from internal.record_signature_timestamp($1,'Test TSA','https://tsa.lab.test/tsr',$2,'AAEC','2026-11-06T10:00:00Z','2a','CN=Test TSA')`,
        [signatureId, signedData],
      )
    await stamp()
    await stamp() // a second replica: the first stamp stands, with one event
    expect(await due()).toHaveLength(0)
    const member = await as(MEMBER)
    const { rows } = await member.query(
      `select status, imprint_sha256, gen_time, serial from api.signature_timestamps where signature_id = $1`,
      [signatureId],
    )
    expect(rows[0]).toMatchObject({ status: 'stamped', imprint_sha256: imprint, serial: '2a' })
    const events = await migrator.query(
      `select payload from api.change_events
        where workspace_id = $1 and entity_type = 'signature_timestamp' and payload->>'action' = 'timestamped'`,
      [WS],
    )
    expect(events.rows).toHaveLength(1)
    // A stamped signature cannot be reset by asking again.
    const owner = await as(OWNER)
    const again = await owner.query(
      `select status from api.request_signature_timestamp($1)`,
      [signatureId],
    )
    expect(again.rows[0].status).toBe('stamped')
  })

  it('cannot be read from another workspace', async () => {
    const other = await as(OWNER, OTHER_WS)
    const { rows } = await other.query(`select id from api.signature_timestamps`)
    expect(rows).toHaveLength(0)
  })
})

describe('export signing key', () => {
  it('is made once per workspace and only the public half is readable', async () => {
    const owner = await as(OWNER)
    expect((await owner.query(`select api.workspace_signing_key($1::uuid) as k`, [WS])).rows[0].k).toBeNull()
    await migrator.query(
      `select * from internal.ensure_workspace_signing_key($1,'PUB1','PRIV1','fp1')`,
      [WS],
    )
    const second = await migrator.query(
      `select * from internal.ensure_workspace_signing_key($1,'PUB2','PRIV2','fp2')`,
      [WS],
    )
    expect(second.rows[0]).toMatchObject({ public_key_pem: 'PUB1', private_key_pem: 'PRIV1' })
    const { rows } = await owner.query(`select api.workspace_signing_key($1::uuid) as k`, [WS])
    expect(rows[0].k).toMatchObject({ publicKeyPem: 'PUB1', fingerprint: 'fp1', algorithm: 'ed25519' })
    expect(JSON.stringify(rows[0].k)).not.toContain('PRIV')
    await expectDenied(
      owner.query(`select * from internal.workspace_signing_keys`),
      '42501',
    )
  })
})

describe.skipIf(!opensslAvailable)('the sweep', () => {
  const connect = async () => ({
    query: migrator.query.bind(migrator) as never,
    end: async () => {},
  })

  async function addSignature(meaning: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `insert into api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,
                                  assurance_level,revision_integrity_digest,signer_user_id,
                                  signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
       select workspace_id,submission_id,revision_id,record_id,$2,'standard',revision_integrity_digest,
              signer_user_id,'sess-ts','reviewer','password','I confirm',now()
         from api.signatures where id = $1
       returning id`,
      [signatureId, meaning],
    )
    return rows[0]!.id
  }

  it('stamps due signatures through the authority and keeps a verifiable token', async () => {
    const authority = createTestAuthority()
    const id = await addSignature('reviewed')
    const result = await sweepTimestamps({ connect, fetch: authority.fetch })
    expect(result).toEqual({ stamped: 1, failed: 0 })
    const { rows } = await migrator.query(
      `select * from api.signature_timestamps where signature_id = $1`,
      [id],
    )
    const row = rows[0]
    expect(row.status).toBe('stamped')
    expect(row.imprint_sha256).toBe(sha256Hex(row.signed_data))
    expect(JSON.parse(row.signed_data)).toMatchObject({
      signatureId: id,
      format: 'sheetbase-signature/1',
    })
    const info = verifyTimestampResponse(
      new Uint8Array(Buffer.from(row.response_b64, 'base64')),
      { expectedImprintHex: row.imprint_sha256, trustedRoots: [authority.rootPem] },
    )
    expect(info.trusted).toBe(true)
    expect(row.authority_name).toBe('tsa.lab.test')
    // Nothing left to do.
    expect(await sweepTimestamps({ connect, fetch: authority.fetch })).toEqual({
      stamped: 0,
      failed: 0,
    })
  })

  it('records a failure and retries later when the authority is down', async () => {
    const id = await addSignature('witnessed')
    const down = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch
    expect(await sweepTimestamps({ connect, fetch: down })).toEqual({ stamped: 0, failed: 1 })
    const { rows } = await migrator.query(
      `select status, attempts, last_error, next_attempt_at > now() as later
         from api.signature_timestamps where signature_id = $1`,
      [id],
    )
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, later: true })
    expect(rows[0].last_error).toMatch(/503/)
  })
})
