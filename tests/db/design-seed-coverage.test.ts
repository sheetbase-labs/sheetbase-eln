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
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.gareth,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    expect(
      (await actor.query('select timezone from api.workspace_settings')).rows,
    ).toEqual([{ timezone: 'Europe/London' }])
    const details = await actor.query(
      "select id,revision,started_on::text,default_reviewer_user_id,agreement_reference from api.projects where display_id='PRJ-0217'",
    )
    // The seed moves the design timeline forward to the real today, by whole
    // days, so the start keeps its place relative to the design's dates.
    const shifted =
      (Date.parse(`${details.rows[0].started_on}T00:00:00Z`) -
        Date.parse('2026-08-03T00:00:00Z')) /
      86_400_000
    expect(Number.isInteger(shifted) && shifted >= 0).toBe(true)
    expect(details.rows[0]).toMatchObject({
      default_reviewer_user_id: DESIGN_USER_IDS.mei,
      agreement_reference: 'MSA-017 · SOW-04',
    })
    const members = await actor.query(
      'select * from api.project_members($1) order by user_id',
      [details.rows[0].id],
    )
    // AAV9 access follows the Settings Access matrix: Process Development
    // leads, Upstream and Downstream may edit, so Tom (Upstream, Downstream)
    // is a member alongside the named team and the QA group.
    expect(members.rows.map((row) => row.user_id)).toEqual([
      DESIGN_USER_IDS.gareth,
      DESIGN_USER_IDS.priya,
      DESIGN_USER_IDS.mei,
      DESIGN_USER_IDS.tom,
      DESIGN_USER_IDS.sam,
      DESIGN_USER_IDS.anna,
    ])
    const analyticalRule = await actor.query(
      `select a.can_view,a.can_edit,a.can_review,a.can_manage
         from api.project_access a
         join api.workspace_groups g on g.id=a.group_id
        where a.project_id=$1 and g.name='Analytical'`,
      [details.rows[0].id],
    )
    expect(analyticalRule.rows).toEqual([
      { can_view: true, can_edit: true, can_review: true, can_manage: false },
    ])
    const readings = await actor.query(
      `select max(v.text_value) filter(where f.key='sample') as sample,
          max(v.text_value) filter(where f.key='condition') as condition,
          max(v.numeric_value) filter(where f.key='turbidity') as turbidity,
          max(v.numeric_value) filter(where f.key='capsid_titre') as titre
       from api.dataset_row_values v join api.dataset_rows r on r.id=v.row_id
       join api.datasets d on d.id=r.dataset_id
       join api.dataset_schema_version_fields f on f.schema_version_id=d.schema_version_id and f.field_id=v.field_id
       where d.display_id='DS-0311' group by v.row_id
       having max(v.text_value) filter(where f.key='sample') in ('SMP-2248','SMP-2249','BLANK','STD-4')
       order by sample,turbidity nulls last,titre`,
    )
    expect(
      readings.rows.map((row) => [
        row.sample,
        row.condition,
        row.turbidity === null ? null : Number(row.turbidity),
        row.titre === null ? null : Number(row.titre),
      ]),
    ).toEqual([
      ['BLANK', null, 0.2, null],
      ['BLANK', null, 0.3, null],
      ['SMP-2248', 'C-150', 61.5, null],
      ['SMP-2249', 'C-150 1:5', 12.1, null],
      ['SMP-2249', 'C-150 1:5', 12.4, null],
      ['SMP-2249', 'C-150 1:5', null, 5.4],
      ['SMP-2249', 'C-150 1:5', null, 5.5],
      ['STD-4', null, null, 10],
      ['STD-4', null, null, 10],
    ])
    const flags = await actor.query(
      `select g.*,f.key,f.quantity from api.dataset_value_flags g
       join api.datasets d on d.id=g.dataset_id
       join api.dataset_schema_version_fields f on f.schema_version_id=d.schema_version_id and f.field_id=g.field_id
       where d.display_id='DS-0311' and g.cleared_at is null order by g.id`,
    )
    expect(flags.rows).toHaveLength(1)
    expect(flags.rows[0]).toMatchObject({
      key: 'turbidity',
      source: 'system',
      system_rule: 'out_of_range',
      evaluated_value: 61.5,
      threshold: { min: 0, max: 50 },
      quantity: { symbol: 'NTU' },
    })
    const milestones = await actor.query(
      'select * from api.study_tasks where project_id=$1 order by position',
      [details.rows[0].id],
    )
    expect(milestones.rows).toHaveLength(9)
    for (let repeat = 0; repeat < 2; repeat++) {
      await execute('pnpm', ['db:seed:design'], { env })
      expect(
        (
          await actor.query(
            'select * from api.study_tasks where project_id=$1 order by position',
            [details.rows[0].id],
          )
        ).rows,
      ).toEqual(milestones.rows)
      expect(
        (
          await actor.query(
            'select * from api.project_members($1) order by user_id',
            [details.rows[0].id],
          )
        ).rows,
      ).toEqual(members.rows)
      expect(
        (
          await actor.query('select revision from api.projects where id=$1', [
            details.rows[0].id,
          ])
        ).rows[0].revision,
      ).toBe(details.rows[0].revision)
      expect(
        (
          await actor.query(
            'select id,set_at,evaluated_at,evaluated_value,threshold from api.dataset_value_flags where id=$1',
            [flags.rows[0].id],
          )
        ).rows[0],
      ).toMatchObject({
        id: flags.rows[0].id,
        set_at: flags.rows[0].set_at,
        evaluated_at: flags.rows[0].evaluated_at,
        evaluated_value: 61.5,
        threshold: { min: 0, max: 50 },
      })
    }
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
