/**
 * Plate runs for the demo: a capsid ELISA read on the plate reader, analysed
 * against its standard curve with the same analysis the Plates page runs, and a
 * second plate laid out and waiting for its readout. The numbers come from a
 * four-parameter curve with a little reproducible noise, so the fit, the
 * replicate spread and the quality checks are real results, not pasted ones.
 */
import { sql } from 'drizzle-orm'

import { analysePlate, defaultAssayConfig } from '#/lib/plate-assay'
import type { AssayWell, PlateReadout } from '#/lib/plate-assay'
import {
  PEOPLE,
  PROCESS,
  daysBefore,
  inTransaction,
  recordIds,
  required,
} from './design-operations'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const AAV9 = '00000000-0000-4000-8000-000000000320'
const ELISA_PROJECT = '00000000-0000-4000-8000-00000000032b'

/** A small, repeatable pseudo-random sequence so a reseed gives the same plate. */
function noise(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296

    return state / 4_294_967_296 - 0.5
  }
}

const fourPl = (conc: number) => {
  const [a, b, c, d] = [0.05, 1.15, 14, 2.65]

  return d + (a - d) / (1 + (conc / c) ** b)
}

const STANDARDS = [64, 32, 16, 8, 4, 2, 1, 0.5] as const
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

const SAMPLE_IDS = [
  'SMP-2240',
  'SMP-2241',
  'SMP-2242',
  'SMP-2243',
  'SMP-2244',
  'SMP-2245',
  'SMP-2246',
  'SMP-2247',
] as const

/** Concentration in the well, ng/mL, after the 1:50 dilution. */
const SAMPLE_CONC = [18, 22, 15, 31, 27, 9.5, 12, 24] as const

export async function seedDesignPlates(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.plate_runs where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const samples = await recordIds(db, SAMPLE_IDS)
  const rnd = noise(2609)
  const wells: AssayWell[] = []
  const readout: PlateReadout = {}

  const add = (well: AssayWell, value: number) => {
    wells.push(well)
    readout[well.wellCode] =
      Math.round((value + rnd() * 0.05 * Math.max(0.2, value)) * 1000) / 1000
  }

  // Standards in columns 1 and 2, blanks in column 3, samples in duplicate down
  // columns 4 to 11 (a pair of rows each: A/B and E/F).
  for (const [i, conc] of STANDARDS.entries()) {
    for (const col of [1, 2]) {
      add(
        {
          wellCode: `${ROWS[i]}${col}`,
          role: 'standard',
          concentration: conc,
          concentrationUnit: 'ng/mL',
          sampleLabel: `Standard ${i + 1}`,
        },
        fourPl(conc),
      )
    }
  }

  for (const row of ['A', 'B', 'C', 'D']) {
    add({ wellCode: `${row}3`, role: 'blank', sampleLabel: 'Diluent' }, 0.052)
  }

  for (const [i, identifier] of SAMPLE_IDS.entries()) {
    const col = 4 + i

    for (const row of ['A', 'B']) {
      add(
        {
          wellCode: `${row}${col}`,
          role: 'sample',
          sampleId: samples.get(identifier) ?? null,
          sampleLabel: identifier,
          dilution: 50,
        },
        fourPl(SAMPLE_CONC[i] ?? 10),
      )
    }
  }

  const config = {
    ...defaultAssayConfig(),
    method: 'quantify' as const,
    dilutionFactor: 50,
    subtractBlank: true,
  }

  let runId = ''
  let version = 1

  await inTransaction(db, PEOPLE.tom, async (client) => {
    const run = await client.query<{ id: string; metadata_version: number }>(
      `select id, metadata_version from api.create_plate_run($1,'96_well',$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null)`,
      [
        'Capsid ELISA plate 4, filtrate titre',
        JSON.stringify(wells),
        JSON.stringify(readout),
        JSON.stringify(config),
        AAV9,
      ],
    )

    runId = required(run.rows[0]?.id, 'row')
    version = run.rows[0]?.metadata_version ?? 1

    const analysis = analysePlate(wells, readout, config)

    await client.query(
      'select api.save_plate_run_analysis($1,$2::jsonb,$3,$4)',
      [runId, JSON.stringify(analysis), analysis.qc.status, version],
    )

    // A second plate: laid out for tomorrow's screen, no readout yet.
    const planned: AssayWell[] = []

    for (const [r, row] of ROWS.entries()) {
      for (let col = 1; col <= 12; col++) {
        planned.push({
          wellCode: `${row}${col}`,
          role:
            col === 1
              ? 'negative_control'
              : col === 12
                ? 'positive_control'
                : r === 0 && col === 2
                  ? 'blank'
                  : 'sample',
          sampleLabel:
            col > 1 && col < 12
              ? `Medium ${((col - 2) % 5) + 1}, donor ${(r % 4) + 1}`
              : null,
        })
      }
    }

    await client.query(
      `select id from api.create_plate_run($1,'96_well',$2::jsonb,'{}'::jsonb,$3::jsonb,$4,null,null)`,
      [
        'T-cell medium viability screen',
        JSON.stringify(planned),
        JSON.stringify(defaultAssayConfig()),
        AAV9,
      ],
    )
  })

  // Made under a project the demo user can edit, then filed where it belongs.
  await db.execute(sql`
    update api.plate_runs
       set project_id = case when id = ${runId} then ${ELISA_PROJECT}::uuid
                        else '00000000-0000-4000-8000-000000000323'::uuid end
     where workspace_id = ${PROCESS}`)
  await db.execute(sql`
    update api.plate_runs
       set created_at = ${daysBefore(9)}::timestamptz, analysed_at = ${daysBefore(9, 5)}::timestamptz
     where id = ${runId}`)
}
