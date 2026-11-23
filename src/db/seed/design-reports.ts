/**
 * More reports for the demo, in every state a report moves through. Sections
 * that cite results are bound to a frozen block of an approved experiment's
 * revision (the same call the builder makes), so a report shows its evidence
 * and the checks read "valid". Approved and published reports have been
 * generated at least once; one report belongs to no project.
 */
import { sql } from 'drizzle-orm'

import { PEOPLE, PROCESS, daysBefore, inTransaction } from './design-operations'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const P = {
  aav9: '00000000-0000-4000-8000-000000000320',
  stability: '00000000-0000-4000-8000-000000000321',
  ambr: '00000000-0000-4000-8000-000000000322',
  carT: '00000000-0000-4000-8000-000000000323',
  fullEmpty: '00000000-0000-4000-8000-000000000328',
  lvv: '00000000-0000-4000-8000-000000000329',
  elisa: '00000000-0000-4000-8000-00000000032b',
} as const

type BlockType = 'rich_text' | 'table' | 'metric' | 'conclusion'

type Section =
  | { title: string; text: string }
  | { title: string; from: string; block: BlockType; note?: string }

interface ReportSeed {
  title: string
  subtitle?: string
  project: string | null
  daysAgo: number
  status: 'draft' | 'in_review' | 'approved' | 'published'
  formats?: ReadonlyArray<'html' | 'pdf'>
  sections: readonly Section[]
}

const REPORTS: readonly ReportSeed[] = [
  {
    title: 'Downstream summary at 2 L: TFF and AEX',
    subtitle: 'Flux, yield and column capacity from three runs',
    project: P.aav9,
    daysAgo: 31,
    status: 'approved',
    formats: ['html', 'pdf'],
    sections: [
      {
        title: 'Summary',
        text: 'Tangential flow filtration at 2 L held flux above the 30 L/m²/h target through a 10× concentration, and the AEX load capacity supports a 4 L batch on the 5 mL column scaled to 20 mL.',
      },
      { title: 'TFF load and flux', from: 'EXP-2002', block: 'table' },
      { title: 'TFF conclusion', from: 'EXP-2002', block: 'conclusion' },
      { title: 'AEX load capacity', from: 'EXP-2003', block: 'table' },
      { title: 'Hold-time at 2–8 °C', from: 'EXP-2004', block: 'metric' },
    ],
  },
  {
    title: 'Ambr 250 perfusion scale-down: interim report',
    subtitle: 'Perfusion rate, temperature shift and seed train',
    project: P.ambr,
    daysAgo: 9,
    status: 'in_review',
    sections: [
      {
        title: 'Purpose',
        text: 'Confirm that the Ambr 250 perfusion model reproduces the 2 L bioreactor before the process moves to the 50 L pilot.',
      },
      { title: 'Perfusion rate screen', from: 'EXP-2402', block: 'table' },
      {
        title: 'Temperature shift at day 5',
        from: 'EXP-2403',
        block: 'metric',
      },
      {
        title: 'Seed train variability',
        from: 'EXP-2405',
        block: 'conclusion',
      },
    ],
  },
  {
    title: 'LVV transfection optimisation: closeout',
    subtitle: 'PEI:DNA ratio, DNA per cell and plasmid ratio',
    project: P.lvv,
    daysAgo: 24,
    status: 'approved',
    formats: ['html'],
    sections: [
      {
        title: 'Outcome',
        text: 'A 3:1 PEI:DNA ratio with 1 µg DNA per million cells and a 4:2:1 gag-pol : rev : VSV-G plasmid ratio gave the highest functional titre. These settings are now the default in the LVV process description.',
      },
      { title: 'PEI:DNA ratio sweep', from: 'EXP-2501', block: 'table' },
      { title: 'DNA per cell', from: 'EXP-2502', block: 'metric' },
      { title: 'Plasmid ratio', from: 'EXP-2503', block: 'conclusion' },
    ],
  },
  {
    title: 'Stability at 2–8 °C: ten-day summary',
    subtitle: 'Titre, turbidity and capsid integrity over ten days',
    project: P.stability,
    daysAgo: 14,
    status: 'published',
    formats: ['html', 'pdf'],
    sections: [
      {
        title: 'Conclusion',
        text: 'Genome titre fell by less than 10% over ten days at 2–8 °C and turbidity stayed inside the release limit. A ten-day hold is supported.',
      },
      { title: 'Day 1', from: 'EXP-2101', block: 'metric' },
      { title: 'Day 4', from: 'EXP-2103', block: 'metric' },
      { title: 'Day 10', from: 'EXP-2106', block: 'table' },
    ],
  },
  {
    title: 'Full/empty capsid assay: qualification report',
    subtitle: 'AUC method, linearity, precision, specificity and robustness',
    project: P.fullEmpty,
    daysAgo: 6,
    status: 'in_review',
    sections: [
      {
        title: 'Scope',
        text: 'This report qualifies the analytical ultracentrifugation method for the full/empty capsid ratio against the acceptance criteria in the qualification protocol.',
      },
      { title: 'Linearity', from: 'EXP-2301', block: 'table' },
      { title: 'Intermediate precision', from: 'EXP-2302', block: 'table' },
      { title: 'Specificity', from: 'EXP-2303', block: 'conclusion' },
      { title: 'Robustness to rotor speed', from: 'EXP-2304', block: 'metric' },
      {
        title: 'Comparison with cryo-EM',
        from: 'EXP-2305',
        block: 'conclusion',
      },
    ],
  },
  {
    title: 'T-cell activation medium comparison',
    subtitle: 'Medium A against medium B across two donors',
    project: P.carT,
    daysAgo: 3,
    status: 'draft',
    sections: [
      {
        title: 'Question',
        text: 'Does the serum-free medium match the serum-containing control for expansion and viability across donors?',
      },
      { title: 'Donor 1', from: 'EXP-2201', block: 'table' },
      { title: 'Donor 2', from: 'EXP-2202', block: 'table' },
      {
        title: 'Serum-free against serum-containing',
        from: 'EXP-2206',
        block: 'conclusion',
      },
    ],
  },
  {
    title: 'Monthly progress, September',
    project: P.aav9,
    daysAgo: 2,
    status: 'approved',
    formats: ['html'],
    sections: [
      {
        title: 'September highlights',
        text: 'The 2 L downstream summary was approved, lot 2 of the Factor IX vector entered release testing, and the capsid ELISA method transfer received its antibodies.',
      },
      {
        title: 'Next month',
        text: 'Release results for lot 2, the first Ambr 250 pilot run, and the CAR-T medium decision.',
      },
    ],
  },
  {
    title: 'Capsid ELISA method transfer: status',
    subtitle: 'Receiving lab readiness',
    project: P.elisa,
    daysAgo: 5,
    status: 'draft',
    sections: [
      {
        title: 'Where we are',
        text: 'Reagents have been ordered and the antibody shipment is in transit. The first side-by-side plate is planned for the week after delivery.',
      },
    ],
  },
  {
    title: 'Quarterly supply and equipment review',
    subtitle: 'Reagent spend, expiries and instrument availability',
    project: null,
    daysAgo: 20,
    status: 'approved',
    formats: ['html', 'pdf'],
    sections: [
      {
        title: 'Reagents',
        text: 'Two reagents were reordered this quarter and one expired lot was replaced. No stock-outs delayed a run.',
      },
      {
        title: 'Instruments',
        text: 'The plate reader and the Ambr 250 stayed in qualification. The SEC-MALS column is out for repacking until November.',
      },
    ],
  },
]

export async function seedDesignReports(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.report_definitions
     where workspace_id = ${PROCESS} and title = ${REPORTS[0]?.title} limit 1`)

  if (done.rows.length) return

  const made: Array<{ id: string; record: string; seed: ReportSeed }> = []

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    for (const r of REPORTS) {
      const created = await client.query<{ id: string; record_id: string }>(
        'select id, record_id from api.create_report_definition($1,$2,$3,null,null)',
        [PROCESS, r.title, r.subtitle ?? null],
      )

      const row = created.rows.at(0)

      if (!row) throw new Error(`report not created: ${r.title}`)
      made.push({ id: row.id, record: row.record_id, seed: r })

      for (const s of r.sections) {
        if ('text' in s) {
          await client.query(
            'select id from api.add_report_section($1,$2,$3,$4,$5,$6)',
            [PROCESS, row.id, s.title, s.text, 'text', 'free_text'],
          )
          continue
        }

        const evidence = await client.query<{
          revision_id: string
          block_id: string
          record_id: string
          identifier: string
          version: number
        }>(
          `select rv.id as revision_id, b->>'id' as block_id, r.id as record_id,
                  r.identifier, rv.structure_version as version
             from api.records r
             join api.revisions rv on rv.record_id = r.id
             cross join lateral jsonb_array_elements(rv.block_snapshot) b
            where r.identifier = $1 and b->>'type' = $2
            order by rv.created_at desc limit 1`,
          // A results table is an ad hoc sheet in the notebook.
          [s.from, s.block === 'table' ? 'sheet' : s.block],
        )

        const e = evidence.rows.at(0)

        if (!e) throw new Error(`no ${s.block} block on ${s.from}`)

        const section = await client.query<{ id: string }>(
          'select id from api.add_report_section($1,$2,$3,$4,$5,$6)',
          [
            PROCESS,
            row.id,
            s.title,
            s.note ?? null,
            s.block === 'table' ? 'table' : 'text',
            s.block === 'table' ? 'table_block' : 'revision_block',
          ],
        )

        await client.query(
          'select id from api.bind_report_section_source($1,$2,$3,$4::jsonb)',
          [
            PROCESS,
            section.rows[0]?.id,
            e.revision_id,
            JSON.stringify({
              blockId: e.block_id,
              recordId: e.record_id,
              recordIdentifier: e.identifier,
              revisionVersion: e.version,
            }),
          ],
        )
      }

      await client.query('select api.validate_report($1,$2)', [PROCESS, row.id])

      if (r.status !== 'draft') {
        await client.query(
          'select id from api.update_report_definition($1,$2,null,null,$3)',
          [PROCESS, row.id, r.status],
        )
      }

      for (const format of r.formats ?? []) {
        await client.query('select id from api.generate_report($1,$2,$3)', [
          PROCESS,
          row.id,
          format,
        ])
      }
    }
  })

  // Reports made under no project are then filed under the one they are about,
  // and dated the way the design's other documents are.
  await db.execute(sql`alter table api.records disable trigger set_updated_at`)

  try {
    for (const m of made) {
      const created = daysBefore(m.seed.daysAgo + 4)
      const updated = daysBefore(m.seed.daysAgo)

      await db.execute(sql`
        update api.records
           set project_id = ${m.seed.project}::uuid,
               created_at = ${created}::timestamptz,
               updated_at = ${updated}::timestamptz
         where id = ${m.record}`)
      await db.execute(sql`
        update api.report_definitions
           set project_id = ${m.seed.project}::uuid,
               created_at = ${created}::timestamptz,
               updated_at = ${updated}::timestamptz,
               last_saved_at = ${updated}::timestamptz
         where id = ${m.id}`)
      await db.execute(sql`
        update api.report_generations
           set created_at = ${updated}::timestamptz
         where report_id = ${m.id}`)
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger set_updated_at`)
  }
}

// Scheduled reports ----------------------------------------------------------

export async function seedDesignScheduledReports(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.scheduled_reports where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    const save = (
      name: string,
      kind: string,
      project: string | null,
      period: string,
      openHours: number,
      frequency: string,
      weekday: number,
      monthDay: number,
      hour: number,
      recipients: string[],
      active = true,
    ) =>
      client.query(
        'select api.save_scheduled_report(null,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12)',
        [
          name,
          kind,
          project,
          period,
          openHours,
          frequency,
          weekday,
          monthDay,
          hour,
          'Europe/London',
          recipients,
          active,
        ],
      )

    await save(
      'Weekly instrument usage',
      'instrument_usage',
      null,
      'previous_week',
      10,
      'weekly',
      1,
      1,
      8,
      [PEOPLE.gareth, PEOPLE.priya],
    )
    await save(
      'Monthly reagent spend',
      'spend',
      null,
      'previous_month',
      10,
      'monthly',
      1,
      1,
      9,
      [PEOPLE.gareth],
    )
    await save(
      'AAV9 transfer status, Fridays',
      'project_status',
      P.aav9,
      'last_7_days',
      10,
      'weekly',
      5,
      1,
      16,
      [PEOPLE.gareth, PEOPLE.tom, PEOPLE.sam],
    )
    await save(
      'Ambr 250 perfusion status',
      'project_status',
      P.ambr,
      'last_30_days',
      10,
      'monthly',
      1,
      15,
      8,
      [PEOPLE.priya],
      false,
    )
  })
}
