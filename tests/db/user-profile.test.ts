/**
 * SET-03.1 — profile fields.
 *
 * The SettingsProfile board shows initials, job title and time zone beside the
 * appearance preference. The full name Better Auth holds is what a signature
 * prints (captured at signing); initials fall back to the name so every avatar
 * has one, and a time zone must be one the database knows. Only the person
 * edits their own profile.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cc00'
const ANALYST = 'set031-analyst'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ('set031-analyst','Gareth Price','gareth@test.invalid',true),
      ('set031-other','Mei Lin','mei@test.invalid',true)`,
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'set031','SET-03.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_settings(workspace_id,timezone,created_by_user_id)
     values($1,'Europe/London','set031-analyst')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,'set031-analyst','analyst'),($1,'set031-other','analyst')`,
    [WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId = ANALYST): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function profile(client: Client) {
  return (
    await client.query<{
      name: string
      initials: string
      job_title: string | null
      timezone: string
      appearance: string
    }>(
      'select name,initials,job_title,timezone,appearance from api.my_profile()',
    )
  ).rows[0]!
}

describe('SET-03.1 profile fields', () => {
  it('derives initials from the name and falls back to the workspace time zone', async () => {
    const analyst = await actor()
    expect(await profile(analyst)).toMatchObject({
      name: 'Gareth Price',
      initials: 'GP',
      job_title: null,
      timezone: 'Europe/London',
      appearance: 'system',
    })
  })

  it('stores initials, job title and time zone for the signed-in person', async () => {
    const analyst = await actor()
    const { rows } = await analyst.query(
      'select * from api.set_user_profile($1,$2,$3)',
      ['gp', 'Senior scientist', 'Europe/Paris'],
    )
    expect(rows[0]).toMatchObject({
      initials: 'GP',
      job_title: 'Senior scientist',
      timezone: 'Europe/Paris',
    })
    expect(await profile(analyst)).toMatchObject({
      initials: 'GP',
      job_title: 'Senior scientist',
      timezone: 'Europe/Paris',
    })
    // Another person's profile is untouched.
    const other = await actor('set031-other')
    expect(await profile(other)).toMatchObject({
      initials: 'ML',
      job_title: null,
      timezone: 'Europe/London',
    })
  })

  it('refuses invalid initials, an unknown time zone and a long job title', async () => {
    const analyst = await actor()
    await expectDenied(
      analyst.query('select * from api.set_user_profile($1)', ['G12345']),
      '22023',
    )
    await expectDenied(
      analyst.query('select * from api.set_user_profile($1,$2,$3)', [
        null,
        null,
        'Mars/Olympus',
      ]),
      '22023',
    )
    await expectDenied(
      analyst.query('select * from api.set_user_profile($1)', [
        'x'.repeat(200),
      ]),
      '22023',
    )
    expect((await profile(analyst)).initials).toBe('GP')
  })
})
