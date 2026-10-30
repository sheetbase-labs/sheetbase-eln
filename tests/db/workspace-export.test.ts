/**
 * Real PostgreSQL: the whole-workspace archive holds this workspace's rows and
 * files and nobody else's, never writes a secret, and backups are recorded,
 * pruned and refused while one is already running.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getPool } from '#/db/pool.server'
import {
  createWorkspaceArchive,
  type ArchiveConnection,
} from '#/lib/workspace-export/archive.server'
import {
  latestBackupStatus,
  listBackups,
  readBackupSettings,
  runBackup,
  saveBackupSettings,
  sweepBackups,
} from '#/lib/workspace-export/backup.server'
import type { BackupDeps } from '#/lib/workspace-export/backup.server'
import { MissingStorageObjectError } from '#/lib/file-storage/types'
import type { ObjectStorage } from '#/lib/file-storage/types'
import {
  restoreWorkspaceArchive,
  RestoreError,
} from '#/lib/workspace-export/restore.server'
import {
  TEST_TEMPLATE_DATABASE,
  migratorUrl,
  prepareTestDatabase,
  testDatabaseName,
} from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000e100'
const WS_B = '00000000-0000-4000-8000-00000000e200'
const USER_A = 'export-user-a'
const USER_B = 'export-user-b'
const PROJECT_A = '00000000-0000-4000-8000-00000000e101'
const PROJECT_B = '00000000-0000-4000-8000-00000000e201'
const RECORD_A = '00000000-0000-4000-8000-00000000e102'
const RECORD_B = '00000000-0000-4000-8000-00000000e202'
const FILE_OK = '00000000-0000-4000-8000-00000000e103'
const FILE_GONE = '00000000-0000-4000-8000-00000000e104'
const FILE_BAD = '00000000-0000-4000-8000-00000000e105'
const KEY_OK = `${WS_A}/${FILE_OK}/${'a'.repeat(32)}`
const KEY_GONE = `${WS_A}/${FILE_GONE}/${'b'.repeat(32)}`
const KEY_BAD = `${WS_A}/${FILE_BAD}/${'c'.repeat(32)}`
const FILE_BYTES = Buffer.from('plate reader output\n1,2,3\n')
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

let admin: Client

function memoryStorage(initial: Record<string, Buffer> = {}) {
  const objects = new Map(Object.entries(initial))
  const storage: ObjectStorage = {
    async putStream(key, body) {
      const parts: Buffer[] = []
      const reader = body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(Buffer.from(value))
      }
      const data = Buffer.concat(parts)
      objects.set(key, data)
      return { byteSize: BigInt(data.length), checksum: sha(data) }
    },
    async getStream(key) {
      const found = objects.get(key)
      if (!found) throw new MissingStorageObjectError(key)
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(found))
            c.close()
          },
        }),
        byteSize: found.length,
      }
    },
    async head(key) {
      const found = objects.get(key)
      return found ? { byteSize: found.length } : null
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { storage, objects }
}

const connect = async (): Promise<ArchiveConnection> => {
  const client = new Client({ connectionString: migratorUrl() })
  await client.connect()
  return client
}

let files = memoryStorage()
let backups = memoryStorage()

function deps(overrides: Partial<BackupDeps> = {}): BackupDeps {
  return {
    pool: getPool(migratorUrl()),
    archive: { connect, storage: files.storage },
    destination: {
      name: 'database',
      separate: false,
      storage: backups.storage,
    },
    now: () => new Date(),
    ...overrides,
  }
}

async function readArchive(workspaceId: string) {
  const { stream, summary } = createWorkspaceArchive(workspaceId, {
    connect,
    storage: files.storage,
  })
  const bytes = Buffer.from(await new Response(stream).arrayBuffer())
  const counts = await summary
  const entries = unzipSync(new Uint8Array(bytes))
  return {
    counts,
    entries,
    text: (name: string) => strFromU8(entries[name]),
    manifest: JSON.parse(strFromU8(entries['manifest.json'])) as {
      totals: { rows: number; files: number; missingFiles: number }
      tables: {
        name: string
        rows: number
        sha256: string | null
        droppedColumns: string[]
      }[]
      skippedTables: { name: string; reason: string }[]
      files: {
        id: string
        status: string
        path: string | null
        sha256: string | null
      }[]
      workspace: { id: string; slug: string }
    },
  }
}

beforeAll(async () => {
  admin = (await prepareTestDatabase()).migrator
  files = memoryStorage({
    [KEY_OK]: FILE_BYTES,
    [KEY_BAD]: Buffer.from('tampered'),
  })
  for (const [ws, slug, user] of [
    [WS_A, 'export-a', USER_A],
    [WS_B, 'export-b', USER_B],
  ] as const) {
    await admin.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
    await admin.query(
      `insert into api.workspaces(id,slug,name) values($1,$2,$2)`,
      [ws, slug],
    )
    await admin.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
      [ws, user],
    )
  }
  for (const [ws, project, record, user, key] of [
    [WS_A, PROJECT_A, RECORD_A, USER_A, 'EXA'],
    [WS_B, PROJECT_B, RECORD_B, USER_B, 'EXB'],
  ] as const) {
    await admin.query(
      `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,$3,$3,$4)`,
      [project, ws, key, user],
    )
    await admin.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,$3,'experiment',$4,$4,$5)`,
      [record, ws, project, `EXP-${key}`, user],
    )
    await admin.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'rich_text',$2::jsonb,1,$3)`,
      [record, JSON.stringify({ text: `notes for ${key}` }), user],
    )
    await admin.query(
      `insert into internal.api_credentials(workspace_id,display_prefix,secret_hash,name,created_by_user_id,scopes)
       values($1,'sb_'||$2,'SECRET-HASH-'||$2,$2,$3,array['projects:read'])`,
      [ws, key, user],
    )
  }
  // a record holds one file, so each file gets its own record
  for (const [i, [id, key, name]] of (
    [
      [FILE_OK, KEY_OK, 'plate.csv'],
      [FILE_GONE, KEY_GONE, 'lost.csv'],
      [FILE_BAD, KEY_BAD, 'changed.csv'],
    ] as const
  ).entries()) {
    const record = `00000000-0000-4000-8000-00000000e11${i}`
    await admin.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,$3,'experiment',$4,$4,$5)`,
      [record, WS_A, PROJECT_A, `EXP-EXA-F${i}`, USER_A],
    )
    await admin.query(
      `insert into api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum)
       values($1,$2,$3,$4,$5,'text/csv',$6,$7)`,
      [id, WS_A, record, key, name, FILE_BYTES.length, sha(FILE_BYTES)],
    )
  }
})

afterAll(async () => {
  await getPool(migratorUrl()).end()
  await admin.end()
})

describe('the workspace archive', () => {
  it("holds this workspace's rows, its children and nobody else's", async () => {
    const a = await readArchive(WS_A)
    const records = a.text('data/api.records.ndjson')
    expect(records).toContain('EXP-EXA')
    expect(records).not.toContain('EXP-EXB')
    // blocks have no workspace_id: they arrive through their record
    const blocks = a.text('data/api.blocks.ndjson')
    expect(blocks).toContain('notes for EXA')
    expect(blocks).not.toContain('notes for EXB')
    // only people who belong to the workspace
    const users = a.text('data/internal.user.ndjson')
    expect(users).toContain(USER_A)
    expect(users).not.toContain(USER_B)
    expect(a.manifest.workspace).toMatchObject({ id: WS_A, slug: 'export-a' })
  })

  it('never writes a secret, and says what it left out', async () => {
    const a = await readArchive(WS_A)
    const everything = Object.values(a.entries)
      .map((e) => strFromU8(e))
      .join('\n')
    expect(everything).not.toContain('SECRET-HASH')
    const credentials = a.manifest.tables.find(
      (t) => t.name === 'internal.api_credentials',
    )
    expect(credentials?.rows).toBe(1)
    expect(credentials?.droppedColumns).toContain('secret_hash')
    const skipped = a.manifest.skippedTables.map((s) => s.name)
    expect(skipped).toEqual(
      expect.arrayContaining([
        'internal.session',
        'internal.account',
        'internal.twoFactor',
      ]),
    )
    expect(Object.keys(a.entries)).not.toContain('data/internal.session.ndjson')
    // the user rows carry no sign-in columns
    expect(a.text('data/internal.user.ndjson')).not.toContain(
      'twoFactorEnabled',
    )
  })

  it('includes file bytes, lists a missing file, and flags a changed one', async () => {
    const a = await readArchive(WS_A)
    expect(Buffer.from(a.entries[`files/${KEY_OK}`]).equals(FILE_BYTES)).toBe(
      true,
    )
    const byId = Object.fromEntries(a.manifest.files.map((f) => [f.id, f]))
    expect(byId[FILE_OK]).toMatchObject({
      status: 'ok',
      sha256: sha(FILE_BYTES),
    })
    expect(byId[FILE_GONE]).toMatchObject({ status: 'missing', path: null })
    expect(byId[FILE_BAD].status).toBe('checksum_mismatch')
    expect(a.counts).toMatchObject({ fileCount: 3, missingFileCount: 2 })
    expect(a.manifest.totals.missingFiles).toBe(2)
  })

  it('lists a hash for every table file that matches its contents', async () => {
    const a = await readArchive(WS_A)
    const withRows = a.manifest.tables.filter((t) => t.rows > 0)
    expect(withRows.length).toBeGreaterThan(5)
    for (const table of withRows) {
      expect(sha(a.text(`data/${table.name}.ndjson`))).toBe(table.sha256)
    }
    expect(a.manifest.totals.rows).toBe(
      withRows.reduce((n, t) => n + t.rows, 0),
    )
  })

  it('keeps the other workspace out of the manifest file list too', async () => {
    const b = await readArchive(WS_B)
    expect(b.manifest.files).toHaveLength(0)
    expect(b.text('data/api.records.ndjson')).toContain('EXP-EXB')
  })
})

describe('backups', () => {
  it('records a good run with its size, hash and counts, and the download matches', async () => {
    backups = memoryStorage()
    const outcome = await runBackup(deps(), {
      workspaceId: WS_A,
      trigger: 'manual',
      userId: USER_A,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const { backup } = outcome
    expect(backup).toMatchObject({
      status: 'succeeded',
      trigger: 'manual',
      destination: 'database',
    })
    expect(backup.fileCount).toBe(3)
    expect(backup.missingFileCount).toBe(2)
    const stored = [...backups.objects.values()][0]
    expect(backup.byteSize).toBe(stored.length)
    expect(backup.sha256).toBe(sha(stored))
    const receipt = await admin.query(
      `select object_type, format, actor_user_id from api.data_exports where object_id = $1`,
      [backup.id],
    )
    expect(receipt.rows[0]).toEqual({
      object_type: 'workspace',
      format: 'backup',
      actor_user_id: USER_A,
    })
  })

  it('refuses a second run while one is going', async () => {
    await admin.query(
      `insert into internal.workspace_backups(workspace_id,trigger,status) values($1,'scheduled','running')`,
      [WS_B],
    )
    const outcome = await runBackup(deps(), {
      workspaceId: WS_B,
      trigger: 'manual',
      userId: USER_B,
    })
    expect(outcome).toEqual({ ok: false, reason: 'already_running' })
    // a run left over from a crash does not block forever
    await admin.query(
      `update internal.workspace_backups set started_at = now() - interval '7 hours' where workspace_id = $1`,
      [WS_B],
    )
    const next = await runBackup(deps(), {
      workspaceId: WS_B,
      trigger: 'manual',
      userId: USER_B,
    })
    expect(next.ok).toBe(true)
    const rows = await listBackups(getPool(migratorUrl()), WS_B)
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'succeeded'])
  })

  it('records a failure with a readable reason and removes the partial object', async () => {
    backups = memoryStorage()
    const failing: ObjectStorage = {
      ...backups.storage,
      async putStream(key, body) {
        await backups.storage.putStream(key, body, 1)
        throw new Error('bucket unreachable   at   somewhere\n  stack')
      },
    }
    const outcome = await runBackup(
      deps({ destination: { name: 's3', separate: true, storage: failing } }),
      { workspaceId: WS_A, trigger: 'scheduled' },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'failed')
      throw new Error('expected a failure')
    expect(outcome.backup.status).toBe('failed')
    expect(outcome.backup.error).toBe('bucket unreachable at somewhere stack')
    expect(backups.objects.size).toBe(0)
    const status = await latestBackupStatus(getPool(migratorUrl()), WS_A)
    expect(status.lastSucceeded).not.toBeNull()
  })

  it('keeps only the newest copies the workspace asked for', async () => {
    backups = memoryStorage()
    const pool = getPool(migratorUrl())
    await admin.query(
      `delete from internal.workspace_backups where workspace_id = $1`,
      [WS_A],
    )
    await saveBackupSettings(
      pool,
      WS_A,
      { enabled: true, frequency: 'daily', keepCount: 2 },
      USER_A,
    )
    expect(await readBackupSettings(pool, WS_A)).toEqual({
      enabled: true,
      frequency: 'daily',
      keepCount: 2,
    })
    for (let i = 0; i < 4; i += 1) {
      const outcome = await runBackup(
        deps({ now: () => new Date(Date.now() + i * 1000) }),
        {
          workspaceId: WS_A,
          trigger: 'scheduled',
        },
      )
      expect(outcome.ok).toBe(true)
    }
    expect(await listBackups(pool, WS_A)).toHaveLength(2)
    expect(backups.objects.size).toBe(2)
  })

  it('makes a backup only for workspaces that are due', async () => {
    backups = memoryStorage()
    const pool = getPool(migratorUrl())
    await admin.query(`delete from internal.workspace_backups`)
    await saveBackupSettings(
      pool,
      WS_B,
      { enabled: false, frequency: 'daily', keepCount: 7 },
      USER_B,
    )
    const first = await sweepBackups(deps())
    expect(first.ran).toBe(1) // WS_A has no settings: defaults to daily, on
    expect((await listBackups(pool, WS_A)).length).toBe(1)
    expect((await listBackups(pool, WS_B)).length).toBe(0)
    const second = await sweepBackups(deps())
    expect(second.ran).toBe(0) // WS_A was just backed up
  })
})

describe('restoring an archive', () => {
  const RESTORE_DB = `${testDatabaseName()}_restore`
  let directory: string
  let zipPath: string
  let restored: Client

  const urlFor = (database: string) => {
    const url = new URL(migratorUrl())
    url.pathname = `/${database}`
    return url.toString()
  }
  const connectRestored = async (): Promise<ArchiveConnection> => {
    // Restoring needs a superuser: the application login, not the migrator.
    const url = new URL(process.env.DATABASE_URL as string)
    url.pathname = `/${RESTORE_DB}`
    const client = new Client({ connectionString: url.toString() })
    await client.connect()
    return client
  }

  beforeAll(async () => {
    const adminUrl = new URL(process.env.DATABASE_URL as string)
    adminUrl.pathname = '/postgres'
    const maintenance = new Client({ connectionString: adminUrl.toString() })
    await maintenance.connect()
    await maintenance.query(
      `drop database if exists "${RESTORE_DB}" with (force)`,
    )
    await maintenance.query(
      `create database "${RESTORE_DB}" template "${TEST_TEMPLATE_DATABASE}"`,
    )
    await maintenance.end()
    restored = new Client({ connectionString: urlFor(RESTORE_DB) })
    await restored.connect()

    directory = await mkdtemp(join(tmpdir(), 'restore-test-'))
    const { stream } = createWorkspaceArchive(WS_A, {
      connect,
      storage: files.storage,
    })
    zipPath = join(directory, 'archive.zip')
    await writeFile(
      zipPath,
      Buffer.from(await new Response(stream).arrayBuffer()),
    )
  })

  afterAll(async () => {
    await restored.end()
    await rm(directory, { recursive: true, force: true })
    const adminUrl = new URL(process.env.DATABASE_URL as string)
    adminUrl.pathname = '/postgres'
    const maintenance = new Client({ connectionString: adminUrl.toString() })
    await maintenance.connect()
    await maintenance
      .query(`drop database if exists "${RESTORE_DB}" with (force)`)
      .finally(() => maintenance.end())
  })

  it('checks an archive without touching the database', async () => {
    const target = memoryStorage()
    const report = await restoreWorkspaceArchive({
      zipPath,
      connect: connectRestored,
      storage: target.storage,
      dryRun: true,
    })
    expect(report.dryRun).toBe(true)
    expect(report.files).toBe(1)
    expect(report.missingFiles).toBe(2)
    expect(target.objects.size).toBe(0)
    const { rows } = await restored.query(
      'select count(*)::int as n from api.records',
    )
    expect(rows[0].n).toBe(0)
  })

  it('puts the workspace, its records and its files back as they were', async () => {
    const target = memoryStorage()
    const report = await restoreWorkspaceArchive({
      zipPath,
      connect: connectRestored,
      storage: target.storage,
    })
    expect(report.skippedTables.map((t) => t.name)).toContain(
      'internal.api_credentials',
    )
    expect(target.objects.get(KEY_OK)?.equals(FILE_BYTES)).toBe(true)

    const count = async (db: Client, table: string) =>
      (await db.query(`select count(*)::int as n from ${table} where true`))
        .rows[0].n as number
    for (const table of [
      'api.workspaces',
      'api.records',
      'api.blocks',
      'api.file_objects',
      'api.projects',
    ]) {
      const scope =
        table === 'api.workspaces'
          ? `id = '${WS_A}'`
          : table === 'api.blocks'
            ? `record_id = '${RECORD_A}'`
            : `workspace_id = '${WS_A}'`
      const original = (
        await admin.query(
          `select count(*)::int as n from ${table} where ${scope}`,
        )
      ).rows[0].n
      const copy = (
        await restored.query(
          `select count(*)::int as n from ${table} where ${scope}`,
        )
      ).rows[0].n
      expect(copy).toBe(original)
      expect(copy).toBeGreaterThan(0)
    }
    // the other workspace's block did not come with it
    expect(await count(restored, 'api.blocks')).toBe(1)
    const block = await restored.query(
      `select payload from api.blocks where record_id = $1`,
      [RECORD_A],
    )
    expect(block.rows[0].payload).toEqual({ text: 'notes for EXA' })
    // people exist, but not how they sign in
    const user = await restored.query(
      `select id, email from internal."user" where id = $1`,
      [USER_A],
    )
    expect(user.rows).toHaveLength(1)
    const credentials = await count(restored, 'internal.api_credentials')
    expect(credentials).toBe(0)
  })

  it('will not restore over a workspace that is already there', async () => {
    await expect(
      restoreWorkspaceArchive({
        zipPath,
        connect: connectRestored,
        storage: memoryStorage().storage,
      }),
    ).rejects.toThrow(RestoreError)
  })

  it('refuses an archive that has been changed', async () => {
    const { unzipSync, zipSync, strToU8 } = await import('fflate')
    const parts = unzipSync(
      new Uint8Array(
        await (await import('node:fs/promises')).readFile(zipPath),
      ),
    )
    parts['data/api.records.ndjson'] = strToU8('{"id":"tampered"}\n')
    const tampered = join(directory, 'tampered.zip')
    await writeFile(tampered, Buffer.from(zipSync(parts)))
    await expect(
      restoreWorkspaceArchive({
        zipPath: tampered,
        connect: connectRestored,
        storage: memoryStorage().storage,
        dryRun: true,
      }),
    ).rejects.toThrow('does not match its recorded hash')
  })

  it('refuses an archive with a path that leaves its folder', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const evil = join(directory, 'evil.zip')
    await writeFile(
      evil,
      Buffer.from(zipSync({ '../escape.txt': strToU8('x') })),
    )
    await expect(
      restoreWorkspaceArchive({
        zipPath: evil,
        connect: connectRestored,
        storage: memoryStorage().storage,
        dryRun: true,
      }),
    ).rejects.toThrow('unsafe path')
  })
})
