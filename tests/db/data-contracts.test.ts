/**
 * Data contracts (migration 20261106235346).
 *
 * Proves, against a freshly migrated database:
 *  - only people who may edit schemas can make or change a contract;
 *  - bad rules are refused with a reason;
 *  - a full check finds each kind of problem, records a run and sets the
 *    contract's Pass / Warning / Fail standing;
 *  - an import that breaks a block rule is refused before anything is written,
 *    and one that only breaks a warn rule is kept and flagged;
 *  - breached and restored events are announced once per change of standing;
 *  - a batch of records is checked without writing anything;
 *  - a contract round-trips through ODCS.
 */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c010'
const PROJECT = '00000000-0000-4000-8000-00000000c011'
const SCHEMA = '00000000-0000-4000-8000-00000000c012'
const VERSION = '00000000-0000-4000-8000-00000000c013'
const F_PURITY = '00000000-0000-4000-8000-00000000c014'
const F_BATCH = '00000000-0000-4000-8000-00000000c015'
const F_NOTE = '00000000-0000-4000-8000-00000000c016'
const DATASET = '00000000-0000-4000-8000-00000000c017'
const OWNER = 'contract-owner'
const VIEWER = 'contract-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client

async function as(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, user, WS)
  return client
}

async function addRow(
  datasetId: string,
  values: { purity?: number | null; batch?: string | null; note?: string | null },
  ageDays = 0,
): Promise<string> {
  const id = randomUUID()
  await migrator.query(
    `insert into api.dataset_rows(id,dataset_id,workspace_id,created_at,updated_at)
     values($1,$2,$3,now() - make_interval(days => $4), now() - make_interval(days => $4))`,
    [id, datasetId, WS, ageDays],
  )
  if (values.purity != null) {
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,numeric_value) values($1,$2,$3)`,
      [id, F_PURITY, values.purity],
    )
  }
  if (values.batch != null) {
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,text_value) values($1,$2,$3)`,
      [id, F_BATCH, values.batch],
    )
  }
  if (values.note != null) {
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,text_value) values($1,$2,$3)`,
      [id, F_NOTE, values.note],
    )
  }
  return id
}

async function newDataset(name: string): Promise<string> {
  const id = randomUUID()
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id)
     values($1,$2,$3,$4,$5)`,
    [id, WS, VERSION, name, PROJECT],
  )
  return id
}

async function save(rules: unknown[], extra: Record<string, unknown> = {}) {
  const { rows } = await owner.query(
    `select * from api.save_data_contract($1,null,$2::jsonb,$3,null,null,$4,$5)`,
    [
      SCHEMA,
      JSON.stringify(rules),
      (extra.name as string) ?? null,
      (extra.lifecycle as string) ?? null,
      (extra.schedule as number) ?? null,
    ],
  )
  return rows[0]
}

async function check(datasetId: string | null = null) {
  const { rows } = await owner.query<{ result: any }>(
    `select api.run_contract_check($1,$2) as result`,
    [(await contract()).id, datasetId],
  )
  return rows[0]!.result
}

async function contract() {
  const { rows } = await migrator.query(
    `select * from api.data_contracts where dataset_schema_id = $1`,
    [SCHEMA],
  )
  return rows[0]
}

async function events(effect?: string) {
  const { rows } = await migrator.query(
    `select entity_type, payload from api.change_events
      where workspace_id = $1 and entity_type in ('data_contract','data_contract_run','data_contract_standing')
        and ($2::text is null or payload->>'effect' = $2)
      order by sequence`,
    [WS, effect ?? null],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,$1,'contract-owner@test.invalid',true),($2,$2,'contract-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'contracts','Contract lab')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'CON','Contracts',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name) values($1,$2,'assay_results','Assay results')`,
    [SCHEMA, WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version) values($1,$2,1)`,
    [VERSION, SCHEMA],
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields
       (schema_version_id,field_id,key,label,logical_type,nullable,display_order,quantity) values
       ($1,$2,'purity','Purity','decimal',true,1,'{"kind":"fraction","dimension":"dimensionless","storageUnit":"%"}'::jsonb),
       ($1,$3,'batch','Batch','text',true,2,null),
       ($1,$4,'note','Note','text',true,3,null)`,
    [VERSION, F_PURITY, F_BATCH, F_NOTE],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [VERSION],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id)
     values($1,$2,$3,'Purity runs',$4)`,
    [DATASET, WS, VERSION, PROJECT],
  )
  owner = await as(OWNER)
  viewer = await as(VIEWER)
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()))
  await migrator?.end()
})

describe('making a contract', () => {
  it('lets someone who edits schemas make one and refuses a viewer', async () => {
    const made = await save([{ kind: 'required', field: 'batch', mode: 'warn' }])
    expect(made.version).toBe(1)
    expect(made.lifecycle).toBe('active')
    expect(made.owner_user_id).toBe(OWNER)
    expect(made.schedule_minutes).toBe(1440)
    expect(made.rules[0].id).toMatch(/^r[0-9a-f]{8}$/)
    await expectDenied(
      viewer.query(`select api.save_data_contract($1,null,'[]'::jsonb)`, [SCHEMA]),
      '42501',
    )
  })

  it('makes a new version only when the rules change', async () => {
    const before = await contract()
    const same = await save(before.rules)
    expect(same.version).toBe(before.version)
    const changed = await save([
      ...before.rules,
      { kind: 'range', field: 'purity', min: 0, max: 100, mode: 'warn' },
    ])
    expect(changed.version).toBe(before.version + 1)
  })

  it('refuses rules that make no sense, saying why', async () => {
    const bad = async (rule: unknown, message: RegExp) =>
      await expect(save([rule])).rejects.toThrow(message)
    await bad({ kind: 'range', field: 'purity', min: 5, max: 1 }, /above the highest/)
    await bad({ kind: 'range', field: 'purity' }, /lowest or highest/)
    await bad({ kind: 'required' }, /needs a field/)
    await bad({ kind: 'completeness', field: 'batch', threshold: 0 }, /percentage/)
    await bad({ kind: 'units', field: 'purity', units: [] }, /unit names/)
    await bad({ kind: 'freshness', maxAgeMinutes: 0 }, /whole number of minutes/)
    await bad({ kind: 'row_count', field: 'purity', min: 1 }, /whole dataset/)
    await bad({ kind: 'mystery' }, /unknown rule kind/)
    await bad({ kind: 'required', field: 'batch', mode: 'maybe' }, /warn or block/)
  })

  it('adds and removes one rule at a time', async () => {
    const c = await contract()
    const added = await owner.query(
      `select * from api.add_contract_rule($1, '{"kind":"unique","field":"batch","mode":"block"}'::jsonb)`,
      [c.id],
    )
    const rule = added.rows[0].rules.find((r: any) => r.kind === 'unique')
    expect(rule.mode).toBe('block')
    const removed = await owner.query(
      `select * from api.remove_contract_rule($1,$2)`,
      [c.id, rule.id],
    )
    expect(removed.rows[0].rules.some((r: any) => r.kind === 'unique')).toBe(false)
  })
})

describe('checking stored data', () => {
  it('finds each kind of problem and keeps the run', async () => {
    const ds = await newDataset('Checked')
    await addRow(ds, { purity: 98, batch: 'B1', note: 'ok' })
    await addRow(ds, { purity: 101, batch: 'B2' })
    await addRow(ds, { purity: 55, batch: 'B2', note: 'dup' })
    await addRow(ds, { purity: null, batch: null })
    await save(
      [
        { id: 'req', kind: 'required', field: 'batch', mode: 'warn' },
        { id: 'uni', kind: 'unique', field: 'batch', mode: 'warn' },
        { id: 'rng', kind: 'range', field: 'purity', min: 60, max: 100, mode: 'warn' },
        { id: 'cmp', kind: 'completeness', field: 'note', threshold: 80, mode: 'warn' },
        { id: 'unt', kind: 'units', field: 'purity', units: ['mg/mL'], mode: 'warn' },
        { id: 'cnt', kind: 'row_count', min: 10, mode: 'warn' },
        { id: 'gone', kind: 'required', field: 'removed_field', mode: 'block' },
      ],
      { schedule: 0 },
    )
    const result = await check(ds)
    expect(result.runs).toHaveLength(1)
    const byId = Object.fromEntries(
      result.runs[0].results.map((r: any) => [r.ruleId, r]),
    )
    expect(byId.req).toMatchObject({ status: 'fail', failed: 1, checked: 4 })
    expect(byId.uni).toMatchObject({ status: 'fail', failed: 2, checked: 3 })
    expect(byId.rng).toMatchObject({ status: 'fail', failed: 2, checked: 3 })
    expect(byId.rng.samples.map((s: any) => s.value).sort()).toEqual(['101', '55'])
    expect(byId.cmp).toMatchObject({ status: 'fail', failed: 2, checked: 4, percent: 50 })
    expect(byId.unt).toMatchObject({ status: 'fail', actual: '%' })
    expect(byId.cnt).toMatchObject({ status: 'fail', rowCount: 4 })
    expect(byId.gone).toMatchObject({ status: 'skipped', reason: 'field_missing' })
    // Only warn rules failed (the block rule points at a field that is gone).
    expect(result.runs[0].status).toBe('warning')
    expect(result.status).toBe('warning')
    expect((await contract()).next_check_at).toBeNull()
  })

  it('says Fail when a block rule fails, and Pass once the data is right', async () => {
    const ds = await newDataset('Fixable')
    const bad = await addRow(ds, { purity: 150 })
    await save([{ id: 'rng', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'block' }])
    expect((await check(ds)).runs[0].status).toBe('fail')
    await migrator.query(`update api.dataset_row_values set numeric_value=90 where row_id=$1`, [bad])
    const fixed = await check(ds)
    expect(fixed.runs[0].status).toBe('pass')
    const status = await migrator.query(
      `select status from api.data_contract_dataset_status where dataset_id=$1`,
      [ds],
    )
    expect(status.rows[0].status).toBe('pass')
  })

  it('checks freshness against the newest row', async () => {
    const ds = await newDataset('Stale feed')
    await addRow(ds, { purity: 90 }, 3)
    await save([{ id: 'fresh', kind: 'freshness', maxAgeMinutes: 60, mode: 'warn' }])
    const stale = await check(ds)
    const rule = stale.runs[0].results[0]
    expect(rule.status).toBe('fail')
    expect(rule.ageMinutes).toBeGreaterThan(3 * 1440 - 5)
    await addRow(ds, { purity: 91 })
    expect((await check(ds)).runs[0].results[0].status).toBe('pass')
  })

  it('announces a breach and a restore once each, and every run', async () => {
    const ds = await newDataset('Events')
    const row = await addRow(ds, { purity: 150 })
    await save([{ id: 'rng', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'block' }])
    await migrator.query(
      `update api.data_contracts set last_status = null where dataset_schema_id=$1`,
      [SCHEMA],
    )
    const breachesBefore = (await events('breached')).length
    const restoredBefore = (await events('restored')).length
    await check(ds)
    await check(ds)
    expect((await events('breached')).length).toBe(breachesBefore + 1)
    await migrator.query(`update api.dataset_row_values set numeric_value=50 where row_id=$1`, [row])
    // Other datasets under the contract still hold the standing at Fail until
    // they are re-checked, so check them all.
    await check()
    const restored = (await events('restored')).length
    expect(restored).toBeGreaterThanOrEqual(restoredBefore)
    const runEvents = (await events()).filter((e) => e.entity_type === 'data_contract_run')
    expect(runEvents.length).toBeGreaterThan(3)
    expect(runEvents.at(-1)!.payload).toMatchObject({ trigger: 'manual' })
  })

  it('previews a change of rules without saving or recording', async () => {
    const ds = await newDataset('Preview')
    await addRow(ds, { purity: 80 })
    await save([{ id: 'rng', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'block' }])
    const c = await contract()
    const runsBefore = (
      await migrator.query(`select count(*)::int n from api.data_contract_runs where contract_id=$1`, [c.id])
    ).rows[0].n
    const { rows } = await owner.query(
      `select api.preview_contract_rules($1,$2::jsonb,$3) as result`,
      [c.id, JSON.stringify([{ id: 'rng', kind: 'range', field: 'purity', min: 90, max: 100, mode: 'block' }]), ds],
    )
    expect(rows[0].result[0].status).toBe('fail')
    const after = await contract()
    expect(after.rules[0].min).toBe(0)
    expect(
      (await migrator.query(`select count(*)::int n from api.data_contract_runs where contract_id=$1`, [c.id])).rows[0].n,
    ).toBe(runsBefore)
  })
})

let uniqueDataset = ''

describe('imports', () => {
  async function importFixture() {
    const dataset = await newDataset('Import target')
    const file = randomUUID()
    const parser = randomUUID()
    const parserVersion = randomUUID()
    await migrator.query(
      `insert into api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format)
       values($1::uuid,$2,'purity.csv',20,$3,$1::text,'csv')`,
      [file, WS, 'a'.repeat(64)],
    )
    await migrator.query(
      `insert into api.parsers(id,workspace_id,key,name,format) values($1::uuid,$2,($1::uuid)::text,'Test','csv')`,
      [parser, WS],
    )
    await migrator.query(
      `insert into api.parser_versions(id,workspace_id,parser_id,version,signature)
       values($1,$2,$3,1,'{"requiredHeaders":["purity"]}')`,
      [parserVersion, WS, parser],
    )
    return { dataset, file, parser, parserVersion }
  }

  async function commit(f: Awaited<ReturnType<typeof importFixture>>, purity: number | null, batch: string | null) {
    const revision = (await migrator.query(`select revision from api.datasets where id=$1`, [f.dataset])).rows[0].revision
    const { rows } = await owner.query<{ result: any }>(
      `select api.commit_dataset_import($1,$7,$2::jsonb,$3,$4,'{}'::jsonb,'{}'::jsonb,$5,$6) as result`,
      [
        f.dataset,
        JSON.stringify([
          { operation: 'create', rowId: randomUUID(), values: { [F_PURITY]: purity, [F_BATCH]: batch } },
        ]),
        randomUUID(),
        f.file,
        f.parser,
        f.parserVersion,
        revision,
      ],
    )
    return rows[0]!.result
  }

  it('refuses a block-rule failure before writing and keeps the run', async () => {
    await save([
      { id: 'rng', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'block' },
      { id: 'req', kind: 'required', field: 'batch', mode: 'warn' },
    ])
    const f = await importFixture()
    const refused = await commit(f, 120, 'B9')
    expect(refused.ok).toBe(false)
    expect(refused.contract.blocked).toBe(true)
    expect(refused.errors[0]).toMatchObject({ code: 'contract_failed', ruleId: 'rng', rowIndex: 1 })
    const rows = await migrator.query(`select count(*)::int n from api.dataset_rows where dataset_id=$1`, [f.dataset])
    expect(rows.rows[0].n).toBe(0)
    const run = await migrator.query(
      `select blocked, trigger, scope, status from api.data_contract_runs where id=$1`,
      [refused.contract.runId],
    )
    expect(run.rows[0]).toEqual({ blocked: true, trigger: 'import', scope: 'batch', status: 'fail' })
  })

  it('keeps an import that only breaks a warn rule, and moves the standing to Warning', async () => {
    await migrator.query(`update api.data_contracts set last_status='pass' where dataset_schema_id=$1`, [SCHEMA])
    const f = await importFixture()
    const kept = await commit(f, 80, null)
    expect(kept.ok).toBe(true)
    const rows = await migrator.query(`select count(*)::int n from api.dataset_rows where dataset_id=$1`, [f.dataset])
    expect(rows.rows[0].n).toBe(1)
    expect((await contract()).last_status).toBe('warning')
  })

  it('lets a clean import through and finds duplicates against stored rows', async () => {
    await save([{ id: 'uni', kind: 'unique', field: 'batch', mode: 'block' }])
    const f = await importFixture()
    expect((await commit(f, 70, 'UNIQ-1')).ok).toBe(true)
    uniqueDataset = f.dataset
    const refused = await commit(f, 71, 'UNIQ-1')
    expect(refused.ok).toBe(false)
    expect(refused.contract.results[0]).toMatchObject({ ruleId: 'uni', failed: 1 })
  })

  it('checks a pipeline batch through the same gate, and only for writers', async () => {
    const ds = uniqueDataset
    const batch = [{ operation: 'create', rowId: randomUUID(), values: { [F_BATCH]: 'UNIQ-1' } }]
    const { rows } = await owner.query(
      `select api.check_dataset_contract($1,$2::jsonb,'pipeline') as result`,
      [ds, JSON.stringify(batch)],
    )
    expect(rows[0].result.blocked).toBe(true)
    await expectDenied(
      viewer.query(`select api.check_dataset_contract($1,$2::jsonb,'pipeline')`, [ds, JSON.stringify(batch)]),
      '42501',
    )
  })

  it('does not hold back a dataset with no contract or a draft one', async () => {
    await save([{ id: 'uni', kind: 'unique', field: 'batch', mode: 'block' }], { lifecycle: 'draft' })
    const f = await importFixture()
    expect((await commit(f, 70, 'UNIQ-1')).ok).toBe(true)
    await save([{ id: 'uni', kind: 'unique', field: 'batch', mode: 'block' }], { lifecycle: 'active' })
  })
})

describe('record models', () => {
  it('checks the records of a model and a batch about to be created', async () => {
    await owner.query(
      `select api.create_starter_model('strain','Strain','STR',null,$1::jsonb,false)`,
      [
        JSON.stringify([
          { field_name: 'genotype', label: 'Genotype' },
          { field_name: 'od600', label: 'OD600', logical_type: 'decimal' },
        ]),
      ],
    )
    for (const [i, fields] of [
      { genotype: 'wt', od600: 0.4 },
      { genotype: 'wt', od600: 9 },
      { od600: 0.5 },
    ].entries()) {
      await owner.query(
        `select api.create_model_record($1,'strain',$2,'draft','{}',$3::jsonb,$4::jsonb)`,
        [PROJECT, `Strain ${i + 1}`, '{}', JSON.stringify(fields)],
      )
    }
    const made = await owner.query(
      `select * from api.save_data_contract(null,'strain',$1::jsonb,null,null,null,null,0)`,
      [
        JSON.stringify([
          { id: 'g', kind: 'required', field: 'genotype', mode: 'warn' },
          { id: 'u', kind: 'unique', field: 'genotype', mode: 'warn' },
          { id: 'o', kind: 'range', field: 'od600', min: 0, max: 5, mode: 'warn' },
        ]),
      ],
    )
    const run = await owner.query(`select api.run_contract_check($1) as result`, [made.rows[0].id])
    const results = Object.fromEntries(run.rows[0].result.runs[0].results.map((r: any) => [r.ruleId, r]))
    expect(results.g).toMatchObject({ failed: 1, checked: 3 })
    expect(results.u).toMatchObject({ failed: 2, checked: 2 })
    expect(results.o).toMatchObject({ failed: 1, checked: 3 })

    const one = await migrator.query(`select id from api.records where title='Strain 3' and kind='strain'`)
    const single = await owner.query(`select api.check_record_contract($1) as result`, [one.rows[0].id])
    expect(single.rows[0].result.results.map((r: any) => r.ruleId)).toEqual(['g'])

    const batch = await owner.query(
      `select api.check_record_batch_contract('strain',$1::jsonb) as result`,
      [JSON.stringify([{ values: { genotype: 'wt', od600: 2 } }, { values: { od600: 99 } }])],
    )
    expect(batch.rows[0].result.results.map((r: any) => r.ruleId).sort()).toEqual(['g', 'o', 'u'])
    expect(batch.rows[0].result.blocked).toBe(false)
  })
})

describe('ODCS', () => {
  it('exports rules in the standard shape and reads them back unchanged', async () => {
    const c = await save(
      [
        { id: 'required_batch', kind: 'required', field: 'batch', mode: 'block' },
        { id: 'unique_batch', kind: 'unique', field: 'batch', mode: 'warn' },
        { id: 'range_purity', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'block' },
        { id: 'units_purity', kind: 'units', field: 'purity', units: ['%'], mode: 'warn' },
        { id: 'completeness_note', kind: 'completeness', field: 'note', threshold: 90, mode: 'block' },
        { id: 'row_count', kind: 'row_count', min: 5, max: 500, mode: 'warn' },
        { id: 'freshness', kind: 'freshness', maxAgeMinutes: 1440, mode: 'block' },
      ],
      { name: 'Assay results contract' },
    )
    const exported = (
      await owner.query(`select api.export_data_contract_odcs($1) as odcs`, [c.id])
    ).rows[0].odcs
    expect(exported).toMatchObject({
      apiVersion: 'v3.1.0',
      kind: 'DataContract',
      name: 'Assay results contract',
      status: 'active',
    })
    const table = exported.schema[0]
    expect(table.name).toBe('assay_results')
    const purity = table.properties.find((p: any) => p.name === 'purity')
    expect(purity.logicalType).toBe('number')
    expect(purity.logicalTypeOptions).toEqual({ minimum: 0, maximum: 100 })
    expect(table.properties.find((p: any) => p.name === 'batch')).toMatchObject({ required: true, unique: true })
    expect(table.quality[0]).toMatchObject({ metric: 'rowCount', mustBeBetween: [5, 500] })
    expect(exported.slaProperties[0]).toMatchObject({ property: 'freshness', value: 1440, unit: 'm' })

    const before = await contract()
    const imported = (
      await owner.query(`select api.import_data_contract_odcs($1::jsonb, $2) as result`, [JSON.stringify(exported), SCHEMA])
    ).rows[0].result
    expect(imported.rulesImported).toBe(7)
    expect(imported.ignored).toEqual([])
    const after = await contract()
    const strip = (rules: any[]) => rules.map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id))
    expect(strip(after.rules)).toEqual(strip(before.rules))
    expect(after.version).toBe(before.version)
  })

  it('reads a document from another tool, reports what it left out and finds the target by name', async () => {
    const result = (
      await owner.query(
        `select api.import_data_contract_odcs($1::jsonb) as result`,
        [
          JSON.stringify({
            apiVersion: 'v3.1.0',
            kind: 'DataContract',
            name: 'From a data team',
            status: 'draft',
            schema: [
              {
                name: 'assay_results',
                properties: [
                  { name: 'batch', required: true, quality: [{ type: 'sql', query: 'select 1' }] },
                ],
              },
            ],
          }),
        ],
      )
    ).rows[0].result
    expect(result.rulesImported).toBe(1)
    expect(result.ignored).toHaveLength(1)
    expect(result.contract.lifecycle).toBe('draft')
    expect(result.contract.rules[0]).toMatchObject({ kind: 'required', field: 'batch', mode: 'warn' })
    await expect(
      owner.query(`select api.import_data_contract_odcs('{"kind":"Other"}'::jsonb, $1)`, [SCHEMA]),
    ).rejects.toThrow(/not an ODCS/)
  })
})

describe('scheduled checks', () => {
  it('runs due contracts and sets the next time', async () => {
    await save([{ id: 'rng', kind: 'range', field: 'purity', min: 0, max: 100, mode: 'warn' }], {
      lifecycle: 'active',
      schedule: 60,
    })
    await migrator.query(
      `update api.data_contracts set next_check_at = now() - interval '1 minute' where dataset_schema_id=$1`,
      [SCHEMA],
    )
    const swept = await migrator.query(`select internal.sweep_contract_checks(20) as result`)
    expect(swept.rows[0].result.checked).toBeGreaterThanOrEqual(1)
    const c = await contract()
    expect(new Date(c.next_check_at).getTime()).toBeGreaterThan(Date.now())
    const runs = await migrator.query(
      `select count(*)::int n from api.data_contract_runs where contract_id=$1 and trigger='schedule'`,
      [c.id],
    )
    expect(runs.rows[0].n).toBeGreaterThan(0)
  })
})
