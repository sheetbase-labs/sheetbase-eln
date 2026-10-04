import { drizzle } from 'drizzle-orm/node-postgres'
import { expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

it('establishes scoped semantic project access before the first sample custody write', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const db = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  try {
    for (const step of designSteps) {
      if (step.name === 'design sample custody') break
      await step.run(db)
    }
    await actor.query('set role authenticated')
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.priya,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    const sample = await actor.query<{ id: string; project_id: string }>(
      "select id,project_id from api.records where identifier='SMP-2210'",
    )
    expect(sample.rows).toHaveLength(1)
    const permissions = await actor.query(
      "select internal.can_access_object('record',$1,'view') as view,internal.can_access_object('record',$1,'edit') as edit",
      [sample.rows[0].id],
    )
    expect(permissions.rows).toEqual([{ view: true, edit: true }])
    for (const [userId, expected] of [
      [
        DESIGN_USER_IDS.gareth,
        { can_view: true, can_edit: true, can_review: true, can_manage: true },
      ],
      [
        DESIGN_USER_IDS.mei,
        { can_view: true, can_edit: true, can_review: true, can_manage: false },
      ],
      [
        DESIGN_USER_IDS.sam,
        {
          can_view: true,
          can_edit: true,
          can_review: false,
          can_manage: false,
        },
      ],
      [
        DESIGN_USER_IDS.tom,
        {
          can_view: false,
          can_edit: false,
          can_review: false,
          can_manage: false,
        },
      ],
      [
        DESIGN_USER_IDS.anna,
        {
          can_view: true,
          can_edit: false,
          can_review: false,
          can_manage: false,
        },
      ],
    ] as const) {
      await setActorJwt(actor, userId, DESIGN_WORKSPACE_IDS.processDevelopment)
      expect(
        (
          await actor.query('select * from api.project_permissions($1)', [
            sample.rows[0].project_id,
          ])
        ).rows[0],
      ).toMatchObject(expected)
    }
    const custody = designSteps.find(
      (step) => step.name === 'design sample custody',
    )!
    await custody.run(db)
    expect(
      (
        await migrator.query(
          'select count(*)::int as count from api.sample_events where record_id=$1',
          [sample.rows[0].id],
        )
      ).rows,
    ).toEqual([{ count: 3 }])
    const rules = await migrator.query(
      'select * from api.project_access order by id',
    )
    await designSteps.find((step) => step.name === 'design projects')!.run(db)
    await custody.run(db)
    expect(
      (await migrator.query('select * from api.project_access order by id'))
        .rows,
    ).toEqual(rules.rows)
    expect(
      (
        await migrator.query(
          'select count(*)::int as count from api.sample_events where record_id=$1',
          [sample.rows[0].id],
        )
      ).rows,
    ).toEqual([{ count: 3 }])
    // The QA View rule is a genuine group grant, not a direct Anna grant.
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.gareth,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    const group = await actor.query<{ id: string }>(
      "select id from api.workspace_groups_list() where name='QA'",
    )
    expect(
      (
        await actor.query(
          'select 1 from api.project_access where project_id=$1 and user_id=$2',
          [sample.rows[0].project_id, DESIGN_USER_IDS.anna],
        )
      ).rows,
    ).toEqual([])
    await actor.query('select api.set_workspace_group_member($1,$2,false)', [
      group.rows[0].id,
      DESIGN_USER_IDS.anna,
    ])
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.anna,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    expect(
      (
        await actor.query(
          'select can_view,can_edit from api.project_permissions($1)',
          [sample.rows[0].project_id],
        )
      ).rows,
    ).toEqual([{ can_view: false, can_edit: false }])
  } finally {
    await actor.end()
    await db.$client.end()
    await migrator.end()
  }
}, 120_000)

it('retains original dataset creator Gareth and uses the permitted semantic lead for unnamed fresh creators', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const db = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  try {
    for (const step of designSteps) {
      if (step.name === 'design dataset links and flags') break
      await step.run(db)
    }
    const datasets = await migrator.query(
      'select id,display_id,primary_project_id,created_by_user_id,revision,created_at,updated_at from api.datasets order by display_id',
    )
    const creators = datasets.rows.filter((row) =>
      ['DS-0290', 'DS-0298', 'DS-0305'].includes(row.display_id),
    )
    expect(
      creators.map((row) => [row.display_id, row.created_by_user_id]),
    ).toEqual([
      ['DS-0290', DESIGN_USER_IDS.mei],
      ['DS-0298', DESIGN_USER_IDS.gareth],
      ['DS-0305', DESIGN_USER_IDS.mei],
    ])
    const schemas = await migrator.query(
      "select id,key,created_by_user_id from api.dataset_schema_definitions where key in ('ambr_250_daily_reading','vicell_viability','auc_full_empty_ratio') order by key",
    )
    expect(schemas.rows).toHaveLength(3)
    expect(
      schemas.rows.every(
        (row) => row.created_by_user_id === DESIGN_USER_IDS.gareth,
      ),
    ).toBe(true)
    await actor.query('set role authenticated')
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.gareth,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    const hek = creators.find((row) => row.display_id === 'DS-0305')!
    expect(
      (
        await actor.query(
          'select can_edit,can_manage from api.project_permissions($1)',
          [hek.primary_project_id],
        )
      ).rows,
    ).toEqual([{ can_edit: false, can_manage: false }])
    const datasetStep = designSteps.find(
      (step) => step.name === 'design datasets',
    )!
    const events = await migrator.query(
      'select * from api.change_events where entity_uuid=any($1::uuid[]) order by id',
      [datasets.rows.map((row) => row.id)],
    )
    for (let repeat = 0; repeat < 2; repeat++) {
      await datasetStep.run(db)
      expect(
        (
          await migrator.query(
            'select id,display_id,primary_project_id,created_by_user_id,revision,created_at,updated_at from api.datasets order by display_id',
          )
        ).rows,
      ).toEqual(datasets.rows)
      expect(
        (
          await migrator.query(
            'select * from api.change_events where entity_uuid=any($1::uuid[]) order by id',
            [datasets.rows.map((row) => row.id)],
          )
        ).rows,
      ).toEqual(events.rows)
    }
    const linkStep = designSteps.find(
      (step) => step.name === 'design dataset links and flags',
    )!
    await linkStep.run(db)
    const links = await migrator.query(
      "select * from api.record_links where target_kind='dataset' and link_type='dataset' order by target_identifier",
    )
    expect(links.rows.map((row) => row.target_identifier)).toEqual([
      'DS-0287',
      'DS-0290',
      'DS-0296',
      'DS-0297',
      'DS-0298',
      'DS-0302',
      'DS-0303',
      'DS-0305',
      'DS-0310',
      'DS-0311',
    ])
    expect(links.rows.every((row) => row.target_record_id === null)).toBe(true)
    expect(
      (
        await migrator.query(
          `select r.identifier,l.target_identifier,l.created_by_user_id
             from api.record_links l join api.records r on r.id=l.source_record_id
            where l.target_kind='dataset' and l.link_type='dataset'
              and l.target_identifier in ('DS-0290','DS-0298','DS-0305')
            order by l.target_identifier`,
        )
      ).rows,
    ).toEqual([
      {
        identifier: 'EXP-0125',
        target_identifier: 'DS-0290',
        created_by_user_id: DESIGN_USER_IDS.mei,
      },
      {
        identifier: 'EXP-0140',
        target_identifier: 'DS-0298',
        created_by_user_id: DESIGN_USER_IDS.gareth,
      },
      {
        identifier: 'EXP-0130',
        target_identifier: 'DS-0305',
        created_by_user_id: DESIGN_USER_IDS.mei,
      },
    ])
    const linkEvents = await migrator.query(
      'select * from api.change_events order by id',
    )
    await linkStep.run(db)
    expect(
      (
        await migrator.query(
          "select * from api.record_links where target_kind='dataset' and link_type='dataset' order by target_identifier",
        )
      ).rows,
    ).toEqual(links.rows)
    expect(
      (await migrator.query('select * from api.change_events order by id'))
        .rows,
    ).toEqual(linkEvents.rows)
  } finally {
    await actor.end()
    await db.$client.end()
    await migrator.end()
  }
}, 120_000)
