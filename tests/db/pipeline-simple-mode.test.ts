/**
 * Simple pipelines: a Simple version carries its recipe, a Standard one does
 * not, a pipeline never goes back to a simpler mode, Convert drops the recipe
 * and keeps the compiled steps, and Duplicate copies a version into a new
 * pipeline in the mode it was written in.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '0e030000-0000-4000-8000-00000000000a'
const OWNER = 'pipe-simple-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

const RECIPE = {
  when: { datasetId: '11111111-1111-4111-8111-111111111111' },
  join: 'and',
  conditions: [],
  actions: [],
}

const STEPS = [
  { name: 'match', kind: 'sql', statement: 'SELECT * FROM source' },
]

const config = (mode: string, extra: { recipe?: typeof RECIPE } = {}) => ({
  configVersion: 2,
  mode,
  parameters: [],
  inputs: [{ name: 'source', required: true }],
  steps: STEPS,
  output: { mode: 'none', datasetLabel: 'out' },
  ...extra,
})

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    'insert into api.workspaces(id, slug, name) values($1, $2, $2)',
    [WS, 'pipe-simple'],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values ($1, 'Owner', 'o@pipe-simple.test')`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [WS, OWNER],
  )
  owner = await asRole('authenticator')
  await owner.query('SET ROLE authenticated')
  await setActorJwt(owner, OWNER, WS)
})

afterAll(async () => {
  await owner?.end().catch(() => {})
  await migrator?.end()
})

async function pipeline(key: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `select id from api.create_pipeline_definition($1::uuid, $2, $2, null)`,
    [WS, key],
  )

  return rows[0].id
}

const version = (
  definition: string,
  configuration: ReturnType<typeof config>,
) =>
  owner.query<{ id: string; lifecycle: string }>(
    'select id, lifecycle from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)',
    [WS, definition, JSON.stringify(configuration)],
  )

describe('mode rules', () => {
  it('keeps a recipe on a Simple version only', async () => {
    const definition = await pipeline('rules_a')

    await expect(version(definition, config('simple'))).rejects.toThrow(
      /recipe/i,
    )

    await expect(
      version(definition, config('standard', { recipe: RECIPE })),
    ).rejects.toThrow(/recipe/i)

    const ok = await version(definition, config('simple', { recipe: RECIPE }))

    expect(ok.rows).toHaveLength(1)
  })

  it('never goes back to a simpler mode', async () => {
    const definition = await pipeline('rules_b')

    await version(definition, config('standard'))
    await owner.query(
      'select api.publish_pipeline_definition_version($1::uuid, id) from api.pipeline_definition_versions where definition_id = $2',
      [WS, definition],
    )

    await expect(
      version(definition, config('simple', { recipe: RECIPE })),
    ).rejects.toThrow(/simpler mode/i)
  })
})

describe('convert_pipeline_to_standard', () => {
  it('converts the draft in place and keeps its steps', async () => {
    const definition = await pipeline('convert_a')

    await version(definition, config('simple', { recipe: RECIPE }))

    await owner.query(
      'select api.convert_pipeline_to_standard($1::uuid, $2::uuid)',
      [WS, definition],
    )

    const { rows } = await owner.query(
      'select configuration from api.pipeline_definition_versions where definition_id = $1',
      [definition],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].configuration.mode).toBe('standard')
    expect(rows[0].configuration.recipe).toBeUndefined()
    expect(rows[0].configuration.steps).toEqual(STEPS)
  })

  it('copies a published Simple version into a new Standard draft', async () => {
    const definition = await pipeline('convert_b')

    const created = await version(
      definition,
      config('simple', { recipe: RECIPE }),
    )

    await owner.query(
      'select api.publish_pipeline_definition_version($1::uuid, $2::uuid)',
      [WS, created.rows[0].id],
    )

    await owner.query(
      'select api.convert_pipeline_to_standard($1::uuid, $2::uuid)',
      [WS, definition],
    )

    const { rows } = await owner.query(
      "select lifecycle, configuration->>'mode' as mode from api.pipeline_definition_versions where definition_id = $1 order by version",
      [definition],
    )

    expect(rows).toEqual([
      { lifecycle: 'published', mode: 'simple' },
      { lifecycle: 'draft', mode: 'standard' },
    ])
  })

  it('refuses a pipeline that is not Simple', async () => {
    const definition = await pipeline('convert_c')

    await version(definition, config('standard'))

    await expect(
      owner.query(
        'select api.convert_pipeline_to_standard($1::uuid, $2::uuid)',
        [WS, definition],
      ),
    ).rejects.toThrow()
  })
})

describe('duplicate_pipeline_definition', () => {
  it('makes a new pipeline from a version, in the same mode', async () => {
    const definition = await pipeline('copy_a')

    const created = await version(
      definition,
      config('simple', { recipe: RECIPE }),
    )

    const copy = await owner.query<{ id: string; key: string }>(
      'select id, key from api.duplicate_pipeline_definition($1::uuid, $2::uuid, $3, $4)',
      [WS, created.rows[0].id, 'copy_a_two', 'Copy A two'],
    )

    expect(copy.rows[0].key).toBe('copy_a_two')

    const versions = await owner.query(
      'select lifecycle, configuration from api.pipeline_definition_versions where definition_id = $1',
      [copy.rows[0].id],
    )

    expect(versions.rows).toHaveLength(1)
    expect(versions.rows[0].lifecycle).toBe('draft')
    expect(versions.rows[0].configuration.mode).toBe('simple')
    expect(versions.rows[0].configuration.recipe).toEqual(RECIPE)
  })

  it('refuses a key that is taken', async () => {
    const definition = await pipeline('copy_b')
    const created = await version(definition, config('standard'))

    await expect(
      owner.query(
        'select api.duplicate_pipeline_definition($1::uuid, $2::uuid, $3, $4)',
        [WS, created.rows[0].id, 'copy_b', 'Copy B'],
      ),
    ).rejects.toThrow()
  })
})

describe('Inbox items from a pipeline', () => {
  it('leaves an item for someone in the workspace and refuses a stranger', async () => {
    const { rows } = await owner.query<{ id: string; title: string }>(
      `select id, title from api.create_inbox_item($1::uuid, $2, 'Check the readings')`,
      [WS, OWNER],
    )

    expect(rows[0].title).toBe('Check the readings')

    await expect(
      owner.query(
        `select api.create_inbox_item($1::uuid, 'nobody-here', 'Hello')`,
        [WS],
      ),
    ).rejects.toThrow()

    await expect(
      owner.query(`select api.create_inbox_item($1::uuid, $2, '   ')`, [
        WS,
        OWNER,
      ]),
    ).rejects.toThrow()
  })

  it('lists the stock that expires soon in one item, and nothing when none does', async () => {
    const none = await owner.query<{ result: { count: number } }>(
      `select api.list_expiring_materials($1::uuid, $2, 30) as result`,
      [WS, OWNER],
    )

    expect(none.rows[0].result.count).toBe(0)

    const soon = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10)

    await migrator.query(
      `insert into api.records(workspace_id, kind, identifier, title, status, created_by_user_id, properties)
       values ($1, 'material', 'RGT-EXP-1', 'Buffer', 'available', $2, $3::jsonb)`,
      [WS, OWNER, JSON.stringify({ lot: 'L7', expiry: soon })],
    )

    const found = await owner.query<{
      result: { count: number; created: boolean }
    }>(`select api.list_expiring_materials($1::uuid, $2, 30) as result`, [
      WS,
      OWNER,
    ])

    expect(found.rows[0].result).toMatchObject({ count: 1, created: true })

    const item = await migrator.query<{ title: string; body: string }>(
      `select title, body from api.pipeline_inbox_items where workspace_id = $1 and title like '%expire%'`,
      [WS],
    )

    expect(item.rows[0].title).toBe('1 material expires within 30 days')
    expect(item.rows[0].body).toContain('RGT-EXP-1 Buffer (lot L7)')
  })

  it('lists every lot, however many there are', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10)

    await migrator.query(
      `insert into api.records(workspace_id, kind, identifier, title, status, created_by_user_id, properties)
       select $1, 'material', 'RGT-MANY-' || n, 'Reagent', 'available', $2, $3::jsonb
         from generate_series(1, 75) n`,
      [WS, OWNER, JSON.stringify({ lot: 'M', expiry: soon })],
    )

    const found = await owner.query<{ result: { count: number } }>(
      `select api.list_expiring_materials($1::uuid, $2, 30) as result`,
      [WS, OWNER],
    )

    expect(found.rows[0].result.count).toBe(76)

    const item = await migrator.query<{ body: string }>(
      `select body from api.pipeline_inbox_items where workspace_id = $1 and title like '76 %'`,
      [WS],
    )

    expect(item.rows[0].body.split('\n')).toHaveLength(76)
  })
})
