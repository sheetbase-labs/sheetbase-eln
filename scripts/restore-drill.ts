/** Restore only into a disposable cluster, never into a caller-supplied database. */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createGunzip } from 'node:zlib'
import { Client } from 'pg'
import {
  verifyObjectArchive,
  verifyRestoredAccess,
  verifyRestoredDatabaseWithClient,
} from '../src/lib/restore-verification'
import { atomicWrite, extractObjects, run, verifyBackupSet } from './backup-io'

process.umask(0o077)
const argv = process.argv.slice(2).filter((arg) => arg !== '--')
let manifestPath: string | undefined
let local = false
let keep = false
let selfTest = false

async function main(): Promise<void> {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') manifestPath = argv[++i]
    else if (argv[i] === '--dump')
      manifestPath = argv[++i]?.replace(/-db\.sql\.gz$/, '-manifest.json')
    else if (argv[i] === '--local') local = true
    else if (argv[i] === '--keep') keep = true
    else if (argv[i] === '--self-test') selfTest = true
    else throw new Error('unknown restore-drill argument')
  }
  if (!manifestPath) throw new Error('--manifest is required')
  const set = await verifyBackupSet(resolve(manifestPath))
  const work = await mkdtemp(join(tmpdir(), 'sheetbase-restore-'))
  const container = `sheetbase-restore-${randomBytes(8).toString('hex')}`
  const data = join(work, 'pgdata')
  const password = randomBytes(24).toString('hex')
  let started = false
  try {
    if (selfTest) {
      const { readFile } = await import('node:fs/promises')
      const bytes = await readFile(set.dump)
      const corrupt = join(work, 'corrupt.sql.gz')
      await writeFile(corrupt, bytes.subarray(0, Math.floor(bytes.length / 2)))
      let rejected = false
      try {
        await run('gzip', ['-t', corrupt])
      } catch {
        rejected = true
      }
      if (!rejected) throw new Error('self-test accepted truncated dump')
      process.stdout.write(
        JSON.stringify({
          message: 'self-test passed: truncated dump rejected',
        }) + '\n',
      )
    }
    await run('gzip', ['-t', set.dump])
    // Validate and hash object bytes before starting PostgreSQL.
    const entries = await extractObjects(set.objects!, join(work, 'objects'))
    let host = work
    let port = 5432
    if (local) {
      await run('initdb', [
        '-D',
        data,
        '-A',
        'trust',
        '--no-locale',
        '-U',
        'postgres',
      ])
      await run('pg_ctl', [
        '-D',
        data,
        '-l',
        join(work, 'postgres.log'),
        '-o',
        `-k ${work} -h ''`,
        '-w',
        'start',
      ])
      started = true
    } else {
      await run('docker', [
        'run',
        '-d',
        '--rm',
        '--name',
        container,
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        '-p',
        '127.0.0.1::5432',
        process.env.SHEETBASE_DRILL_IMAGE ?? 'postgres:18-alpine',
      ])
      started = true
      const mapping = execFileSync('docker', ['port', container, '5432/tcp'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')[0]
      host = '127.0.0.1'
      port = Number(mapping.split(':').at(-1))
    }
    const connection = {
      host,
      port,
      user: 'postgres',
      password,
      database: 'postgres',
    }
    const deadline = Date.now() + 60_000
    for (;;) {
      const probe = new Client(connection)
      try {
        await probe.connect()
        break
      } catch {
        if (Date.now() >= deadline)
          throw new Error('drill postgres did not become ready')
        await new Promise((done) => setTimeout(done, 500))
      } finally {
        await probe.end().catch(() => undefined)
      }
    }
    const pgEnv = {
      ...process.env,
      PGHOST: host,
      PGPORT: String(port),
      PGUSER: 'postgres',
      PGPASSWORD: password,
      PGDATABASE: 'postgres',
    }
    const bootstrapEnv = {
      POSTGRES_USER: 'postgres',
      POSTGRES_DB: 'postgres',
      POSTGREST_AUTHENTICATOR_PASSWORD: password,
      MIGRATOR_PASSWORD: password,
      FORMULA_WRITER_PASSWORD: password,
      PIPELINE_SANDBOX_PASSWORD: password,
    }
    // Bootstrap in postgres, not the restore DB: the init script creates api,
    // and that schema must not already exist when the full dump is replayed.
    await run(
      local ? 'sh' : 'docker',
      local
        ? []
        : [
            'exec',
            '-i',
            ...Object.entries(bootstrapEnv).flatMap(([key, value]) => [
              '-e',
              `${key}=${value}`,
            ]),
            container,
            'sh',
          ],
      {
        input: createReadStream('docker/db/init/00-roles.sh'),
        env: { ...pgEnv, ...bootstrapEnv },
      },
    )
    const admin = new Client(connection)
    await admin.connect()
    try {
      const role = set.manifest.database.bootstrapRole
      const exists = await admin.query(
        'SELECT 1 FROM pg_roles WHERE rolname=$1',
        [role],
      )
      // Preserve ownership identities, never copy superuser/password attributes from the source cluster.
      if (!exists.rowCount)
        await admin.query(
          `CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`,
        )
      await admin.query('CREATE DATABASE sheetbase_restore OWNER migrator')
    } finally {
      await admin.end()
    }
    const input = createReadStream(set.dump).pipe(createGunzip())
    await run(
      local ? 'psql' : 'docker',
      local
        ? ['-d', 'sheetbase_restore', '-v', 'ON_ERROR_STOP=1', '-q']
        : [
            'exec',
            '-i',
            container,
            'psql',
            '-U',
            'postgres',
            '-d',
            'sheetbase_restore',
            '-v',
            'ON_ERROR_STOP=1',
            '-q',
          ],
      { input, env: pgEnv },
    )
    const client = new Client({ ...connection, database: 'sheetbase_restore' })
    const request = new Client({
      ...connection,
      database: 'sheetbase_restore',
      user: 'authenticator',
    })
    await client.connect()
    try {
      await request.connect()
      const database = await verifyRestoredDatabaseWithClient(client)
      const access = await verifyRestoredAccess(client, request)
      const files = await client.query<{
        storage_key: string
        byte_size: string
        checksum: string | null
        status: string
      }>(`
        SELECT storage_key, byte_size, checksum, status FROM api.file_objects
        UNION ALL SELECT storage_key, byte_size, checksum, 'active' FROM internal.revision_file_objects`)
      const objects = verifyObjectArchive(entries, files.rows)
      const ok = database.ok && objects.ok && access.ok
      process.stdout.write(
        JSON.stringify({
          message: ok ? 'restore drill passed' : 'restore drill FAILED',
          prefix: set.manifest.prefix,
          verification: { database, objects, access },
          ...(keep ? { work, container: local ? undefined : container } : {}),
        }) + '\n',
      )
      if (!ok) throw new Error('restored state failed verification')
    } finally {
      await request.end()
      await client.end()
    }
  } finally {
    if (!keep) {
      if (started)
        await run(
          local ? 'pg_ctl' : 'docker',
          local
            ? ['-D', data, '-m', 'immediate', '-w', 'stop']
            : ['rm', '-f', container],
        )
      await rm(work, { recursive: true, force: true })
    }
  }
}

let success = false
try {
  await main()
  success = true
} catch {
  process.stderr.write(
    JSON.stringify({ level: 'error', message: 'restore drill failed' }) + '\n',
  )
  process.exitCode = 1
} finally {
  const reportPath =
    process.env.SHEETBASE_DRILL_REPORT_PATH ??
    (manifestPath
      ? join(dirname(resolve(manifestPath)), 'restore-drill.json')
      : undefined)
  if (reportPath) {
    try {
      await atomicWrite(
        reportPath,
        JSON.stringify({ ok: success, finishedAt: new Date().toISOString() }) +
          '\n',
      )
    } catch {
      process.exitCode = 1
    }
  }
  const metrics = process.env.SHEETBASE_METRICS_TEXTFILE_DIR
  if (metrics) {
    try {
      await atomicWrite(
        join(metrics, 'sheetbase_restore_drill.prom'),
        `sheetbase_restore_drill_success ${success ? 1 : 0}\nsheetbase_restore_drill_run_time_seconds ${Math.floor(Date.now() / 1000)}\n`,
        0o644,
      )
    } catch {
      process.exitCode = 1
    }
  }
}
