import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { z } from 'zod'

import * as schema from '../../src/db/schema'

const execute = promisify(execFile)
const screen = z
  .enum(['ReviewSign', 'SettingsSignature', 'HomeFirstRun'])
  .parse(process.argv[2])
const mode = z
  .enum(['capture', 'app', 'postgrest'])
  .parse(process.argv[3] ?? 'capture')
const databaseName = {
  ReviewSign: 'sheetbase_parity_review_sign',
  SettingsSignature: 'sheetbase_parity_settings_signature',
  HomeFirstRun: 'sheetbase_parity_home_first_run',
}[screen]
const port = { ReviewSign: 3300, SettingsSignature: 3310, HomeFirstRun: 3320 }[
  screen
]

config({ path: ['.env.local', '.env'], quiet: true })
const env = { ...process.env }
for (const name of [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'PGRST_DB_URI',
  'FORMULA_DATABASE_URL',
] as const) {
  const url = new URL(env[name] ?? '')
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(`${name} must be a local PostgreSQL role URL`)
  }
  url.pathname = `/${databaseName}`
  env[name] = url.toString()
}
Object.assign(env, {
  CI: 'true',
  SHEETBASE_ENV: 'test',
  SHEETBASE_DEV_AUTH_FREE: 'false',
  VITE_PARITY: 'true',
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  POSTGREST_URL: `http://127.0.0.1:${port + 1}`,
  POSTGREST_ADMIN_URL: `http://127.0.0.1:${port + 2}`,
  PGRST_SERVER_PORT: String(port + 1),
  PGRST_ADMIN_SERVER_PORT: String(port + 2),
  PGRST_DB_SCHEMAS: 'api',
  PGRST_DB_ANON_ROLE: 'anon',
})

if (mode !== 'capture') {
  const child =
    mode === 'app'
      ? spawn(
          'pnpm',
          [
            'exec',
            'vite',
            'dev',
            '--port',
            String(port),
            '--host',
            '127.0.0.1',
            '--strictPort',
          ],
          { env, stdio: 'inherit' },
        )
      : spawn('postgrest', [], { env, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  // CREATE fails if the exact database already exists: never reset an
  // ambiguous database, including another worker's unfinished scenario.
  const maintenanceUrl = new URL(env.DATABASE_URL ?? '')
  maintenanceUrl.pathname = '/postgres'
  const maintenance = new Client({
    connectionString: maintenanceUrl.toString(),
  })
  await maintenance.connect()
  await maintenance.query(`CREATE DATABASE ${databaseName} OWNER migrator`)
  const directory = await mkdtemp(join(tmpdir(), `parity-${screen}-`))
  env.FILE_STORAGE_DIR = directory
  const services: string[] = []
  const database = drizzle(env.MIGRATION_DATABASE_URL ?? '', { schema })
  try {
    await execute('pnpm', ['db:migrate'], { env, maxBuffer: 8 * 1024 * 1024 })
    const seeded = await execute('pnpm', ['db:seed:design'], {
      env,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (
      !seeded.stdout.includes('Seed complete: 45 step(s) applied idempotently.')
    ) {
      throw new Error('Full canonical design seed did not complete')
    }
    Object.assign(process.env, env)
    const { prepareDesignScenario } = await import('../../src/db/seed/design')
    const signaturesBefore = (
      await database.$client.query('select * from api.signatures order by id')
    ).rows
    const prepared = await prepareDesignScenario(database, screen)
    const fixture = join(directory, 'scenario.json')
    await writeFile(fixture, JSON.stringify(prepared))
    env.SHEETBASE_PARITY_SCENARIO = screen
    env.SHEETBASE_PARITY_SCENARIO_FILE = fixture
    for (const surface of ['postgrest', 'app'] as const) {
      const name = `parity-${screen.toLowerCase()}-${surface === 'postgrest' ? 'pgrst' : surface}`
      await execute(
        'amp',
        [
          'orb',
          'service',
          'start',
          name,
          '--command',
          `CI=true pnpm exec tsx tests/visual/design-scenario.mts ${screen} ${surface}`,
        ],
        { env, maxBuffer: 1024 * 1024 },
      )
      services.push(name)
    }
    await Promise.all(
      [port, port + 1].map(async (target) => {
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            const response = await fetch(
              `http://127.0.0.1:${target}/${target === port ? 'sign-in' : ''}`,
            )
            if (response.ok) return
          } catch {
            // Dedicated service is starting; bounded readiness poll only.
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        throw new Error(
          `Scenario ${screen} service on ${target} did not become ready`,
        )
      }),
    )
    let failed = false
    try {
      const result = await execute(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '--project=parity',
          'tests/visual/parity.spec.ts',
          '--grep',
          `${screen} —`,
          '--reporter=list',
          `--output=test-results/scenario-${screen}`,
        ],
        { env, maxBuffer: 8 * 1024 * 1024 },
      )
      process.stdout.write(result.stdout)
    } catch (error) {
      const result = z
        .object({ stdout: z.string(), stderr: z.string() })
        .parse(error)
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      failed = true
    }
    const signaturesAfter = (
      await database.$client.query('select * from api.signatures order by id')
    ).rows
    if (JSON.stringify(signaturesAfter) !== JSON.stringify(signaturesBefore)) {
      throw new Error('Visual capture changed existing signed evidence')
    }
    const output = `test-results/scenario-${screen}`
    await mkdir(output, { recursive: true })
    await writeFile(
      join(output, 'preparation.json'),
      JSON.stringify(
        {
          screen,
          userId: prepared.userId,
          workspaceId: prepared.workspaceId,
          projectId: prepared.projectId,
          route: prepared.route,
          revisionId: prepared.revisionId,
          submissionId: prepared.submissionId,
          prerequisites: prepared.prerequisites,
          signaturesPreserved: signaturesAfter.length,
        },
        null,
        2,
      ) + '\n',
    )
    process.stdout.write(
      `Preserved ${signaturesAfter.length} existing signatures; both themes used the same prepared ${screen} database.\n`,
    )
    process.exitCode = failed ? 1 : 0
  } finally {
    for (const name of services.reverse()) {
      await execute('amp', ['orb', 'service', 'stop', name])
    }
    await database.$client.end()
    await maintenance.query(`DROP DATABASE ${databaseName}`)
    await maintenance.end()
    await rm(directory, { recursive: true })
  }
}
