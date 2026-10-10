/**
 * REV-04.1 — the evidence view compares a signed revision with live data.
 *
 * The frozen revision itself is carried by api.revision_evidence_package; this
 * read model reports what moved since: the record's name as signed versus now,
 * comments added after signing, and cited dataset versions against their latest.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000010000'
const PROJECT = '00000000-0000-4000-8000-000000010001'
const RECORD = '00000000-0000-4000-8000-000000010002'
const REVISION = '00000000-0000-4000-8000-000000010003'
const AUTHOR = 'rev041-author'

type Drift = {
  drifted: boolean
  record: { signedTitle: string | null; currentTitle: string; renamed: boolean }
  instruments: Array<{
    instrumentId: string
    displayId: string | null
    signedName: string | null
    currentName: string | null
    renamed: boolean
  }>
  datasets: Array<{
    changed: boolean
    citedVersionId: string
    latestVersionId: string | null
  }>
  commentsAfterSigning: number
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [AUTHOR, `${AUTHOR}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'rev041','REV-04.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'R41','Drift',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-DRIFT','Signed name','draft',$4)`,
    [RECORD, WS, PROJECT, AUTHOR],
  )
  await migrator.query(
    `insert into api.revisions(id,record_id,workspace_id,structure_version,metadata_version,
       metadata_snapshot,block_snapshot,integrity_digest,reason,created_by_user_id,created_at,updated_at)
     values($1,$2,$3,1,1,'{"title":"Signed name"}'::jsonb,'[]'::jsonb,repeat('a',64),'submit',$4,
            now() - interval '2 days', now() - interval '2 days')`,
    [REVISION, RECORD, WS, AUTHOR],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function drift(client: Client): Promise<Drift> {
  return (
    await client.query<{ result: Drift }>(
      'select api.revision_drift($1) as result',
      [REVISION],
    )
  ).rows[0]!.result
}

const INSTRUMENT = '00000000-0000-4000-8000-000000010010'

/** A frozen revision carrying the instrument names captured when it was signed. */
async function frozenWithInstrument(capturedName: string): Promise<void> {
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,connection_status,config,position,custom_fields,display_id)
     values($1,$2,$3,'qpcr','disconnected','{}'::jsonb,1,'{}'::jsonb,'INS-0001')
     on conflict (id) do update set name=excluded.name`,
    [
      INSTRUMENT,
      WS,
      capturedName === 'Signed instrument'
        ? capturedName
        : 'Current instrument',
    ],
  )
  await migrator.query(
    `update api.revisions
        set canonical_snapshot = jsonb_build_object(
          'formatVersion', 1,
          'instruments', jsonb_build_array(jsonb_build_object(
            'instrumentId', $2::uuid, 'displayId', 'INS-0001', 'name', $3::text)))
      where id = $1`,
    [REVISION, INSTRUMENT, capturedName],
  )
}

describe('REV-04.1 revision drift', () => {
  it('reports no drift while the record still matches what was signed', async () => {
    const result = await drift(await actor(AUTHOR))
    expect(result.drifted).toBe(false)
    expect(result.record).toMatchObject({
      signedTitle: 'Signed name',
      currentTitle: 'Signed name',
      renamed: false,
    })
    expect(result.commentsAfterSigning).toBe(0)
  })

  it('reports a renamed record with both names', async () => {
    await migrator.query(
      `update api.records set title='Renamed later' where id=$1`,
      [RECORD],
    )

    const result = await drift(await actor(AUTHOR))
    expect(result.drifted).toBe(true)
    expect(result.record).toMatchObject({
      signedTitle: 'Signed name',
      currentTitle: 'Renamed later',
      renamed: true,
    })

    await migrator.query(
      `update api.records set title='Signed name' where id=$1`,
      [RECORD],
    )
    expect((await drift(await actor(AUTHOR))).record.renamed).toBe(false)
  })

  it('captures the instrument names a record imports came through', async () => {
    // The capture itself: the association is the record's imports, so a record whose data came
    // through an instrument carries that instrument's name in the frozen envelope.
    const dataset = '00000000-0000-4000-8000-000000010020'
    const schemaVersion = '00000000-0000-4000-8000-000000010021'
    const schema = '00000000-0000-4000-8000-000000010023'
    await migrator.query(
      `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle,created_by_user_id)
       values($1,$2,'lab06_4','Lab 06.4','active',$3)`,
      [schema, WS, AUTHOR],
    )
    await migrator.query(
      `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,revision,created_by_user_id)
       values($1,$2,1,'active',1,$3)`,
      [schemaVersion, schema, AUTHOR],
    )
    await migrator.query(
      `insert into api.datasets(id,workspace_id,schema_version_id,name,lifecycle,revision,intended_use,created_by_user_id)
       values($1,$2,$3,'Imported readings','active',1,'exploratory_research',$4)`,
      [dataset, WS, schemaVersion, AUTHOR],
    )
    await migrator.query(
      `insert into api.instruments(id,workspace_id,name,instrument_type,connection_status,config,position,custom_fields,display_id)
       values($1,$2,'Captured instrument','qpcr','disconnected','{}'::jsonb,1,'{}'::jsonb,'INS-0002')
       on conflict (id) do nothing`,
      [INSTRUMENT, WS],
    )
    const version = '00000000-0000-4000-8000-000000010025'
    await migrator.query(
      `insert into api.dataset_versions(id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id)
       values($1,$2,$3,$4,1,'v1',$5)`,
      [version, dataset, WS, schemaVersion, AUTHOR],
    )
    const file = '00000000-0000-4000-8000-000000010024'
    await migrator.query(
      `insert into api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format,status,created_by_user_id)
       values($1,$2,'readings.csv',128,repeat('b',64),'lab06-4/readings.csv','csv','stored',$3)`,
      [file, WS, AUTHOR],
    )
    await migrator.query(
      `insert into api.dataset_imports(id,workspace_id,dataset_id,experiment_record_id,instrument_id,file_id,
         mapping,outcome,status,idempotency_key,imported_row_ids,parser_provenance,source_provenance,created_by_user_id,snapshot_version_id)
       values('00000000-0000-4000-8000-000000010022',$1,$2,$3,$4,$5,'{}'::jsonb,'"succeeded"'::jsonb,'committed','lab06-4-import','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,$6,$7)`,
      [WS, dataset, RECORD, INSTRUMENT, file, AUTHOR, version],
    )

    const { rows } = await migrator.query<{
      envelope: { instruments: unknown }
    }>(`select internal.build_revision_envelope($1) as envelope`, [RECORD])
    expect(rows[0]!.envelope.instruments).toEqual([
      {
        instrumentId: INSTRUMENT,
        displayId: 'INS-0002',
        name: 'Captured instrument',
      },
    ])
  })

  it('reports an instrument renamed since signing with both names', async () => {
    await frozenWithInstrument('Signed instrument')
    await migrator.query(
      `update api.instruments set name='Current instrument' where id=$1`,
      [INSTRUMENT],
    )
    const client = await actor(AUTHOR)
    const result = await drift(client)
    expect(result.instruments).toEqual([
      {
        instrumentId: INSTRUMENT,
        displayId: 'INS-0001',
        signedName: 'Signed instrument',
        currentName: 'Current instrument',
        renamed: true,
      },
    ])
    expect(result.drifted).toBe(true)
  })

  it('reports no instrument drift while the name still matches', async () => {
    await frozenWithInstrument('Current instrument')
    const client = await actor(AUTHOR)
    const result = await drift(client)
    expect(result.instruments).toHaveLength(1)
    expect(result.instruments[0]!.renamed).toBe(false)
    expect(result.instruments[0]!.signedName).toBe('Current instrument')
  })

  it('reports no instruments for a revision frozen before the capture existed', async () => {
    // A snapshot with no instruments section, which is what a revision signed before the
    // capture existed carries.
    await migrator.query(
      `update api.revisions set canonical_snapshot = '{"formatVersion":1}'::jsonb where id = $1`,
      [REVISION],
    )
    const client = await actor(AUTHOR)
    const result = await drift(client)
    expect(result.instruments).toEqual([])
  })

  it('counts comments added after the revision was frozen', async () => {
    await migrator.query(
      `insert into api.comments(id,root_id,workspace_id,record_id,revision_id,target_kind,target,body,author_user_id)
       values('00000000-0000-4000-8000-000000010004','00000000-0000-4000-8000-000000010004',
              $1,$2,$3,'revision','{}'::jsonb,'Added after signing',$4)`,
      [WS, RECORD, REVISION, AUTHOR],
    )

    const result = await drift(await actor(AUTHOR))
    expect(result.commentsAfterSigning).toBe(1)
    expect(result.drifted).toBe(true)
  })

  it('refuses a caller who cannot read the record', async () => {
    const outsider = 'rev041-outsider'
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [outsider, `${outsider}@test.invalid`],
    )
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('set role authenticated')
    await setActorJwt(client, outsider, WS)
    await expect(
      client.query('select api.revision_drift($1)', [REVISION]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
