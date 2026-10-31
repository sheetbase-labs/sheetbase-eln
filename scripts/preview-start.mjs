#!/usr/bin/env node
/**
 * Start command for a PR preview (see docs/operations/previews.md).
 *
 * A preview has its own database. On start this makes sure that database holds
 * the design demo data for the current seed token, then serves the app:
 *
 *   - empty database           migrate, seed, remember the token
 *   - token differs (reseed)   drop and recreate the database, migrate, seed
 *   - token matches            migrate only (a new push to the PR branch)
 *
 * The token is PREVIEW_SEED (default "1"), kept as a setting on the database
 * itself, so it goes away with the database. `pnpm preview reseed <pr>` bumps
 * it. A failed seed is logged and the app still serves, so a broken seed never
 * leaves the preview with no site at all.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const token = process.env.PREVIEW_SEED || '1'
const dbName = 'sheetbase'

const say = (message) => process.stdout.write(`[preview] ${message}\n`)
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    .status === 0

async function connect(url, attempts = 40) {
  for (let i = 1; ; i++) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
      return client
    } catch (error) {
      await client.end().catch(() => undefined)
      if (i >= attempts) throw error
      say(`database not ready yet (${error.message}), retrying`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// DATABASE_URL is the superuser on the database named `postgres`.
async function admin() {
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = '/postgres'
  return connect(url.toString())
}

async function current() {
  const client = await admin()
  try {
    const { rows } = await client.query(
      `SELECT array_to_string(s.setconfig, ',') AS cfg
         FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = $1 AND s.setrole = 0`,
      [dbName],
    )
    const cfg = rows[0]?.cfg ?? ''
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    )
    return { exists: exists.rowCount > 0, cfg }
  } finally {
    await client.end()
  }
}

// The stock Postgres image knows nothing about Sheetbase's roles. Create them
// from docker/db/init/00-roles.sh (the same SQL the compose stack runs), taking
// each password from the connection string the app already holds.
async function ensureRoles() {
  const client = await connect(process.env.DATABASE_URL)
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'migrator'",
    )
    if (rowCount > 0) return
    say('creating the database roles')
    const pw = (url) => decodeURIComponent(new URL(url).password)
    const sh = readFileSync('docker/db/init/00-roles.sh', 'utf8')
    const sql = sh.slice(sh.indexOf("<<'SQL'\n") + 8, sh.lastIndexOf('\nSQL'))
    const lit = (v) => `'${v.replace(/'/g, "''")}'`
    const values = {
      auth_pass: pw(process.env.PGRST_DB_URI),
      migrator_pass: pw(process.env.MIGRATION_DATABASE_URL),
      formula_pass: pw(process.env.FORMULA_DATABASE_URL),
      sandbox_pass: pw(process.env.PIPELINE_SANDBOX_DATABASE_URL),
    }
    let text = sql.replace(/:db_name/g, dbName)
    for (const [k, v] of Object.entries(values)) {
      text = text.replaceAll(`:'${k}'`, lit(v))
    }
    const db = await connect(process.env.DATABASE_URL)
    try {
      await db.query(text)
    } finally {
      await db.end()
    }
  } finally {
    await client.end()
  }
}

async function reset() {
  const client = await admin()
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${dbName} OWNER migrator`)
  } finally {
    await client.end()
  }
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `/${dbName}`
  const db = await connect(url.toString())
  try {
    await db.query('CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION migrator')
    await db.query(
      'GRANT USAGE ON SCHEMA api TO anon, authenticated, api_client',
    )
  } finally {
    await db.end()
  }
}

async function remember() {
  const client = await admin()
  try {
    await client.query(
      `ALTER DATABASE ${dbName} SET sheetbase.preview_seed = '${token.replace(/'/g, '')}'`,
    )
    // PostgREST caches the schema; ask it to reload.
    const db = await connect(
      new URL(`/${dbName}`, process.env.DATABASE_URL).toString(),
    )
    await db.query("NOTIFY pgrst, 'reload schema'").catch(() => undefined)
    await db.end()
  } finally {
    await client.end()
  }
}

try {
  await ensureRoles()
  const state = await current()
  const seeded = state.cfg
    .split(',')
    .includes(`sheetbase.preview_seed=${token}`)
  if (!seeded) {
    if (state.exists && state.cfg.includes('sheetbase.preview_seed=')) {
      say(`seed token changed to ${token}: resetting the database`)
      await reset()
    }
    if (!run(process.execPath, ['scripts/migrate-once.mjs'])) {
      throw new Error('migration failed')
    }
    say('seeding the design demo data')
    const ok = run(
      'node_modules/.bin/tsx',
      ['src/db/seed/run.ts', '--design'],
      {
        DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
        PGRST_DB_URI: process.env.PGRST_DB_URI,
      },
    )
    if (ok) await remember()
    else say('seed FAILED: serving anyway')
  } else {
    say(`already seeded with token ${token}`)
  }
} catch (error) {
  say(`setup failed: ${error.message}; serving anyway`)
}

if (!run(process.execPath, ['scripts/migrate-once.mjs'])) {
  say('migration failed')
  process.exit(1)
}
run(process.execPath, ['scripts/stage-demo-files.mjs'])
const serve = spawnSync(process.execPath, ['scripts/serve-production.mjs'], {
  stdio: 'inherit',
})
process.exit(serve.status ?? 1)
