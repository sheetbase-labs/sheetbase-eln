/**
 * What EXP-0142 holds as evidence, as the Samples, Datasets and Files boards
 * show it: the twelve samples with their parents, volumes and boxes; four files
 * (two instrument exports, a plate export, the controlled protocol copy) with
 * the datasets each one fed; and the parse receipt on each link. Everything is
 * an idempotent upsert, so reseeding changes nothing once it exists.
 */
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const PROJECT = '00000000-0000-4000-8000-000000000320'
const EXP_0142 = '00000000-0000-4000-8000-000000000351'
const PRESSURE_FILE = '00000000-0000-4000-8000-000000000723'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** The filtrates: train and load, the box position, and one dilution. */
const SAMPLES: Array<[string, string, string, number, string]> = [
  ['SMP-2240', 'A-50 filtrate', 'Filtrate', 15, 'F-2, box 14, A1'],
  ['SMP-2241', 'A-100 filtrate', 'Filtrate', 15, 'F-2, box 14, A2'],
  ['SMP-2242', 'A-150 filtrate', 'Filtrate', 15, 'F-2, box 14, A3'],
  ['SMP-2243', 'B-50 filtrate', 'Filtrate', 15, 'F-2, box 14, A4'],
  ['SMP-2244', 'B-100 filtrate', 'Filtrate', 15, 'F-2, box 14, A5'],
  ['SMP-2245', 'B-150 filtrate', 'Filtrate', 15, 'F-2, box 14, A6'],
  ['SMP-2246', 'C-50 filtrate', 'Filtrate', 15, 'F-2, box 14, A7'],
  ['SMP-2247', 'C-100 filtrate', 'Filtrate', 15, 'F-2, box 14, A8'],
]

interface FileSpec {
  identifier: string
  name: string
  mediaType: string
  byteSize: number
  uploadedAt: string
  /** Datasets or a protocol the file fed, with what the parse reported. */
  feeds: Array<{
    kind: 'dataset' | 'protocol_template'
    identifier: string
    receipt: Record<string, unknown>
  }>
  text?: string
}

const FILES: FileSpec[] = [
  {
    identifier: 'FILE-0002',
    name: 'PR-01_EXP-0142_plates1-3.xlsx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: 219_136,
    uploadedAt: '2026-09-24T15:03:00Z',
    feeds: [
      {
        kind: 'dataset',
        identifier: 'DS-0311',
        receipt: {
          instrument: 'Plate reader PR-01',
          parser: 'PR-01 plate map v1.3',
          rows: 87,
          kind: 'Instrument export',
        },
      },
    ],
  },
  {
    identifier: 'FILE-0003',
    name: 'TB-02_turbidity_2026-09-24.csv',
    mediaType: 'text/csv',
    byteSize: 3_072,
    uploadedAt: '2026-09-24T14:59:00Z',
    feeds: [
      {
        kind: 'dataset',
        identifier: 'DS-0311',
        receipt: {
          instrument: 'Turbidimeter TB-02',
          parser: 'TB-02 CSV v1.0',
          rows: 9,
          kind: 'Instrument export',
        },
      },
    ],
    text: [
      'sample_id,reading_ntu,dilution,time',
      'SMP-2240,6.2,1,2026-09-24T15:31',
      'SMP-2241,9.8,1,2026-09-24T15:31',
      'SMP-2242,18.4,1,2026-09-24T15:37',
      'SMP-2243,4.1,1,2026-09-24T15:40',
      'SMP-2244,5.6,1,2026-09-24T15:43',
      'SMP-2245,8.9,1,2026-09-24T15:45',
      'SMP-2246,12.7,1,2026-09-24T15:52',
      'SMP-2247,24.3,1,2026-09-24T15:55',
      'SMP-2248,61.5,1,2026-09-24T15:58',
    ].join('\n'),
  },
  {
    identifier: 'FILE-0004',
    name: 'PRT-021_v3_depth_filtration.pdf',
    mediaType: 'application/pdf',
    byteSize: 1_258_291,
    uploadedAt: '2026-09-21T09:00:00Z',
    feeds: [
      {
        kind: 'protocol_template',
        identifier: 'PRT-021',
        receipt: { kind: 'Protocol, controlled copy', version: 3 },
      },
    ],
  },
  {
    identifier: 'FILE-0005',
    name: 'pressure_logger_trains_A-C.csv',
    mediaType: 'text/csv',
    byteSize: 41_984,
    uploadedAt: '2026-09-23T16:52:00Z',
    feeds: [
      {
        kind: 'dataset',
        identifier: 'DS-0310',
        receipt: {
          instrument: 'Pressure logger PL-8',
          parser: 'PL-8 log v1.0',
          rows: 27,
          kind: 'Instrument export',
        },
      },
    ],
    text: [
      'run,time_min,pressure_bar,flow_lpm',
      'A,0,0.20,1.20',
      'A,5,0.31,1.20',
      'A,10,0.44,1.19',
      'B,0,0.19,1.20',
      'B,5,0.28,1.21',
      'C,0,0.22,1.20',
    ].join('\n'),
  },
]

async function recordId(db: Db, identifier: string): Promise<string | null> {
  const found = await db.execute(sql`
    select id from api.records
     where workspace_id = ${PROCESS} and identifier = ${identifier}`)
  return (found.rows[0] as { id: string } | undefined)?.id ?? null
}

async function seedSamples(db: Db): Promise<void> {
  for (const [identifier, title, type, volume, place] of SAMPLES) {
    await db.execute(sql`
      update api.records
         set title = ${title},
             properties = ${JSON.stringify({
               quantity: volume,
               sampleType: type,
               quantityUnit: 'mL',
               storageLocation: place,
             })}::jsonb
       where workspace_id = ${PROCESS} and identifier = ${identifier}
         and properties = '{}'::jsonb`)
  }
}

async function seedFiles(db: Db): Promise<void> {
  // The pressure log is the fourth upload on the board; the other three were
  // seeded by the project's files step and are renamed to the board's.
  const existing = await recordId(db, 'FILE-0005')
  if (!existing) {
    await withDesignClaims(db, GARETH, PROCESS, async (client) => {
      await client.query(
        'select api.create_file_upload($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          PROJECT,
          'pressure_logger_trains_A-C.csv',
          'text/csv',
          41_984,
          `${PROCESS}/${PRESSURE_FILE}/${'4'.padStart(32, '0')}`,
          null,
          'local',
          PRESSURE_FILE,
        ],
      )
    })
  }
  for (const file of FILES) {
    const id = await recordId(db, file.identifier)
    if (!id) continue
    await db.execute(
      sql`alter table api.file_objects disable trigger change_event_file_objects`,
    )
    await db.execute(
      sql`alter table api.file_objects disable trigger protect_retained_file_object`,
    )
    await db.execute(
      sql`alter table api.records disable trigger prevent_locked_record_mutation`,
    )
    await db.execute(
      sql`alter table api.records disable trigger change_event_records`,
    )
    try {
      await db.execute(sql`
        update api.file_objects
           set display_name = ${file.name}, media_type = ${file.mediaType},
               byte_size = ${file.byteSize}, checksum = ${sha(file.name)},
               retention_until = ${'2041-09-24'},
               extracted_text = ${file.text ?? null},
               extracted_at = ${file.text ? file.uploadedAt : null}
         where record_id = ${id}`)
      await db.execute(sql`
        update api.records
           set title = ${file.name}, created_at = ${file.uploadedAt},
               created_by_user_id = ${GARETH}
         where id = ${id}`)
    } finally {
      await db.execute(
        sql`alter table api.file_objects enable trigger change_event_file_objects`,
      )
      await db.execute(
        sql`alter table api.file_objects enable trigger protect_retained_file_object`,
      )
      await db.execute(
        sql`alter table api.records enable trigger prevent_locked_record_mutation`,
      )
      await db.execute(
        sql`alter table api.records enable trigger change_event_records`,
      )
    }
    // The experiment holds the file.
    const held = await db.execute(sql`
      select 1 from api.record_links
       where source_record_id = ${EXP_0142} and target_record_id = ${id}
         and link_type = 'file' limit 1`)
    if (held.rows.length === 0) {
      await db.execute(sql`
        insert into api.record_links
          (source_record_id, target_record_id, target_kind, target_identifier,
           link_type, created_by_user_id)
        values (${EXP_0142}, ${id}, 'file', ${file.identifier}, 'file', ${GARETH})`)
    }
    // What the file fed, with the parse receipt.
    for (const feed of file.feeds) {
      const targetId =
        feed.kind === 'protocol_template'
          ? await recordId(db, feed.identifier)
          : null
      await db.execute(sql`
        insert into api.record_links
          (source_record_id, target_record_id, target_kind, target_identifier,
           link_type, link_metadata, created_by_user_id)
        values (${id}, ${targetId}, ${feed.kind}, ${feed.identifier},
                ${feed.kind === 'dataset' ? 'dataset' : 'protocol'},
                ${JSON.stringify(feed.receipt)}::jsonb, ${GARETH})
        on conflict (source_record_id, target_identifier, link_type) do nothing`)
    }
  }
}

export async function seedDesignExperimentEvidence(db: Db): Promise<void> {
  await seedSamples(db)
  await seedFiles(db)
}
