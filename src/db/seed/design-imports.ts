/**
 * Two stored import files, so the Import map and review screens can be reached
 * from the design data: a plate export that maps onto the planned ELISA
 * dataset (with a high-CV replicate and a control), and an export the parser
 * cannot read (the Import failed board). The bytes are written to the local
 * object store the way an upload would leave them. Idempotent.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'

export const IMPORT_FILES = {
  plate: {
    id: '00000000-0000-4000-8000-000000000731',
    name: 'PR-01_EXP-0142_plate4.csv',
    text: [
      'Sample,Well,Dilution,Capsid titre (×10¹⁰ vg/mL),Note',
      'SMP-2249,G1,400,5.2,',
      'SMP-2249,G2,400,5.0,',
      'SMP-2251,G3,400,4.8,',
      'SMP-2251,G4,400,4.9,',
      'SMP-2253,H7,2000,5.5,Above curve (OD > 3.0)',
      'SMP-2253,H8,2000,3.9,Replicate CV 31 %',
      'BLANK,A12,,0.0,Control',
    ].join('\n'),
  },
  failed: {
    id: '00000000-0000-4000-8000-000000000732',
    name: 'TB02_turbidity_2026-09-25.csv',
    text: [
      'Sample,NTU,Dil,Timestamp',
      'SMP-2250,12.4,1,2026-09-25T09:02:11',
      'SMP-2251,13.1,1,2026-09-25T09:02:41',
      'SMP-2252,12.8,1,2026-09-25T09:03:10',
    ].join('\n'),
  },
} as const

async function store(
  db: Db,
  file: { id: string; name: string; text: string },
): Promise<void> {
  const found = await db.execute(
    sql`select 1 from api.dataset_import_files where workspace_id = ${PROCESS} and filename = ${file.name}`,
  )
  if (found.rows.length > 0) return
  const bytes = Buffer.from(file.text, 'utf8')
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const key = `${PROCESS}/${file.id}/${createHash('md5').update(file.id).digest('hex')}`
  const target = resolve(
    process.env.FILE_STORAGE_DIR ?? './.storage/objects',
    key,
  )
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  await withDesignClaims(db, GARETH, PROCESS, async (client) => {
    await client.query(
      'select * from api.create_dataset_import_file($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        PROCESS,
        file.name,
        'text/csv',
        bytes.byteLength,
        checksum,
        key,
        'csv',
        null,
      ],
    )
  })
}

export async function seedDesignImports(db: Db): Promise<void> {
  for (const file of Object.values(IMPORT_FILES)) await store(db, file)
}
