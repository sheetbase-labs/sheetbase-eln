import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

it('reuses RPC-created project, record, protocol and file identities on two reseeds', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const database = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  try {
    for (const step of designSteps) {
      if (step.name === 'design projects') break
      await step.run(database)
    }
    await actor.query('set role authenticated')
    await setActorJwt(
      actor,
      DESIGN_USER_IDS.gareth,
      DESIGN_WORKSPACE_IDS.processDevelopment,
    )
    const project = await actor.query<{ id: string }>(
      "select id from api.create_project('AAV9 process transfer')",
    )
    const projectId = project.rows[0].id
    expect(projectId).not.toBe('00000000-0000-4000-8000-000000000320')
    for (let number = 1; number <= 145; number++) {
      await actor.query("select api.create_record($1,'experiment',$2)", [
        projectId,
        `Lookup control ${number}`,
      ])
    }
    for (let number = 1; number <= 6; number++) {
      await actor.query(
        "select api.create_record(null,'protocol_template',$1,'active')",
        [`Protocol lookup control ${number}`],
      )
    }
    const protocol = await actor.query<{
      id: string
      structure_version: number
    }>(
      "select id, structure_version from api.records where identifier = 'PRT-006'",
    )
    const protocolId = protocol.rows[0].id
    expect(protocolId).not.toBe('00000000-0000-4000-8000-000000000370')
    const uploadId = randomUUID()
    const upload = await actor.query<{ file_object_id: string }>(
      "select file_object_id from api.create_file_upload($1,'PR-01 plate reader export.csv','text/csv',184320,$2,null,'local',$3)",
      [
        projectId,
        `${DESIGN_WORKSPACE_IDS.processDevelopment}/${uploadId}/${'a'.repeat(32)}`,
        uploadId,
      ],
    )
    const fileId = upload.rows[0].file_object_id
    expect(fileId).not.toBe('00000000-0000-4000-8000-000000000720')

    const steps = designSteps.filter((step) =>
      ['design protocol training', 'design folders and files'].includes(
        step.name,
      ),
    )
    for (const step of steps) await step.run(database)

    const folders = await actor.query(
      'select id, name, parent_id from api.folders where project_id = $1 order by name',
      [projectId],
    )
    expect(folders.rows).toHaveLength(8)
    const records = await actor.query(
      `select r.id, r.identifier, r.folder_id, r.metadata_version, r.updated_at, f.name
         from api.records r join api.folders f on f.id = r.folder_id
        where r.project_id = $1 order by r.identifier`,
      [projectId],
    )
    expect(records.rows.map((row) => [row.identifier, row.name])).toEqual([
      ['EXP-0133', 'Harvest'],
      ['EXP-0136', 'Transfection'],
      ['EXP-0138', 'Transfection'],
      ['EXP-0142', 'Clarification'],
      ['EXP-0145', 'Clarification'],
    ])
    const files = await actor.query(
      `select f.* from api.file_objects f join api.records r on r.id = f.record_id
        where r.project_id = $1 order by f.display_name`,
      [projectId],
    )
    expect(files.rows).toHaveLength(3)
    expect(
      files.rows.find(
        (row) => row.display_name === 'PR-01 plate reader export.csv',
      ).id,
    ).toBe(fileId)
    // The metadata fixture does not pretend that upload bytes exist.
    expect(files.rows.every((row) => row.status === 'missing')).toBe(true)
    const blocks = await actor.query(
      'select * from api.blocks where record_id = $1 order by id',
      [protocolId],
    )
    expect(blocks.rows).toHaveLength(1)
    expect(blocks.rows[0].payload.doc.content[0].content[0].text).toBe(
      'Purpose',
    )
    const protocolAfter = await actor.query(
      'select structure_version from api.records where id = $1',
      [protocolId],
    )
    expect(protocolAfter.rows[0].structure_version).toBe(
      protocol.rows[0].structure_version + 1,
    )
    const training = await actor.query(
      'select * from api.protocol_training where protocol_record_id = $1 order by user_id',
      [protocolId],
    )
    expect(training.rows.map((row) => [row.user_id, row.status])).toEqual([
      [DESIGN_USER_IDS.priya, 'trained'],
      [DESIGN_USER_IDS.mei, 'trained'],
      [DESIGN_USER_IDS.tom, 'required'],
    ])

    for (let repeat = 0; repeat < 2; repeat++) {
      for (const step of steps) await step.run(database)
      expect(
        (
          await actor.query(
            'select id, name, parent_id from api.folders where project_id = $1 order by name',
            [projectId],
          )
        ).rows,
      ).toEqual(folders.rows)
      expect(
        (
          await actor.query(
            `select r.id, r.identifier, r.folder_id, r.metadata_version, r.updated_at, f.name
         from api.records r join api.folders f on f.id = r.folder_id
        where r.project_id = $1 order by r.identifier`,
            [projectId],
          )
        ).rows,
      ).toEqual(records.rows)
      expect(
        (
          await actor.query(
            `select f.* from api.file_objects f join api.records r on r.id = f.record_id
        where r.project_id = $1 order by f.display_name`,
            [projectId],
          )
        ).rows,
      ).toEqual(files.rows)
      expect(
        (
          await actor.query(
            'select * from api.blocks where record_id = $1 order by id',
            [protocolId],
          )
        ).rows,
      ).toEqual(blocks.rows)
      expect(
        (
          await actor.query(
            'select structure_version from api.records where id = $1',
            [protocolId],
          )
        ).rows,
      ).toEqual(protocolAfter.rows)
      expect(
        (
          await actor.query(
            'select * from api.protocol_training where protocol_record_id = $1 order by user_id',
            [protocolId],
          )
        ).rows,
      ).toEqual(training.rows)
    }
  } finally {
    await actor.end()
    await migrator.end()
    await database.$client.end()
  }
}, 180_000)

it('plans rows, measures samples and follows experiments by canonical identities without reseed churn', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const database = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  try {
    for (const step of designSteps) {
      if (step.name === 'design projects') break
      await step.run(database)
    }
    await actor.query('set role authenticated')
    const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
    await setActorJwt(actor, DESIGN_USER_IDS.gareth, workspaceId)
    const project = await actor.query<{ id: string }>(
      "select id from api.create_project('AAV9 process transfer')",
    )
    const projectId = project.rows[0].id
    await actor.query(
      "select api.create_record($1,'experiment','Follow control ' || n) from generate_series(1,142) n",
      [projectId],
    )
    const samples = await actor.query<{ id: string; identifier: string }>(
      `select r.id,r.identifier from generate_series(1,2235) n
         cross join lateral api.create_record($1,'sample','Measurement control ' || n,'available') r
        where r.identifier in ('SMP-2231','SMP-2232','SMP-2233','SMP-2234','SMP-2235') order by r.identifier`,
      [projectId],
    )
    expect(samples.rows.map((row) => row.identifier)).toEqual([
      'SMP-2231',
      'SMP-2232',
      'SMP-2233',
      'SMP-2234',
      'SMP-2235',
    ])
    expect(samples.rows[0].id).not.toBe('00000000-0000-4000-8000-000000000340')
    const definition = await actor.query<{
      result: { schema_version_id: string }
    }>(
      "select api.create_dataset_schema_definition($1,'bench_lookup_control','Bench lookup control',null,'[]'::jsonb) as result",
      [workspaceId],
    )
    const versionId = definition.rows[0].result.schema_version_id
    await actor.query('select api.publish_dataset_schema_version($1)', [
      versionId,
    ])
    // Canonical catalogue creation, under the authenticated role, with both
    // UUID and display ID omitted: the same payload createDataset posts.
    await actor.query(
      `insert into api.datasets(workspace_id,schema_version_id,name,primary_project_id)
       select $1,$2,'Bench lookup control ' || n,$3 from generate_series(1,320) n`,
      [workspaceId, versionId, projectId],
    )
    const dataset = await actor.query<{ id: string }>(
      "select id from api.datasets where display_id='DS-0320'",
    )
    const datasetId = dataset.rows[0].id
    expect(datasetId).not.toBe('00000000-0000-4000-8000-00000000038a')
    const oldFollow = await actor.query<{ created_at: Date }>(
      "select api.follow_record(id) as created_at from api.records where identifier='EXP-0138'",
    )
    const existingMeasurement = await actor.query<{ id: string }>(
      "select id from api.record_sample_measurement($1,'Capsid titre',1.2e12,'vg/mL','qPCR')",
      [samples.rows[0].id],
    )
    const existingPlanned = await actor.query<{ id: string }>(
      "select id from api.plan_dataset_row($1,null,'SMP-2232')",
      [datasetId],
    )
    const steps = designSteps.filter((step) =>
      [
        'design bench reading rows',
        'design sample measurements',
        'design work items',
      ].includes(step.name),
    )
    expect(steps.map((step) => step.name)).toEqual([
      'design bench reading rows',
      'design sample measurements',
      'design work items',
    ])
    const benchStep = steps.find(
      (step) => step.name === 'design bench reading rows',
    )
    if (!benchStep) throw new Error('bench step missing')
    let revision = await actor.query<{ revision: string }>(
      'select revision from api.datasets where id=$1',
      [datasetId],
    )
    await actor.query('select api.archive_dataset($1,$2)', [
      datasetId,
      revision.rows[0].revision,
    ])
    await benchStep.run(database)
    const archivedRows = await actor.query(
      'select * from api.dataset_rows where dataset_id=$1',
      [datasetId],
    )
    expect(archivedRows.rows).toHaveLength(1)
    expect(archivedRows.rows[0].id).toBe(existingPlanned.rows[0].id)
    revision = await actor.query<{ revision: string }>(
      'select revision from api.datasets where id=$1',
      [datasetId],
    )
    await actor.query('select api.restore_dataset($1,$2)', [
      datasetId,
      revision.rows[0].revision,
    ])
    for (const step of steps) await step.run(database)

    const rows = await actor.query(
      'select * from api.dataset_rows where dataset_id=$1 order by planned_key',
      [datasetId],
    )
    expect(rows.rows.map((row) => [row.planned_key, row.status])).toEqual([
      ['SMP-2231', 'planned'],
      ['SMP-2232', 'planned'],
      ['SMP-2233', 'planned'],
      ['SMP-2234', 'planned'],
    ])
    expect(rows.rows[1].id).toBe(existingPlanned.rows[0].id)
    expect(rows.rows[1].scheduled_at).toBeNull()
    const measurements = await actor.query(
      `select m.*,r.identifier from api.sample_measurements m join api.records r on r.id=m.sample_record_id order by r.identifier,m.name`,
    )
    expect(measurements.rows).toHaveLength(10)
    expect(
      measurements.rows.filter(
        (row) => row.identifier === 'SMP-2231' && row.name === 'Capsid titre',
      )[0].id,
    ).toBe(existingMeasurement.rows[0].id)
    expect(
      measurements.rows.map((row) => [
        row.identifier,
        row.name,
        Number(row.value),
        row.unit,
        row.method,
      ]),
    ).toEqual(
      ['SMP-2231', 'SMP-2232', 'SMP-2233', 'SMP-2234', 'SMP-2235'].flatMap(
        (identifier) => [
          [
            identifier,
            'Capsid titre',
            identifier === 'SMP-2231' ? 1.2e12 : 4.6e12,
            'vg/mL',
            identifier === 'SMP-2231' ? 'qPCR' : 'ddPCR',
          ],
          [identifier, 'Viability', 92.4, '%', 'Vi-CELL'],
        ],
      ),
    )
    const follows = await actor.query(
      'select f.*,r.identifier from api.work_item_follows f join api.records r on r.id=f.record_id order by r.identifier',
    )
    expect(follows.rows.map((row) => [row.identifier, row.user_id])).toEqual([
      ['EXP-0138', DESIGN_USER_IDS.gareth],
      ['EXP-0142', DESIGN_USER_IDS.gareth],
    ])
    expect(follows.rows[0].created_at).toEqual(oldFollow.rows[0].created_at)
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const step of steps) await step.run(database)
      expect(
        (
          await actor.query(
            'select * from api.dataset_rows where dataset_id=$1 order by planned_key',
            [datasetId],
          )
        ).rows,
      ).toEqual(rows.rows)
      expect(
        (
          await actor.query(
            'select m.*,r.identifier from api.sample_measurements m join api.records r on r.id=m.sample_record_id order by r.identifier,m.name',
          )
        ).rows,
      ).toEqual(measurements.rows)
      expect(
        (
          await actor.query(
            'select f.*,r.identifier from api.work_item_follows f join api.records r on r.id=f.record_id order by r.identifier',
          )
        ).rows,
      ).toEqual(follows.rows)
    }
  } finally {
    await actor.end()
    await migrator.end()
    await database.$client.end()
  }
}, 180_000)

it('creates the five original project milestones through their authority and reuses native identities', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const database = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  try {
    for (const step of designSteps.slice(0, 3)) await step.run(database)
    await actor.query('set role authenticated')
    const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
    await setActorJwt(actor, DESIGN_USER_IDS.gareth, workspaceId)
    const project = await actor.query<{ id: string }>(
      "select id from api.create_project('AAV9 process transfer')",
    )
    const projectId = project.rows[0].id
    expect(projectId).not.toBe('00000000-0000-4000-8000-000000000320')
    await actor.query(
      "select api.create_record($1,'experiment','Milestone control ' || n) from generate_series(1,145) n",
      [projectId],
    )
    const other = await actor.query<{ id: string }>(
      "select id from api.create_project('Unrelated milestone controls')",
    )
    await actor.query(
      `select api.create_study_task(p_workspace_id=>$1,p_project_id=>$2,
        p_title=>'50 L engineering run',p_task_type=>'milestone',p_due_at=>'2027-01-02')`,
      [workspaceId, other.rows[0].id],
    )
    const preexisting = await actor.query<{ id: string }>(
      `select id from api.create_study_task(p_workspace_id=>$1,p_project_id=>$2,
        p_title=>'TFF and polish defined',p_task_type=>'milestone',
        p_due_at=>'2026-10-16T00:00:00+01:00',p_timezone=>'Europe/London',p_position=>2)`,
      [workspaceId, projectId],
    )
    const step = designSteps.find((item) => item.name === 'design milestones')
    if (!step) throw new Error('milestone step missing')
    await step.run(database)
    const read = () =>
      actor.query(
        `select * from api.study_tasks where project_id=$1 order by position`,
        [projectId],
      )
    const everything = (await read()).rows
    // The plan has since grown phases and further milestones; this test is
    // about the five it started with.
    const originalTitles = [
      'Upstream process locked',
      'Clarification train selected',
      'TFF and polish defined',
      '50 L engineering run',
      'Tech-transfer package to CL-017',
    ]
    const original = everything
      .filter((row) => originalTitles.includes(row.title))
      .sort(
        (a, b) =>
          originalTitles.indexOf(a.title) - originalTitles.indexOf(b.title),
      )
    // Expected values are transcribed from immutable ProjectDetail.txt, not
    // taken from the implementation's milestone list.
    expect(
      original.map((row) => [
        row.title,
        row.status,
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London',
          day: '2-digit',
          month: 'short',
        }).format(row.due_at),
        row.linked_experiment_identifier,
      ]),
    ).toEqual([
      ['Upstream process locked', 'completed', '19 Sept', 'EXP-0133'],
      ['Clarification train selected', 'in_progress', '29 Sept', 'EXP-0142'],
      ['TFF and polish defined', 'not_started', '16 Oct', null],
      ['50 L engineering run', 'not_started', '06 Nov', 'EXP-0145'],
      ['Tech-transfer package to CL-017', 'not_started', '27 Nov', null],
    ])
    expect(original[2].id).toBe(preexisting.rows[0].id)
    expect(original.filter((row) => row.status === 'completed')).toHaveLength(1)
    expect(original.map((row) => row.progress_percent)).toEqual([
      100, 25, 0, 0, 0,
    ])
    // The milestones now carry their done-when conditions as deliverables.
    expect(
      (await actor.query('select * from api.study_deliverables')).rows.length,
    ).toBeGreaterThan(0)
    for (let repeat = 0; repeat < 2; repeat++) {
      await step.run(database)
      expect((await read()).rows).toEqual(everything)
    }
  } finally {
    await actor.end()
    await migrator.end()
    await database.$client.end()
  }
}, 180_000)
