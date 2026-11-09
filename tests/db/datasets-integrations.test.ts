/**
 * Datasets integrations: measurement tables, value flags, kept snapshots,
 * intake problems and stored files emit change events (without storage keys),
 * and files can be attached to an import or an instrument run by id.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DATASET_OPERATIONS } from '../../src/features/datasets/operations'
import { PIPELINE_ACTIONS } from '../../src/lib/pipelines/actions'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000d1a0a'
const WS_B = '00000000-0000-4000-8000-0000000d1a0b'
const PROJECT = '00000000-0000-4000-8000-0000000d1a1a'
const RECORD = '00000000-0000-4000-8000-0000000d1a2a'
const FILE = '00000000-0000-4000-8000-0000000d1a3a'
const INSTRUMENT = '00000000-0000-4000-8000-0000000d1a4a'
const CONNECTOR = '00000000-0000-4000-8000-0000000d1a5a'
const OWNER = 'dsi-owner'
const VIEWER = 'dsi-viewer'
const OUTSIDER = 'dsi-outsider'
const KEY = `${FILE}/00000000-0000-4000-8000-000000001b02/0000000000000000000000000000aaaa`

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','dsi-owner@test.invalid',true),
     ($2,'Viewer','dsi-viewer@test.invalid',true),
     ($3,'Outsider','dsi-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'dsi-a','DSI A'),($2,'dsi-b','DSI B')`,
    [WS, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$3,'owner'),($1,$4,'viewer'),($2,$5,'owner')`,
    [WS, WS_B, OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'dsi','DSI',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values ($1,$2,$3,'file','FILE-DSI','Plate 7 CSV',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await migrator.query(
    `insert into api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum)
     values ($1,$2,$3,$4,'plate7.csv','text/csv',42,repeat('a',64))`,
    [FILE, WS, RECORD, KEY],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,owner_id) values ($1,$2,'Plate reader',$3)`,
    [INSTRUMENT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.connectors(id,workspace_id,key,name,connector_type) values ($1,$2,'dsi','DSI','instrument')`,
    [CONNECTOR, WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

interface Event {
  entity_type: string
  operation: string
  payload: Record<string, unknown> | null
  record: Record<string, unknown> | null
}

async function eventsFor(entityId: string): Promise<Event[]> {
  const { rows } = await migrator.query<Event>(
    `select entity_type, operation, payload, to_jsonb(e) - 'payload' as record
       from api.change_events e where entity_uuid = $1 order by sequence`,
    [entityId],
  )
  return rows
}

const ops = (events: Event[]) =>
  events.map((e) => `${e.entity_type}/${e.operation}`)

let counter = 0
async function makeTable(client: Client) {
  counter += 1
  return (
    await client.query(
      `select api.create_dataset_schema_definition($1,$2,'Plate','',
         '[{"key":"well","label":"Well","logical_type":"text","nullable":false}]'::jsonb) result`,
      [WS, `dsi_table_${counter}`],
    )
  ).rows[0].result as {
    schema_definition_id: string
    schema_version_id: string
  }
}

describe('measurement table events', () => {
  it('records create, draft edits, publish, retire and restore', async () => {
    const owner = await actor(OWNER)
    const table = await makeTable(owner)
    expect(ops(await eventsFor(table.schema_definition_id))).toEqual([
      'dataset_schema_definition/create',
    ])
    expect(ops(await eventsFor(table.schema_version_id))).toEqual([
      'dataset_schema_version/create',
    ])

    await owner.query(
      `select api.replace_dataset_schema_version_fields($1,
         '[{"key":"well","label":"Well","logical_type":"text","nullable":false},
           {"key":"od","label":"OD","logical_type":"decimal","nullable":true}]'::jsonb, null)`,
      [table.schema_version_id],
    )
    await owner.query(`select api.publish_dataset_schema_version($1)`, [
      table.schema_version_id,
    ])
    const version = await eventsFor(table.schema_version_id)
    expect(ops(version)).toEqual([
      'dataset_schema_version/create',
      'dataset_schema_version/update',
      'dataset_schema_version/update',
    ])
    expect(version.at(-1)?.payload).toMatchObject({ lifecycle: 'active' })
    // A published version only changes when it is published.
    expect(
      version.filter((e) => e.payload?.lifecycle === 'active'),
    ).toHaveLength(1)

    await owner.query(`select api.retire_dataset_schema_definition($1)`, [
      table.schema_definition_id,
    ])
    await owner.query(`select api.restore_dataset_schema_definition($1)`, [
      table.schema_definition_id,
    ])
    expect(ops(await eventsFor(table.schema_definition_id))).toEqual([
      'dataset_schema_definition/create',
      'dataset_schema_definition/archive',
      'dataset_schema_definition/restore',
    ])
  })

  it('builds a table that extends another the way the assistant card does', async () => {
    const owner = await actor(OWNER)
    const parent = await makeTable(owner)
    await owner.query(`select api.publish_dataset_schema_version($1)`, [
      parent.schema_version_id,
    ])
    counter += 1
    const child = (
      await owner.query(
        `select api.create_dataset_schema_subtype($1,$2,'Plate child',null) result`,
        [parent.schema_definition_id, `dsi_child_${counter}`],
      )
    ).rows[0].result as { schema_version_id: string }
    // The card reads the inherited fields as the API returns them, then adds its own.
    const inherited = (
      await owner.query(
        `select to_jsonb(f) as f from api.dataset_schema_version_fields f
          where schema_version_id = $1 order by display_order`,
        [child.schema_version_id],
      )
    ).rows.map((row: { f: unknown }) => row.f)
    expect(inherited).toHaveLength(1)
    await owner.query(
      `select api.replace_dataset_schema_version_fields($1, $2::jsonb, null)`,
      [
        child.schema_version_id,
        JSON.stringify([
          ...inherited,
          {
            field_id: null,
            key: 'od',
            label: 'OD',
            description: null,
            logical_type: 'decimal',
            nullable: true,
          },
        ]),
      ],
    )
    const { rows } = await owner.query<{ key: string }>(
      `select key from api.dataset_schema_version_fields where schema_version_id = $1 order by display_order`,
      [child.schema_version_id],
    )
    expect(rows.map((r) => r.key)).toEqual(['well', 'od'])
  })

  it('records a discarded draft as a delete', async () => {
    const owner = await actor(OWNER)
    const table = await makeTable(owner)
    await owner.query(`select api.delete_dataset_schema_version($1)`, [
      table.schema_version_id,
    ])
    expect(ops(await eventsFor(table.schema_version_id))).toEqual([
      'dataset_schema_version/create',
      'dataset_schema_version/delete',
    ])
  })

  it('shows events only to the workspace they belong to', async () => {
    const owner = await actor(OWNER)
    const table = await makeTable(owner)
    const outsider = await actor(OUTSIDER, WS_B)
    const { rows } = await outsider.query(
      `select 1 from api.change_events where entity_uuid = $1`,
      [table.schema_definition_id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('files by id', () => {
  it('adds a file someone can see to the import list, with an event that leaves out the storage key', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ id: string; storage_key: string }>(
      `select * from api.add_dataset_import_file($1,'csv')`,
      [FILE],
    )
    const added = rows[0]!
    expect(added.storage_key).toBe(KEY)
    const events = await eventsFor(added.id)
    expect(ops(events)).toEqual(['dataset_import_file/create'])
    expect(JSON.stringify(events)).not.toContain(KEY)
  })

  it('refuses a file the caller cannot see', async () => {
    const outsider = await actor(OUTSIDER, WS_B)
    await expect(
      outsider.query(`select * from api.add_dataset_import_file($1,'csv')`, [
        FILE,
      ]),
    ).rejects.toMatchObject({ code: 'SB106' })
    // A viewer of the workspace who cannot open the file's project.
    const viewer = await actor(VIEWER)
    await expect(
      viewer.query(`select * from api.add_dataset_import_file($1,'csv')`, [
        FILE,
      ]),
    ).rejects.toMatchObject({ code: 'SB106' })
  })

  it('attaches a file to an instrument run', async () => {
    const owner = await actor(OWNER)
    const run = (
      await migrator.query<{ id: string }>(
        `insert into api.instrument_runs(workspace_id,instrument_id,project_id,name,run_identifier)
         values ($1,$2,null,'Read 1','dsi-1') returning id`,
        [WS, INSTRUMENT],
      )
    ).rows[0]!
    const { rows } = await owner.query<{ id: string; file_id: string }>(
      `select * from api.attach_instrument_raw_file($1,$2)`,
      [run.id, FILE],
    )
    expect(rows[0]?.file_id).toBe(FILE)
    const events = await eventsFor(rows[0]!.id)
    expect(ops(events)).toEqual(['instrument_raw_file/create'])
    expect(JSON.stringify(events)).not.toContain(KEY)
  })
})

describe('intake problems', () => {
  it('records a problem and its resolution', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ id: string }>(
      `select (api.record_intake_failure($1,$2,'plate8.csv','upload','parse_failed','No header row')).id`,
      [WS, CONNECTOR],
    )
    const id = rows[0]!.id
    await owner.query(`select api.resolve_intake_failure($1,'dismissed')`, [id])
    expect(ops(await eventsFor(id))).toEqual([
      'intake_failure/create',
      'intake_failure/resolve',
    ])
  })
})

describe('registries', () => {
  const mine = new Set(DATASET_OPERATIONS.map((op) => op.name))

  it('accepts every datasets pipeline action', async () => {
    const actions = PIPELINE_ACTIONS.filter((a) => mine.has(a.operation))
    expect(actions.length).toBeGreaterThan(20)
    for (const action of actions) {
      const args = Object.fromEntries(
        action.arguments
          .filter((field) => field.required && !field.server)
          .map((field) => [field.name, 'x']),
      )
      const { rows } = await migrator.query(
        `SELECT internal.pipeline_action_errors($1::jsonb) AS errors`,
        [
          JSON.stringify([
            { name: 'step', operation: action.operation, arguments: args },
          ]),
        ],
      )
      expect(rows[0].errors, action.operation).toEqual([])
    }
  })

  it('lets every datasets event start a pipeline', async () => {
    const names = DATASET_OPERATIONS.flatMap((op) =>
      (op.events ?? []).map((event) => event.name),
    )
    for (const name of names) {
      const { rows } = await migrator.query(
        `SELECT api.normalize_pipeline_event_type($1) AS name`,
        [name],
      )
      expect(rows[0].name, name).toBe(name)
    }
  })

  it('lets agents discard a draft measurement table version, with a confirmation', async () => {
    const { rows } = await migrator.query(
      `SELECT internal.agent_action_always_never('delete_dataset_schema_version') AS never`,
    )
    expect(rows[0].never).toBe(false)
  })

  it('gives stewards the datasets views, without storage keys', async () => {
    const ready = (
      await migrator.query<{ ok: boolean }>(
        `SELECT internal.reporting_ready() AS ok`,
      )
    ).rows[0]!.ok
    if (!ready) return
    const names = await migrator.query<{ view_key: string; view_name: string }>(
      `SELECT view_key, view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1`,
      [WS],
    )
    const keys = names.rows.map((r) => r.view_key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'datasets',
        'dataset_snapshots',
        'measurement_tables',
        'dataset_value_flags',
        'dataset_import_files',
        'intake_failures',
        'instrument_raw_files',
        'data_exports',
        'column_promotions',
      ]),
    )
    for (const key of ['dataset_import_files', 'instrument_raw_files']) {
      const view = names.rows.find((r) => r.view_key === key)!
      const columns = await migrator.query<{ column_name: string }>(
        `SELECT attname AS column_name FROM pg_attribute
          WHERE attrelid = format('data.%I', $1::text)::regclass AND attnum > 0 AND NOT attisdropped`,
        [view.view_name],
      )
      expect(columns.rows.length).toBeGreaterThan(0)
      expect(columns.rows.map((c) => c.column_name)).not.toContain(
        'storage_key',
      )
    }
  })
})
