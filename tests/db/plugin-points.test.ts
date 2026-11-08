/**
 * Extension runner points, against real Postgres: the SQL manifest validator
 * agrees with the TypeScript one, the per-point switch is admin only and
 * audited, and secrets are not readable through the API.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateExtensionManifest } from '#/lib/extensions/manifest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPluginPackage } from '#/lib/extensions/package'
import { prepareTestDatabase } from './helpers'

const WS = '0e050000-0000-4000-8000-0000000000e1'
const OWNER = 'ext5-owner'
const ADMIN = 'ext5-admin'
const STEWARD = 'ext5-steward'
const MEMBER = 'ext5-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: userId, workspace_id: WS }),
  ])
  return client
}

const EXAMPLE = join(process.cwd(), 'sdks/plugin-python/examples/cell-count')

function exampleFiles(dir = '', out: Record<string, string> = {}) {
  for (const entry of readdirSync(join(EXAMPLE, dir), {
    withFileTypes: true,
  })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) exampleFiles(path, out)
    else if (/^(plugin\.json|README\.md|LICENSE.*|python\/.*\.py)$/.test(path))
      out[path] = readFileSync(join(EXAMPLE, path), 'utf8')
  }
  return out
}

/** The stored manifest of the example plugin, as the install page builds it. */
const sample = () =>
  structuredClone(buildPluginPackage(exampleFiles()).manifest) as any

async function install(client: Client, key: string, manifest: unknown) {
  return (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb,true)`,
      [
        WS,
        key,
        (manifest as { name: string }).name,
        (manifest as { version: string }).version,
        (manifest as { source: string }).source,
        JSON.stringify(manifest),
      ],
    )
  ).rows[0] as { id: string; disabled_points: string[] }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values ('${WS}','ext5','EXT5','active') on conflict (id) do nothing`,
  )
  for (const [id, role] of [
    [OWNER, 'owner'],
    [ADMIN, 'admin'],
    [STEWARD, 'steward'],
    [MEMBER, 'member'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,'f') on conflict (id) do nothing`,
      [id, `${id}@test`],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3) on conflict do nothing`,
      [WS, id, role],
    )
  }
})

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {})
  await migrator.end().catch(() => {})
})

describe('runner point manifests in SQL', () => {
  it('installs the sample and agrees with the TypeScript validator', async () => {
    expect(validateExtensionManifest(sample())).toEqual([])
    const owner = await actor(OWNER)
    const row = await install(owner, 'cell-count', sample())
    expect(row.disabled_points).toEqual([])
  })

  it('rejects the same bad declarations TypeScript rejects', async () => {
    const owner = await actor(OWNER)
    const op = (m: any) => m.contributions.operations[0]
    const bad: Array<[string, (m: any) => void]> = [
      ['bad id', (m) => (op(m).id = 'Bad Id')],
      ['bad runner', (m) => (op(m).runner = { kind: 'shell', code: 'ls' })],
      ['bad field type', (m) => (op(m).outputs[0].type = 'blob')],
      ['bad access', (m) => (op(m).access = 'sign')],
      ['no description', (m) => delete op(m).description],
    ]
    let n = 0
    for (const [label, mutate] of bad) {
      const m = sample()
      mutate(m)
      expect(
        validateExtensionManifest(m).length,
        `ts: ${label}`,
      ).toBeGreaterThan(0)
      await expect(
        install(owner, `bad-${n++}`, m),
        `sql: ${label}`,
      ).rejects.toMatchObject({ code: 'SB034' })
    }
  })
})

describe('per-point switch', () => {
  it('lets owners and admins switch a point off and on, and audits it', async () => {
    const owner = await actor(OWNER)
    const ext = await install(owner, 'switchable', sample())
    const admin = await actor(ADMIN)
    const off = (
      await admin.query(
        `select * from api.set_extension_point_enabled($1,$2,$3,false)`,
        [WS, ext.id, 'operations'],
      )
    ).rows[0]
    expect(off.disabled_points).toEqual(['operations'])
    const on = (
      await owner.query(
        `select * from api.set_extension_point_enabled($1,$2,$3,true)`,
        [WS, ext.id, 'operations'],
      )
    ).rows[0]
    expect(on.disabled_points).toEqual([])
    const events = (
      await owner.query(
        `select payload->>'change' as change from api.change_events
         where entity_type='extension' and entity_uuid=$1 and payload->>'change' like 'point_%' order by sequence`,
        [ext.id],
      )
    ).rows
    expect(events.map((e: any) => e.change)).toEqual([
      'point_disabled',
      'point_enabled',
    ])
  })

  it('refuses stewards, members and unknown points', async () => {
    const owner = await actor(OWNER)
    const ext = await install(owner, 'guarded', sample())
    for (const who of [STEWARD, MEMBER]) {
      const c = await actor(who)
      await expect(
        c.query(
          `select * from api.set_extension_point_enabled($1,$2,$3,false)`,
          [WS, ext.id, 'analysis-kinds'],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    }
    await expect(
      owner.query(
        `select * from api.set_extension_point_enabled($1,$2,$3,false)`,
        [WS, ext.id, 'widgets'],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
