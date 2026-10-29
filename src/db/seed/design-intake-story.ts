/**
 * The TB-02 turbidimeter gets a firmware update, and its export changes: a
 * block of details above the table, semicolons, decimal commas and the unit in
 * the column name. The parser that read the old export can't read the new one,
 * so two files arrive and fail. An admin describes the new layout as a parser,
 * tries the first file again with it (it reads), and starts a second version
 * that is still waiting to be approved. The second file's problem is still
 * open, so "Try again" can be shown working on the live site.
 *
 * The files' bytes are in demo-files.json so the app can keep them in its own
 * object store (scripts/stage-demo-files.mjs does that at start-up).
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { and, eq, sql } from 'drizzle-orm'

import * as schema from '../schema'
import type { ParserLayout } from '#/lib/import/parser-layout'
import { describeIntakeFailure } from '#/lib/connectors/intake.server'
import demoFiles from './demo-files.json' with { type: 'json' }
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const PROJECT = '00000000-0000-4000-8000-000000000320'
const TB02 = '00000000-0000-4000-8000-0000000003a7'
const OLD_PARSER = 'tb_02_csv'
const NEW_PARSER = 'tb_02_fw4_csv'

interface DemoFile {
  id: string
  name: string
  text: string
}

export const DEMO_FILES: DemoFile[] = demoFiles

/** Where a demo file's bytes live in the object store. */
export function demoFileKey(file: { id: string }): string {
  return `${PROCESS}/${file.id}/${createHash('md5').update(file.id).digest('hex')}`
}

const DAY = (n: number, time: string) => {
  const d = new Date('2026-09-25T00:00:00+01:00')
  d.setDate(d.getDate() - n)
  return new Date(`${d.toISOString().slice(0, 10)}T${time}+01:00`)
}

export const FW4_LAYOUT: ParserLayout = {
  delimiter: 'semicolon',
  headerStartsWith: 'Sample',
  readDetails: true,
  units: 'header',
  decimalComma: true,
}

export async function seedDesignIntakeStory(db: Db): Promise<void> {
  const oldParser = await db
    .select({ id: schema.parsers.id })
    .from(schema.parsers)
    .where(
      and(
        eq(schema.parsers.workspaceId, PROCESS),
        eq(schema.parsers.key, OLD_PARSER),
      ),
    )
    .then((rows) => rows.at(0))
  const instrument = await db
    .select({ id: schema.instruments.id })
    .from(schema.instruments)
    .where(eq(schema.instruments.id, TB02))
    .then((rows) => rows.at(0))
  if (!oldParser || !instrument) return
  const done = await db
    .select({ id: schema.connectors.id })
    .from(schema.connectors)
    .where(
      and(
        eq(schema.connectors.workspaceId, PROCESS),
        eq(schema.connectors.key, 'tb-02-folder'),
      ),
    )
    .then((rows) => rows.at(0))
  if (done) return

  // Where TB-02 readings go: a small schema, with a dataset made on first read.
  const schemaVersionId = await withDesignClaims(
    db,
    GARETH,
    PROCESS,
    async (client) => {
      const created = await client.query(
        'select api.create_dataset_schema_definition($1,$2,$3,$4,$5::jsonb) as result',
        [
          PROCESS,
          'tb02_turbidity',
          'TB-02 turbidity',
          'Harvest turbidity read on the TB-02',
          JSON.stringify([
            {
              key: 'sample',
              label: 'Sample',
              logical_type: 'text',
              nullable: false,
              validation: {},
              display_order: 1,
            },
            {
              key: 'turbidity',
              label: 'Turbidity',
              logical_type: 'decimal',
              nullable: false,
              validation: {},
              display_order: 2,
            },
            {
              key: 'dilution',
              label: 'Dilution',
              logical_type: 'integer',
              nullable: true,
              validation: {},
              display_order: 3,
            },
          ]),
        ],
      )
      const versionId = created.rows[0].result.schema_version_id as string
      await client.query('select api.publish_dataset_schema_version($1)', [
        versionId,
      ])
      return versionId
    },
  )

  // The old parser reads the old export. Give it the columns it looks for.
  await db.execute(sql`
    update api.parser_versions
       set signature = '{"requiredHeaders": ["sample", "turbidity", "dilution"]}'::jsonb
     where parser_id = ${oldParser.id} and version = 1`)

  const [parser] = await db
    .insert(schema.parsers)
    .values({
      workspaceId: PROCESS,
      instrumentId: TB02,
      key: NEW_PARSER,
      name: 'TB-02 CSV, firmware 4',
      format: 'csv',
      createdByUserId: GARETH,
    })
    .returning({ id: schema.parsers.id })
  const signature = {
    requiredHeaders: ['sample', 'turbidity', 'dilution'],
    layout: FW4_LAYOUT,
  }
  const [v1] = await db
    .insert(schema.parserVersions)
    .values({
      workspaceId: PROCESS,
      parserId: parser.id,
      version: 1,
      status: 'approved',
      signature,
      testResult: {
        ok: true,
        rowCount: 3,
        headers: ['Sample', 'Turbidity', 'Dilution', 'Timestamp'],
        fileName: DEMO_FILES[0].name,
      },
      validatedAt: DAY(0, '10:21:00'),
      approvedByUserId: GARETH,
      approvedAt: DAY(0, '10:24:00'),
      createdByUserId: GARETH,
      createdAt: DAY(0, '10:18:00'),
    })
    .returning({ id: schema.parserVersions.id })
  await db.insert(schema.parserVersions).values({
    workspaceId: PROCESS,
    parserId: parser.id,
    version: 2,
    status: 'validated',
    signature: {
      ...signature,
      layout: { ...FW4_LAYOUT, stopAt: 'Summary' },
    },
    testResult: {
      ok: true,
      rowCount: 4,
      headers: ['Sample', 'Turbidity', 'Dilution', 'Timestamp'],
      fileName: DEMO_FILES[1].name,
    },
    validatedAt: DAY(0, '10:44:00'),
    createdByUserId: GARETH,
    createdAt: DAY(0, '10:40:00'),
  })

  const [connector] = await db
    .insert(schema.connectors)
    .values({
      workspaceId: PROCESS,
      key: 'tb-02-folder',
      name: 'TB-02 results folder',
      connectorType: 'instrument',
      direction: 'inbound',
      status: 'active',
      parserId: NEW_PARSER,
      config: {
        pickup: {
          projectId: PROJECT,
          schemaVersionId,
          autoDetect: false,
          datasetNamePattern: 'TB-02 turbidity · {file}',
          instrumentId: TB02,
        },
      },
      createdByUserId: GARETH,
      createdAt: DAY(30, '09:00:00'),
    })
    .returning({ id: schema.connectors.id })

  const storageRoot = resolve(
    process.env.FILE_STORAGE_DIR ?? './.storage/objects',
  )
  const kept: Array<{ recordId: string; checksum: string; size: number }> = []
  for (const [n, file] of DEMO_FILES.entries()) {
    const bytes = Buffer.from(file.text, 'utf8')
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const key = demoFileKey(file)
    const target = resolve(storageRoot, key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    const recordId = `00000000-0000-4000-8000-00000000075${n + 1}`
    await db.insert(schema.records).values({
      id: recordId,
      workspaceId: PROCESS,
      projectId: PROJECT,
      kind: 'file',
      identifier: `TB02-FW4-${n + 1}`,
      title: file.name,
      status: 'active',
      tags: [],
      createdByUserId: GARETH,
      createdAt: DAY(0, n === 0 ? '09:58:00' : '10:03:00'),
    })
    await db.insert(schema.fileObjects).values({
      workspaceId: PROCESS,
      recordId,
      storageKey: key,
      displayName: file.name,
      mediaType: 'text/csv',
      byteSize: BigInt(bytes.byteLength),
      checksum,
      status: 'active',
      storageBackend: 'local',
      version: 1,
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
    kept.push({ recordId, checksum, size: bytes.byteLength })
  }

  const reason = describeIntakeFailure('parser_unrecognised', {
    parser: 'TB-02 CSV',
  })
  const target = {
    projectId: PROJECT,
    schemaVersionId,
    datasetId: null,
    newDatasetName: 'TB-02 turbidity readings',
  }
  const failedRun = async (n: number, at: Date) => {
    const [run] = await db
      .insert(schema.connectorRuns)
      .values({
        workspaceId: PROCESS,
        connectorId: connector.id,
        triggerKind: 'event',
        status: 'failed',
        attempt: 1,
        requestDigest: `tb02-fw4-${n}`,
        result: { fileName: DEMO_FILES[n].name },
        errorCode: 'parser_unrecognised',
        errorMessage: reason,
        startedAt: at,
        finishedAt: new Date(at.getTime() + 1_500),
        actorUserId: GARETH,
        createdAt: at,
      })
      .returning({ id: schema.connectorRuns.id })
    return run.id
  }
  const firstFailed = await failedRun(0, DAY(0, '09:58:20'))
  const secondFailed = await failedRun(1, DAY(0, '10:03:10'))
  // The admin tried the first file again once the new parser was approved.
  const [retried] = await db
    .insert(schema.connectorRuns)
    .values({
      workspaceId: PROCESS,
      connectorId: connector.id,
      triggerKind: 'manual',
      status: 'succeeded',
      attempt: 2,
      retryOfRunId: firstFailed,
      requestDigest: 'tb02-fw4-0-retry',
      result: {
        kind: 'instrument_ingestion',
        fileName: DEMO_FILES[0].name,
        rowCount: 3,
        parser: `${NEW_PARSER}@1`,
        instrumentMetadata: {
          Firmware: '4.0.2',
          Serial: 'TB02-0117',
          Operator: 'Mei',
          'Turbidity unit': 'NTU',
        },
      },
      startedAt: DAY(0, '10:34:05'),
      finishedAt: DAY(0, '10:34:07'),
      actorUserId: GARETH,
      createdAt: DAY(0, '10:34:05'),
    })
    .returning({ id: schema.connectorRuns.id })

  const insertProblem = (
    n: number,
    runId: string,
    status: 'open' | 'resolved',
  ) =>
    db.execute(sql`
      insert into api.intake_failures
        (workspace_id, connector_id, instrument_id, connector_run_id, file_record_id, file_name,
         checksum, byte_size, source, code, message, parser_key, target, status, attempts,
         created_at, updated_at, last_attempt_at, resolved_at, resolved_by_user_id, resolved_run_id)
      values
        (${PROCESS}, ${connector.id}, ${TB02}, ${runId}, ${kept[n].recordId}, ${DEMO_FILES[n].name},
         ${kept[n].checksum}, ${kept[n].size}, 'agent', 'parser_unrecognised', ${reason}, ${OLD_PARSER},
         ${JSON.stringify(target)}::jsonb, ${status}, ${status === 'resolved' ? 2 : 1},
         ${(n === 0 ? DAY(0, '09:58:20') : DAY(0, '10:03:10')).toISOString()},
         ${(status === 'resolved' ? DAY(0, '10:34:07') : DAY(0, '10:03:10')).toISOString()},
         ${(status === 'resolved' ? DAY(0, '10:34:05') : DAY(0, '10:03:10')).toISOString()},
         ${status === 'resolved' ? DAY(0, '10:34:07').toISOString() : null},
         ${status === 'resolved' ? GARETH : null},
         ${status === 'resolved' ? retried.id : null})`)
  await insertProblem(0, firstFailed, 'resolved')
  await insertProblem(1, secondFailed, 'open')
  void v1
}
