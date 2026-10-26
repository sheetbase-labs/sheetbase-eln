/**
 * The list boards (Experiments, Samples, Protocols, project overviews) tell one
 * story: who owns each record, which protocol version it follows, and when it
 * was started and last touched, all against the frozen design clock. The steps
 * that create these records stamp the real clock and a placeholder owner, so
 * this one runs last and sets the board's values.
 *
 * Everything is an idempotent update keyed by identifier. Dates need three
 * triggers out of the way (the same ones the design clock step handles):
 * `set_updated_at` forces now() on any change, `prevent_locked_record_mutation`
 * refuses signed records, `assert_record_project_active` refuses the archived
 * projects' records, and `change_event_records` would log a seed correction as
 * if a person had made it.
 */
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const USERS = {
  gareth: '00000000-0000-4000-8000-000000000310',
  priya: '00000000-0000-4000-8000-000000000311',
  mei: '00000000-0000-4000-8000-000000000312',
  tom: '00000000-0000-4000-8000-000000000313',
} as const
const PROJECTS = {
  aav9: 'aav9-process-transfer',
  ambr: 'ambr-250-perfusion-scale-down',
  lvvStability: 'lvv-stability-2-8c',
  lvvDownstream: 'lvv-downstream-chromatography',
  hek293: 'hek293-cell-bank-characterisation',
  cart: 'car-t-expansion-media-screen',
  fullEmpty: 'aav-full-empty-assay-qualification',
  tff: 'aav8-tff-concentration',
} as const

/** Before the design clock's 30-day window, so these stay out of "recent". */
const LONG_AGO = '2026-08-14T10:00:00+01:00'

interface ExperimentRow {
  identifier: string
  title?: string
  owner: keyof typeof USERS
  project: keyof typeof PROJECTS
  protocol: [identifier: string, version: number] | null
  /** Null keeps the date the earlier steps set. */
  started: string | null
  updated: string
}

const EXPERIMENTS: ExperimentRow[] = [
  {
    identifier: 'EXP-0145',
    owner: 'gareth',
    project: 'aav9',
    protocol: ['PRT-021', 3],
    started: null,
    updated: '2026-09-25T09:40:00+01:00',
  },
  {
    identifier: 'EXP-0142',
    owner: 'gareth',
    project: 'aav9',
    protocol: ['PRT-021', 3],
    started: null,
    updated: '2026-09-25T09:32:00+01:00',
  },
  {
    identifier: 'EXP-0140',
    owner: 'gareth',
    project: 'ambr',
    protocol: ['PRT-014', 2],
    started: '2026-09-19T09:00:00+01:00',
    updated: '2026-09-24T15:30:00+01:00',
  },
  {
    identifier: 'EXP-0138',
    owner: 'priya',
    project: 'aav9',
    protocol: ['PRT-018', 2],
    started: '2026-09-17T09:00:00+01:00',
    updated: '2026-09-24T16:40:00+01:00',
  },
  {
    identifier: 'EXP-0131',
    owner: 'tom',
    project: 'lvvStability',
    protocol: ['PRT-019', 1],
    started: '2026-09-14T09:00:00+01:00',
    updated: '2026-09-24T11:02:00+01:00',
  },
  {
    identifier: 'EXP-0130',
    owner: 'mei',
    project: 'hek293',
    protocol: ['PRT-009', 4],
    started: '2026-09-12T09:00:00+01:00',
    updated: '2026-09-23T15:18:00+01:00',
  },
  {
    identifier: 'EXP-0128',
    owner: 'tom',
    project: 'cart',
    protocol: ['PRT-020', 1],
    started: '2026-09-09T09:00:00+01:00',
    updated: '2026-09-23T10:00:00+01:00',
  },
  {
    identifier: 'EXP-0125',
    owner: 'mei',
    project: 'fullEmpty',
    protocol: ['PRT-012', 2],
    started: '2026-09-01T09:00:00+01:00',
    updated: '2026-09-22T14:00:00+01:00',
  },
  {
    identifier: 'EXP-0144',
    owner: 'tom',
    project: 'tff',
    protocol: null,
    started: '2026-09-20T09:00:00+01:00',
    updated: '2026-09-20T09:00:00+01:00',
  },
  {
    identifier: 'EXP-0136',
    owner: 'gareth',
    project: 'aav9',
    protocol: ['PRT-017', 2],
    started: '2026-09-08T09:00:00+01:00',
    updated: '2026-09-19T14:00:00+01:00',
  },
  {
    identifier: 'EXP-0133',
    owner: 'gareth',
    project: 'aav9',
    protocol: ['PRT-017', 2],
    started: '2026-09-05T09:00:00+01:00',
    updated: '2026-09-19T11:00:00+01:00',
  },
  {
    identifier: 'EXP-0139',
    owner: 'gareth',
    project: 'lvvDownstream',
    protocol: ['PRT-022', 1],
    started: '2026-09-10T09:00:00+01:00',
    updated: '2026-09-11T16:00:00+01:00',
  },
  // The project overviews' own recent experiments.
  {
    identifier: 'EXP-0127',
    title: 'Day 3 stability pull, 2–8 °C',
    owner: 'tom',
    project: 'lvvStability',
    protocol: ['PRT-019', 1],
    started: '2026-09-07T09:00:00+01:00',
    updated: '2026-09-21T13:00:00+01:00',
  },
  {
    identifier: 'EXP-0124',
    title: 'Day 0 reference, LVV harvest H-21',
    owner: 'priya',
    project: 'lvvStability',
    protocol: ['PRT-019', 1],
    started: '2026-09-04T09:00:00+01:00',
    updated: '2026-09-18T12:00:00+01:00',
  },
  {
    identifier: 'EXP-0123',
    title: 'Infectious titre method check',
    owner: 'mei',
    project: 'lvvStability',
    protocol: null,
    started: '2026-09-01T09:00:00+01:00',
    updated: '2026-09-15T12:00:00+01:00',
  },
  {
    identifier: 'EXP-0132',
    title: 'Ambr 250 run AMB-25-112',
    owner: 'gareth',
    project: 'ambr',
    protocol: ['PRT-014', 2],
    started: '2026-08-31T09:00:00+01:00',
    updated: '2026-09-12T12:00:00+01:00',
  },
  {
    identifier: 'EXP-0119',
    title: 'Scale-down qualification vs 50 L',
    owner: 'gareth',
    project: 'ambr',
    protocol: ['PRT-014', 1],
    started: '2026-08-10T09:00:00+01:00',
    updated: '2026-08-28T12:00:00+01:00',
  },
]

/** The controlled documents' names as the Protocols board writes them. */
const PROTOCOL_TITLES: Array<[string, string]> = [
  ['PRT-021', 'Depth-filter clarification screen'],
  ['PRT-018', 'Transfection ratio sweep'],
  ['PRT-017', 'Harvest timing'],
  ['PRT-022', 'AEX resin screen'],
  ['PRT-020', 'T-cell expansion media comparison'],
  ['PRT-019', 'Viral vector hold stability, 2–8 °C'],
  ['PRT-014', 'Ambr 250 perfusion run'],
  ['PRT-012', 'Full/empty ratio by AUC'],
  ['PRT-009', 'Cell bank viability panel'],
]

interface SampleRow {
  identifier: string
  title: string
  status?: string
  properties: Record<string, unknown>
}

/** Samples whose placeholder names differ from the registry and lineage boards. */
const SAMPLES: SampleRow[] = [
  {
    identifier: 'SMP-1002',
    title: 'HEK293 WCB-2',
    status: 'available',
    properties: {
      sampleType: 'Cell bank',
      releasedAt: '2026-06-02T10:00:00Z',
    },
  },
  {
    identifier: 'SMP-2226',
    title: 'Production culture, 20 L',
    status: 'consumed',
    properties: { sampleType: 'Culture' },
  },
  {
    identifier: 'SMP-2214',
    title: 'Donor 44 PBMC',
    status: 'available',
    properties: {
      sampleType: 'Cells',
      quantity: 3,
      quantityUnit: 'vials',
      storageLocation: 'LN2 tank 1, rack A, 2',
    },
  },
  {
    identifier: 'SMP-2201',
    title: 'AMB-25-118 inoculum',
    status: 'available',
    properties: { sampleType: 'Culture', storageLocation: 'Ambr 250, bay 2' },
  },
  {
    identifier: 'SMP-2190',
    title: 'LVV harvest H-21, 2–8 °C hold',
    status: 'hold_exceeded',
    properties: {
      sampleType: 'Viral harvest',
      quantity: 180,
      quantityUnit: 'mL',
      storageLocation: 'CR-2, shelf 1',
      holdCondition: '2–8 °C',
      holdStartedAt: '2026-09-11T00:00:00Z',
      holdDurationDays: 14,
      holdUntil: '2026-09-25T00:00:00Z',
    },
  },
]

export async function seedDesignListData(db: Db): Promise<void> {
  const triggers = [
    'set_updated_at',
    'prevent_locked_record_mutation',
    'change_event_records',
    'assert_record_project_active',
  ]
  for (const trigger of triggers)
    await db.execute(
      sql.raw(`alter table api.records disable trigger ${trigger}`),
    )
  try {
    await correctExperiments(db)
    await correctProtocols(db)
    await correctSamples(db)
  } finally {
    for (const trigger of triggers)
      await db.execute(
        sql.raw(`alter table api.records enable trigger ${trigger}`),
      )
  }
}

async function correctExperiments(db: Db): Promise<void> {
  // Every other experiment predates the 30-day window the Experiments board
  // filters to.
  await db.execute(sql`
    update api.records r
       set updated_at = ${LONG_AGO}
     where r.workspace_id = ${PROCESS}
       and r.kind = 'experiment'
       and r.identifier not in (${sql.join(
         EXPERIMENTS.map((e) => sql`${e.identifier}`),
         sql`, `,
       )})
       and r.updated_at > ${LONG_AGO}`)

  for (const e of EXPERIMENTS) {
    await db.execute(sql`
      update api.records r
         set created_by_user_id = ${USERS[e.owner]},
             project_id = (select id from api.projects
                            where workspace_id = ${PROCESS}
                              and key = ${PROJECTS[e.project]}),
             title = ${e.title ?? sql`r.title`},
             created_at = coalesce(${e.started}::timestamptz, r.created_at),
             updated_at = ${e.updated}
       where r.workspace_id = ${PROCESS}
         and r.kind = 'experiment'
         and r.identifier = ${e.identifier}`)

    await db.execute(sql`
      delete from api.record_links l
       using api.records r
       where l.source_record_id = r.id and l.link_type = 'protocol'
         and r.workspace_id = ${PROCESS} and r.identifier = ${e.identifier}`)
    if (!e.protocol) continue
    const [protocol, version] = e.protocol
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, link_metadata, created_by_user_id)
      select exp.id, prt.id, 'protocol_template', prt.identifier, 'protocol',
             ${JSON.stringify({ version })}::jsonb, ${USERS.gareth}
        from api.records exp, api.records prt
       where exp.workspace_id = ${PROCESS} and exp.identifier = ${e.identifier}
         and exp.kind = 'experiment'
         and prt.workspace_id = ${PROCESS} and prt.identifier = ${protocol}
         and prt.kind = 'protocol_template'
      on conflict do nothing`)
  }
}

async function correctProtocols(db: Db): Promise<void> {
  for (const [identifier, title] of PROTOCOL_TITLES)
    await db.execute(sql`
      update api.records
         set title = ${title}
       where workspace_id = ${PROCESS} and kind = 'protocol_template'
         and identifier = ${identifier}`)
}

async function correctSamples(db: Db): Promise<void> {
  for (const s of SAMPLES)
    await db.execute(sql`
      update api.records
         set title = ${s.title},
             status = coalesce(${s.status ?? null}, status),
             properties = properties || ${JSON.stringify(s.properties)}::jsonb
       where workspace_id = ${PROCESS} and kind = 'sample'
         and identifier = ${s.identifier}`)
}

/**
 * The Datasets board names two models at their second version ("ELISA and
 * turbidity v2", "ViCell v2"). Each gets its next schema version, with the
 * same fields, and its datasets move to it. Datasets keep their rows because
 * the new version carries the same field ids.
 */
export async function seedDesignDatasetModels(db: Db): Promise<void> {
  for (const key of ['elisa_turbidity', 'vicell_viability']) {
    const definition = await db.execute(sql`
      select id from api.dataset_schema_definitions
       where workspace_id = ${PROCESS} and key = ${key}`)
    const definitionId = (definition.rows[0] as { id: string } | undefined)?.id
    if (!definitionId) continue
    const latest = await db.execute(sql`
      select id, version from api.dataset_schema_versions
       where schema_id = ${definitionId} order by version desc limit 1`)
    const current = latest.rows[0] as { id: string; version: number }
    const nextId =
      Number(current.version) >= 2
        ? current.id
        : await withDesignClaims(db, USERS.gareth, PROCESS, async (client) => {
            const created = await client.query<{
              result: { schema_version_id: string }
            }>('select api.create_next_dataset_schema_version($1) as result', [
              definitionId,
            ])
            const id = created.rows[0].result.schema_version_id
            await client.query(
              'select api.publish_dataset_schema_version($1)',
              [id],
            )
            return id
          })
    await db.execute(sql`
      update api.datasets
         set schema_version_id = ${nextId}
       where schema_version_id in (
         select id from api.dataset_schema_versions
          where schema_id = ${definitionId} and id <> ${nextId})`)
  }
}
