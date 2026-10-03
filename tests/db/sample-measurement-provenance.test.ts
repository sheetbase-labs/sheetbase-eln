/**
 * LAB-03 — sample measurement provenance.
 *
 * The sample Measurements tab reads `api.sample_measurement_provenance`, which
 * aggregates authoritative values from Dataset rows linked to the sample and
 * from instrument QC/integration, each with its source row. This suite proves:
 *
 *  - a value from a Dataset row linked by a `sample` reference field appears
 *    with its Dataset/row/field provenance;
 *  - a value from a row linked by a sample-keyed text field appears too;
 *  - an unlinked row in the same Dataset does not appear;
 *  - an integration/QC value appears with its run/instrument source;
 *  - the standalone `sample_measurements` bench surface is not aggregated;
 *  - another workspace's data is invisible and a non-member is refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ab01'
const OTHER_WS = '00000000-0000-4000-8000-00000000ab02'
const OWNER = 'smprov-owner'
const VIEWER = 'smprov-viewer'
const OUTSIDER = 'smprov-outsider'
const OTHER_OWNER = 'smprov-other'

const SAMPLE = '00000000-0000-4000-8000-00000000ab10'
const SAMPLE2 = '00000000-0000-4000-8000-00000000ab11'
const OTHER_SAMPLE = '00000000-0000-4000-8000-00000000ab12'

const DS_MAIN = '00000000-0000-4000-8000-00000000ab20'
const DS_TEXT = '00000000-0000-4000-8000-00000000ab21'
const DS_OTHER = '00000000-0000-4000-8000-00000000ab22'

const ROW_LINKED = '00000000-0000-4000-8000-00000000ab30'
const ROW_UNLINKED = '00000000-0000-4000-8000-00000000ab31'
const ROW_TEXT = '00000000-0000-4000-8000-00000000ab32'
const ROW_OTHER = '00000000-0000-4000-8000-00000000ab33'

const REF_FIELD = '00000000-0000-4000-8000-00000000ab40'
const METHOD_FIELD = '00000000-0000-4000-8000-00000000ab41'
const TITRE_FIELD = '00000000-0000-4000-8000-00000000ab42'
const TEXT_SAMPLE_FIELD = '00000000-0000-4000-8000-00000000ab43'
const TURBIDITY_FIELD = '00000000-0000-4000-8000-00000000ab44'

const INSTRUMENT = '00000000-0000-4000-8000-00000000ab50'
const RUN = '00000000-0000-4000-8000-00000000ab51'
const QC = '00000000-0000-4000-8000-00000000ab52'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

interface MeasurementWire {
  id: string
  measurement: string
  value: number | null
  valueText: string | null
  unit: string | null
  method: string | null
  source: string | null
  result: string | null
  measuredAt: string
  provenance: {
    kind: string
    datasetId: string | null
    datasetDisplayId: string | null
    datasetName: string | null
    rowId: string | null
    fieldId: string | null
    fieldKey: string | null
    sourceId: string | null
    runId: string | null
    runIdentifier: string | null
    instrumentId: string | null
    instrumentName: string | null
  }
}

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

async function provenance(client: Client, sampleId: string) {
  const { rows } = await client.query<{ result: MeasurementWire[] }>(
    `select api.sample_measurement_provenance($1) result`,
    [sampleId],
  )
  return rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,'Owner','smprov-owner@test.invalid',true),
       ($2,'Viewer','smprov-viewer@test.invalid',true),
       ($3,'Outsider','smprov-outsider@test.invalid',true),
       ($4,'Other','smprov-other@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER, OTHER_OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
       ($1,'smprov','SMPROV'),($2,'smprov2','SMPROV2')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
       ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OTHER_OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values
       ($1,$2,'sample','SMP-PROV','Harvest lot','available',$3),
       ($4,$2,'sample','SMP-PROV-2','Other lot','available',$3),
       ($5,$6,'sample','SMP-OTHER','Other workspace lot','available',$7)`,
    [SAMPLE, WS, OWNER, SAMPLE2, OTHER_SAMPLE, OTHER_WS, OTHER_OWNER],
  )

  // --- WS Dataset with a reference link, a method field and a titre field ---
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle)
     values
       ('00000000-0000-4000-8000-00000000ab60',$1,'prov_main','Provision main','active'),
       ('00000000-0000-4000-8000-00000000ab61',$1,'prov_text','Provision text','active'),
       ('00000000-0000-4000-8000-00000000ab62',$2,'prov_other','Provision other','active')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle)
     values
       ('00000000-0000-4000-8000-00000000ab70','00000000-0000-4000-8000-00000000ab60',1,'draft'),
       ('00000000-0000-4000-8000-00000000ab71','00000000-0000-4000-8000-00000000ab61',1,'draft'),
       ('00000000-0000-4000-8000-00000000ab72','00000000-0000-4000-8000-00000000ab62',1,'draft')`,
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields
       (schema_version_id,field_id,key,label,logical_type,nullable,quantity,relationship,cardinality,lifecycle,display_order)
     values
       ('00000000-0000-4000-8000-00000000ab70',$1,'sample','Sample','reference',true,NULL,
          '{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}'::jsonb,'one','active',1),
       ('00000000-0000-4000-8000-00000000ab70',$2,'method','Method','text',true,NULL,NULL,'one','active',2),
       ('00000000-0000-4000-8000-00000000ab70',$3,'capsid_titre','Capsid titre','decimal',true,
          '{"kind":"quantity","dimension":"titre","storageUnit":"cp/mL","symbol":"cp/mL"}'::jsonb,NULL,'one','active',3),
       ('00000000-0000-4000-8000-00000000ab71',$4,'sample','Sample','text',true,NULL,NULL,'one','active',1),
       ('00000000-0000-4000-8000-00000000ab71',$5,'turbidity','Turbidity','decimal',true,
          '{"kind":"quantity","dimension":"turbidity","storageUnit":"NTU","symbol":"NTU"}'::jsonb,NULL,'one','active',2),
       ('00000000-0000-4000-8000-00000000ab72',$1,'sample','Sample','reference',true,NULL,
          '{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}'::jsonb,'one','active',1),
       ('00000000-0000-4000-8000-00000000ab72',$3,'capsid_titre','Capsid titre','decimal',true,
          '{"kind":"quantity","dimension":"titre","storageUnit":"cp/mL","symbol":"cp/mL"}'::jsonb,NULL,'one','active',2)`,
    [REF_FIELD, METHOD_FIELD, TITRE_FIELD, TEXT_SAMPLE_FIELD, TURBIDITY_FIELD],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active'
      where id in ('00000000-0000-4000-8000-00000000ab70','00000000-0000-4000-8000-00000000ab71','00000000-0000-4000-8000-00000000ab72')`,
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,display_id,lifecycle)
     values
       ($1,$4,'00000000-0000-4000-8000-00000000ab70','Provision main','DS-9001','active'),
       ($2,$4,'00000000-0000-4000-8000-00000000ab71','Provision text','DS-9002','active'),
       ($3,$5,'00000000-0000-4000-8000-00000000ab72','Provision other','DS-9003','active')`,
    [DS_MAIN, DS_TEXT, DS_OTHER, WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id,status)
     values
       ($1,$4,$6,'recorded'),
       ($2,$4,$6,'recorded'),
       ($3,$5,$6,'recorded')`,
    [ROW_LINKED, ROW_UNLINKED, ROW_TEXT, DS_MAIN, DS_TEXT, WS],
  )
  await migrator.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id,status)
     values ($1,$2,$3,'recorded')`,
    [ROW_OTHER, DS_OTHER, OTHER_WS],
  )
  // Linked row: sample reference + method + titre.
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,reference_id) values ($1,$2,0,$3)`,
    [ROW_LINKED, REF_FIELD, SAMPLE],
  )
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,text_value) values ($1,$2,0,'EM-004')`,
    [ROW_LINKED, METHOD_FIELD],
  )
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values ($1,$2,0,8.6e11::numeric)`,
    [ROW_LINKED, TITRE_FIELD],
  )
  // Unlinked row in the same Dataset: references a different sample.
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,reference_id) values ($1,$2,0,$3)`,
    [ROW_UNLINKED, REF_FIELD, SAMPLE2],
  )
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values ($1,$2,0,999::numeric)`,
    [ROW_UNLINKED, TITRE_FIELD],
  )
  // Sample-keyed text link.
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,text_value) values ($1,$2,0,'SMP-PROV')`,
    [ROW_TEXT, TEXT_SAMPLE_FIELD],
  )
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values ($1,$2,0,310::numeric)`,
    [ROW_TEXT, TURBIDITY_FIELD],
  )
  // Other workspace: a row linked to its own sample. It must never surface for
  // the first workspace.
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,reference_id) values ($1,$2,0,$3)`,
    [ROW_OTHER, REF_FIELD, OTHER_SAMPLE],
  )
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values ($1,$2,0,777::numeric)`,
    [ROW_OTHER, TITRE_FIELD],
  )

  // --- Integration/QC on a run linked to the sample ---
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,display_id,instrument_type)
     values ($1,$2,'Endotoxin reader','INS-9001','other')`,
    [INSTRUMENT, WS],
  )
  await migrator.query(
    `insert into api.instrument_runs(id,workspace_id,instrument_id,name,run_identifier,status)
     values ($1,$2,$3,'QC run','RUN-9001','completed')`,
    [RUN, WS, INSTRUMENT],
  )
  await migrator.query(
    `insert into api.instrument_run_links(workspace_id,run_id,linked_record_id,linked_record_identifier,linked_record_title,link_type)
     values ($1,$2,$3,'SMP-PROV','Harvest lot','sample')`,
    [WS, RUN, SAMPLE],
  )
  await migrator.query(
    `insert into api.instrument_qc_checks(id,workspace_id,run_id,check_name,check_type,detail)
     values ($1,$2,$3,'Endotoxin','pass','{"value":0.8,"unit":"EU/mL"}'::jsonb)`,
    [QC, WS, RUN],
  )

  // --- Standalone bench-reading surface: must NOT be aggregated ---
  await migrator.query(
    `insert into api.sample_measurements(workspace_id,sample_record_id,name,value,unit,measured_at)
     values ($1,$2,'Bench reading',42,'TU/mL',now())`,
    [WS, SAMPLE],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('sample_measurement_provenance', () => {
  it('aggregates linked dataset and integration values with provenance', async () => {
    const owner = await actor(OWNER, WS)
    const rows = await provenance(owner, SAMPLE)

    expect(rows).toHaveLength(3)

    const titre = rows.find(
      (m) =>
        m.provenance.fieldKey === 'capsid_titre' &&
        m.provenance.datasetId === DS_MAIN,
    )
    expect(titre).toMatchObject({
      measurement: 'Capsid titre',
      value: 8.6e11,
      unit: 'cp/mL',
      method: 'EM-004',
      source: 'DS-9001',
    })
    expect(titre?.provenance).toMatchObject({
      kind: 'dataset',
      datasetId: DS_MAIN,
      datasetDisplayId: 'DS-9001',
      datasetName: 'Provision main',
      rowId: ROW_LINKED,
      fieldId: TITRE_FIELD,
    })

    // Sample-keyed text link resolves too.
    const turbidity = rows.find((m) => m.provenance.fieldKey === 'turbidity')
    expect(turbidity).toMatchObject({
      measurement: 'Turbidity',
      value: 310,
      unit: 'NTU',
    })
    expect(turbidity?.provenance).toMatchObject({
      kind: 'dataset',
      datasetId: DS_TEXT,
      rowId: ROW_TEXT,
    })

    // Integration/QC value with its run/instrument source.
    const qc = rows.find((m) => m.provenance.kind === 'integration')
    expect(qc).toMatchObject({
      measurement: 'Endotoxin',
      value: 0.8,
      unit: 'EU/mL',
      result: 'pass',
      source: 'QC · RUN-9001',
    })
    expect(qc?.provenance).toMatchObject({
      kind: 'integration',
      sourceId: QC,
      runId: RUN,
      runIdentifier: 'RUN-9001',
      instrumentId: INSTRUMENT,
      instrumentName: 'Endotoxin reader',
    })
  })

  it('does not include an unlinked dataset row in the same dataset', async () => {
    const owner = await actor(OWNER, WS)
    const rows = await provenance(owner, SAMPLE)
    expect(rows.some((m) => m.provenance.rowId === ROW_UNLINKED)).toBe(false)
    expect(rows.some((m) => m.value === 999)).toBe(false)
  })

  it('does not include another workspace’s data', async () => {
    const owner = await actor(OWNER, WS)
    const rows = await provenance(owner, SAMPLE)
    expect(rows.some((m) => m.provenance.datasetId === DS_OTHER)).toBe(false)
    expect(rows.some((m) => m.value === 777)).toBe(false)
  })

  it('does not aggregate the standalone sample_measurements surface', async () => {
    const owner = await actor(OWNER, WS)
    const rows = await provenance(owner, SAMPLE)
    expect(rows.some((m) => m.measurement === 'Bench reading')).toBe(false)
  })

  it('lets a viewer read and refuses a non-member', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(provenance(viewer, SAMPLE)).resolves.toHaveLength(3)

    const outsider = await actor(OUTSIDER, WS)
    await expect(provenance(outsider, SAMPLE)).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('refuses a sample in another workspace and keeps workspaces isolated', async () => {
    const owner = await actor(OWNER, WS)
    await expect(provenance(owner, OTHER_SAMPLE)).rejects.toMatchObject({
      code: '42501',
    })

    const other = await actor(OTHER_OWNER, OTHER_WS)
    const otherRows = await provenance(other, OTHER_SAMPLE)
    expect(otherRows).toHaveLength(1)
    expect(otherRows[0]).toMatchObject({ value: 777, source: 'DS-9003' })
    expect(otherRows.some((m) => m.provenance.datasetId === DS_MAIN)).toBe(
      false,
    )
  })
})
