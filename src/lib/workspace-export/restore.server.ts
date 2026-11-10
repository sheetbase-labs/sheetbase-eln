/**
 * Puts a workspace archive (an export or a backup) back into a database.
 *
 * It is meant for an empty, migrated database on the same version of
 * Sheetbase: a new deployment, or a rehearsal. The archive's rows are inserted
 * as they were, in one transaction, with triggers off so the audit trail and
 * signed revisions arrive exactly as they were written rather than being
 * recorded again. Files are written to the configured storage first, each
 * checked against the hash in the manifest.
 *
 * What an archive never holds (password hashes, API keys, sign-in secrets) is
 * not restored: people sign in again, and API keys and webhook secrets are
 * created again. Tables that depend on such a secret are skipped and named in
 * the report.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { Unzip, UnzipInflate } from 'fflate'
import { z } from 'zod'

import type { ObjectStorage } from '#/lib/file-storage/types'

import type { ArchiveConnection } from './archive.server'
import { ARCHIVE_FORMAT_VERSION } from './format'

const INSERT_BATCH = 500

/** Ceiling on one restored file, matching the largest the product accepts. */
const FILE_MAX_BYTES = 1024 * 1024 * 1024

export interface RestoreReport {
  workspaceId: string
  tables: { name: string; rows: number }[]
  skippedTables: { name: string; reason: string }[]
  files: number
  missingFiles: number
  dryRun: boolean
}

// Restore skips entries with absent or falsy paths or hashes.
const optionalArchiveString = z
  .union([z.string(), z.literal(false), z.literal(0), z.null()])
  .optional()

const manifestSchema = z.looseObject({
  workspace: z.looseObject({ id: z.string() }),
  tables: z.array(
    z.looseObject({
      name: z.string(),
      rows: z.number(),
      path: optionalArchiveString,
      sha256: optionalArchiveString,
      droppedColumns: z.array(z.unknown()),
    }),
  ),
  files: z.array(
    z.looseObject({
      id: z.unknown().optional(),
      path: optionalArchiveString,
      sha256: optionalArchiveString,
      status: z.unknown().optional(),
    }),
  ),
})

export class RestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreError'
  }
}

/** Unpacks an archive to a directory without holding it in memory. */
export async function extractArchive(
  zipPath: string,
  directory: string,
): Promise<void> {
  const root = resolve(directory)
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  const writers: Promise<void>[] = []
  let failure: RestoreError | null = null
  unzip.onfile = (file) => {
    if (file.name.endsWith('/')) return
    const target = resolve(root, file.name)

    // An archive is untrusted input: refuse a path that leaves the folder.
    if (!target.startsWith(root + sep)) {
      failure = new RestoreError(`unsafe path in archive: ${file.name}`)

      return
    }

    const done = (async () => {
      await mkdir(dirname(target), { recursive: true })
      const out = createWriteStream(target, { flags: 'wx', mode: 0o600 })
      await new Promise<void>((resolveFile, reject) => {
        file.ondata = (error, chunk, final) => {
          if (error) {
            reject(error)

            return
          }

          out.write(chunk)

          if (final) out.end(() => resolveFile())
        }

        out.on('error', reject)
        file.start()
      })
    })()

    writers.push(done)
  }

  for await (const chunk of createReadStream(zipPath)) {
    // SAFETY: A file read stream without an encoding yields Buffer chunks.
    unzip.push(chunk as Uint8Array)

    // unzip.push invokes onfile synchronously, which can assign failure.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (failure) throw failure
  }

  unzip.push(new Uint8Array(0), true)
  await Promise.all(writers)

  // The final unzip.push can invoke onfile and assign failure as well.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (failure) throw failure
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')

  for await (const chunk of createReadStream(path)) {
    // SAFETY: A file read stream without an encoding yields Buffer chunks.
    hash.update(chunk as Uint8Array)
  }

  return hash.digest('hex')
}

const identifier = (name: string) => `"${name.replace(/"/g, '""')}"`

async function insertTable(
  conn: ArchiveConnection,
  name: string,
  path: string,
): Promise<number> {
  const [schema, table] = name.split('.')
  const target = `${identifier(schema)}.${identifier(table)}`

  const { rows: columnRows } = await conn.query<{ name: string }>(
    `SELECT a.attname::text AS name
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = ''`,
    [target],
  )

  const columns = new Set(columnRows.map((r) => r.name))
  const readable = Readable.from(createReadStream(path, 'utf8'))
  let carry = ''
  let batch: string[] = []
  let total = 0

  const flush = async () => {
    if (batch.length === 0) return
    // Only the columns the archive has: the rest take their defaults.
    const present = new Set<string>()

    for (const line of batch) {
      // Preserve native key enumeration; PostgreSQL validates inserted row shape.
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
      for (const key of Object.keys(JSON.parse(line) as object)) {
        if (columns.has(key)) present.add(key)
      }
    }

    const list = [...present].map(identifier).join(', ')
    await conn.query(
      `INSERT INTO ${target} (${list})
       SELECT ${list} FROM jsonb_populate_recordset(NULL::${target}, $1::jsonb)
       ${name === 'internal.user' ? 'ON CONFLICT (id) DO NOTHING' : ''}`,
      [`[${batch.join(',')}]`],
    )
    total += batch.length
    batch = []
  }

  for await (const piece of readable) {
    // SAFETY: The underlying file stream was opened with UTF-8 encoding.
    carry += piece as string
    const lines = carry.split('\n')
    carry = lines.pop() ?? ''

    for (const line of lines) {
      if (!line) continue
      batch.push(line)

      if (batch.length >= INSERT_BATCH) await flush()
    }
  }

  if (carry) batch.push(carry)
  await flush()

  return total
}

export async function restoreWorkspaceArchive(input: {
  zipPath: string
  connect: () => Promise<ArchiveConnection>
  storage: ObjectStorage
  dryRun?: boolean
}): Promise<RestoreReport> {
  const dryRun = input.dryRun ?? false
  const directory = await mkdtemp(join(tmpdir(), 'sheetbase-restore-'))

  try {
    await extractArchive(input.zipPath, directory)

    const parsed: unknown = JSON.parse(
      await readFile(join(directory, 'manifest.json'), 'utf8'),
    )

    const identity = z
      .looseObject({ kind: z.unknown(), formatVersion: z.unknown() })
      .safeParse(parsed)

    if (
      !identity.success ||
      identity.data.kind !== 'sheetbase-workspace-export' ||
      identity.data.formatVersion !== ARCHIVE_FORMAT_VERSION
    ) {
      throw new RestoreError('This is not a Sheetbase workspace archive.')
    }

    const manifest = manifestSchema.parse(parsed)

    for (const table of manifest.tables) {
      if (!table.path || !table.sha256) continue

      // Check in manifest order so the first reported mismatch stays stable.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      if ((await sha256Of(join(directory, table.path))) !== table.sha256) {
        throw new RestoreError(
          `${table.name} does not match its recorded hash.`,
        )
      }
    }

    const restorableFiles = manifest.files.flatMap((file) =>
      file.status === 'ok' && file.path ? [{ ...file, path: file.path }] : [],
    )

    for (const file of restorableFiles) {
      if (
        // Check in manifest order so the first reported mismatch stays stable.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        (await sha256Of(join(directory, file.path))) !== file.sha256
      ) {
        throw new RestoreError(
          `File ${String(file.id)} does not match its recorded hash.`,
        )
      }
    }

    const skippedTables: RestoreReport['skippedTables'] = []

    const plan = manifest.tables.flatMap((table) => {
      if (!table.path || table.rows === 0) return []

      // A table that lost a secret column cannot be rebuilt without it.
      if (table.droppedColumns.length > 0 && table.name !== 'internal.user') {
        skippedTables.push({
          name: table.name,
          reason:
            'holds secrets, which are not in an archive: create them again',
        })

        return []
      }

      return [{ ...table, path: table.path }]
    })

    const report: RestoreReport = {
      workspaceId: manifest.workspace.id,
      tables: plan.map((t) => ({ name: t.name, rows: t.rows })),
      skippedTables,
      files: restorableFiles.length,
      missingFiles: manifest.files.length - restorableFiles.length,
      dryRun,
    }

    if (dryRun) return report

    const conn = await input.connect()

    try {
      const { rows: superRows } = await conn.query(
        'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
      )

      if (superRows[0]?.rolsuper !== true) {
        throw new RestoreError(
          'Restoring needs a database login that can switch triggers off (a superuser).',
        )
      }

      const { rows: existing } = await conn.query(
        'SELECT 1 FROM api.workspaces WHERE id = $1::uuid',
        [manifest.workspace.id],
      )

      if (existing.length > 0) {
        throw new RestoreError(
          'This workspace already exists here. Restore into an empty database.',
        )
      }

      // Files first: if they fail nothing has touched the database yet.
      for (const file of restorableFiles) {
        const storageKey = file.path.replace(/^files\//, '')

        // Keep writes ordered and bound storage to one stream at a time.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        if (await input.storage.head(storageKey)) continue
        const bytes = createReadStream(join(directory, file.path))
        // SAFETY: The unencoded file stream yields Buffer/Uint8Array chunks.
        await input.storage.putStream(
          storageKey,
          Readable.toWeb(bytes) as ReadableStream<Uint8Array>,
          FILE_MAX_BYTES,
        )
      }

      await conn.query('BEGIN')

      try {
        await conn.query('SET LOCAL session_replication_role = replica')

        for (const table of plan) {
          await insertTable(conn, table.name, join(directory, table.path))
        }

        await conn.query('COMMIT')
      } catch (error) {
        await conn.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    } finally {
      await conn.end().catch(() => undefined)
    }

    return report
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
