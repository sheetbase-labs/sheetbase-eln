import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

function localUrl(name: string): URL {
  const url = new URL(process.env[name] ?? '')
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error(`API tests require a loopback ${name}`)
  return url
}

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No TCP port')
  const port = address.port
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

/** Only creates/drops its own random database on a local disposable cluster. */
export async function startApiTestStack() {
  if (
    !['development', 'test'].includes(
      process.env.SHEETBASE_ENV ?? 'development',
    )
  )
    throw new Error('API tests cannot run in a shared deployment environment')
  const adminUrl = localUrl('DATABASE_URL')
  const migrationUrl = localUrl('MIGRATION_DATABASE_URL')
  const formulaUrl = localUrl('FORMULA_DATABASE_URL')
  const sandboxUrl = process.env.PIPELINE_SANDBOX_DATABASE_URL
    ? localUrl('PIPELINE_SANDBOX_DATABASE_URL')
    : undefined
  if (
    [migrationUrl, formulaUrl, sandboxUrl].some(
      (url) => url && url.host !== adminUrl.host,
    )
  )
    throw new Error('API test roles must use the same local PostgreSQL cluster')
  const actorUrl = new URL(process.env.PGRST_DB_URI ?? '')
  if (
    actorUrl.username !== 'authenticator' ||
    migrationUrl.username !== 'migrator'
  )
    throw new Error(
      'API tests require the real authenticator and migrator roles',
    )
  // Compose's hostname is not valid in an orb. Only reuse credentials, never
  // its destination or an externally supplied HTTP upstream.
  actorUrl.host = adminUrl.host
  const database = `sheetbase_api_${randomUUID().replaceAll('-', '')}`
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${database} OWNER migrator`)
  } catch (error) {
    await admin.end()
    throw error
  }
  let postgrest: ReturnType<typeof spawn> | undefined
  const stop = async () => {
    try {
      if (
        postgrest &&
        postgrest.pid !== undefined &&
        postgrest.exitCode === null &&
        postgrest.signalCode === null
      ) {
        const exited = once(postgrest, 'exit')
        postgrest.kill('SIGTERM')
        await exited
      }
      // Private application pools release idle connections after 10 seconds.
      // Do not force-disconnect them: pg reports those as unhandled errors.
      for (let attempt = 0; attempt < 150; attempt++) {
        const connections = await admin.query<{ count: number }>(
          'SELECT count(*)::int count FROM pg_stat_activity WHERE datname=$1',
          [database],
        )
        if (connections.rows[0].count === 0) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await admin.query(`DROP DATABASE ${database}`)
    } finally {
      await admin.end()
    }
  }
  try {
    for (const [key, url] of [
      ['DATABASE_URL', adminUrl],
      ['MIGRATION_DATABASE_URL', migrationUrl],
      ['FORMULA_DATABASE_URL', formulaUrl],
      ['PGRST_DB_URI', actorUrl],
    ] as const) {
      url.pathname = `/${database}`
      process.env[key] = url.toString()
    }
    if (sandboxUrl) {
      sandboxUrl.pathname = `/${database}`
      process.env.PIPELINE_SANDBOX_DATABASE_URL = sandboxUrl.toString()
    }
    process.env.SHEETBASE_ENV = 'test'
    process.env.SHEETBASE_DEV_AUTH_FREE = 'false'
    const migrationClient = new Client({
      connectionString: migrationUrl.toString(),
    })
    await migrationClient.connect()
    try {
      // Match the migration runner's historical Sheet Instance backfills.
      await migrationClient.query(
        "SELECT set_config('sheetbase.sheet_instance_write','rpc-v1',false)",
      )
      await migrate(drizzle(migrationClient), { migrationsFolder: 'drizzle' })
    } finally {
      await migrationClient.end()
    }
    const port = await freePort()
    const adminPort = await freePort()
    process.env.POSTGREST_URL = `http://127.0.0.1:${port}`
    process.env.POSTGREST_ADMIN_URL = `http://127.0.0.1:${adminPort}`
    let failure: Error | undefined
    postgrest = spawn('postgrest', [], {
      env: {
        ...process.env,
        PGRST_DB_URI: actorUrl.toString(),
        PGRST_DB_SCHEMAS: 'api',
        PGRST_DB_ANON_ROLE: 'anon',
        PGRST_SERVER_HOST: '127.0.0.1',
        PGRST_SERVER_PORT: String(port),
        PGRST_ADMIN_SERVER_PORT: String(adminPort),
      },
      stdio: 'ignore',
    })
    postgrest.on('error', (error) => {
      failure = error
    })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure
      if (postgrest.exitCode !== null)
        throw new Error(`PostgREST exited with ${postgrest.exitCode}`)
      const ready = await fetch(`${process.env.POSTGREST_ADMIN_URL}/ready`)
        .then((response) => response.ok)
        .catch(() => false)
      if (ready) return stop
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Isolated PostgREST did not become ready')
  } catch (error) {
    await stop()
    throw error
  }
}
