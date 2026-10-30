/**
 * The "Regulated lab" workspace setting: a lab that is not regulated lets its
 * only administrator certify their own signing identity and lets an
 * experiment finish without review; a regulated lab keeps today's rules.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { createHmac } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import {
  REGULATED_IDLE_SECONDS,
  WORKING_DAY_IDLE_SECONDS,
  resetSessionIdleCache,
} from '#/lib/session-idle'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import {
  expectDenied,
  grantProjectAccess,
  migratorUrl,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000e100'
const PROJECT = '00000000-0000-4000-8000-00000000e102'
const PASSWORD = 'fixture-signing-password-2026'
const ORIGIN = 'https://sheetbase.test'
const OWNER = 'regulated-owner'
const MEMBER = 'regulated-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'regulated','Regulated')`,
    [WS],
  )
  for (const [id, role] of [
    [OWNER, 'owner'],
    [MEMBER, 'scientist'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [id, `${id}@sheetbase.test`],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)`,
      [WS, id, role],
    )
    await migrator.query(
      `insert into internal.session(id,token,"userId","expiresAt") values($1,$2,$3,now()+interval '1 hour')`,
      [`session-${id}`, `token-session-${id}`, id],
    )
  }
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values($1,$2,'REGA','Project A')`,
    [PROJECT, WS],
  )
  for (const id of [OWNER, MEMBER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: id,
      canView: true,
      canEdit: true,
    })
  }
  await authentication.api.setPassword({
    headers: headers(OWNER),
    body: { newPassword: PASSWORD },
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await database.$client.end()
  await migrator.end()
})

function headers(id: string) {
  const token = `token-session-${id}`
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Test secret required')
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: ORIGIN,
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function actor(id: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, id, WS, { session_id: `session-${id}` })
  return client
}

function step(id: string, input: object) {
  return handleSignatureStepUp(
    new Request(`${ORIGIN}/api/signatures/step-up`, {
      method: 'POST',
      headers: headers(id),
      body: JSON.stringify({ workspaceId: WS, ...input }),
    }),
    { database, authentication },
  )
}

async function setRegulated(regulated: boolean) {
  await migrator.query(
    `insert into api.workspace_settings(workspace_id,regulated_lab,created_by_user_id)
     values($1,$2,$3)
     on conflict(workspace_id) do update set regulated_lab=excluded.regulated_lab`,
    [WS, regulated, OWNER],
  )
}

describe('a workspace is not regulated until it says so', () => {
  it('reads as unregulated with no settings row, and the owner can turn it on and off', async () => {
    const isRegulated = async () =>
      (
        await migrator.query<{ r: boolean }>(
          'select internal.is_regulated_lab($1) as r',
          [WS],
        )
      ).rows[0]?.r
    expect(await isRegulated()).toBe(false)
    const owner = await actor(OWNER)
    await owner.query('select api.set_regulated_lab($1,true)', [WS])
    expect(await isRegulated()).toBe(true)
    await owner.query('select api.set_regulated_lab($1,false)', [WS])
    expect(await isRegulated()).toBe(false)
  })

  it('refuses people who cannot manage general settings', async () => {
    const member = await actor(MEMBER)
    await expectDenied(
      member.query('select api.set_regulated_lab($1,true)', [WS]),
      'SB056',
    )
  })
})

describe('signing identity', () => {
  it('lets the only administrator certify themselves when the lab is not regulated', async () => {
    await setRegulated(false)
    const owner = await actor(OWNER)
    await owner.query('select api.request_signature_identity_verification()')
    await owner.query('select api.self_verify_signature_identity($1)', [
      `${OWNER}@sheetbase.test`,
    ])
    const response = await step(OWNER, {
      purpose: 'certify',
      password: PASSWORD,
    })
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    await owner.query('select api.certify_signature($1,1,$2)', [WS, token])
    const practice = await step(OWNER, {
      purpose: 'practice',
      password: PASSWORD,
    })
    expect(practice.status).toBe(200)
  })

  it('only counts the signer’s own verification while the lab is not regulated', async () => {
    await setRegulated(true)
    expect(
      (await step(OWNER, { purpose: 'practice', password: PASSWORD })).status,
    ).toBe(403)
    await setRegulated(false)
    expect(
      (await step(OWNER, { purpose: 'practice', password: PASSWORD })).status,
    ).toBe(200)
  })

  it('refuses self-verification in a regulated lab, and for the wrong email', async () => {
    const owner = await actor(OWNER)
    await owner.query('select api.request_signature_identity_verification()')
    await expectDenied(
      owner.query('select api.self_verify_signature_identity($1)', [
        'someone-else@sheetbase.test',
      ]),
      '22023',
    )
    await setRegulated(true)
    await expectDenied(
      owner.query('select api.self_verify_signature_identity($1)', [
        `${OWNER}@sheetbase.test`,
      ]),
      '42501',
    )
    await setRegulated(false)
  })
})

describe('finishing an experiment', () => {
  async function runningExperiment(author: Client) {
    const id = crypto.randomUUID()
    await migrator.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'Finishing experiment','draft',$5)`,
      [id, WS, PROJECT, `EXP-${id}`, MEMBER],
    )
    const draft = await migrator.query<{ metadata_version: number }>(
      'select metadata_version from api.records where id=$1',
      [id],
    )
    const started = await author.query(
      'select * from api.start_experiment($1,$2,null,$3)',
      [id, draft.rows[0]!.metadata_version, 'Begin'],
    )
    return { id, version: started.rows[0].metadata_version as number }
  }

  it('finishes without review and reopens when the lab is not regulated', async () => {
    await setRegulated(false)
    const member = await actor(MEMBER)
    const experiment = await runningExperiment(member)
    const finished = (
      await member.query(
        'select * from api.set_experiment_status($1,$2,$3,$4)',
        [experiment.id, experiment.version, 'completed', 'Done at the bench'],
      )
    ).rows[0]
    expect(finished.status).toBe('completed')
    expect(finished.locked_at).toBeNull()
    const reopened = (
      await member.query(
        'select * from api.set_experiment_status($1,$2,$3,$4)',
        [
          experiment.id,
          finished.metadata_version,
          'in_progress',
          'One more run',
        ],
      )
    ).rows[0]
    expect(reopened.status).toBe('in_progress')
  })

  it('closes a finished notebook to edits until it is reopened', async () => {
    await setRegulated(false)
    const member = await actor(MEMBER)
    const experiment = await runningExperiment(member)
    await member.query('select * from api.set_experiment_status($1,$2,$3,$4)', [
      experiment.id,
      experiment.version,
      'completed',
      'Done',
    ])
    await expectDenied(
      migrator.query(
        `insert into api.blocks(record_id,type,payload,payload_schema_version,"order",created_by_user_id)
         values($1,'rich_text','{}'::jsonb,1,1,$2)`,
        [experiment.id, MEMBER],
      ),
      'SB116',
    )
  })

  it('still sends a regulated lab through review', async () => {
    await setRegulated(true)
    const member = await actor(MEMBER)
    const experiment = await runningExperiment(member)
    await expectDenied(
      member.query('select * from api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        experiment.version,
        'completed',
        'Done',
      ]),
      'SB116',
    )
    await setRegulated(false)
  })
})

describe('how long a session may sit idle', () => {
  async function newSessionSeconds(userId: string) {
    resetSessionIdleCache()
    const context = await authentication.$context
    const created = await context.internalAdapter.createSession(userId)
    return Math.round((created.expiresAt.getTime() - Date.now()) / 1000)
  }

  it('is a working day in a lab that is not regulated', async () => {
    await setRegulated(false)
    expect(await newSessionSeconds(MEMBER)).toBeCloseTo(
      WORKING_DAY_IDLE_SECONDS,
      -1,
    )
  })

  it('stays 30 minutes in a regulated lab', async () => {
    await setRegulated(true)
    expect(await newSessionSeconds(MEMBER)).toBeCloseTo(
      REGULATED_IDLE_SECONDS,
      -1,
    )
    await setRegulated(false)
  })

  it('applies the lab’s window when a session is refreshed by use', async () => {
    const expiry = async () =>
      (
        await migrator.query<{ seconds: number }>(
          `select extract(epoch from "expiresAt" - now()) as seconds
             from internal.session where id = $1`,
          [`session-${MEMBER}`],
        )
      ).rows[0]!.seconds
    for (const [regulated, expected] of [
      [true, REGULATED_IDLE_SECONDS],
      [false, WORKING_DAY_IDLE_SECONDS],
    ] as const) {
      await setRegulated(regulated)
      resetSessionIdleCache()
      await migrator.query(
        `update internal.session set "expiresAt" = now() + interval '1 hour' where id = $1`,
        [`session-${MEMBER}`],
      )
      await authentication.api.getSession({ headers: headers(MEMBER) })
      expect(Number(await expiry())).toBeCloseTo(expected, -1)
    }
    await setRegulated(false)
  })
})
