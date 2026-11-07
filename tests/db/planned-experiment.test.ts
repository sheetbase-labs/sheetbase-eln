/**
 * Creating an experiment from a plan (migration remove_campaigns_and_plans),
 * against a freshly migrated database: the experiment, its parts, plate,
 * worklist, reservations and schedule request are made in one step, or nothing is.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const WS2 = '00000000-0000-4000-8000-00000000fd02'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const READER = '00000000-0000-4000-8000-00000000fd21'
const OWNER = 'pc-owner'
const VIEWER = 'pc-viewer'
const OUTSIDER = 'pc-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client
let outsider: Client

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function record(
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
) {
  const { rows } = await owner.query(
    `select * from api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],$5::jsonb)`,
    [
      PROJECT,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0] as { id: string; identifier: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pc','Planner'),($2,'pc2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pc','Planner',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
     values ($1,$2,'Plate reader','other',$3)`,
    [READER, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

const wells = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    wellCode: `A${i + 1}`,
    role: 'sample',
    sampleLabel: `S${i + 1}`,
    volumeUl: 20,
  }))

describe('creating an experiment from a plan', () => {
  const plan = (sampleId?: string) => ({
    summary: 'Dose response of compound X.',
    experiment: { title: 'Dose response of X' },
    parts: [
      {
        title: 'Prepare dilutions',
        dayOffset: 0,
        handsOnMinutes: 45,
        waitAfterMinutes: 0,
        needs: [],
      },
      {
        title: 'Read the plate',
        gate: 'block',
        dayOffset: 1,
        handsOnMinutes: 30,
        waitAfterMinutes: 60,
        needs: [{ instrumentId: READER, minutes: 30 }],
      },
    ],
    plate: { name: 'Dose plate', format: '96_well', wells: wells(4) },
    worklist: {
      format: 'csv',
      mode: 'stamp',
      sourcePlate: 'Dilutions',
      transfers: [
        { sourceWell: 'A1', destWell: 'A1', volumeUl: 20, label: 'S1' },
      ],
    },
    samples: sampleId ? [{ recordId: sampleId, quantity: 5, unit: 'µL' }] : [],
    schedule: true,
    warnings: [],
  })
  const create = (client: Client, body: unknown, project = PROJECT) =>
    client.query(`select api.create_planned_experiment($1,$2::jsonb) as r`, [
      project,
      JSON.stringify(body),
    ])

  it('refuses a plan with no title, a part without a title or a worklist without a plate', async () => {
    const bad = (patch: Record<string, unknown>) =>
      create(owner, { ...plan(), ...patch })
    await expect(bad({ experiment: { title: '' } })).rejects.toThrow(/title/)
    await expect(bad({ parts: [{ title: '' }] })).rejects.toThrow(
      /every part needs a title/,
    )
    await expect(bad({ plate: undefined })).rejects.toThrow(
      /worklist needs the plate/,
    )
    await expect(
      bad({ samples: [{ recordId: READER, quantity: 0 }] }),
    ).rejects.toThrow(/quantity above zero/)
  })

  it('is refused for an archived project', async () => {
    await migrator.query(
      `update api.projects set archived_at = now() where id = $1`,
      [PROJECT],
    )
    try {
      await expect(create(owner, plan())).rejects.toThrow(/archived/)
    } finally {
      await migrator.query(
        `update api.projects set archived_at = null where id = $1`,
        [PROJECT],
      )
    }
  })

  it('is for people who can write, in this workspace', async () => {
    await expect(create(viewer, plan())).rejects.toThrow(/not permitted/)
    await expect(create(outsider, plan())).rejects.toThrow(
      /not found|not permitted/,
    )
    const made = await migrator.query(
      `select count(*)::int as n from api.records where title = 'Dose response of X'`,
    )
    expect(made.rows[0].n).toBe(0)
  })

  it('creates the experiment, parts, plate, worklist, reservations and a schedule request', async () => {
    const sample = await record('sample', 'Compound X stock', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const result = (await create(owner, plan(sample.id))).rows[0].r
    expect(result).toMatchObject({ parts: 2, reservations: 1 })

    const parts = await owner.query(
      `select * from api.record_parts($1) order by part_number`,
      [result.recordId],
    )
    expect(parts.rows.map((p: { title: string }) => p.title)).toEqual([
      'Prepare dilutions',
      'Read the plate',
    ])
    const gated = await owner.query(
      `select opens_when, gate_mode from api.experiment_parts where id = $1`,
      [parts.rows[1].part_id],
    )
    expect(gated.rows[0].gate_mode).toBe('block')
    expect(gated.rows[0].opens_when).toEqual([
      { kind: 'part_done', partId: parts.rows[0].part_id },
    ])
    const needs = await migrator.query(
      `select minutes, resource_id from api.part_resource_needs where part_id = $1`,
      [parts.rows[1].part_id],
    )
    expect(needs.rows).toEqual([{ minutes: 30, resource_id: READER }])
    const planRow = await migrator.query(
      `select hands_on_minutes, wait_after_minutes from api.part_plans where part_id = $1`,
      [parts.rows[1].part_id],
    )
    expect(planRow.rows[0]).toEqual({
      hands_on_minutes: 30,
      wait_after_minutes: 60,
    })
    const run = await migrator.query(
      `select record_id, jsonb_array_length(wells) as wells from api.plate_runs where id = $1`,
      [result.plateRunId],
    )
    expect(run.rows[0]).toEqual({ record_id: result.recordId, wells: 4 })
    const wl = await migrator.query(
      `select record_id, run_id as plate_run_id from api.plate_worklists where id = $1`,
      [result.worklistId],
    )
    expect(wl.rows[0]).toEqual({
      record_id: result.recordId,
      plate_run_id: result.plateRunId,
    })
    const reserved = await migrator.query(
      `select quantity::numeric as q from api.sample_reservations where sample_record_id = $1 and experiment_record_id = $2`,
      [sample.id, result.recordId],
    )
    expect(Number(reserved.rows[0].q)).toBe(5)
    const proposal = await migrator.query(
      `select status from api.schedule_proposals where id = $1`,
      [result.proposalId],
    )
    expect(proposal.rows[0].status).toBe('requested')
  })

  it('creates nothing at all when one step is refused', async () => {
    const broken = {
      ...plan(),
      experiment: { title: 'Broken experiment' },
      parts: [
        {
          title: 'Needs a ghost',
          needs: [
            {
              instrumentId: '00000000-0000-4000-8000-0000000000aa',
              minutes: 10,
            },
          ],
        },
      ],
    }
    await expect(create(owner, broken)).rejects.toThrow()
    const made = await migrator.query(
      `select count(*)::int as n from api.records where title = 'Broken experiment'`,
    )
    expect(made.rows[0].n).toBe(0)
  })

  it('leaves no campaign or plan tables behind', async () => {
    const { rows } = await migrator.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'api'
          and table_name in ('experiment_plans','campaigns','campaign_rounds','model_campaign_lists','model_capabilities')`,
    )
    expect(rows[0].n).toBe(0)
  })
})
