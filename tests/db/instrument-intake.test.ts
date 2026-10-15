/**
 * R5-CONFIG-02 — an instrument declares how its data arrives.
 *
 * The intake method is instrument configuration: it says who writes the data and therefore what
 * its provenance is. A writer records it when registering and may change it later, and changing
 * it is configuration for future data only — an import already committed keeps the parser and
 * source provenance it arrived with, and the instrument's own history records only name,
 * location and qualified-for. A viewer and another workspace are refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000001770a'
const WS_B = '00000000-0000-4000-8000-00000001770b'
const OWNER = 'intake-owner'
const VIEWER = 'intake-viewer'
const OUTSIDER = 'intake-outsider'

const DATASET = '00000000-0000-4000-8000-0000000177d0'
const SCHEMA = '00000000-0000-4000-8000-0000000177d1'
const SCHEMA_VERSION = '00000000-0000-4000-8000-0000000177d2'
const DATASET_VERSION = '00000000-0000-4000-8000-0000000177d3'
const IMPORT_FILE = '00000000-0000-4000-8000-0000000177d4'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','intake-owner@test.invalid',true),
     ($2,'Viewer','intake-viewer@test.invalid',true),
     ($3,'Outsider','intake-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'intake-a','Intake A'),($2,'intake-b','Intake B')`,
    [WS, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$3,'owner'),($1,$4,'viewer'),($2,$5,'owner')`,
    [WS, WS_B, OWNER, VIEWER, OUTSIDER],
  )
  // A committed import whose provenance was frozen at commit time.
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle,created_by_user_id)
     values($1,$2,'r5_config_02','R5-CONFIG-02','active',$3)`,
    [SCHEMA, WS, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,revision,created_by_user_id)
     values($1,$2,1,'active',1,$3)`,
    [SCHEMA_VERSION, SCHEMA, OWNER],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,lifecycle,revision,intended_use,created_by_user_id)
     values($1,$2,$3,'Intake readings','active',1,'exploratory_research',$4)`,
    [DATASET, WS, SCHEMA_VERSION, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_versions(id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id)
     values($1,$2,$3,$4,1,'v1',$5)`,
    [DATASET_VERSION, DATASET, WS, SCHEMA_VERSION, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format,status,created_by_user_id)
     values($1,$2,'readings.csv',128,repeat('c',64),'r5-config-02/readings.csv','csv','stored',$3)`,
    [IMPORT_FILE, WS, OWNER],
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
  await setActorJwt(client, user, workspace)
  return client
}

async function register(
  client: Client,
  name: string,
  serial: string,
  intakeMethod?: string,
): Promise<{ id: string; intake_method: string }> {
  const { rows } = await client.query<{ id: string; intake_method: string }>(
    intakeMethod
      ? `select * from api.create_instrument($1,$2,'qpcr','Model X',$3,'Vendor','Lab 2',$4,'{}'::jsonb,0,$5)`
      : `select * from api.create_instrument($1,$2,'qpcr','Model X',$3,'Vendor','Lab 2',$4)`,
    intakeMethod
      ? [WS, name, serial, OWNER, intakeMethod]
      : [WS, name, serial, OWNER],
  )
  return rows[0]!
}

async function seedImport(instrumentId: string): Promise<string> {
  const id = '00000000-0000-4000-8000-0000000177e0'
  await migrator.query(
    `insert into api.dataset_imports(id,workspace_id,dataset_id,instrument_id,file_id,mapping,outcome,
       status,idempotency_key,imported_row_ids,parser_provenance,source_provenance,created_by_user_id,snapshot_version_id)
     values($1,$2,$3,$4,$5,'{}'::jsonb,'"succeeded"'::jsonb,'committed','r5-config-02-import','[]'::jsonb,
       '{"parserKey":"turbidimeter","version":2}'::jsonb,'{"filename":"readings.csv","method":"filedrop"}'::jsonb,$6,$7)`,
    [id, WS, DATASET, instrumentId, IMPORT_FILE, OWNER, DATASET_VERSION],
  )
  return id
}

describe('R5-CONFIG-02 instrument intake method', () => {
  it('records the method a writer registers with, defaulting to none', async () => {
    const owner = await actor(OWNER)
    const dropped = await register(
      owner,
      'Turbidimeter TB-02',
      'IN-0001',
      'filedrop',
    )
    expect(dropped.intake_method).toBe('filedrop')
    // Omitting the method keeps the conservative default: nothing arrives.
    const bare = await register(owner, 'Balance BAL-03', 'IN-0002')
    expect(bare.intake_method).toBe('none')
  })

  it('refuses a method outside the supported set', async () => {
    const owner = await actor(OWNER)
    await expect(
      register(owner, 'Osmometer OS-01', 'IN-0003', 'carrier_pigeon'),
    ).rejects.toThrow(/invalid intake method/)
  })

  it('lets a writer change the method, and refuses a viewer and another workspace', async () => {
    const owner = await actor(OWNER)
    const instrument = await register(
      owner,
      'Plate reader PR-01',
      'IN-0004',
      'none',
    )
    const changed = await owner.query(
      `select * from api.set_instrument_intake_method($1,'manual')`,
      [instrument.id],
    )
    expect(changed.rows[0]!.intake_method).toBe('manual')

    const viewer = await actor(VIEWER)
    await expect(
      viewer.query(
        `select * from api.set_instrument_intake_method($1,'webhook')`,
        [instrument.id],
      ),
    ).rejects.toThrow(/instrument denied/)

    const outsider = await actor(OUTSIDER, WS_B)
    await expect(
      outsider.query(
        `select * from api.set_instrument_intake_method($1,'webhook')`,
        [instrument.id],
      ),
    ).rejects.toThrow(/instrument denied/)
  })

  it('changes future configuration without rewriting an import’s provenance or history', async () => {
    const owner = await actor(OWNER)
    const instrument = await register(
      owner,
      'ÄKTA system',
      'IN-0005',
      'filedrop',
    )
    const importId = await seedImport(instrument.id)
    const before = await migrator.query(
      `select parser_provenance,source_provenance,status from api.dataset_imports where id=$1`,
      [importId],
    )
    const historyBefore = await owner.query(
      `select event_id from api.instrument_history($1)`,
      [instrument.id],
    )

    await owner.query(
      `select * from api.set_instrument_intake_method($1,'webhook')`,
      [instrument.id],
    )

    const after = await migrator.query(
      `select parser_provenance,source_provenance,status from api.dataset_imports where id=$1`,
      [importId],
    )
    expect(after.rows[0]).toEqual(before.rows[0])
    // The method is not one of the fields the instrument's history tracks, so the change writes
    // no event: history is not rewritten to look as though the data always arrived this way.
    const historyAfter = await owner.query(
      `select event_id from api.instrument_history($1)`,
      [instrument.id],
    )
    expect(historyAfter.rows).toEqual(historyBefore.rows)
    const row = await owner.query(
      `select intake_method from api.instruments where id=$1`,
      [instrument.id],
    )
    expect(row.rows[0]!.intake_method).toBe('webhook')
  })
})
