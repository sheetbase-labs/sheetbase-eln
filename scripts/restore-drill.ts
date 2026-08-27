/**
 * PLAT-01 — restore drill. Proves a backup can recreate usable Sheetbase
 * state; a backup file that merely exists proves nothing.
 *
 * The drill restores the dump into a disposable PostgreSQL container and
 * verifies the restored state with src/lib/restore-verification.ts. When an
 * object archive is provided, restored file metadata must match the archived
 * bytes. Exit code 0 means the backup is proven; anything else means the
 * backup is unusable and recovery objectives are not met.
 *
 * The drill never touches the active development or production database: the
 * disposable container is separate from the Compose stacks and removed again.
 *
 * Usage:
 *   pnpm backup:restore-drill -- --dump backups/sheetbase-...-db.sql.gz \
 *                              [--objects backups/sheetbase-...-objects.tar.gz]
 *                              [--keep] [--self-test]
 *
 * --self-test additionally proves the drill detects corruption: it truncates
 * a copy of the dump and requires the drill to fail on it.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { Client } from 'pg'

import {
  verifyObjectArchive,
  verifyRestoredDatabaseWithClient,
} from '../src/lib/restore-verification'

const CONTAINER = 'sheetbase-restore-drill'
const RESTORED_DB = 'sheetbase_restore'
const IMAGE = process.env.SHEETBASE_DRILL_IMAGE ?? 'postgres:18-alpine'

interface Options {
  dump?: string
  objects?: string
  keep: boolean
  selfTest: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = { keep: false, selfTest: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dump') options.dump = argv[++i]
    else if (argv[i] === '--objects') options.objects = argv[++i]
    else if (argv[i] === '--keep') options.keep = true
    else if (argv[i] === '--self-test') options.selfTest = true
  }
  return options
}

function event(fields: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), ...fields }) + '\n',
  )
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

async function isRestorable(dumpPath: string): Promise<boolean> {
  // Integrity gate: gzip -t catches truncation before the restore attempt.
  const result = spawnSync('gzip', ['-t', dumpPath], { stdio: 'ignore' })
  return result.status === 0
}

function waitForPostgres(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000
    const attempt = () => {
      const result = spawnSync(
        'docker',
        ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { stdio: 'ignore' },
      )
      if (result.status === 0) return resolve()
      if (Date.now() > deadline) {
        return reject(new Error('drill postgres did not become ready'))
      }
      setTimeout(attempt, 500)
    }
    attempt()
  })
}

/**
 * Creates the restored-drill database. Retries because pg_isready can answer
 * during PostgreSQL's temporary initdb phase before the real server starts.
 */
async function createRestoredDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `CREATE DATABASE ${RESTORED_DB}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    if (result.status === 0) return
    if (Date.now() > deadline) {
      throw new Error(
        `could not create the drill database: ${String(result.stderr).slice(-300)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function restoreDump(dumpPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const gunzip = spawn('gzip', ['-dc', dumpPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const psql = spawn(
      'docker',
      [
        'exec',
        '-i',
        CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        RESTORED_DB,
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    )
    let stderr = ''
    let bytes = 0
    psql.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    gunzip.stdout.on('data', (chunk) => {
      bytes += chunk.length
    })
    gunzip.on('error', reject)
    psql.on('error', reject)
    psql.on('close', (code) => {
      event({
        level: 'info',
        message: 'restore attempt finished',
        psqlExit: code,
        pipedBytes: bytes,
        stderr: stderr.slice(-300) || undefined,
      })
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `restore failed (psql exit ${code}): ${stderr.slice(-500)}`,
          ),
        )
    })
    pipeline(gunzip.stdout, psql.stdin).catch(reject)
  })
}

async function listArchiveEntries(
  archivePath: string,
  workDir: string,
): Promise<{ name: string; size: number }[]> {
  const extractDir = join(workDir, 'objects')
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archivePath, '-C', extractDir], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    tar.on('error', reject)
    tar.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`object archive is not a readable tar.gz (exit ${code})`),
          ),
    )
  })
  const entries: { name: string; size: number }[] = []
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        entries.push({
          name: full.slice(extractDir.length + 1),
          size: (await stat(full)).size,
        })
      }
    }
  }
  await walk(extractDir)
  return entries
}

interface DrillResult {
  ok: boolean
  reason?: string
  verification?: unknown
}

async function runDrill(
  dumpPath: string,
  options: Options,
): Promise<DrillResult> {
  await restoreDump(dumpPath)

  const mappedPort = capture('docker', ['port', CONTAINER, '5432/tcp']).split(
    '\n',
  )[0]
  const port = Number(mappedPort.split(':').at(-1))
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'restore-drill',
    database: RESTORED_DB,
  })
  await client.connect()
  try {
    const verification = await verifyRestoredDatabaseWithClient(client)
    if (!verification.ok) {
      return {
        ok: false,
        reason: 'restored database failed verification',
        verification,
      }
    }

    if (options.objects) {
      const workDir = await mkdtemp(join(tmpdir(), 'sheetbase-restore-'))
      try {
        const entries = await listArchiveEntries(options.objects, workDir)
        const fileRows = await client.query(
          'SELECT storage_key, byte_size, status FROM api.file_objects',
        )
        const objectVerification = verifyObjectArchive(
          entries,
          fileRows.rows as {
            storage_key: string
            byte_size: string
            status: string
          }[],
        )
        if (!objectVerification.ok) {
          return {
            ok: false,
            reason: 'object archive does not match restored file metadata',
            verification: {
              database: verification,
              objects: objectVerification,
            },
          }
        }
        return {
          ok: true,
          verification: { database: verification, objects: objectVerification },
        }
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    }
    return { ok: true, verification }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function startDrillDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        CONTAINER,
        '-e',
        'POSTGRES_PASSWORD=restore-drill',
        '-p',
        '127.0.0.1::5432',
        IMAGE,
      ],
      { stdio: 'ignore' },
    )
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`drill container exited with status ${code}`))
      }
    })
    // Wait for readiness before resolving.
    waitForPostgres().then(resolve, reject)
  })
  capture('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-c',
    'SELECT 1',
  ])
  await createRestoredDatabase()

  // Production creates the role skeleton (anon/authenticated/api_client/
  // authenticator/migrator/formula_runtime) at container init, not via
  // migrations, and migration function bodies reference those roles. The
  // drill container replays the same init script so the restored dump can
  // be applied exactly as it would be in production.
  const { open } = await import('node:fs/promises')
  const initScript = await open(
    join(process.cwd(), 'docker/db/init/00-roles.sh'),
    'r',
  )
  const roleEnv = [
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_DB=postgres',
    '-e',
    'POSTGREST_AUTHENTICATOR_PASSWORD=restore-drill',
    '-e',
    'MIGRATOR_PASSWORD=restore-drill',
    '-e',
    'FORMULA_WRITER_PASSWORD=restore-drill',
  ]
  const bootstrap = spawn(
    'docker',
    ['exec', '-i', ...roleEnv, CONTAINER, 'sh'],
    {
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  )
  await pipeline(initScript.createReadStream(), bootstrap.stdin)
  const bootstrapCode = await new Promise<number>((resolve, reject) => {
    bootstrap.on('error', reject)
    bootstrap.on('close', (code) => resolve(code ?? -1))
  })
  if (bootstrapCode !== 0) {
    throw new Error(`role bootstrap failed (exit ${bootstrapCode})`)
  }
}

function stopDrillDatabase(): void {
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
}

/** Runs one full drill lifecycle: disposable container → restore → verify. */
async function drillOnce(
  dumpPath: string,
  options: Options,
): Promise<DrillResult> {
  // Integrity gate before any container is started: truncated or corrupt
  // gzip is rejected immediately.
  if (!(await isRestorable(dumpPath))) {
    return {
      ok: false,
      reason: 'dump is not valid gzip (truncated or corrupt)',
    }
  }
  await startDrillDatabase()
  try {
    return await runDrill(dumpPath, options)
  } finally {
    if (!options.keep) stopDrillDatabase()
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.selfTest && !options.dump) {
    throw new Error('--self-test requires --dump')
  }
  if (!options.dump && !options.selfTest) {
    throw new Error(
      'usage: restore-drill --dump <path> [--objects <path>] [--keep] [--self-test]',
    )
  }

  try {
    if (options.selfTest && options.dump) {
      // Corruption proof: truncate a copy of the dump and require the drill
      // to reject it. If the drill "passes" a corrupt backup it is useless.
      const workDir = await mkdtemp(join(tmpdir(), 'sheetbase-corrupt-'))
      try {
        const corruptPath = join(workDir, 'corrupt.sql.gz')
        await copyFile(options.dump, corruptPath)
        const full = await stat(options.dump)
        const buffer = await readFile(corruptPath)
        await writeFile(
          corruptPath,
          buffer.subarray(0, Math.floor(full.size / 2)),
        )
        const result = await drillOnce(corruptPath, options)
        if (result.ok) {
          event({
            level: 'error',
            message: 'self-test FAILED: the drill accepted a corrupted backup',
          })
          process.exit(1)
        }
        event({
          level: 'info',
          message: 'self-test passed: corruption detected as expected',
          reason: result.reason,
        })
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    }

    if (options.dump) {
      const result = await drillOnce(options.dump, options)
      event({
        level: result.ok ? 'info' : 'error',
        message: result.ok ? 'restore drill passed' : 'restore drill FAILED',
        dump: options.dump,
        reason: result.reason,
        verification: result.verification,
      })
      if (!result.ok) process.exit(1)
    }
  } finally {
    if (!options.keep) stopDrillDatabase()
  }
  event({ level: 'info', message: 'restore drill complete' })
}

main().catch(async (error) => {
  stopDrillDatabase()
  event({
    level: 'error',
    message: 'restore drill failed',
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
