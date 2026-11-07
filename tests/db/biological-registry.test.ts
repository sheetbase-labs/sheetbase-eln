/**
 * Registries: a record model ticked as a registry gets a duplicate check that
 * the database enforces, lineage without loops, and ready-made starter
 * registries. Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e701'
const OTHER_WS = '00000000-0000-4000-8000-00000000e702'
const PROJECT = '00000000-0000-4000-8000-00000000e711'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000e712'
const OWNER = 'reg-owner'
const VIEWER = 'reg-viewer'
const STRANGER = 'reg-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client
let stranger: Client

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

const CONSTRUCT_FIELDS = [
  { field_name: 'purpose', label: 'Purpose' },
  { field_name: 'sequence_fingerprint', label: 'Sequence fingerprint' },
]
const ANTIBODY_FIELDS = [
  { field_name: 'vendor', label: 'Vendor' },
  { field_name: 'catalogue_number', label: 'Catalogue number' },
]

async function starter(
  client: Client,
  key: string,
  prefix: string,
  fields: object[],
  keys: string[],
  sequence: string | null = null,
) {
  const { rows } = await client.query(
    `select * from api.create_registry_model($1,$2,$3,null,$4::jsonb,$5,$6)`,
    [key, key, prefix, JSON.stringify(fields), keys, sequence],
  )
  return rows[0]
}

async function create(
  kind: string,
  title: string,
  custom: Record<string, string> = {},
  opts: { allow?: boolean; client?: Client; project?: string } = {},
) {
  const { rows } = await (opts.client ?? owner).query(
    `select * from api.create_registry_entry($1,$2,$3,$4::jsonb,$5)`,
    [
      opts.project ?? PROJECT,
      kind,
      title,
      JSON.stringify(custom),
      opts.allow ?? false,
    ],
  )
  return rows[0] as { id: string; identifier: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','reg-owner@test.invalid',true),
      ('${VIEWER}','Viewer','reg-viewer@test.invalid',true),
      ('${STRANGER}','Stranger','reg-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','registry','Registry'),
      ('${OTHER_WS}','registry-other','Registry other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer'),
      ('${OTHER_WS}','${STRANGER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT}','${WS}','reg','Registry','${OWNER}'),
      ('${OTHER_PROJECT}','${OTHER_WS}','rego','Registry other','${STRANGER}')`)
  owner = await actor(OWNER)
  viewer = await actor(VIEWER)
  stranger = await actor(STRANGER, OTHER_WS)
  await starter(
    owner,
    'construct',
    'CON',
    CONSTRUCT_FIELDS,
    ['sequence_fingerprint'],
    'sequence_fingerprint',
  )
  await starter(owner, 'antibody', 'AB', ANTIBODY_FIELDS, [
    'vendor',
    'catalogue_number',
  ])
  await starter(stranger, 'construct', 'CON', CONSTRUCT_FIELDS, [
    'sequence_fingerprint',
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('making a registry', () => {
  it('ticks a model and keeps its settings', async () => {
    const { rows } = await migrator.query(
      `select c.settings, m.lifecycle
         from api.record_models m
         join api.model_capabilities c
           on c.workspace_id = m.workspace_id and c.model_key = m.key and c.capability = 'registry'
        where m.workspace_id = $1 and m.key = 'antibody'`,
      [WS],
    )
    expect(rows[0]).toEqual({
      settings: {
        keyFields: ['vendor', 'catalogue_number'],
        sequenceField: null,
        structureField: null,
        lotKind: null,
      },
      lifecycle: 'published',
    })
  })

  it('can tick an ordinary model and untick it again, and only with real fields', async () => {
    await owner.query(
      `select api.create_workspace_model($1,'strain','Strain','STR',null)`,
      [WS],
    )
    await migrator.query(
      `insert into api.record_field_definitions
         (workspace_id,kind,field_name,label,display_order,logical_type,nullable,validation,lifecycle,created_by_user_id)
       values ($1,'strain','genotype','Genotype',1,'text',true,'{}','active',$2)`,
      [WS, OWNER],
    )
    const registrySettings = async () =>
      (
        await migrator.query(
          `select settings from api.model_capabilities
            where workspace_id = $1 and model_key = 'strain' and capability = 'registry'`,
          [WS],
        )
      ).rows[0]?.settings
    await owner.query(
      `select * from api.set_model_registry('strain',true,'{genotype}',null)`,
    )
    expect(await registrySettings()).toMatchObject({ keyFields: ['genotype'] })
    await expect(
      owner.query(`select api.set_model_registry('strain',true,'{nope}',null)`),
    ).rejects.toThrow(/no active field/)
    await owner.query(
      `select * from api.set_model_registry('strain',false,'{}',null)`,
    )
    expect(await registrySettings()).toBeUndefined()
  })

  it('needs schema rights', async () => {
    await expectDenied(
      viewer.query(`select api.set_model_registry('antibody',false,'{}',null)`),
      '42501',
    )
  })
})

describe('numbering', () => {
  it('gives each entry the model number and never reuses one', async () => {
    const a = await create('construct', 'pUC19', {
      sequence_fingerprint: 'seq:1',
    })
    const b = await create('construct', 'pUC57', {
      sequence_fingerprint: 'seq:2',
    })
    expect(a.identifier).toBe('CON-0001')
    expect(b.identifier).toBe('CON-0002')
    await owner.query(`select api.archive_record($1, 1)`, [b.id])
    const c = await create('construct', 'pUC118', {
      sequence_fingerprint: 'seq:3',
    })
    expect(c.identifier).toBe('CON-0003')
  })

  it('numbers separately in each workspace', async () => {
    const other = await create(
      'construct',
      'pUC19',
      {},
      { client: stranger, project: OTHER_PROJECT },
    )
    expect(other.identifier).toBe('CON-0001')
  })
})

describe('duplicate check', () => {
  it('refuses the same key fields and the same name, in the database', async () => {
    await create('construct', 'pGEX', { sequence_fingerprint: 'seq:abc' })
    await expect(
      create('construct', 'Another name', { sequence_fingerprint: 'seq:abc' }),
    ).rejects.toMatchObject({ code: 'SB012' })
    await expect(create('construct', '  pgex ')).rejects.toMatchObject({
      code: 'SB012',
    })
    await expect(
      owner.query(
        `select * from api.create_model_record($1,'construct','Plain create','draft','{}','{}'::jsonb,'{"sequence_fingerprint":"seq:abc"}'::jsonb)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB012' })
  })

  it('needs every key field to match, so a shared vendor alone is fine', async () => {
    await create('antibody', 'Anti-actin', {
      vendor: 'Abcam',
      catalogue_number: 'ab8226',
    })
    await create('antibody', 'Anti-tubulin', {
      vendor: 'Abcam',
      catalogue_number: 'ab7291',
    })
    await expect(
      create('antibody', 'Actin again', {
        vendor: ' ABCAM ',
        catalogue_number: 'AB8226',
      }),
    ).rejects.toMatchObject({ code: 'SB012' })
  })

  it('reports matches, exact first, and lets a repeat through on purpose', async () => {
    const { rows } = await owner.query(
      `select * from api.registry_find_duplicates('construct','pgex','{"sequence_fingerprint":"seq:abc"}'::jsonb)`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].match).toBe('exact')
    const again = await create(
      'construct',
      'pGEX',
      { sequence_fingerprint: 'seq:abc' },
      { allow: true },
    )
    expect(again.identifier).toMatch(/^CON-/)
    await expect(create('construct', 'pGEX')).rejects.toMatchObject({
      code: 'SB012',
    })
  })

  it('catches a repeat made by editing, and sees retired entries too', async () => {
    const e = await create('construct', 'Editable', {
      sequence_fingerprint: 'seq:edit',
    })
    await expect(
      owner.query(
        `update api.records set custom_fields = '{"sequence_fingerprint":"seq:abc"}' where id = $1`,
        [e.id],
      ),
    ).rejects.toMatchObject({ code: 'SB012' })
    const dup = await owner.query(
      `select * from api.registry_find_duplicates('construct','pUC57',null)`,
    )
    expect(dup.rows[0].archived).toBe(true)
  })

  it('does not compare across models or workspaces, and ignores unticked models', async () => {
    await create('antibody', 'pGEX', { vendor: 'x', catalogue_number: '1' })
    const theirs = await stranger.query(
      `select * from api.registry_find_duplicates('construct','pGEX','{"sequence_fingerprint":"seq:abc"}'::jsonb)`,
    )
    expect(theirs.rows).toHaveLength(0)
    const plain = await owner.query(
      `select * from api.registry_find_duplicates('experiment','pGEX',null)`,
    )
    expect(plain.rows).toHaveLength(0)
  })
})

describe('lineage', () => {
  it('records parents with their part and refuses a loop', async () => {
    const vector = await create('construct', 'Backbone', {
      sequence_fingerprint: 'seq:v',
    })
    const insert = await create('construct', 'Gene X', {
      sequence_fingerprint: 'seq:i',
    })
    const child = await create('construct', 'Backbone-GeneX', {
      sequence_fingerprint: 'seq:c',
    })
    await owner.query(`select api.add_registry_parent($1,$2,'vector')`, [
      child.id,
      vector.id,
    ])
    await owner.query(`select api.add_registry_parent($1,$2,'insert')`, [
      child.id,
      insert.id,
    ])
    const { rows } = await migrator.query(
      `select link_metadata ->> 'role' as role from api.record_links
        where source_record_id = $1 and link_type = 'upstream' order by 1`,
      [child.id],
    )
    expect(rows.map((r) => r.role)).toEqual(['insert', 'vector'])
    await expect(
      owner.query(`select api.add_registry_parent($1,$2,'parent')`, [
        vector.id,
        child.id,
      ]),
    ).rejects.toThrow(/descendant/)
    await expect(
      owner.query(`select api.add_registry_parent($1,$1,'parent')`, [
        vector.id,
      ]),
    ).rejects.toThrow(/itself/)
    await owner.query(`select api.remove_registry_parent($1,$2)`, [
      child.id,
      insert.id,
    ])
    const left = await migrator.query(
      `select count(*)::int as n from api.record_links where source_record_id = $1 and link_type = 'upstream'`,
      [child.id],
    )
    expect(left.rows[0].n).toBe(1)
  })

  it('links only registry entries, in the same workspace', async () => {
    const mine = await create('construct', 'Mine', {
      sequence_fingerprint: 'seq:m',
    })
    const theirs = await create(
      'construct',
      'Theirs',
      {},
      { client: stranger, project: OTHER_PROJECT },
    )
    await expect(
      owner.query(`select api.add_registry_parent($1,$2,'parent')`, [
        mine.id,
        theirs.id,
      ]),
    ).rejects.toThrow(/not found/)
    const { rows } = await owner.query(
      `select id from api.create_record($1::uuid,'sample','Miniprep','available',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT],
    )
    await expect(
      owner.query(`select api.add_registry_parent($1,$2,'parent')`, [
        mine.id,
        rows[0].id,
      ]),
    ).rejects.toThrow(/registry entries/)
  })
})

describe('access', () => {
  it('lets a viewer look but not add', async () => {
    await expectDenied(
      viewer.query(
        `select * from api.create_registry_entry($1,'construct','Nope','{}'::jsonb,false)`,
        [PROJECT],
      ),
      '42501',
    )
    const seen = await viewer.query(
      `select * from api.registry_find_duplicates('construct','pGEX',null)`,
    )
    expect(seen.rows.length).toBeGreaterThan(0)
  })

  it('refuses a model that is not a registry', async () => {
    await expect(
      owner.query(
        `select * from api.create_registry_entry($1,'experiment','x','{}'::jsonb,false)`,
        [PROJECT],
      ),
    ).rejects.toThrow(/not a registry/)
  })
})
