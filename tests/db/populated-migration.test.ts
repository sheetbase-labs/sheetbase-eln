import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, roleUrl } from './helpers'

const database = `sheetbase_upgrade_${process.pid}`
const workspace = randomUUID()
const owner = randomUUID()
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

describe('populated migration 0255', () => {
  let admin: Client
  let client: Client
  let fixture: string
  let instanceId: string
  let evidence: Record<string, unknown>
  let hashes: { hash: string; created_at: string }[]

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

    // Only the disposable fixture's journal is truncated. Published SQL and
    // the repository journal remain byte-for-byte unchanged.
    fixture = await mkdtemp(join(tmpdir(), 'sheetbase-pre0255-'))
    await cp('drizzle', join(fixture, 'drizzle'), { recursive: true })
    const journal = JSON.parse(
      await readFile(join(fixture, 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string; when: number }[] }
    journal.entries = journal.entries.filter((entry) => entry.idx < 255)
    await writeFile(
      join(fixture, 'drizzle/meta/_journal.json'),
      JSON.stringify(journal),
    )
    await migrate(drizzle(client), {
      migrationsFolder: join(fixture, 'drizzle'),
    })
    hashes = (
      await client.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows
    expect(hashes).toHaveLength(journal.entries.length)
    expect(journal.entries.at(-1)?.tag).toBe('0254_conscious_puppet_master')

    await client.query(
      `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES ($1,'Upgrade owner','upgrade@test.invalid',true)`,
      [owner],
    )
    await client.query(
      `INSERT INTO api.workspaces (id,slug,name) VALUES ($1,'populated-upgrade','Populated upgrade')`,
      [workspace],
    )
    await client.query(
      `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
      [workspace, owner],
    )
    const actor = new Client({
      connectionString: inDatabase(roleUrl('authenticator'), database),
    })
    await actor.connect()
    try {
      await actor.query('SET ROLE authenticated')
      await actor.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          sub: owner,
          workspace_id: workspace,
          role: 'authenticated',
        }),
      ])
      const state = {
        bindings: [],
        localFields: [
          {
            fieldId: '13000000-0000-4000-8000-000000000010',
            key: 'observation',
            label: 'Observation',
            description: null,
            logicalType: 'text',
            nullable: true,
            defaultValue: null,
            cardinality: 'one',
            quantity: null,
            validation: {},
            category: null,
            relationship: null,
            computation: { mode: 'stored' },
            lifecycle: 'active',
          },
        ],
        localValues: {
          '13000000-0000-4000-8000-000000000011': {
            '13000000-0000-4000-8000-000000000010': 'Retain this observation',
          },
        },
        calculationOverrides: {},
        presentation: {
          columnOrder: [],
          hiddenColumnIds: [],
          columnWidths: {},
          frozenColumnCount: 0,
          density: 'standard',
        },
        provenance: { createdFrom: 'ad_hoc' },
      }
      const result = await actor.query(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Preserve this working sheet',null,null,null,null,$2::jsonb)) AS instance`,
        [workspace, JSON.stringify(state)],
      )
      instanceId = result.rows[0].instance.id
      evidence = result.rows[0].instance
    } finally {
      await actor.end()
    }
  })

  afterAll(async () => {
    await client?.end()
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
      await admin.end()
    }
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  it('reproduces the context-free backfill denial and transaction rollback', async () => {
    await expect(
      migrate(drizzle(client), { migrationsFolder: 'drizzle' }),
    ).rejects.toMatchObject({
      cause: {
        code: '42501',
        message: 'Sheet Instances require controlled RPCs',
        where: expect.stringContaining('guard_sheet_instance'),
      },
    })
    expect(
      (
        await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='api' AND table_name='sheet_instances' AND column_name='display_id'`,
        )
      ).rowCount,
    ).toBe(0)
    expect(
      (
        await client.query(
          'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows,
    ).toEqual(hashes)
  })

  it('upgrades through the supported command without rewriting evidence or admitting ordinary writes', async () => {
    const result = await run('pnpm', ['db:migrate'])
    expect(result.code, result.output).toBe(0)
    const row = (
      await client.query(
        'SELECT to_jsonb(i) AS instance FROM api.sheet_instances i WHERE id=$1',
        [instanceId],
      )
    ).rows[0].instance
    expect(row).toEqual({ ...evidence, display_id: 'SHT-0001' })
    const journal = (
      await client.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows
    expect(journal.slice(0, hashes.length)).toEqual(hashes)
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
    await expect(
      client.query('UPDATE api.sheet_instances SET name=$2 WHERE id=$1', [
        instanceId,
        'Forbidden direct write',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    const actor = new Client({
      connectionString: inDatabase(roleUrl('authenticator'), database),
    })
    await actor.connect()
    try {
      await actor.query('SET ROLE authenticated')
      await expect(
        actor.query('UPDATE api.sheet_instances SET name=$2 WHERE id=$1', [
          instanceId,
          'Forbidden request write',
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await actor.end()
    }
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
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND pid<>pg_backend_pid()`,
        )
      ).rows[0].n,
    ).toBe(0)
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
    expect(
      (
        await client.query(
          `SELECT to_regclass('internal.runner_rollback_probe') AS probe,
                  current_setting('sheetbase.sheet_instance_write', true) AS context,
                  (SELECT count(*)::int FROM pg_stat_activity
                   WHERE datname=current_database() AND pid<>pg_backend_pid()) AS other_sessions`,
        )
      ).rows[0],
    ).toEqual({ probe: null, context: null, other_sessions: 0 })
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

  it('serialises fresh installers and applies the same full chain exactly once', async () => {
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
