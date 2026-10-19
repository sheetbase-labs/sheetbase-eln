/**
 * EXP-03 / ADMIN-05 — an experiment can be put on hold and resumed, and a draft
 * can be moved to another project.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000d100'
const PROJECT = '00000000-0000-4000-8000-00000000d102'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000d103'
const VIEW_ONLY_PROJECT = '00000000-0000-4000-8000-00000000d104'
const AUTHOR = 'hold-author'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [AUTHOR, `${AUTHOR}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'hold','Hold')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'scientist')`,
    [WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values
     ($1,$4,'HOLDA','Project A'),($2,$4,'HOLDB','Project B'),($3,$4,'HOLDC','Project C')`,
    [PROJECT, OTHER_PROJECT, VIEW_ONLY_PROJECT, WS],
  )
  for (const [projectId, canEdit] of [
    [PROJECT, true],
    [OTHER_PROJECT, true],
    [VIEW_ONLY_PROJECT, false],
  ] as const) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId,
      userId: AUTHOR,
      canView: true,
      canEdit,
    })
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function author(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, AUTHOR, WS)
  return client
}

async function draft(): Promise<{ id: string; version: number }> {
  const id = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment',$4,'Movable experiment','draft',$5)`,
    [id, WS, PROJECT, `EXP-${id}`, AUTHOR],
  )
  return { id, version: await version(id) }
}

async function version(id: string): Promise<number> {
  const { rows } = await migrator.query<{ metadata_version: number }>(
    'select metadata_version from api.records where id=$1',
    [id],
  )
  return Number(rows[0]!.metadata_version)
}

describe('on hold', () => {
  it('holds a running experiment with a reason and resumes it', async () => {
    const db = await author()
    const experiment = await draft()
    const started = (
      await db.query('select * from api.start_experiment($1,$2,null,$3)', [
        experiment.id,
        experiment.version,
        'Begin',
      ])
    ).rows[0]
    const held = (
      await db.query('select * from api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        started.metadata_version,
        'on_hold',
        'Waiting for the reagent order',
      ])
    ).rows[0]
    expect(held.status).toBe('on_hold')

    const resumed = (
      await db.query('select * from api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        held.metadata_version,
        'in_progress',
        'Reagent arrived',
      ])
    ).rows[0]
    expect(resumed.status).toBe('in_progress')
  })

  it('needs a reason and refuses to hold a draft', async () => {
    const db = await author()
    const experiment = await draft()
    await expectDenied(
      db.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        experiment.version,
        'on_hold',
        'Not started yet',
      ]),
      'SB111',
    )
    const started = (
      await db.query('select * from api.start_experiment($1,$2,null,$3)', [
        experiment.id,
        experiment.version,
        'Begin',
      ])
    ).rows[0]
    await expectDenied(
      db.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        started.metadata_version,
        'on_hold',
        '',
      ]),
      '22023',
    )
  })
})

describe('move to another project', () => {
  it('moves a draft and clears its folder', async () => {
    const db = await author()
    const experiment = await draft()
    const moved = (
      await db.query('select * from api.move_record_to_project($1,$2,$3)', [
        experiment.id,
        OTHER_PROJECT,
        experiment.version,
      ])
    ).rows[0]
    expect(moved.project_id).toBe(OTHER_PROJECT)
    expect(moved.folder_id).toBeNull()
    expect(Number(moved.metadata_version)).toBe(experiment.version + 1)
  })

  it('refuses a started experiment, a stale version and a view-only project', async () => {
    const db = await author()
    const experiment = await draft()
    await expectDenied(
      db.query('select api.move_record_to_project($1,$2,$3)', [
        experiment.id,
        OTHER_PROJECT,
        experiment.version + 5,
      ]),
      'SB001',
    )
    await expectDenied(
      db.query('select api.move_record_to_project($1,$2,$3)', [
        experiment.id,
        VIEW_ONLY_PROJECT,
        experiment.version,
      ]),
      '42501',
    )
    const started = (
      await db.query('select * from api.start_experiment($1,$2,null,$3)', [
        experiment.id,
        experiment.version,
        'Begin',
      ])
    ).rows[0]
    await expectDenied(
      db.query('select api.move_record_to_project($1,$2,$3)', [
        experiment.id,
        OTHER_PROJECT,
        started.metadata_version,
      ]),
      'SB109',
    )
  })
})
