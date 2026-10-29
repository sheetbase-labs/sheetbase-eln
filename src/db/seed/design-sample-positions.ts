/**
 * Where the demo samples sit, and what releases them. Samples whose typed
 * place names one free position are filed by the same matcher the Storage page
 * offers; the rest are placed by hand the way a person would. A few keep typed
 * places on purpose (the cold-room shelves, the plate), so the fallback and the
 * "not in a box" count show. Harvest samples need a turbidity reading in range,
 * and SMP-2251 gets its reading from the TB-02 file, so its release check can
 * pass from real instrument data.
 */
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { DEMO_FILES, FW4_LAYOUT } from './design-intake-story'
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'
import { sampleResultsFromPayload } from '#/lib/connectors/run-results'
import { readWithLayout } from '#/lib/import/parser-layout'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const PROJECT = '00000000-0000-4000-8000-000000000320'
const TB02 = '00000000-0000-4000-8000-0000000003a7'
const FILE_RECORD = '00000000-0000-4000-8000-000000000751'

/** Sample → box code and position. */
const PLACEMENTS = [
  ['SMP-1002', 'CB-1', 'A1'],
  ['SMP-2214', 'CB-1', 'A2'],
  ['SMP-2227', 'CB-2', 'A4'],
  ['SMP-2220', 'BX-7B', 'A1'],
  ['SMP-2236', 'BX-2', 'A1'],
  ['SMP-2251', 'BX-15', 'A1'],
] as const

export async function seedDesignSamplePositions(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.storage_movements where workspace_id = ${PROCESS} limit 1`)
  if (done.rows.length) return
  const pending = await db.execute(sql`
    select 1 from api.storage_sites where workspace_id = ${PROCESS} limit 1`)
  if (!pending.rows.length) return

  // The Storage page's own matcher files the samples that name one position.
  await db.execute(sql`
    select internal.match_sample_locations(${PROCESS}::uuid, ${GARETH}::text)`)

  await withDesignClaims(db, GARETH, PROCESS, async (client) => {
    for (const [identifier, box, label] of PLACEMENTS) {
      const found = await client.query<{
        record_id: string
        position_id: string
        version: number
      }>(
        `select r.id as record_id, p.id as position_id, r.metadata_version as version
           from api.records r, api.storage_positions p
           join api.storage_boxes b on b.id = p.box_id
          where r.workspace_id = $1 and r.kind = 'sample' and r.identifier = $2
            and b.code = $3 and p.label = $4 and p.status = 'available'`,
        [PROCESS, identifier, box, label],
      )
      const row = found.rows.at(0)
      if (!row) continue
      await client.query(
        `select api.move_sample_to_position($1, $2, $3, null)`,
        [row.record_id, row.position_id, row.version],
      )
    }

    // Harvest samples are released on a turbidity reading that is in range.
    await client.query(
      `select api.set_sample_release_rules($1, 'Harvest', $2::jsonb)`,
      [
        PROCESS,
        JSON.stringify([
          { kind: 'no_result', result: 'fail', label: 'No failed measurement' },
          {
            kind: 'measurement_range',
            measurement: 'Turbidity',
            max: 15,
            label: 'Turbidity at most 15 NTU',
          },
        ]),
      ],
    )

    // The TB-02 run that read the first file, with a result for each sample in it.
    const file = DEMO_FILES[0]
    const checksum = createHash('sha256').update(file.text).digest('hex')
    const run = (
      await client.query<{ id: string }>(
        `select id from api.create_instrument_run(
           p_workspace_id => $1, p_name => $2, p_run_identifier => $3,
           p_instrument_id => $4, p_project_id => $5, p_tags => $6)`,
        [
          PROCESS,
          file.name,
          `pickup-${checksum.slice(0, 16)}`,
          TB02,
          PROJECT,
          ['pickup'],
        ],
      )
    ).rows[0]
    await client.query(`select api.start_instrument_run($1, $2)`, [
      PROCESS,
      run.id,
    ])
    await client.query(`select api.link_run_record($1, $2, $3, 'file')`, [
      PROCESS,
      run.id,
      FILE_RECORD,
    ])
    await client.query(`select api.complete_instrument_run($1, $2)`, [
      PROCESS,
      run.id,
    ])
    const results = sampleResultsFromPayload(
      readWithLayout(file.text, FW4_LAYOUT),
    )
    await client.query(
      `select api.record_run_sample_results($1, $2, $3::jsonb)`,
      [PROCESS, run.id, JSON.stringify(results)],
    )
  })
}
