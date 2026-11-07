/**
 * Chemistry registration: a registry model that takes structures checks repeats
 * on the parent structure, makes lots, and finds compounds by structure. Runs
 * against a freshly migrated database; the structures are described with the
 * same OpenChemLib code the app uses.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadOcl } from '#/lib/chemistry-draw'
import type { Ocl } from '#/lib/chemistry-draw'
import {
  describeStructure,
  fingerprintOf,
  queryFragment,
  wireStructure,
} from '#/lib/compound-registry'
import type { StructureDescriptor } from '#/lib/compound-registry'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c701'
const OTHER_WS = '00000000-0000-4000-8000-00000000c702'
const PROJECT = '00000000-0000-4000-8000-00000000c711'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000c712'
const OWNER = 'chem-owner'
const VIEWER = 'chem-viewer'
const STRANGER = 'chem-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client
let stranger: Client
let ocl: Ocl

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

function describe_(smiles: string): StructureDescriptor {
  const d = describeStructure(ocl, smiles)
  if (!d) throw new Error(`unreadable: ${smiles}`)
  return d
}

async function register(
  smiles: string,
  title: string,
  opts: {
    allow?: boolean
    client?: Client
    kind?: string
    project?: string
  } = {},
) {
  const { rows } = await (opts.client ?? owner).query(
    `select * from api.register_compound($1,$2,$3,'{}'::jsonb,$4::jsonb,$5)`,
    [
      opts.project ?? PROJECT,
      opts.kind ?? 'compound',
      title,
      JSON.stringify(wireStructure(describe_(smiles))),
      opts.allow ?? false,
    ],
  )
  return rows[0] as {
    id: string
    identifier: string
    custom_fields: Record<string, unknown>
    metadata_version: number
  }
}

const FIELDS = [
  { field_name: 'structure', label: 'Structure' },
  { field_name: 'target', label: 'Target' },
]
const LOT_FIELDS = [{ field_name: 'lot_number', label: 'Lot number' }]

const ASPIRIN = 'CC(=O)Oc1ccccc1C(=O)O'
const NICOTINE = 'CN1CCC[C@H]1c1cccnc1'

beforeAll(async () => {
  ocl = await loadOcl()
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','chem-owner@test.invalid',true),
      ('${VIEWER}','Viewer','chem-viewer@test.invalid',true),
      ('${STRANGER}','Stranger','chem-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','chem','Chemistry'),
      ('${OTHER_WS}','chem-other','Chemistry other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer'),
      ('${OTHER_WS}','${STRANGER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT}','${WS}','chem','Chemistry','${OWNER}'),
      ('${OTHER_PROJECT}','${OTHER_WS}','cheo','Chemistry other','${STRANGER}')`)
  owner = await actor(OWNER)
  viewer = await actor(VIEWER)
  stranger = await actor(STRANGER, OTHER_WS)
  await owner.query(
    `select api.create_starter_model('compound_lot','Compound lot','LOT',null,$1::jsonb,false)`,
    [JSON.stringify(LOT_FIELDS)],
  )
  await owner.query(
    `select api.create_registry_model('compound','Compound','CMP',null,$1::jsonb,'{}',null)`,
    [JSON.stringify(FIELDS)],
  )
  await stranger.query(
    `select api.create_registry_model('compound','Compound','CMP',null,$1::jsonb,'{}',null)`,
    [JSON.stringify(FIELDS)],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('turning on structures', () => {
  it('is refused until the model is a registry with that field, and needs schema rights', async () => {
    await owner.query(
      `select api.create_workspace_model($1,'plain','Plain','PLN',null)`,
      [WS],
    )
    await expect(
      owner.query(`select api.set_model_chemistry('plain','structure',null)`),
    ).rejects.toThrow(/registry first/)
    await expect(
      owner.query(`select api.set_model_chemistry('compound','nope',null)`),
    ).rejects.toThrow(/no active field/)
    await expect(
      owner.query(
        `select api.set_model_chemistry('compound','structure','compound')`,
      ),
    ).rejects.toThrow(/another model/)
    await expect(register(ASPIRIN, 'Too early')).rejects.toThrow(
      /does not register structures/,
    )
    await expectDenied(
      viewer.query(
        `select api.set_model_chemistry('compound','structure',null)`,
      ),
      '42501',
    )
  })

  it('keeps the structure field and the lot model, and clears them with the registry', async () => {
    await owner.query(
      `select * from api.set_model_chemistry('compound','structure','compound_lot')`,
    )
    const { rows } = await owner.query(
      `select settings from api.model_capabilities
        where model_key = 'compound' and capability = 'registry'`,
    )
    expect(rows[0].settings).toMatchObject({
      structureField: 'structure',
      lotKind: 'compound_lot',
    })
    await stranger.query(
      `select api.set_model_chemistry('compound','structure',null)`,
    )
  })
})

describe('registering', () => {
  it('stores the structure in the field and a structure row beside the entry', async () => {
    const aspirin = await register(ASPIRIN, 'Aspirin')
    expect(aspirin.identifier).toBe('CMP-0001')
    expect(String(aspirin.custom_fields.structure)).toContain('M  END')
    const { rows } = await owner.query(
      `select parent_code, formula, mass::float8, salts from api.record_structures where record_id = $1`,
      [aspirin.id],
    )
    expect(rows[0].formula).toBe('C9H8O4')
    expect(rows[0].mass).toBeCloseTo(180.16, 1)
    expect(rows[0].salts).toEqual([])
  })

  it('refuses the same parent however it was drawn, but lets a repeat through on purpose', async () => {
    await expect(
      register('OC(=O)c1ccccc1OC(C)=O', 'Acetylsalicylic acid'),
    ).rejects.toMatchObject({ code: 'SB012' })
    const again = await register('OC(=O)c1ccccc1OC(C)=O', 'Aspirin, second', {
      allow: true,
    })
    expect(again.identifier).toBe('CMP-0002')
    // The flag lasts for that one call only.
    await expect(register(ASPIRIN, 'Aspirin, third')).rejects.toMatchObject({
      code: 'SB012',
    })
  })

  it('treats a salt or solvate as the same parent, and says it is a different form', async () => {
    const free = await register(NICOTINE, 'Nicotine')
    const salt = describe_('CN1CCC[C@H]1c1cccnc1.Cl.O')
    expect(salt.parentCode).toBe(describe_(NICOTINE).parentCode)
    await expect(
      register('CN1CCC[C@H]1c1cccnc1.Cl.O', 'Nicotine HCl hydrate'),
    ).rejects.toMatchObject({ code: 'SB012' })
    const { rows } = await owner.query(
      `select * from api.find_structure_duplicates('compound',$1,$2)`,
      [salt.parentCode, salt.drawnCode],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: free.id, same_form: false })
    const same = describe_(NICOTINE)
    const exact = await owner.query(
      `select * from api.find_structure_duplicates('compound',$1,$2)`,
      [same.parentCode, same.drawnCode],
    )
    expect(exact.rows[0].same_form).toBe(true)
  })

  it('tells enantiomers apart', async () => {
    await register('C[C@H](N)C(=O)O', 'L-alanine')
    const d = await register('C[C@@H](N)C(=O)O', 'D-alanine')
    expect(d.identifier).toMatch(/^CMP-/)
  })

  it('needs a structure and a registry that takes them', async () => {
    await expect(
      owner.query(
        `select * from api.register_compound($1,'compound','Blank','{}'::jsonb,'{}'::jsonb,false)`,
        [PROJECT],
      ),
    ).rejects.toThrow(/draw a structure/)
    await expect(
      register(ASPIRIN, 'Wrong model', { kind: 'compound_lot' }),
    ).rejects.toThrow(/does not register structures/)
  })

  it('announces a new compound to webhooks and the stream', async () => {
    const { rows } = await migrator.query<{
      operation: string
      payload: { identifier: string; formula: string }
    }>(
      `select operation, payload from api.change_events
        where workspace_id = $1 and entity_type = 'compound' order by sequence limit 1`,
      [WS],
    )
    expect(rows[0]).toMatchObject({
      operation: 'create',
      payload: { identifier: 'CMP-0001', formula: 'C9H8O4' },
    })
    const { rows: names } = await migrator.query(
      `select name from internal.webhook_event_names where name like 'compound.%' order by name`,
    )
    expect(names.map((n) => n.name)).toEqual([
      'compound.lot_added',
      'compound.registered',
      'compound.structure_changed',
    ])
  })
})

describe('changing a structure', () => {
  it('moves the entry to its new parent and still refuses a repeat', async () => {
    const entry = await register('c1ccccc1O', 'Phenol')
    const next = describe_('c1ccccc1N')
    const { rows } = await owner.query(
      `select * from api.set_record_structure($1,$2,$3::jsonb,false)`,
      [entry.id, entry.metadata_version, JSON.stringify(wireStructure(next))],
    )
    expect(rows[0].metadata_version).toBe(entry.metadata_version + 1)
    const parent = await owner.query(
      `select parent_code from api.record_structures where record_id = $1`,
      [entry.id],
    )
    expect(parent.rows[0].parent_code).toBe(next.parentCode)
    await expect(
      owner.query(
        `select * from api.set_record_structure($1,$2,$3::jsonb,false)`,
        [
          entry.id,
          entry.metadata_version + 1,
          JSON.stringify(wireStructure(describe_(ASPIRIN))),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB012' })
    await expect(
      owner.query(
        `select * from api.set_record_structure($1,1,$2::jsonb,false)`,
        [entry.id, JSON.stringify(wireStructure(next))],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('gives an older entry its first structure without editing it', async () => {
    const { rows } = await owner.query(
      `select * from api.create_registry_entry($1,'compound','Older entry',$2::jsonb,false)`,
      [PROJECT, JSON.stringify({ structure: describe_('CCO').molfile })],
    )
    const older = rows[0]
    expect(
      (
        await owner.query(
          `select 1 from api.record_structures where record_id = $1`,
          [older.id],
        )
      ).rowCount,
    ).toBe(0)
    await owner.query(`select api.index_record_structure($1,$2::jsonb)`, [
      older.id,
      JSON.stringify(wireStructure(describe_('CCO'))),
    ])
    const after = await owner.query(
      `select formula from api.record_structures where record_id = $1`,
      [older.id],
    )
    expect(after.rows[0].formula).toBe('C2H6O')
    await expectDenied(
      viewer.query(`select api.index_record_structure($1,$2::jsonb)`, [
        older.id,
        JSON.stringify(wireStructure(describe_('CCO'))),
      ]),
      '42501',
    )
  })
})

describe('lots', () => {
  it('adds a lot to a compound and lists it, in the compound’s project', async () => {
    const nicotine = (
      await owner.query(
        `select id from api.records where kind = 'compound' and title = 'Nicotine'`,
      )
    ).rows[0].id as string
    const { rows } = await owner.query(
      `select * from api.add_compound_lot($1,null,'Batch 1','{"lot_number":"B-001"}'::jsonb)`,
      [nicotine],
    )
    expect(rows[0].identifier).toBe('LOT-0001')
    expect(rows[0].project_id).toBe(PROJECT)
    await owner.query(`select api.add_compound_lot($1,null,null)`, [nicotine])
    const lots = await owner.query(`select * from api.list_compound_lots($1)`, [
      nicotine,
    ])
    expect(lots.rows.map((l) => l.title)).toEqual(['Batch 1', 'CMP-0003 lot'])
    expect(lots.rows[0].custom_fields).toEqual({ lot_number: 'B-001' })
    const { rows: events } = await migrator.query(
      `select payload from api.change_events
        where workspace_id = $1 and entity_type = 'compound_lot' order by sequence`,
      [WS],
    )
    expect(events).toHaveLength(2)
    expect(events[0].payload).toMatchObject({
      compound: 'CMP-0003',
      identifier: 'LOT-0001',
    })
  })

  it('needs a lot model and the right to write', async () => {
    const aspirin = (
      await owner.query(
        `select id from api.records where kind = 'compound' and title = 'Aspirin'`,
      )
    ).rows[0].id as string
    await expect(
      viewer.query(`select api.add_compound_lot($1,null,'Nope')`, [aspirin]),
    ).rejects.toThrow()
    await owner.query(
      `select api.set_model_chemistry('compound','structure',null)`,
    )
    await expect(
      owner.query(`select api.add_compound_lot($1,null,'Nope')`, [aspirin]),
    ).rejects.toThrow(/no lot model/)
    await owner.query(
      `select api.set_model_chemistry('compound','structure','compound_lot')`,
    )
  })
})

describe('searching', () => {
  async function search(
    query: string,
    mode: 'substructure' | 'similarity',
    opts: { kind?: string | null; min?: number; client?: Client } = {},
  ) {
    const fingerprint =
      mode === 'substructure'
        ? fingerprintOf(ocl, queryFragment(ocl, query)!)
        : describe_(query).fingerprint
    const { rows } = await (opts.client ?? owner).query(
      `select * from api.query_structures($1,$2,$3,$4)`,
      [fingerprint, mode, opts.kind ?? null, opts.min ?? 0.5],
    )
    return rows as {
      identifier: string
      title: string
      similarity: string
      parent_code: string
    }[]
  }

  it('narrows a substructure search by fingerprint', async () => {
    const hits = await search('c1ccccc1C(=O)O', 'substructure')
    const titles = hits.map((h) => h.title)
    expect(titles).toContain('Aspirin')
    expect(titles).not.toContain('Nicotine')
    expect(titles).not.toContain('Phenol')
  })

  it('ranks a similarity search by score and keeps the cut-off', async () => {
    const hits = await search(ASPIRIN, 'similarity', { min: 0.99 })
    expect(hits.map((h) => h.title)).toContain('Aspirin')
    expect(hits.every((h) => Number(h.similarity) >= 0.99)).toBe(true)
    const wide = await search(ASPIRIN, 'similarity', { min: 0.1 })
    const scores = wide.map((h) => Number(h.similarity))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(wide.length).toBeGreaterThan(hits.length)
  })

  it('agrees with the app on how alike two structures are', async () => {
    const hits = await search(ASPIRIN, 'similarity', { min: 0 })
    // The entry called Phenol was changed to aniline above.
    const phenol = hits.find((h) => h.title === 'Phenol')
    expect(phenol).toBeDefined()
    const a = describe_(ASPIRIN).fingerprint
    const { similarityOf } = await import('#/lib/compound-registry')
    const target = describe_('c1ccccc1N').fingerprint
    expect(Number(phenol!.similarity)).toBeCloseTo(
      similarityOf(ocl, a, target),
      3,
    )
  })

  it('only searches the chosen registry, and hides retired compounds unless asked', async () => {
    expect(
      await search(ASPIRIN, 'similarity', { kind: 'compound_lot' }),
    ).toEqual([])
    const entry = (
      await owner.query(
        `select id, metadata_version from api.records where kind = 'compound' and title = 'L-alanine'`,
      )
    ).rows[0]
    await owner.query(`select api.archive_record($1,$2)`, [
      entry.id,
      entry.metadata_version,
    ])
    const q = queryFragment(ocl, 'C[C@H](N)C(=O)O')!
    const hidden = await owner.query(
      `select title from api.query_structures($1,'substructure')`,
      [fingerprintOf(ocl, q)],
    )
    expect(hidden.rows.map((r) => r.title)).not.toContain('L-alanine')
    const shown = await owner.query(
      `select title from api.query_structures($1,'substructure',null,0.5,true)`,
      [fingerprintOf(ocl, q)],
    )
    expect(shown.rows.map((r) => r.title)).toContain('L-alanine')
  })

  it('never shows another workspace’s compounds', async () => {
    await register(ASPIRIN, 'Their aspirin', {
      client: stranger,
      project: OTHER_PROJECT,
    })
    const mine = await search(ASPIRIN, 'similarity', { min: 0.99 })
    expect(mine.map((h) => h.title)).not.toContain('Their aspirin')
    const theirs = await search(ASPIRIN, 'similarity', {
      min: 0.99,
      client: stranger,
    })
    expect(theirs.map((h) => h.title)).toEqual(['Their aspirin'])
    expect(
      (await stranger.query(`select 1 from api.record_structures`)).rowCount,
    ).toBe(1)
  })

  it('refuses a fingerprint that is not 128 hex digits', async () => {
    await expect(
      owner.query(`select * from api.query_structures('abc')`),
    ).rejects.toThrow(/128 hex/)
  })
  it('lets a pipeline start from the compound events and add a lot', async () => {
    const { rows } = await migrator.query(
      `select api.normalize_pipeline_event_type('compound.registered') as a,
              api.normalize_pipeline_event_type('compound.structure_changed') as b,
              api.normalize_pipeline_event_type('compound.lot_added') as c`,
    )
    expect(rows[0]).toEqual({
      a: 'compound.registered',
      b: 'compound.structure_changed',
      c: 'compound.lot_added',
    })
    const errors = await migrator.query(
      `select internal.pipeline_action_errors($1::jsonb) as errors`,
      [
        JSON.stringify([
          {
            name: 'lot',
            operation: 'add_compound_lot',
            arguments: {
              p_compound_id: '00000000-0000-4000-8000-000000000001',
            },
          },
          { name: 'bad', operation: 'add_compound_lot', arguments: {} },
        ]),
      ],
    )
    expect(errors.rows[0].errors).toHaveLength(1)
  })
})
