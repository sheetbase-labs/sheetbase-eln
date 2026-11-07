/**
 * Sign-off per part (see the part_sign_off migration): a part that needs a
 * signature is finished only when it is signed, signing freezes it and opens
 * the next, a signed part cannot be changed, a countersign is a request, and
 * amending reopens only that part with a reason.
 * Runs against a freshly migrated sheetbase_test database.
 */
import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fc01'
const OTHER_WS = '00000000-0000-4000-8000-00000000fc02'
const PROJECT = '00000000-0000-4000-8000-00000000fc11'
const OWNER = 'ps-owner'
const WITNESS = 'ps-witness'
const OUTSIDER = 'ps-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let witness: Client
let sequence = 0

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      session_id: `session-${userId}`,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, WITNESS, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$2,$3,true)`,
      [user, `Person ${user}`, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ('ps-verifier','Verifier','ps-verifier@test.invalid',true)`,
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'ps','Sign-off'),($2,'ps2','Other lab')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'owner'),($4,$5,'owner')`,
    [WS, OWNER, WITNESS, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'ps','Sign-off',$3)`,
    [PROJECT, WS, OWNER],
  )
  for (const user of [OWNER, WITNESS]) {
    await migrator.query(
      `insert into internal.session(id,token,"userId","expiresAt") values ($1,$2,$3,now()+interval '1 hour')`,
      [`session-${user}`, `token-${user}`, user],
    )
    await migrator.query(
      `insert into api.user_signature_certifications
       (workspace_id,user_id,statement_version,certified_at,identity_verified_by,identity_verified_at,verified_email,auth_method)
       values($1,$2,1,now(),'ps-verifier',now(),$3,'password')`,
      [WS, user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,access_level,granted_by_user_id,can_view,can_edit)
     values($1,$2,$3,'editor',$4,true,true)`,
    [WS, PROJECT, WITNESS, OWNER],
  )
  owner = await actor(OWNER, WS)
  witness = await actor(WITNESS, WS)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('part_signoff','part_countersign','part_amendment','part_opened') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
  }))
}

/** An experiment with `texts.length` steps in the first part and an empty second part. */
async function experiment(texts: string[]) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, `Assay ${++sequence}`],
  )
  const recordId = rows[0].id as string
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,'Protocol','active',$4)`,
    [protocol, WS, `PRT-${protocol}`, OWNER],
  )
  for (const [index, text] of texts.entries()) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,$3,$4)`,
      [
        protocol,
        JSON.stringify({ text, stepNumber: index + 1 }),
        index + 1,
        OWNER,
      ],
    )
  }
  const pin = (
    await owner.query(
      `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
      [recordId],
    )
  ).rows[0].result.block as { id: string; version: number }
  const structure = (
    await migrator.query(
      `select structure_version from api.records where id=$1`,
      [recordId],
    )
  ).rows[0].structure_version as number
  const stepIds = (
    (
      await owner.query(
        `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
        [pin.id, protocol, pin.version, structure],
      )
    ).rows[0].result.copied_steps as Array<{ id: string }>
  ).map((step) => step.id)
  const one = (
    await owner.query(`select api.create_experiment_part($1,'Seed',0) as p`, [
      recordId,
    ])
  ).rows[0].p as { id: string }
  const two = (
    await owner.query(`select api.create_experiment_part($1,'Dose',1) as p`, [
      recordId,
    ])
  ).rows[0].p as { id: string }
  // The last step belongs to the second part.
  await owner.query(`select api.set_block_part($1,$2)`, [
    stepIds[stepIds.length - 1],
    two.id,
  ])
  return { recordId, stepIds, one: one.id, two: two.id }
}

async function states(recordId: string) {
  const { rows } = await owner.query(
    `select part_number, status, is_current, completed_at from api.record_parts($1) order by part_number`,
    [recordId],
  )
  return rows as Array<{
    part_number: number
    status: string
    is_current: boolean
    completed_at: string | null
  }>
}

async function signoffs(recordId: string) {
  const { rows } = await owner.query(
    `select * from api.record_part_signoffs($1) order by part_number`,
    [recordId],
  )
  return rows as Array<Record<string, unknown>>
}

async function previewDigest(client: Client, partId: string): Promise<string> {
  const { rows } = await client.query(
    `select api.part_signoff_preview($1) as p`,
    [partId],
  )
  return rows[0].p.digest as string
}

async function grant(opts: {
  who: string
  recordId: string
  partId: string
  digest: string
  meaning: 'signed' | 'witnessed'
}): Promise<string> {
  const token = `grant-${++sequence}-${'x'.repeat(30)}`
  await migrator.query(
    `insert into internal.signature_grants
     (token_hash,user_id,session_id,workspace_id,purpose,revision_digest,record_id,part_id,signature_meaning,auth_method,expires_at)
     values($1,$2,$3,$4,'sign-part',$5,$6,$7,$8,'password',now()+interval '5 minutes')`,
    [
      createHash('sha256').update(token).digest('hex'),
      opts.who,
      `session-${opts.who}`,
      WS,
      opts.digest,
      opts.recordId,
      opts.partId,
      opts.meaning,
    ],
  )
  return token
}

async function sign(
  client: Client,
  who: string,
  recordId: string,
  partId: string,
  meaning: 'signed' | 'witnessed' = 'signed',
  countersign: string[] = [],
) {
  const digest = await previewDigest(client, partId)
  const token = await grant({ who, recordId, partId, digest, meaning })
  return client.query(
    `select api.sign_experiment_part($1,$2,$3,$4,$5,$6::text[]) as r`,
    [partId, meaning, `Person ${who}`, digest, token, countersign],
  )
}

async function finishPartOne(stepIds: string[]) {
  for (const id of stepIds.slice(0, -1)) {
    await owner.query(`select api.set_step_done($1)`, [id])
  }
}

describe('a part that needs a signature', () => {
  it('is finished only when signed; the next part waits and cannot be worked', async () => {
    const { recordId, stepIds, one, two } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)

    // Work is done, but Part 1 is still the one to work on, awaiting a signature.
    expect((await states(recordId)).map((p) => [p.status, p.is_current])).toEqual(
      [
        ['now', true],
        ['later', false],
      ],
    )
    expect((await signoffs(recordId))[0]).toMatchObject({
      requires_sign_off: true,
      work_done: true,
      awaiting_sign_off: true,
      signed: false,
    })
    // Part 2's step cannot be finished until Part 1 is signed.
    await expect(
      owner.query(`select api.set_step_done($1)`, [stepIds[2]]),
    ).rejects.toMatchObject({ code: 'SB151' })

    const since = await mark()
    const result = (await sign(owner, OWNER, recordId, one)).rows[0].r
    expect(result).toMatchObject({ meaning: 'signed', part_id: one })
    expect((await states(recordId)).map((p) => [p.status, p.is_current])).toEqual(
      [
        ['done', false],
        ['now', true],
      ],
    )
    expect((await signoffs(recordId))[0]).toMatchObject({
      signed: true,
      awaiting_sign_off: false,
      signed_by_user_id: OWNER,
    })
    // The next part is open and its step can now be finished.
    await owner.query(`select api.set_step_done($1)`, [stepIds[2]])
    // Part 2 is finished too but waits for its own signature.
    expect((await states(recordId)).map((p) => p.status)).toEqual([
      'done',
      'now',
    ])
    const wires = (await feed(since)).map((e) => e.wire)
    expect(wires).toContain('experiment.part_signed')
    const signed = (await feed(since)).find(
      (e) => e.wire === 'experiment.part_signed',
    )!
    expect(signed.payload).toMatchObject({
      partNumber: 1,
      part: 'Seed',
      signedByUserId: OWNER,
    })
    expect(String(signed.payload.digest)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to sign an unfinished part, a changed part, a wrong name and a spent or missing password', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    const early = await previewDigest(owner, one)
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,'nope')`,
        [one, `Person ${OWNER}`, early],
      ),
    ).rejects.toThrow(/finish the part/)
    await finishPartOne(stepIds)

    // The part changed after the digest was shown.
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,'nope')`,
        [one, `Person ${OWNER}`, early],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })

    const digest = await previewDigest(owner, one)
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,NULL)`,
        [one, `Person ${OWNER}`, digest],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed','Somebody Else',$2,'nope')`,
        [one, digest],
      ),
    ).rejects.toMatchObject({ code: 'SB009' })
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,'not-a-real-token')`,
        [one, `Person ${OWNER}`, digest],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })

    // A grant for another digest or another part does not pass.
    const wrongDigest = await grant({
      who: OWNER,
      recordId,
      partId: one,
      digest: 'a'.repeat(64),
      meaning: 'signed',
    })
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,$4)`,
        [one, `Person ${OWNER}`, digest, wrongDigest],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })

    // A spent grant cannot be used again.
    const token = await grant({
      who: OWNER,
      recordId,
      partId: one,
      digest,
      meaning: 'signed',
    })
    await owner.query(
      `select api.sign_experiment_part($1,'signed',$2,$3,$4)`,
      [one, `Person ${OWNER}`, digest, token],
    )
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,$4)`,
        [one, `Person ${OWNER}`, digest, token],
      ),
    ).rejects.toThrow()
  })

  it('does nothing for a part that is not set up for sign-off', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2'])
    await finishPartOne(stepIds)
    expect((await states(recordId))[0]!.status).toBe('done')
    const digest = await previewDigest(owner, one)
    const token = await grant({
      who: OWNER,
      recordId,
      partId: one,
      digest,
      meaning: 'signed',
    })
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'signed',$2,$3,$4)`,
        [one, `Person ${OWNER}`, digest, token],
      ),
    ).rejects.toMatchObject({ code: 'SB152' })
  })

  it('is passed on to parts added later', async () => {
    const { recordId } = await experiment(['S1', 'S2'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    const three = (
      await owner.query(`select api.create_experiment_part($1,'Read') as p`, [
        recordId,
      ])
    ).rows[0].p as { id: string }
    const row = (await signoffs(recordId)).find((s) => s.part_id === three.id)
    expect(row).toMatchObject({ requires_sign_off: true })
  })
})

describe('a signed part is locked', () => {
  it('refuses changes to its blocks, links, title, day and place, and its deletion', async () => {
    const { recordId, stepIds, one, two } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    await sign(owner, OWNER, recordId, one)

    await expect(
      owner.query(`select api.set_step_done($1,false)`, [stepIds[0]]),
    ).rejects.toMatchObject({ code: 'SB150' })
    await expect(
      owner.query(
        `select api.update_block_payload($1,$2::jsonb,1)`,
        [stepIds[0], JSON.stringify({ text: 'tampered' })],
      ),
    ).rejects.toThrow()
    await expect(
      owner.query(`select api.update_experiment_part($1,'Renamed')`, [one]),
    ).rejects.toMatchObject({ code: 'SB150' })
    await expect(
      owner.query(`select api.update_experiment_part($1,NULL,5)`, [one]),
    ).rejects.toMatchObject({ code: 'SB150' })
    await expect(
      owner.query(`select api.delete_experiment_part($1,$2)`, [one, two]),
    ).rejects.toMatchObject({ code: 'SB150' })
    await expect(
      owner.query(`select api.set_block_part($1,$2)`, [stepIds[0], two]),
    ).rejects.toMatchObject({ code: 'SB150' })
    await expect(
      owner.query(`select api.set_part_done($1,false)`, [one]),
    ).rejects.toThrow()
    // Nothing goes into it either.
    await expect(
      owner.query(`select api.set_block_part($1,$2)`, [stepIds[2], one]),
    ).rejects.toMatchObject({ code: 'SB150' })
    // The assignee is not part of what was signed.
    await owner.query(`select api.update_experiment_part($1,NULL,NULL,$2)`, [
      one,
      WITNESS,
    ])
    // Another part still takes new blocks (their order moves, the signed part's does not matter).
    await owner.query(
      `select api.insert_block($1,'rich_text','{}'::jsonb,1,$2)`,
      [recordId, stepIds[2]],
    )
  })

  it('keeps the frozen snapshot and its digest on record', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    const digest = await previewDigest(owner, one)
    await sign(owner, OWNER, recordId, one)
    const { rows } = await owner.query(
      `select snapshot, snapshot_digest, part_number, part_title, meaning, auth_method
         from api.experiment_part_signoffs where part_id = $1`,
      [one],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      snapshot_digest: digest,
      part_number: 1,
      part_title: 'Seed',
      meaning: 'signed',
      auth_method: 'password',
    })
    expect(
      (rows[0].snapshot.blocks as Array<{ id: string; type: string }>)
        .filter((b) => b.type === 'procedure_step')
        .map((b) => b.id),
    ).toEqual(stepIds.slice(0, -1))
  })

  it('cannot be edited or removed as evidence', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    await sign(owner, OWNER, recordId, one)
    await expect(
      owner.query(
        `update api.experiment_part_signoffs set part_title = 'x' where part_id = $1`,
        [one],
      ),
    ).rejects.toThrow()
    await expect(
      owner.query(`delete from api.experiment_part_signoffs`),
    ).rejects.toThrow()
    await expect(
      owner.query(
        `insert into api.experiment_part_signoffs(workspace_id,record_id,part_id,part_number,part_title,meaning,snapshot,snapshot_digest,signer_user_id,signer_name,signer_session_id,auth_method,confirmation_phrase) values ($1,$2,$3,1,'x','signed','{}',$4,$5,'x','x','password','x')`,
        [WS, recordId, one, 'a'.repeat(64), OWNER],
      ),
    ).rejects.toThrow()
    // Even the migrator login through the application path may not rewrite it.
    await expect(
      owner.query(`select api.amend_experiment_part($1,'ab')`, [one]),
    ).rejects.toThrow(/say why/)
  })

  it('is invisible to people outside the experiment', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    await sign(owner, OWNER, recordId, one)
    const stranger = await actor(OUTSIDER, OTHER_WS)
    const { rows } = await stranger.query(
      `select * from api.experiment_part_signoffs`,
    )
    expect(rows).toEqual([])
    await expect(
      stranger.query(`select api.amend_experiment_part($1,'a good reason')`, [
        one,
      ]),
    ).rejects.toThrow(/not found/)
    await expect(
      stranger.query(`select api.part_signoff_preview($1)`, [one]),
    ).rejects.toThrow(/not found/)
  })
})

describe('countersigning', () => {
  it('is a request: signing opens the next part, and the named person can countersign once', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    const since = await mark()
    await sign(owner, OWNER, recordId, one, 'signed', [WITNESS])
    // Signing was not held up.
    expect((await states(recordId))[1]!.is_current).toBe(true)
    expect((await signoffs(recordId))[0]).toMatchObject({
      countersign_requested_from: [WITNESS],
      countersigned_by: [],
    })
    const note = await migrator.query(
      `select title from internal.notifications where user_id = $1 and event_type = 'part_signoff_request'`,
      [WITNESS],
    )
    expect(note.rows.at(-1)?.title).toMatch(/Countersign Part 1/)

    // The signer cannot countersign their own signature.
    const digest = await previewDigest(owner, one)
    const own = await grant({
      who: OWNER,
      recordId,
      partId: one,
      digest,
      meaning: 'witnessed',
    })
    await expect(
      owner.query(
        `select api.sign_experiment_part($1,'witnessed',$2,$3,$4)`,
        [one, `Person ${OWNER}`, digest, own],
      ),
    ).rejects.toMatchObject({ code: 'SB152' })

    await sign(witness, WITNESS, recordId, one, 'witnessed')
    expect((await signoffs(recordId))[0]).toMatchObject({
      countersign_requested_from: [],
      countersigned_by: [WITNESS],
    })
    expect((await feed(since)).map((e) => e.wire)).toContain(
      'experiment.part_countersigned',
    )
    // Once only.
    await expect(
      sign(witness, WITNESS, recordId, one, 'witnessed'),
    ).rejects.toThrow()
  })

  it('needs an explicit request, and asking again does not double up', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    await sign(owner, OWNER, recordId, one)
    await expect(
      sign(witness, WITNESS, recordId, one, 'witnessed'),
    ).rejects.toMatchObject({ code: 'SB152' })
    await owner.query(`select api.request_part_signoff($1,$2,'please')`, [
      one,
      WITNESS,
    ])
    await owner.query(`select api.request_part_signoff($1,$2)`, [one, WITNESS])
    expect((await signoffs(recordId))[0]!.countersign_requested_from).toEqual([
      WITNESS,
    ])
    await expect(
      owner.query(`select api.request_part_signoff($1,$2)`, [one, OUTSIDER]),
    ).rejects.toThrow(/not in this workspace/)
    await sign(witness, WITNESS, recordId, one, 'witnessed')
  })

  it('can ask someone to sign a part that is finished and waiting', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await expect(
      owner.query(`select api.request_part_signoff($1,$2)`, [one, WITNESS]),
    ).rejects.toThrow(/finish the part/)
    await finishPartOne(stepIds)
    await owner.query(`select api.request_part_signoff($1,$2,'Over to you')`, [
      one,
      WITNESS,
    ])
    expect((await signoffs(recordId))[0]!.sign_requested_from).toEqual([
      WITNESS,
    ])
    await sign(witness, WITNESS, recordId, one)
    expect((await signoffs(recordId))[0]).toMatchObject({
      signed: true,
      signed_by_user_id: WITNESS,
      sign_requested_from: [],
    })
  })
})

describe('amending a signed part', () => {
  it('asks for a reason, reopens only that part, keeps the old signature and needs signing again', async () => {
    const { recordId, stepIds, one } = await experiment(['S1', 'S2', 'S3'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await finishPartOne(stepIds)
    await sign(owner, OWNER, recordId, one)
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])

    await expect(
      owner.query(`select api.amend_experiment_part($1,'  ')`, [one]),
    ).rejects.toThrow(/say why/)
    const since = await mark()
    await owner.query(
      `select api.amend_experiment_part($1,'Wrong cell count recorded')`,
      [one],
    )
    expect((await signoffs(recordId))[0]).toMatchObject({
      signed: false,
      awaiting_sign_off: true,
      amendment_count: 1,
      last_amendment_reason: 'Wrong cell count recorded',
    })
    // The old signature is still on record.
    const old = await owner.query(
      `select count(*)::int as n from api.experiment_part_signoffs where part_id = $1`,
      [one],
    )
    expect(old.rows[0].n).toBe(1)
    // The part can be edited again; the one after it is held up again.
    await owner.query(`select api.set_step_done($1,false)`, [stepIds[0]])
    await owner.query(`select api.set_step_done($1)`, [stepIds[0]])
    await expect(
      owner.query(`select api.set_step_done($1)`, [stepIds[2]]),
    ).rejects.toMatchObject({ code: 'SB151' })
    // Signing again freezes the new state; the digest differs from the first signature only if the part did.
    await sign(owner, OWNER, recordId, one)
    const both = await owner.query(
      `select count(*)::int as n from api.experiment_part_signoffs where part_id = $1 and meaning = 'signed'`,
      [one],
    )
    expect(both.rows[0].n).toBe(2)
    const wires = (await feed(since)).map((e) => e.wire)
    expect(wires).toContain('experiment.part_amended')
    const amended = (await feed(since)).find(
      (e) => e.wire === 'experiment.part_amended',
    )!
    expect(amended.payload).toMatchObject({
      reason: 'Wrong cell count recorded',
      amendedByUserId: OWNER,
    })
    await owner.query(`select api.set_step_done($1)`, [stepIds[2]])
  })

  it('refuses an amendment of an unsigned part', async () => {
    const { recordId, one } = await experiment(['S1', 'S2'])
    await owner.query(`select api.set_parts_sign_off($1,true)`, [recordId])
    await expect(
      owner.query(`select api.amend_experiment_part($1,'A reason')`, [one]),
    ).rejects.toThrow(/not signed/)
  })
})

describe('templates', () => {
  it('accept a sign-off setting, and only a true or false one', async () => {
    const config = (value: unknown) =>
      JSON.stringify({
        formatVersion: 1,
        parameters: [],
        placements: [],
        parts: [],
        signOffParts: value,
      })
    await expect(
      migrator.query(
        `select internal.validate_notebook_template_configuration($1,$2::jsonb)`,
        [WS, config(true)],
      ),
    ).resolves.toBeDefined()
    await expect(
      migrator.query(
        `select internal.validate_notebook_template_configuration($1,$2::jsonb)`,
        [WS, config('yes')],
      ),
    ).rejects.toMatchObject({ code: 'SB091' })
  })
})
