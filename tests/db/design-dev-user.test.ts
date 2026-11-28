/**
 * The auth-free development person `pnpm db:seed --design` signs in as. They
 * join the design workspace as its lead, as a person choosing the demo does,
 * so every seeded experiment opens for them. Before this they were made owner
 * with no project access, and every experiment page read "Experiment not
 * found", because a project's records are read only through an access grant.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { DESIGN_WORKSPACE_IDS, designSteps } from '#/db/seed/design'
import { FIXTURE_USER_ID } from '#/db/seed/identities'
import { designDevSessionSteps, fixtureSteps } from '#/db/seed/run'

import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

it('lets the design seed’s development person open every seeded experiment', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const db = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  // The default development person: the fixture owner, not the seed's lead.
  const devUserId = FIXTURE_USER_ID

  try {
    for (const step of fixtureSteps) await step.run(db)
    // Projects, their access and the experiments are all in place by here;
    // the rest of the design seed only adds to them.
    for (const step of designSteps) {
      await step.run(db)
      if (step.name === 'design experiments') break
    }
    for (const step of designDevSessionSteps(devUserId)) await step.run(db)
    // Running it again changes nothing: a reseed must not fail on access
    // the person already has.
    for (const step of designDevSessionSteps(devUserId)) await step.run(db)

    const all = await migrator.query<{ id: string }>(
      `SELECT id FROM api.records
        WHERE workspace_id = $1 AND kind = 'experiment' AND deleted_at IS NULL
        ORDER BY id`,
      [workspaceId],
    )
    expect(all.rows.length).toBeGreaterThan(10)

    await actor.query('set role authenticated')
    await setActorJwt(actor, devUserId, workspaceId)

    const seen = await actor.query<{ id: string }>(
      `SELECT id FROM api.records
        WHERE kind = 'experiment' AND deleted_at IS NULL
        ORDER BY id`,
    )
    expect(seen.rows.map((row) => row.id)).toEqual(
      all.rows.map((row) => row.id),
    )
  } finally {
    await actor.end()
    await db.$client.end()
    await migrator.end()
  }
}, 300_000)
