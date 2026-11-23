/**
 * The quality side of the demo: release limits on the vector lots, an incident
 * log, legal holds, retention rules, a sample release workflow, the lab
 * watchers and their findings, QC control charts, experiment series, and the
 * comments and follows that make the lab read as worked in by several people.
 * Everything goes through the RPC a page calls, as the person who would use it.
 */
import { sql } from 'drizzle-orm'

import {
  PEOPLE,
  PROCESS,
  daysBefore,
  inTransaction,
  required,
  recordIds,
} from './design-operations'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const AAV9 = '00000000-0000-4000-8000-000000000320'

// Release limits, incident log, legal holds, retention -------------------------

const INCIDENT_MODEL = {
  key: 'incident',
  name: 'Incident',
  prefix: 'INC',
  description:
    'Anything that went wrong in the lab, what was done and what changes.',
  fields: [
    { field_name: 'summary', label: 'What happened', show_in_list: true },
    {
      field_name: 'severity',
      label: 'Severity',
      logical_type: 'category',
      show_in_list: true,
      options: [
        { key: 'minor', label: 'Minor' },
        { key: 'major', label: 'Major' },
        { key: 'critical', label: 'Critical' },
      ],
    },
    { field_name: 'area', label: 'Where', show_in_list: true },
    { field_name: 'immediate_action', label: 'Immediate action' },
    { field_name: 'root_cause', label: 'Root cause' },
    { field_name: 'corrective_action', label: 'Corrective action' },
  ],
} as const

const INCIDENTS: ReadonlyArray<{
  title: string
  status: string
  daysAgo: number
  closedAgo?: number
  fields: Record<string, string>
}> = [
  {
    title: 'Freezer F-2 temperature excursion over the weekend',
    status: 'closed',
    daysAgo: 41,
    closedAgo: 33,
    fields: {
      summary:
        'The F-2 alarm logged −61 °C for four hours on Saturday night after the door was left ajar.',
      severity: 'major',
      area: 'Cold room corridor, F-2',
      immediate_action:
        'Door closed, contents checked, boxes moved to F-3 until the unit recovered.',
      root_cause:
        'Door latch worn. The alarm call-out went to a number that no longer exists.',
      corrective_action:
        'Latch replaced, alarm contact list corrected and tested.',
    },
  },
  {
    title: 'Two aliquot tubes labelled with the wrong lot number',
    status: 'closed',
    daysAgo: 28,
    closedAgo: 24,
    fields: {
      summary:
        'Barcodes on two AAV8 aliquots read lot V8F-001 but the handwritten label said V9F-001.',
      severity: 'minor',
      area: 'Freezer 7, rack C',
      immediate_action:
        'Both tubes quarantined and re-identified by ddPCR genome sequence.',
      root_cause:
        'Hand-labelled backup tubes were prepared at the same time as the printed ones.',
      corrective_action:
        'Printed labels only. Handwritten labels removed from the bench kit.',
    },
  },
  {
    title: 'TFF cassette leak during the 10× concentration',
    status: 'under investigation',
    daysAgo: 8,
    fields: {
      summary:
        'Retentate pressure dropped to 0.4 bar and the permeate turned cloudy 40 minutes into the run.',
      severity: 'major',
      area: 'Downstream suite, TFF skid 2',
      immediate_action:
        'Run stopped, product recovered, cassette sent back with the lot number.',
      root_cause: '',
      corrective_action: '',
    },
  },
  {
    title: 'Plate reader PR-01 lamp warm-up failed twice',
    status: 'open',
    daysAgo: 4,
    fields: {
      summary:
        'The instrument reported a lamp error on two mornings. Calibration check passed afterwards.',
      severity: 'minor',
      area: 'Analytical lab, PR-01',
      immediate_action:
        'Service engineer called. Plates run on the second reader in the meantime.',
      root_cause: '',
      corrective_action: '',
    },
  },
  {
    title: 'CHO-K1 bank vial count one short',
    status: 'open',
    daysAgo: 17,
    fields: {
      summary:
        'The quarterly count found 11 vials in the box; the register said 12.',
      severity: 'minor',
      area: 'LN2 tank 1, rack 3',
      immediate_action:
        'Register corrected, vial marked lost in the stocktake.',
      root_cause: '',
      corrective_action: '',
    },
  },
  {
    title: 'Sterility test positive on a media hold bottle',
    status: 'closed',
    daysAgo: 63,
    closedAgo: 49,
    fields: {
      summary:
        'A 1 L hold bottle of expression medium grew Bacillus on the day-7 sterility test.',
      severity: 'critical',
      area: 'Media prep',
      immediate_action:
        'All bottles from the same prep discarded. Runs using that prep reviewed.',
      root_cause:
        'Autoclave cycle log showed a short hold at temperature for the load.',
      corrective_action:
        'Autoclave serviced, load patterns revalidated, media prep checklist updated.',
    },
  },
]

export async function seedDesignQuality(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.record_models
     where workspace_id = ${PROCESS} and key = 'incident' limit 1`)

  if (done.rows.length) return

  const ids: string[] = []

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    // Release limits on the vector lots' numbers: pass, alert or fail live.
    await client.query('select api.set_spec_limits_enabled($1,true)', [PROCESS])
    await client.query(
      'select api.set_field_spec_limits($1,$2,$3,null,$4,null,$5)',
      [
        'vector_lot',
        'full_capsids_percent',
        60,
        70,
        'Release needs at least 60% full capsids.',
      ],
    )
    await client.query(
      'select api.set_field_spec_limits($1,$2,null,$3,null,$4,$5)',
      ['vector_lot', 'endotoxin_eu_per_ml', 5, 2, 'Release limit of 5 EU/mL.'],
    )
    await client.query(
      'select api.set_field_spec_limits($1,$2,$3,null,$4,null,$5)',
      ['vector_lot', 'titre_vg_per_ml', 1e13, 2e13, 'Minimum working titre.'],
    )

    // Incident log.
    await client.query(
      'select api.create_starter_model($1,$2,$3,$4,$5::jsonb,true)',
      [
        INCIDENT_MODEL.key,
        INCIDENT_MODEL.name,
        INCIDENT_MODEL.prefix,
        INCIDENT_MODEL.description,
        JSON.stringify(INCIDENT_MODEL.fields),
      ],
    )

    for (const i of INCIDENTS) {
      const made = await client.query<{ id: string }>(
        `select id from api.create_model_record($1,$2,$3,'draft','{}'::text[],'{}'::jsonb,$4::jsonb)`,
        [AAV9, INCIDENT_MODEL.key, i.title, JSON.stringify(i.fields)],
      )

      ids.push(required(made.rows[0]?.id, 'row'))
    }

    // Retention for the models that gather volume.
    await client.query('select api.set_retention_enabled($1,true)', [PROCESS])
    await client.query('select api.set_retention_rule($1,$2,$3)', [
      'analysis_request',
      24,
      'Requests are kept for two years after they were made.',
    ])
    await client.query('select api.set_retention_rule($1,$2,$3)', [
      'incident',
      120,
      'Incident records are kept ten years.',
    ])
  })

  await db.execute(sql`alter table api.records disable trigger set_updated_at`)

  try {
    for (const [i, incident] of INCIDENTS.entries()) {
      await db.execute(sql`
        update api.records
           set status = ${incident.status},
               created_at = ${daysBefore(incident.daysAgo)}::timestamptz,
               updated_at = ${daysBefore(incident.closedAgo ?? incident.daysAgo - 1)}::timestamptz,
               created_by_user_id = ${[PEOPLE.sam, PEOPLE.tom, PEOPLE.priya, PEOPLE.priya, PEOPLE.sam, PEOPLE.gareth][i % 6]}
         where id = ${ids[i]}`)
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger set_updated_at`)
  }

  // Legal holds: one released after an inspection, one on named documents. A
  // hold on a live project would stop the seed rewriting its records on a
  // reseed, so the active hold sits on documents the seed leaves alone.
  const reports = await recordIds(db, ['RPT-2026-0001', 'RPT-2026-0002'])

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    await client.query(
      `select api.create_legal_hold($1,$2,null,null,$3::uuid[])`,
      [
        'Transfection report and process lock summary',
        'Held for the client’s regulatory submission.',
        [...reports.values()],
      ],
    )

    const released = await client.query<{ id: string }>(
      `select id from api.create_legal_hold($1,$2,$3,null,'{}'::uuid[])`,
      [
        'Plasmid release: inspection request',
        'Inspector requested the plasmid release panel records.',
        '00000000-0000-4000-8000-00000000032d',
      ],
    )

    await client.query('select api.release_legal_hold($1,$2)', [
      released.rows[0]?.id,
      'Inspection closed with no findings.',
    ])
  })
}

// Sample release workflow ----------------------------------------------------

export async function seedDesignSampleWorkflows(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.sample_workflows where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const samples = await recordIds(db, [
    'SMP-2231',
    'SMP-2226',
    'SMP-2214',
    'SMP-2211',
    'SMP-2220',
    'SMP-2250',
  ])

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    const stage = (
      key: string,
      name: string,
      description: string,
      days: number | null,
      final: boolean,
      next: string[],
      actions: object[] = [],
    ) => ({
      key,
      name,
      description,
      turnaroundDays: days,
      final,
      requiredFields: [],
      actions,
      next,
    })

    const saved = await client.query<{ id: string }>(
      'select api.save_sample_workflow(null,$1::jsonb) as id',
      [
        JSON.stringify({
          name: 'Harvest lot release',
          description:
            'From a harvest arriving in the lab to a lot released for the next unit operation.',
          sampleType: '',
          autoEnrol: false,
          stages: [
            stage(
              'received',
              'Received',
              'Logged in, labelled and stored.',
              1,
              false,
              ['testing'],
            ),
            stage(
              'testing',
              'In testing',
              'Titre, turbidity and viability measured.',
              3,
              false,
              ['review', 'rejected'],
              [
                {
                  kind: 'notify',
                  to: 'scientist',
                  message: 'A harvest lot is ready for its release tests.',
                },
              ],
            ),
            stage(
              'review',
              'Awaiting review',
              'A second person checks the results.',
              2,
              false,
              ['released', 'rejected'],
              [{ kind: 'notify', to: 'reviewer' }],
            ),
            stage(
              'released',
              'Released',
              'Cleared for clarification.',
              null,
              true,
              [],
            ),
            stage(
              'rejected',
              'Rejected',
              'Fails release. Held for investigation.',
              null,
              true,
              [],
              [{ kind: 'quarantine', reason: 'Failed lot release.' }],
            ),
          ],
        }),
      ],
    )

    const workflowId = required(saved.rows[0]?.id, 'row')

    const stages = await client.query<{ id: string; name: string }>(
      'select id, name from api.sample_workflow_stages where workflow_id = $1',
      [workflowId],
    )

    const byName = (name: string) => {
      const id = stages.rows.find((s) => s.name === name)?.id

      if (!id) throw new Error(`workflow stage ${name}`)

      return id
    }

    const move = async (identifier: string, path: readonly string[]) => {
      const record = samples.get(identifier)

      if (!record) throw new Error(`sample ${identifier}`)

      const run = await client.query<{ id: string }>(
        'select id from api.enrol_sample_in_workflow($1,$2)',
        [record, workflowId],
      )

      for (const name of path) {
        await client.query('select api.advance_sample_workflow($1,$2,null)', [
          run.rows[0]?.id,
          byName(name),
        ])
      }
    }

    await move('SMP-2231', ['In testing'])
    await move('SMP-2226', ['In testing', 'Awaiting review'])
    await move('SMP-2214', ['In testing', 'Awaiting review', 'Released'])
    await move('SMP-2211', [])
    await move('SMP-2250', ['In testing', 'Awaiting review', 'Released'])
    await move('SMP-2220', ['In testing', 'Rejected'])
  })
}

// Watchers -------------------------------------------------------------------

export async function seedDesignWatchers(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.lab_watchers where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    const watchers: Array<[string, string, string | null, object]> = [
      ['stock_expiring', 'daily', null, { days: 45 }],
      ['stock_low', 'daily', null, {}],
      ['work_overdue', 'daily', AAV9, {}],
      ['data_missing', 'weekly', null, {}],
      ['results_off', 'weekly', null, { sigma: 3 }],
    ]

    for (const [kind, schedule, project, params] of watchers) {
      const set = await client.query<{ id: string }>(
        'select id from api.set_lab_watcher($1,$2,true,$3,$4,$5::jsonb)',
        [PROCESS, kind, schedule, project, JSON.stringify(params)],
      )

      await client.query('select api.run_lab_watcher($1)', [set.rows[0]?.id])
    }
  })
}

// Control charts ---------------------------------------------------------------

const QC_SERIES: ReadonlyArray<{
  name: string
  unit: string
  mean: number
  sd: number
  values: readonly number[]
}> = [
  {
    name: 'ddPCR positive control, copies/µL',
    unit: 'copies/µL',
    mean: 1850,
    sd: 62,
    values: [
      1842, 1871, 1803, 1890, 1855, 1827, 1912, 1798, 1864, 1881, 1839, 1905,
      1812, 1873, 1858, 1790, 1844, 1921, 1835, 1867, 1852, 1809, 1888, 1976,
    ],
  },
  {
    name: 'Capsid ELISA reference, ng/mL',
    unit: 'ng/mL',
    mean: 52,
    sd: 2.4,
    values: [
      51.2, 53.1, 50.4, 52.8, 54.0, 51.5, 49.8, 52.3, 53.6, 50.9, 52.0, 51.1,
      53.4, 52.7, 50.2, 51.9, 53.0, 52.4, 51.3, 49.9,
    ],
  },
  {
    name: 'Vi-CELL viability standard, %',
    unit: '%',
    mean: 96.2,
    sd: 0.9,
    values: [
      96.0, 96.8, 95.4, 96.5, 96.1, 97.0, 95.9, 96.3, 94.6, 94.2, 94.9, 94.4,
      95.0, 94.1, 94.7,
    ],
  },
]

export async function seedDesignQcSeries(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.qc_series where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const ids: string[] = []

  await inTransaction(db, PEOPLE.priya, async (client) => {
    for (const s of QC_SERIES) {
      const made = await client.query<{ id: string }>(
        `select id from api.create_qc_series($1,$2,'manual',null,null,null,$3,$4,$5,null)`,
        [PROCESS, s.name, s.unit, s.mean, s.sd],
      )

      const id = required(made.rows[0]?.id, 'row')
      ids.push(id)

      for (const [i, v] of s.values.entries()) {
        await client.query(
          'select api.record_qc_point($1,$2,$3::timestamptz,null,null)',
          [id, v, daysBefore(s.values.length - i + 2)],
        )
      }
    }
  })
}

// Comments, follows and series -------------------------------------------------

export async function seedDesignCollaboration(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.comments where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const exp = await recordIds(db, [
    'EXP-0126',
    'EXP-0128',
    'EXP-0129',
    'EXP-0140',
    'EXP-0141',
    'EXP-0144',
    'EXP-2006',
    'EXP-2007',
    'EXP-2008',
    'EXP-2009',
  ])

  const need = (key: string) => {
    const id = exp.get(key)

    if (!id) throw new Error(`experiment ${key}`)

    return id
  }

  // Threads on live notebooks, with a reply, a mention and a resolved one.
  const threads: Array<[string, string, string, string, string, string?]> = [
    [
      PEOPLE.priya,
      'EXP-0126',
      'Can we add a 120 h point? The titre may still be rising at 96 h.',
      PEOPLE.gareth,
      'Agreed. I will add a fourth arm and move the harvest forward two days.',
    ],
    [
      PEOPLE.gareth,
      'EXP-0129',
      'The gradient step from 20 to 40% looks steeper than the method says. Is that intended?',
      PEOPLE.tom,
      'Yes, the method was updated last week. Pointing it out in the notes.',
    ],
    [
      PEOPLE.tom,
      'EXP-0140',
      'Vessel 3 pH drifted above 7.2 overnight. Should I flag it in the deviations?',
      PEOPLE.priya,
      'Flagged. Probe was recalibrated this morning.',
    ],
    [
      PEOPLE.mei,
      'EXP-0128',
      'Medium B lot changed halfway through. Noting it here so the comparison is not misread.',
      PEOPLE.priya,
      'Thanks, I will mention it in the summary.',
    ],
    [
      PEOPLE.priya,
      'EXP-2006',
      'Pilot at 10 L starts Monday. Booking the Ambr overflow vessel as a backup.',
      PEOPLE.gareth,
      'Good. Tell me if the booking clashes with the TFF slot.',
    ],
  ]

  for (const [author, key, body, replier, reply] of threads) {
    const rootId = await inTransaction(db, author, async (client) => {
      const made = await client.query<{ id: string }>(
        `select (api.create_record_comment($1,'record','{}'::jsonb,$2,$3::text[])->>'id') as id`,
        [need(key), body, [replier]],
      )

      return made.rows[0]?.id
    })

    await inTransaction(db, replier, async (client) => {
      await client.query('select api.reply_to_comment($1,$2,$3::text[])', [
        rootId,
        reply,
        [author],
      ])
    })

    // Two of the five are settled.
    if (key === 'EXP-0129' || key === 'EXP-0128') {
      await inTransaction(db, author, async (client) => {
        await client.query('select api.resolve_comment_thread($1)', [rootId])
      })
    }
  }

  // Who follows what.
  const follows: Array<[string, string]> = [
    [PEOPLE.priya, 'EXP-0140'],
    [PEOPLE.priya, 'EXP-0126'],
    [PEOPLE.tom, 'EXP-0129'],
    [PEOPLE.sam, 'EXP-2006'],
    [PEOPLE.mei, 'EXP-0128'],
    [PEOPLE.mei, 'EXP-0140'],
    [PEOPLE.gareth, 'EXP-2006'],
  ]

  for (const [person, key] of follows) {
    await inTransaction(db, person, async (client) => {
      await client.query('select api.follow_record($1)', [need(key)])
    })
  }

  for (const person of [PEOPLE.priya, PEOPLE.tom, PEOPLE.sam]) {
    await inTransaction(db, person, async (client) => {
      await client.query('select api.follow_project($1)', [AAV9])
    })
  }

  // The repeat-2 downstream checks as one series: the feed titre check is the
  // series record, the TFF and AEX repeats are its members on planned days.
  await inTransaction(db, PEOPLE.gareth, async (client) => {
    await client.query('select api.start_experiment_series($1)', [
      need('EXP-2007'),
    ])

    const members: Array<[string, number]> = [
      ['EXP-2008', -2],
      ['EXP-2009', -4],
    ]

    for (const [key, day] of members) {
      await client.query('select api.add_series_member($1,$2,null,$3::date)', [
        need('EXP-2007'),
        need(key),
        daysBefore(day).slice(0, 10),
      ])
    }
  })

  // A planned absence, with the cover. The RPC only takes dates from today on,
  // so it is made for next week and then placed on the design's own calendar,
  // which the clock sweep carries forward with everything else.
  await inTransaction(db, PEOPLE.priya, async (client) => {
    const soon = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

    await client.query(
      'select api.set_member_absence($1,$2::date,$3::date,$4,$5,null)',
      [
        PROCESS,
        soon(5),
        soon(12),
        PEOPLE.gareth,
        'Annual leave. Gareth covers reviews.',
      ],
    )
  })

  await db.execute(sql`
    update api.member_absences
       set starts_on = ${daysBefore(-5).slice(0, 10)}::date,
           ends_on = ${daysBefore(-12).slice(0, 10)}::date
     where workspace_id = ${PROCESS}`)
}
