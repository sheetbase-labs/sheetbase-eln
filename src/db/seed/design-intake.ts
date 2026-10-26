/**
 * How the design's instruments deliver data: a parser with an approved version
 * for every instrument that drops files or posts results, and the imports each
 * one has committed (or, for TB-02 and the pressure logger, failed). The
 * Instruments registry reads its health from exactly these rows, so a
 * connected instrument reads Healthy and a failing one says so.
 */
import { and, desc, eq } from 'drizzle-orm'

import * as schema from '../schema'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const DS_AMBR = '00000000-0000-4000-8000-000000000380'
const DS_YIELD = '00000000-0000-4000-8000-000000000381'
const INS = (n: number) =>
  `00000000-0000-4000-8000-0000000003${(0xa0 + n).toString(16)}`
const AMBR = '00000000-0000-4000-8000-0000000003e1'
const PR01 = '00000000-0000-4000-8000-0000000003e0'

interface Intake {
  instrumentId: string
  key: string
  parser: string
  format: 'csv' | 'xlsx' | 'json'
  datasetId: string
  /** ISO times of the imports, with how each ended. */
  imports: Array<{ at: string; status: 'committed' | 'failed' }>
}

const DAY = (n: number, time: string) => {
  const d = new Date('2026-09-25T00:00:00+01:00')
  d.setDate(d.getDate() - n)
  return `${d.toISOString().slice(0, 10)}T${time}+01:00`
}

const INTAKES: Intake[] = [
  {
    instrumentId: AMBR,
    key: 'ambr_250_csv',
    parser: 'Ambr 250 CSV v2.1',
    format: 'csv',
    datasetId: DS_AMBR,
    imports: [6, 5, 4, 3, 2, 1, 0].map((n) => ({
      at: DAY(n, '09:12:00'),
      status: 'committed' as const,
    })),
  },
  {
    instrumentId: PR01,
    key: 'pr_01_webhook',
    parser: 'CLARIOstar results v1.4',
    format: 'json',
    datasetId: DS_YIELD,
    imports: [{ at: DAY(0, '10:11:00'), status: 'committed' }],
  },
  {
    instrumentId: INS(4),
    key: 'akta_csv',
    parser: 'ÄKTA run export v1.0',
    format: 'csv',
    datasetId: DS_YIELD,
    imports: [{ at: DAY(14, '10:00:00'), status: 'committed' }],
  },
  {
    instrumentId: INS(5),
    key: 'vicell_csv',
    parser: 'Vi-CELL BLU export v1.2',
    format: 'csv',
    datasetId: DS_AMBR,
    imports: [{ at: DAY(1, '16:30:00'), status: 'committed' }],
  },
  {
    instrumentId: INS(7),
    key: 'tb_02_csv',
    parser: 'TB-02 CSV v1.0',
    format: 'csv',
    datasetId: DS_YIELD,
    imports: [
      { at: DAY(1, '16:04:00'), status: 'committed' },
      { at: DAY(0, '09:58:00'), status: 'failed' },
    ],
  },
  {
    instrumentId: INS(9),
    key: 'qx600_csv',
    parser: 'QX600 export v1.1',
    format: 'csv',
    datasetId: DS_YIELD,
    imports: [{ at: DAY(1, '14:00:00'), status: 'committed' }],
  },
  {
    instrumentId: INS(11),
    key: 'pl_8_csv',
    parser: 'PL-8 log v1.0',
    format: 'csv',
    datasetId: DS_YIELD,
    imports: [{ at: DAY(7, '11:00:00'), status: 'failed' }],
  },
]

export async function seedDesignIntake(db: Db) {
  for (const intake of INTAKES) {
    const present = await db
      .select({ id: schema.instruments.id })
      .from(schema.instruments)
      .where(eq(schema.instruments.id, intake.instrumentId))
    if (!present.length) continue

    const [existing] = await db
      .select({ id: schema.parsers.id })
      .from(schema.parsers)
      .where(
        and(
          eq(schema.parsers.workspaceId, PROCESS),
          eq(schema.parsers.key, intake.key),
        ),
      )
    if (existing) continue
    const [parser] = await db
      .insert(schema.parsers)
      .values({
        workspaceId: PROCESS,
        instrumentId: intake.instrumentId,
        key: intake.key,
        name: intake.parser,
        format: intake.format,
        createdByUserId: GARETH,
      })
      .returning({ id: schema.parsers.id })
    const [version] = await db
      .insert(schema.parserVersions)
      .values({
        workspaceId: PROCESS,
        parserId: parser.id,
        version: 1,
        status: 'approved',
        validatedAt: new Date(DAY(30, '09:00:00')),
        approvedByUserId: GARETH,
        approvedAt: new Date(DAY(30, '09:30:00')),
        createdByUserId: GARETH,
      })
      .returning({ id: schema.parserVersions.id })
    const [snapshot] = await db
      .select({ id: schema.datasetVersions.id })
      .from(schema.datasetVersions)
      .where(eq(schema.datasetVersions.datasetId, intake.datasetId))
      .orderBy(desc(schema.datasetVersions.createdAt))
      .limit(1)

    for (const [n, entry] of intake.imports.entries()) {
      const at = new Date(entry.at)
      const checksum = `${intake.key.length.toString(16)}${n}`.padEnd(64, 'a')
      const [file] = await db
        .insert(schema.datasetImportFiles)
        .values({
          workspaceId: PROCESS,
          datasetId: intake.datasetId,
          filename: `${intake.key}_${at.toISOString().slice(0, 10)}.${intake.format}`,
          mediaType: 'text/csv',
          byteSize: 48_000n,
          checksum,
          storageKey: `design/${intake.key}/${n}`,
          format: intake.format,
          status: entry.status === 'failed' ? 'failed' : 'parsed',
          parseError:
            entry.status === 'failed' ? 'Column "Turbidity" not found' : null,
          createdByUserId: GARETH,
          createdAt: at,
        })
        .returning({ id: schema.datasetImportFiles.id })
      await db.insert(schema.datasetImports).values({
        workspaceId: PROCESS,
        datasetId: intake.datasetId,
        instrumentId: intake.instrumentId,
        parserId: parser.id,
        parserVersionId: version.id,
        fileId: file.id,
        status: entry.status,
        errorDetail:
          entry.status === 'failed' ? 'Column "Turbidity" not found' : null,
        snapshotVersionId: entry.status === 'committed' ? snapshot?.id : null,
        idempotencyKey: `design-intake:${intake.key}:${n}`,
        createdByUserId: GARETH,
        createdAt: at,
        updatedAt: at,
      })
    }
  }
}
