/** Installed SDKs over real HTTP: token route -> proxy -> PostgREST -> RLS. */
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as schema from '#/db/schema'
import { createCredential } from '#/lib/api-credentials'
import {
  prepareTestDatabase,
  roleUrl,
  setActorJwt,
  testDatabaseName,
} from './helpers'

const exec = promisify(execFile)
const WS = randomUUID()
const OTHER_WS = randomUUID()
const OWNER = 'installed-sdk-owner'
const MEMBER = 'installed-sdk-member'
let admin: Client
let actor: Client
let db: ReturnType<typeof drizzle<typeof schema>>
let dir: string
let baseUrl: string
let versionId: string
let fieldId: string
let hiddenDataset: string
let projectId: string
const processes: ChildProcess[] = []
let serviceLog = ''

async function port() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  admin = prepared.migrator
  db = drizzle(admin, { schema })
  actor = await prepared.asRole('authenticator')
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified")
    values ($1,$1,'installed-owner@test.invalid',true),($2,$2,'installed-member@test.invalid',true)`,
    [OWNER, MEMBER],
  )
  await admin.query(
    `insert into api.workspaces(id,slug,name) values
    ($1,'installed-sdk','Installed SDK'),($2,'installed-hidden','Hidden')`,
    [WS, OTHER_WS],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
    values($1,$2,'owner'),($1,$3,'member'),($4,$2,'owner')`,
    [WS, OWNER, MEMBER, OTHER_WS],
  )
  await actor.query('set role authenticated')
  await setActorJwt(actor, OWNER, WS)
  projectId = (
    await actor.query(`select (api.create_project('SDK acceptance')).id`)
  ).rows[0].id
  await actor.query(`select api.grant_project_access($1,$2,$3,'editor')`, [
    WS,
    projectId,
    MEMBER,
  ])
  const definition = await actor.query(
    `select api.create_dataset_schema_definition(
    $1,'installed','Installed',null,$2::jsonb) as result`,
    [
      WS,
      JSON.stringify([
        {
          key: 'value',
          label: 'Value',
          logicalType: 'decimal',
          nullable: false,
        },
      ]),
    ],
  )
  versionId = definition.rows[0].result.schema_version_id
  await actor.query('select api.publish_dataset_schema_version($1)', [
    versionId,
  ])
  fieldId = (
    await admin.query(
      'select field_id from api.dataset_schema_version_fields where schema_version_id=$1',
      [versionId],
    )
  ).rows[0].field_id
  // A foreign-workspace ID must not become readable through a scoped token.
  hiddenDataset = randomUUID()
  await setActorJwt(actor, OWNER, OTHER_WS)
  const hiddenSchema = await actor.query(
    `select api.create_dataset_schema_definition(
    $1,'hidden','Hidden',null,'[]'::jsonb) as result`,
    [OTHER_WS],
  )
  const hiddenVersion = hiddenSchema.rows[0].result.schema_version_id
  await actor.query('select api.publish_dataset_schema_version($1)', [
    hiddenVersion,
  ])
  await actor.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name)
    values($1,$2,$3,'Hidden')`,
    [hiddenDataset, OTHER_WS, hiddenVersion],
  )
  await setActorJwt(actor, OWNER, WS)

  dir = await mkdtemp(join(tmpdir(), 'sheetbase-sdk-installed-'))
  await exec('pnpm', ['exec', 'tsc', '-p', 'sdks/typescript/tsconfig.json'])
  await exec('npm', ['pack', '--pack-destination', dir], {
    cwd: resolve('sdks/typescript'),
  })
  const tarball = (await readdir(dir)).find((name) => name.endsWith('.tgz'))!
  await exec('npm', [
    'install',
    '--prefix',
    dir,
    '--no-package-lock',
    '--ignore-scripts',
    join(dir, tarball),
  ])
  await exec('uv', ['build', '--wheel', '--out-dir', dir, 'sdks/python'])
  await exec('uv', ['venv', join(dir, 'venv')])
  const wheel = (await readdir(dir)).find((name) => name.endsWith('.whl'))!
  await exec('uv', [
    'pip',
    'install',
    '--python',
    join(dir, 'venv/bin/python'),
    join(dir, wheel),
  ])
  await copyFile(
    'tests/fixtures/sdk-installed.mjs',
    join(dir, 'acceptance.mjs'),
  )

  const upstreamPort = await port()
  const appPort = await port()
  baseUrl = `http://127.0.0.1:${appPort}`
  const appDatabase = new URL(process.env.DATABASE_URL!)
  appDatabase.pathname = `/${testDatabaseName()}`
  const upstream = spawn('postgrest', [], {
    env: {
      ...process.env,
      PGRST_DB_URI: roleUrl('authenticator'),
      PGRST_DB_SCHEMAS: 'api',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(upstreamPort),
      PGRST_ADMIN_SERVER_PORT: String(await port()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const app = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(appPort),
      '--strictPort',
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: appDatabase.toString(),
        POSTGREST_URL: `http://127.0.0.1:${upstreamPort}`,
        NODE_ENV: 'development',
        VITEST: 'true',
        SHEETBASE_PIPELINE_WORKER: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  processes.push(upstream, app)
  for (const child of processes) {
    child.stdout?.on('data', (part) => {
      serviceLog += String(part)
    })
    child.stderr?.on('data', (part) => {
      serviceLog += String(part)
    })
  }
  await vi.waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/api/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(response.status, serviceLog.slice(-4000)).toBe(400)
    },
    { timeout: 120_000, interval: 500 },
  )
}, 240_000)

afterAll(async () => {
  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exit = once(child, 'exit')
    child.kill('SIGTERM')
    await exit
  }
  await actor?.end()
  await admin?.end()
  if (dir) await rm(dir, { recursive: true, force: true })
})

for (const language of ['typescript', 'python']) {
  it(`${language} package reads/writes idempotently, retries stale revisions, and obeys live permissions/revocation`, async () => {
    await admin.query(
      `update api.workspace_memberships set role='member',suspended_at=null where workspace_id=$1 and user_id=$2`,
      [WS, MEMBER],
    )
    const scopes = ['datasets:read', 'datasets:write', 'projects:read']
    const service = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: language,
      scopes,
    })
    const personal = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: MEMBER,
      name: `${language}-personal`,
      scopes,
      kind: 'personal',
    })
    const reader = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: `${language}-reader`,
      scopes: ['projects:read'],
    })
    const dataset = (
      await actor.query(
        `insert into api.datasets(workspace_id,schema_version_id,name,primary_project_id)
      values($1,$2,$3,$4) returning id`,
        [WS, versionId, language, projectId],
      )
    ).rows[0].id
    const child =
      language === 'typescript'
        ? spawn(process.execPath, [join(dir, 'acceptance.mjs')], {
            cwd: dir,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        : spawn(
            join(dir, 'venv/bin/python'),
            ['-I', resolve('tests/fixtures/sdk_installed.py')],
            { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] },
          )
    processes.push(child)
    const exited = once(child, 'exit')
    let errors = ''
    child.stderr.on('data', (part) => {
      errors += String(part)
    })
    const lines = createInterface({ input: child.stdout })
    const stages: string[] = []
    const changes = (async () => {
      for await (const line of lines) {
        stages.push(line)
        if (line === 'permissions')
          await admin.query(
            `update api.workspace_memberships set role='viewer' where workspace_id=$1 and user_id=$2`,
            [WS, MEMBER],
          )
        else if (line === 'membership')
          await admin.query(
            `update api.workspace_memberships set suspended_at=now() where workspace_id=$1 and user_id=$2`,
            [WS, MEMBER],
          )
        else if (line === 'revocation')
          await admin.query(
            'update internal.api_credentials set revoked_at=now() where id=$1',
            [service.id],
          )
        else continue
        child.stdin.write('continue\n')
      }
    })()
    child.stdin.write(
      JSON.stringify({
        baseUrl,
        credential: service.secret,
        personal: personal.secret,
        reader: reader.secret,
        dataset,
        fieldId,
        hiddenDataset,
        scopes,
      }) + '\n',
    )
    const [code] = await exited
    await changes
    expect(code, `${errors}\n${serviceLog.slice(-4000)}`).toBe(0)
    expect(stages).toEqual([
      'permissions',
      'membership',
      'revocation',
      'accepted',
    ])
    const page = await actor.query(
      'select api.query_dataset_rows($1) as result',
      [dataset],
    )
    expect(page.rows[0].result.totalCount).toBe(2)
    expect(
      page.rows[0].result.rows
        .map((row: { values: Record<string, number> }) =>
          Number(row.values[fieldId]),
        )
        .sort((a: number, b: number) => a - b),
    ).toEqual([37, 83])
  }, 120_000)
}
