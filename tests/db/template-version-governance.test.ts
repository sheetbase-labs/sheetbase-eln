/**
 * CORE-06 governance: publishing a template version records a reason; retiring
 * is an e-signature (the caller must be certified) and is blocked while
 * unsigned records are still pinned to the version.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000170a'
const OWNER = 'tplgov-owner'
const TEMPLATE = '00000000-0000-4000-8000-000000001710'
const VERSION = '00000000-0000-4000-8000-000000001711'
const RECORD = '00000000-0000-4000-8000-000000001712'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','tplgov@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'tplgov','Tpl Gov')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.notebook_templates(id,workspace_id,key,name) values ($1,$2,'gov','Gov template')`,
    [TEMPLATE, WS],
  )
  await migrator.query(
    `insert into api.notebook_template_versions(id,template_id,version,lifecycle,configuration) values ($1,$2,1,'draft','{"formatVersion":1,"parameters":[],"placements":[]}'::jsonb)`,
    [VERSION, TEMPLATE],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function certify() {
  await migrator.query(
    `insert into api.user_signature_certifications(workspace_id,user_id,statement_version) values ($1,$2,1) on conflict do nothing`,
    [WS, OWNER],
  )
}

describe('template version governance', () => {
  it('requires a reason to publish', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query(`select api.publish_notebook_template_version($1,$2,'')`, [
        VERSION,
        1,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('publishes with a reason and records it', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await owner.query(
      `select * from api.publish_notebook_template_version($1,$2,$3)`,
      [VERSION, 1, 'Adds the stability timepoints'],
    )
    expect(rows[0]!.lifecycle).toBe('published')
    expect(rows[0]!.reason).toBe('Adds the stability timepoints')
  })

  it('refuses to retire without a certified signature', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      owner.query(
        `select api.retire_notebook_template_version($1,$2,'Old',$3)`,
        [VERSION, 2, 'Retired'],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses to retire while unsigned records are pinned', async () => {
    await certify()
    await migrator.query(
      `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id,source_notebook_template_version_id) values ($1,$2,'experiment','EXP-9001','Pinned','draft',$3,$4)`,
      [RECORD, WS, OWNER, VERSION],
    )
    const owner = await actor(OWNER, WS)
    const rev = (
      await owner.query(
        `select revision from api.notebook_template_versions where id=$1`,
        [VERSION],
      )
    ).rows[0]!.revision
    await expect(
      owner.query(
        `select api.retire_notebook_template_version($1,$2,'Old',$3)`,
        [VERSION, rev, 'Retired'],
      ),
    ).rejects.toMatchObject({ code: 'SB091' })
  })

  it('retires with a signature once no unsigned records remain', async () => {
    // The record is no longer pinned (a signed record, or a tombstoned one).
    await migrator.query(
      `update api.records set deleted_at = now() where id = $1`,
      [RECORD],
    )
    const owner = await actor(OWNER, WS)
    const rev = (
      await owner.query(
        `select revision from api.notebook_template_versions where id=$1`,
        [VERSION],
      )
    ).rows[0]!.revision
    const { rows } = await owner.query(
      `select * from api.retire_notebook_template_version($1,$2,$3,$4)`,
      [VERSION, rev, 'Superseded by v2', 'Retired — no longer for new records'],
    )
    expect(rows[0]!.lifecycle).toBe('retired')
    expect(rows[0]!.signed_by_user_id).toBe(OWNER)
    expect(rows[0]!.signed_meaning).toBe('Retired — no longer for new records')
    expect(rows[0]!.signed_at).not.toBeNull()
  })
})
