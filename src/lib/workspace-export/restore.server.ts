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

import type { ObjectStorage } from '#/lib/file-storage/types'

import { ARCHIVE_FORMAT_VERSION } from './archive.server'
import type { ArchiveConnection } from './archive.server'

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

interface Manifest {
  formatVersion: number
  kind: string
  workspace: { id: string; slug: string }
  tables: {
    name: string
    rows: number
    path: string | null
    sha256: string | null
    droppedColumns: string[]
  }[]
  files: {
    id: string
    path: string | null
    sha256: string | null
    bytes: number
    status: string
  }[]
}

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
  let failure: unknown = null
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
    unzip.push(chunk as Uint8Array)
    if (failure) throw failure
  }
  unzip.push(new Uint8Array(0), true)
  await Promise.all(writers)
  if (failure) throw failure
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
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
  const { rows: columnRows } = await conn.query(
    `SELECT a.attname::text AS name
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = ''`,
    [target],
  )
  const columns = new Set(columnRows.map((r) => r.name as string))
  const readable = Readable.from(createReadStream(path, 'utf8'))
  let carry = ''
  let batch: string[] = []
  let total = 0
  const flush = async () => {
    if (batch.length === 0) return
    // Only the columns the archive has: the rest take their defaults.
    const present = new Set<string>()
    for (const line of batch) {
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
    const manifest = JSON.parse(
      await readFile(join(directory, 'manifest.json'), 'utf8'),
    ) as Manifest
    if (
      manifest.kind !== 'sheetbase-workspace-export' ||
      manifest.formatVersion !== ARCHIVE_FORMAT_VERSION
    ) {
      throw new RestoreError('This is not a Sheetbase workspace archive.')
    }

    for (const table of manifest.tables) {
      if (!table.path || !table.sha256) continue
      if ((await sha256Of(join(directory, table.path))) !== table.sha256) {
        throw new RestoreError(
          `${table.name} does not match its recorded hash.`,
        )
      }
    }
    const restorableFiles = manifest.files.filter(
      (f) => f.status === 'ok' && f.path,
    )
    for (const file of restorableFiles) {
      if (
        (await sha256Of(join(directory, file.path as string))) !== file.sha256
      ) {
        throw new RestoreError(
          `File ${file.id} does not match its recorded hash.`,
        )
      }
    }

    const skippedTables: RestoreReport['skippedTables'] = []
    const plan = manifest.tables.filter((table) => {
      if (!table.path || table.rows === 0) return false
      // A table that lost a secret column cannot be rebuilt without it.
      if (table.droppedColumns.length > 0 && table.name !== 'internal.user') {
        skippedTables.push({
          name: table.name,
          reason:
            'holds secrets, which are not in an archive: create them again',
        })
        return false
      }
      return true
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
        const storageKey = (file.path as string).replace(/^files\//, '')
        if (await input.storage.head(storageKey)) continue
        const bytes = createReadStream(join(directory, file.path as string))
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
          await insertTable(
            conn,
            table.name,
            join(directory, table.path as string),
          )
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
