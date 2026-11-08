/**
 * Plugin hook points against real Postgres: the sample plugins install, the
 * structural check refuses broken declarations, a field can be given a plugin
 * type (only by someone who can edit models, only a type the plugin declares),
 * and the plugin block type is allowed with nothing searchable in it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validateExtensionManifest } from '#/lib/extensions/manifest'
import { buildPluginPackage } from '#/lib/extensions/package'
import { prepareTestDatabase } from './helpers'

const WS = '0e050000-0000-4000-8000-0000000000e2'
const OWNER = 'hook-owner'
const MEMBER = 'hook-member'

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

function exampleFiles(
  name: string,
  dir = '',
  out: Record<string, string> = {},
) {
  const root = join(process.cwd(), 'sdks/plugin-python/examples', name)
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) exampleFiles(name, path, out)
    else if (/^(plugin\.json|README\.md|python\/.*\.py|ui\/.*)$/.test(path))
      out[path] = readFileSync(join(root, path), 'utf8')
  }
  return out
}

const manifestOf = (name: string) =>
  structuredClone(buildPluginPackage(exampleFiles(name)).manifest) as any

async function install(client: Client, key: string, manifest: any) {
  return (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb,true)`,
      [
        WS,
        key,
        manifest.name,
        manifest.version,
        manifest.source,
        JSON.stringify(manifest),
      ],
    )
  ).rows[0] as { id: string; status: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values ('${WS}','hook','HOOK','active') on conflict (id) do nothing`,
  )
  for (const [id, role] of [
    [OWNER, 'owner'],
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

describe('hook points in SQL', () => {
  it('installs every sample plugin', async () => {
    const owner = await actor(OWNER)
    for (const name of [
      'dilution-block',
      'ui-counter',
      'cell-looks',
      'plate-tools',
      'sequence-tools',
    ]) {
      const manifest = manifestOf(name)
      expect(validateExtensionManifest(manifest)).toEqual([])
      await install(owner, name, manifest)
    }
  })

  it('refuses the structural mistakes TypeScript also refuses', async () => {
    const owner = await actor(OWNER)
    const bad: Array<[string, any, (m: any) => void]> = [
      [
        'block with both screen and ui',
        'dilution-block',
        (m) => (m.contributions.blocks[0].ui = 'ui/x.html'),
      ],
      [
        'column without a value type',
        'plate-tools',
        (m) => delete m.contributions.columns[0].value,
      ],
      [
        'row action selection',
        'plate-tools',
        (m) => (m.contributions['row-actions'][0].selection = 'few'),
      ],
      [
        'field type base',
        'cell-looks',
        (m) => (m.contributions['field-types'][0].base = 'blob'),
      ],
      [
        'a page without a ui file',
        'sequence-tools',
        (m) => delete m.contributions.pages[0].ui,
      ],
      [
        'a table cell with both display and render',
        'sequence-tools',
        (m) => (m.contributions['table-cells'][0].display = { kind: 'text' }),
      ],
      [
        'a size on something that is not a widget',
        'sequence-tools',
        (m) => (m.contributions.pages[0].size = 'wide'),
      ],
      [
        'duplicate ids',
        'cell-looks',
        (m) =>
          m.contributions['table-cells'].push(
            m.contributions['table-cells'][0],
          ),
      ],
    ]
    let n = 0
    for (const [label, name, mutate] of bad) {
      const m = manifestOf(name)
      mutate(m)
      await expect(
        install(owner, `bad-hook-${n++}`, m),
        label,
      ).rejects.toMatchObject({
        code: 'SB034',
      })
    }
  })
})

describe('field types', () => {
  let owner: Client
  beforeAll(async () => {
    owner = await actor(OWNER)
    await owner.query(
      `select * from api.create_model_field($1,'sample','batch','Batch','text',true,null,'{}'::jsonb)`,
      [WS],
    )
  })

  const apply = (client: Client, key: string | null, type: string | null) =>
    client.query(
      `select api.set_field_plugin_type('sample','batch',$1,$2) as applied`,
      [key, type],
    )

  it('refuses a plugin that is not on, or a type it does not declare', async () => {
    await expect(apply(owner, 'cell-looks', 'batch-code')).rejects.toThrow(
      /does not offer/,
    )
    await owner.query(
      `select * from api.enable_extension($1,(select id from api.extensions where key='cell-looks' and workspace_id=$1))`,
      [WS],
    )
    await expect(apply(owner, 'cell-looks', 'nope')).rejects.toThrow(
      /does not offer/,
    )
  })

  it('applies, reads back, and clears a type, with an event each time', async () => {
    expect(
      (await apply(owner, 'cell-looks', 'batch-code')).rows[0].applied,
    ).toBe(true)
    const link = await owner.query(
      `select plugin_key, type_id from api.field_plugin_types where kind='sample' and field_name='batch'`,
    )
    expect(link.rows[0]).toEqual({
      plugin_key: 'cell-looks',
      type_id: 'batch-code',
    })
    expect((await apply(owner, null, null)).rows[0].applied).toBe(false)
    const gone = await owner.query(
      `select 1 from api.field_plugin_types where field_name='batch'`,
    )
    expect(gone.rowCount).toBe(0)
    const events = await migrator.query(
      `select payload->>'change' as change from api.change_events where workspace_id=$1 and entity_type='extension' and payload->>'change' like 'field_type_%' order by sequence`,
      [WS],
    )
    expect(events.rows.map((r) => r.change)).toEqual([
      'field_type_applied',
      'field_type_removed',
    ])
  })

  it('is for people who can edit models, and a missing field is refused', async () => {
    const member = await actor(MEMBER)
    await expect(apply(member, 'cell-looks', 'batch-code')).rejects.toBeTruthy()
    await expect(
      owner.query(
        `select api.set_field_plugin_type('sample','nope','cell-looks','batch-code')`,
      ),
    ).rejects.toThrow(/field not found/)
  })
})

describe('the plugin block type', () => {
  it('is allowed by the table and adds nothing to search', async () => {
    const def = await migrator.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='api.blocks'::regclass and conname='chk_blocks_type'`,
    )
    expect(def.rows[0].def).toContain("'plugin'")
    const text = await migrator.query(
      `select internal.block_search_text('plugin','{"plugin":"x","block":"y","state":{"a":"private"}}'::jsonb) as t`,
    )
    expect(text.rows[0].t).toBe('')
  })
})

describe('field type rules on record writes', () => {
  const check = (value: unknown) =>
    migrator.query(
      `select internal.validate_model_fields($1,'sample',$2::jsonb) as v`,
      [WS, JSON.stringify({ batch: value })],
    )

  beforeAll(async () => {
    const owner = await actor(OWNER)
    await migrator.query(
      `update api.record_field_definitions set lifecycle='active' where workspace_id=$1 and kind='sample' and field_name='batch'`,
      [WS],
    )
    await owner.query(
      `select api.set_field_plugin_type('sample','batch','cell-looks','batch-code')`,
    )
  })
  afterAll(async () => {
    await migrator.query(
      `delete from api.field_plugin_types where workspace_id=$1 and kind='sample'`,
      [WS],
    )
  })

  it('accepts a value that matches the type and refuses one that does not', async () => {
    expect((await check('AB-0042')).rows[0].v).toEqual({ batch: 'AB-0042' })
    await expect(check('ab-12')).rejects.toMatchObject({
      code: 'SB071',
      message: expect.stringContaining('two capital letters'),
    })
  })

  it('stops applying when the plugin is switched off, or the point is', async () => {
    await migrator.query(
      `update api.extensions set disabled_points=array['field-types'] where workspace_id=$1 and key='cell-looks'`,
      [WS],
    )
    expect((await check('ab-12')).rows[0].v).toEqual({ batch: 'ab-12' })
    await migrator.query(
      `update api.extensions set disabled_points='{}' where workspace_id=$1 and key='cell-looks'`,
      [WS],
    )
    await expect(check('ab-12')).rejects.toMatchObject({ code: 'SB071' })
  })

  it('leaves a field with no plugin type alone', async () => {
    await migrator.query(
      `delete from api.field_plugin_types where workspace_id=$1 and kind='sample'`,
      [WS],
    )
    expect((await check('anything')).rows[0].v).toEqual({ batch: 'anything' })
  })
})
