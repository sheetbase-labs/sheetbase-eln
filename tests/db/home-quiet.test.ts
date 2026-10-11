/**
 * R5-HOME-01 — the quiet Home is reachable by a real workspace.
 *
 * The pace ladder is decided by three real authorities: the caller's
 * actionable Inbox work items (`api.my_work_items`), Datasets with unresolved
 * issues (`api.dataset_list_summary`), and unread notifications
 * (`api.my_notifications`). This suite builds a real workspace that is
 * genuinely calm — a person with their own project, record and recents, and
 * nothing waiting — and then makes one and two things wait, so quiet,
 * near-quiet and busy are all reachable from real state rather than mocked
 * counts.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { homePace } from '../../src/lib/home-quiet'
import type { HomeWaitingCounts } from '../../src/lib/home-quiet'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000250a'
const USER = 'r5-home-01-user'
const PROJECT = '00000000-0000-4000-8000-0000000025b1'
const RECORD = '00000000-0000-4000-8000-0000000025c1'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'R5 Home',$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'r5-home-01','R5 Home 01')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'R5H','Quiet project',$3)`,
    [PROJECT, WS, USER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-R5H','Quiet experiment',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor() {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: USER, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

/** The three counts the Home read model issues, read as the person. */
async function waitingCounts(client: Client): Promise<HomeWaitingCounts> {
  const inbox = await client.query<{ n: string }>(
    `select count(*)::int as n from api.my_work_items
      where state in ('needs_action','overdue')`,
  )
  const datasets = await client.query<{ n: string }>(
    `select count(*)::int as n from api.dataset_list_summary()
      where issue_count > 0 and archived_at is null`,
  )
  const unread = await client.query<{ n: string }>(
    'select count(*)::int as n from api.my_notifications where read_at is null',
  )
  return {
    inbox: Number(inbox.rows[0].n),
    datasetsWithErrors: Number(datasets.rows[0].n),
    unreadNotifications: Number(unread.rows[0].n),
  }
}

async function notify(): Promise<void> {
  await migrator.query(
    `insert into internal.notifications(workspace_id,user_id,event_type,title)
     values($1,$2,'review_requested','Review requested')`,
    [WS, USER],
  )
}

describe('quiet Home reachability', () => {
  it('is quiet for a real workspace that has work of its own and nothing waiting', async () => {
    const client = await actor()
    // The person has recents, so Home is past first-run and must decide its pace.
    await client.query('select api.record_recent_view($1,$2)', [
      'record',
      RECORD,
    ])
    const recents = await client.query<{ n: string }>(
      'select count(*)::int as n from api.recently_viewed',
    )
    expect(Number(recents.rows[0].n)).toBe(1)

    const counts = await waitingCounts(client)
    expect(counts).toEqual({
      inbox: 0,
      datasetsWithErrors: 0,
      unreadNotifications: 0,
    })
    expect(homePace(counts)).toBe('quiet')
  })

  it('is near-quiet with one thing waiting and busy with two, from real rows', async () => {
    const client = await actor()
    await notify()
    expect(homePace(await waitingCounts(client))).toBe('near-quiet')
    await notify()
    expect(homePace(await waitingCounts(client))).toBe('busy')
  })

  it('reads only the caller’s own waiting rows', async () => {
    const other = await asRole('authenticator')
    clients.push(other)
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,'Other',$2,true)`,
      [`${USER}-other`, `${USER}-other@test.invalid`],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'viewer')`,
      [WS, `${USER}-other`],
    )
    await other.query('set role authenticated')
    await other.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: `${USER}-other`,
        workspace_id: WS,
        role: 'authenticated',
      }),
    ])
    expect(await waitingCounts(other)).toEqual({
      inbox: 0,
      datasetsWithErrors: 0,
      unreadNotifications: 0,
    })
    expect(homePace(await waitingCounts(other))).toBe('quiet')
  })
})
