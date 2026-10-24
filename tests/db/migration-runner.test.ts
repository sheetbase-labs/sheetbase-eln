import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, roleUrl } from './helpers'

const database = `sheetbase_upgrade_${process.pid}`
const lockKey = '7421834490123457'

function inDatabase(url: string, name: string) {
  const connection = new URL(url)
  connection.pathname = `/${name}`
  return connection.toString()
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; url?: string } = {},
) {
  return new Promise<{ code: number; output: string }>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL:
          options.url ?? inDatabase(migratorUrl(), database),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))
    child.on('error', reject)
    child.on('close', (code) => resolveRun({ code: code ?? -1, output }))
  })
}

describe('migration runner', () => {
  let admin: Client
  let client: Client
  let fixture: string

  beforeAll(async () => {
    admin = new Client({
      connectionString: inDatabase(process.env.DATABASE_URL!, 'postgres'),
    })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${database} OWNER migrator`)
    client = new Client({
      connectionString: inDatabase(migratorUrl(), database),
    })
    await client.connect()

    // The disposable fixture gets a failing migration appended in a later
    // test; the repository journal and SQL stay byte-for-byte unchanged.
    fixture = await mkdtemp(join(tmpdir(), 'sheetbase-migrate-'))
    await cp('drizzle', join(fixture, 'drizzle'), { recursive: true })
  })

  afterAll(async () => {
    await client?.end()
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
      await admin.end()
    }
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  it('applies the journal through the supported command, records it exactly and releases its lock', async () => {
    const result = await run('pnpm', ['db:migrate'])
    expect(result.code, result.output).toBe(0)
    const journal = (
      await client.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows
    const manifest = JSON.parse(
      await readFile('drizzle/meta/_journal.json', 'utf8'),
    ) as { entries: { tag: string; when: number }[] }
    expect(journal).toHaveLength(manifest.entries.length)
    for (const [index, entry] of manifest.entries.entries()) {
      const sql = await readFile(`drizzle/${entry.tag}.sql`)
      expect(journal[index]).toEqual({
        hash: createHash('sha256').update(sql).digest('hex'),
        created_at: String(entry.when),
      })
    }
    // A second run is a no-op.
    expect(
      (await run(process.execPath, ['scripts/migrate-once.mjs'])).code,
    ).toBe(0)
    const lock = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockKey],
    )
    expect(lock.rows[0].acquired).toBe(true)
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey])
  }, 120_000)

  it('refuses request-login credentials before granting migration context', async () => {
    const result = await run(process.execPath, ['scripts/migrate-once.mjs'], {
      url: inDatabase(roleUrl('authenticator'), database),
    })
    expect(result.code).not.toBe(0)
    expect(result.output).toContain(
      'Migrations require the migrator role and database owner',
    )
    // The child exits after closing its socket; PostgreSQL may still be
    // processing that disconnect when the parent observes process exit.
    await expect
      .poll(
        async () =>
          (
            await client.query(
              `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND pid<>pg_backend_pid()`,
            )
          ).rows[0].n,
      )
      .toBe(0)
  })

  it('rolls back a failed pending migration and closes its privileged session', async () => {
    const journal = JSON.parse(
      await readFile('drizzle/meta/_journal.json', 'utf8'),
    ) as {
      entries: { idx: number; tag: string; when: number; version: string }[]
    }
    const last = journal.entries.at(-1)!
    // Drizzle applies only migrations newer than the latest applied timestamp,
    // and the journal is not strictly ordered by it, so the probe has to
    // outrank the newest entry rather than the last one.
    const newest = Math.max(...journal.entries.map((entry) => entry.when))
    journal.entries.push({
      ...last,
      idx: last.idx + 1,
      tag: 'runner_failure_probe',
      when: newest + 1,
    })
    // A deliberately failing migration exists only in the disposable fixture.
    await writeFile(
      join(fixture, 'drizzle/meta/_journal.json'),
      JSON.stringify(journal),
    )
    await writeFile(
      join(fixture, 'drizzle/runner_failure_probe.sql'),
      'CREATE TABLE internal.runner_rollback_probe(id integer);--> statement-breakpoint\nSELECT 1 / 0;',
    )
    const result = await run(
      process.execPath,
      [resolve('scripts/migrate-once.mjs')],
      { cwd: fixture },
    )
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('22012')
    await expect
      .poll(
        async () =>
          (
            await client.query(
              `SELECT to_regclass('internal.runner_rollback_probe') AS probe,
                  current_setting('sheetbase.sheet_instance_write', true) AS context,
                  (SELECT count(*)::int FROM pg_stat_activity
                   WHERE datname=current_database() AND pid<>pg_backend_pid()) AS other_sessions`,
            )
          ).rows[0],
      )
      .toEqual({ probe: null, context: null, other_sessions: 0 })
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(journal.entries.length - 1)
    const lock = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockKey],
    )
    expect(lock.rows[0].acquired).toBe(true)
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey])
  }, 120_000)

  it('serialises fresh installers and applies the full journal exactly once', async () => {
    const fresh = `${database}_fresh`
    await admin.query(`CREATE DATABASE ${fresh} OWNER migrator`)
    const freshClient = new Client({
      connectionString: inDatabase(migratorUrl(), fresh),
    })
    try {
      const results = await Promise.all([
        run(process.execPath, ['scripts/migrate-once.mjs'], {
          url: inDatabase(migratorUrl(), fresh),
        }),
        run(process.execPath, ['scripts/migrate-once.mjs'], {
          url: inDatabase(migratorUrl(), fresh),
        }),
      ])
      for (const result of results) expect(result.code, result.output).toBe(0)
      await freshClient.connect()
      expect(
        (
          await freshClient.query(
            'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
          )
        ).rows,
      ).toEqual(
        (
          await client.query(
            'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
          )
        ).rows,
      )
    } finally {
      await freshClient.end()
      await admin.query(`DROP DATABASE ${fresh} WITH (FORCE)`)
    }
  }, 120_000)
})
