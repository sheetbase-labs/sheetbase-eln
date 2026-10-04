import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

import {
  coverageExitCode,
  seededStrings,
  summarizeCoverage,
} from '../../scripts/design-seed-coverage.mts'
import { DESIGN_USER_IDS, DESIGN_WORKSPACE_IDS } from '#/db/seed/design'
import {
  FIXTURE_PROJECT_ID,
  FIXTURE_USER_ID,
  FIXTURE_WORKSPACE_ID,
} from '#/db/seed/identities'
import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

const execute = promisify(execFile)

it('rejects unrelated identities, title citations and unmatched screen identifiers after a real seed', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const env = { ...process.env, DATABASE_URL: migratorUrl() }
  await execute('pnpm', ['db:seed:design'], { env })
  const actor = await asRole('authenticator')
  const previousUrl = process.env.DATABASE_URL
  try {
    await actor.query('set role authenticated')
    await setActorJwt(actor, FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID)
    await actor.query('select api.update_workspace_id_prefixes($1,$2::jsonb)', [
      FIXTURE_WORKSPACE_ID,
      JSON.stringify({ experiment: 'EXP' }),
    ])
    const unrelated = await actor.query<{ identifier: string }>(
      `select r.identifier from generate_series(1,400) n
         cross join lateral api.create_record($1,'experiment','Unrelated coverage control ' || n) r`,
      [FIXTURE_PROJECT_ID],
    )
    const unrelatedIdentifier = 'EXP-0400'
    expect(unrelated.rows.map((row) => row.identifier)).toContain(
      unrelatedIdentifier,
    )
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.gareth,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    const project = await actor.query<{ id: string }>(
      "select id from api.projects where display_id = 'PRJ-0217'",
    )
    const cited = await actor.query<{ identifier: string }>(
      "select identifier from api.create_record($1,'experiment',$2)",
      [project.rows[0].id, `Reference ${unrelatedIdentifier} and EXP-9999`],
    )
    await actor.query('select api.update_workspace_id_prefixes($1,$2::jsonb)', [
      DESIGN_WORKSPACE_IDS.processDevelopment,
      JSON.stringify({ experiment: 'SHT' }),
    ])
    const wrongAuthority = await actor.query<{ identifier: string }>(
      "select identifier from api.create_record($1,'experiment','Not a sheet instance')",
      [project.rows[0].id],
    )
    const wrongAuthorityIdentifier = wrongAuthority.rows[0].identifier
    process.env.DATABASE_URL = migratorUrl()
    const values = await seededStrings()
    expect(values).toContain(cited.rows[0].identifier)
    expect(values).not.toContain(unrelatedIdentifier)
    expect(values).not.toContain('EXP-9999')
    expect(values).not.toContain(wrongAuthorityIdentifier)
    const summary = summarizeCoverage(
      [
        {
          name: 'Control.txt',
          text: `${unrelatedIdentifier} EXP-9999 ${wrongAuthorityIdentifier}`,
        },
      ],
      values,
      [],
      [],
    )
    expect(summary.unmatchedByScreen).toEqual([
      {
        screen: 'Control',
        tokens: [unrelatedIdentifier, 'EXP-9999', wrongAuthorityIdentifier],
      },
    ])

    const completed = summarizeCoverage(
      [{ name: 'Completed.txt', text: cited.rows[0].identifier }],
      values,
      [],
      [],
    )
    expect(coverageExitCode(completed)).toBe(0)
    const deliberatelyMissing = summarizeCoverage(
      [{ name: 'DeliberatelyMissing.txt', text: 'EXP-9999' }],
      values,
      [],
      [],
    )
    expect(deliberatelyMissing.unmatched).toBe(1)
    expect(coverageExitCode(deliberatelyMissing)).toBe(1)
    expect(coverageExitCode(deliberatelyMissing, true)).toBe(0)
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
    await actor.end()
    await migrator.end()
  }
}, 180_000)
