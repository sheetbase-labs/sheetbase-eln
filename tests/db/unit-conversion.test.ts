/**
 * Unit conversion. A number typed with a unit ("2 g") into a column stored in
 * another unit of the same kind (mg) is stored in the column's unit (2000),
 * on dataset rows, a sheet's own cells and record fields alike. What was typed
 * is kept in api.quantity_entries. A unit of another kind is refused. The
 * database's unit table and conversions match src/lib/lab-units.ts.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LAB_UNITS, convertQuantity } from '#/lib/lab-units'
import { createAdHocTextField } from '#/lib/sheet-local-data'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '15000000-0000-4000-8000-0000000000f1'
const PROJECT = '15000000-0000-4000-8000-0000000000f2'
const OWNER = 'unit-conversion-owner'
const MASS = { kind: 'mass', dimension: 'mass', storageUnit: 'mg' }

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor() {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, OWNER, WS)

  return client
}

async function massDataset() {
  const key = `mass_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Weighing') returning id`,
      [WS, key],
    )
  ).rows[0]

  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]

  const field = (
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,quantity,display_order)
       values ($1,gen_random_uuid(),'mass','Mass','decimal',true,$2::jsonb,1) returning field_id`,
      [version.id, JSON.stringify(MASS)],
    )
  ).rows[0]

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Weighing') returning id`,
      [WS, version.id],
    )
  ).rows[0]

  return { datasetId: dataset.id as string, mass: field.field_id as string }
}

const rows = (values: unknown[], mass: string) =>
  JSON.stringify(
    values.map((value) => ({
      operation: 'create',
      rowId: crypto.randomUUID(),
      values: { [mass]: value },
    })),
  )

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner',$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'unit-conversion','Units')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'UNIT','Units',$3)`,
    [PROJECT, WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('the lab unit table', () => {
  it('matches the app’s copy', async () => {
    const { rows: units } = await migrator.query(
      `select symbol, aliases, dimension, factor::float8 factor, divisor::float8 divisor, pre_offset::float8 "preOffset"
         from api.lab_units order by display_order`,
    )

    expect(units).toEqual(
      LAB_UNITS.map((unit) => ({
        symbol: unit.symbol,
        aliases: [...unit.aliases],
        dimension: unit.dimension,
        factor: unit.factor,
        divisor: unit.divisor,
        preOffset: unit.preOffset,
      })),
    )
  })

  it('converts the same as the app', async () => {
    const cases: Array<[number, string, string]> = [
      [2, 'g', 'mg'],
      [0.3, 'g', 'mg'],
      [250, 'μL', 'mL'],
      [1, 'mg/mL', 'µg/mL'],
      [90, 'min', 'h'],
      [-40, '°C', '°F'],
      [0, '°F', 'K'],
      [37, 'C', 'K'],
      [760, 'Torr', 'atm'],
      [1.5, '×10⁶ cells/mL', 'cells/mL'],
      [3, 'x10^11 cp/mL', '×10¹⁰ cp/mL'],
      [12, 'mL/h', 'µL/min'],
      [2, 'L', 'mg'],
      [5, 'AU', 'AU'],
    ]

    for (const [value, from, to] of cases) {
      const { rows: result } = await migrator.query(
        `select internal.lab_convert_quantity($1,$2,$3)::float8 v`,
        [value, from, to],
      )

      expect([value, from, to, result[0].v]).toEqual([
        value,
        from,
        to,
        convertQuantity(value, from, to),
      ])
    }
  })

  it('converts for pipelines and agents, and refuses different kinds', async () => {
    const owner = await actor()

    const { rows: converted } = await owner.query(
      `select api.convert_quantity(2.5,'mL','µL') result`,
    )

    expect(converted[0].result).toMatchObject({
      value: 2500,
      unit: 'µL',
      dimension: 'volume',
    })
    await expect(
      owner.query(`select api.convert_quantity(2,'mL','mg')`),
    ).rejects.toThrow(/measure different things/)
  })
})

describe('dataset rows', () => {
  it('checks units before anything is written', async () => {
    const owner = await actor()
    const { datasetId, mass } = await massDataset()

    const result = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [
          datasetId,
          rows(
            ['2 g', '12 mg', 12, { value: 2, unit: 'g' }, '2 mL', 'lots'],
            mass,
          ),
        ],
      )
    ).rows[0].result

    expect(
      (result.errors as Array<{ rowIndex: number; code: string }>).map(
        (error) => [error.rowIndex, error.code],
      ),
    ).toEqual([
      [5, 'wrong_unit'],
      [6, 'invalid_value_type'],
    ])
  })

  it('stores the value in the column’s unit and keeps what was typed', async () => {
    const owner = await actor()
    const { datasetId, mass } = await massDataset()

    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,$3)`,
      [
        datasetId,
        rows(['2 g', { value: 500, unit: 'µg' }, '7 mg'], mass),
        `units-${crypto.randomUUID()}`,
      ],
    )

    const { rows: stored } = await migrator.query(
      `select v.numeric_value::float8 value from api.dataset_row_values v
         join api.dataset_rows r on r.id=v.row_id where r.dataset_id=$1 order by 1`,
      [datasetId],
    )

    expect(stored.map((row) => row.value)).toEqual([0.5, 7, 2000])

    const { rows: entries } = await owner.query(
      `select entered_value::float8 entered, entered_unit, stored_value::float8 stored, stored_unit, actor_user_id
         from api.quantity_entries where object_kind='dataset' and object_id=$1 order by stored_value`,
      [datasetId],
    )

    expect(entries).toEqual([
      {
        entered: 500,
        entered_unit: 'µg',
        stored: 0.5,
        stored_unit: 'mg',
        actor_user_id: OWNER,
      },
      {
        entered: 2,
        entered_unit: 'g',
        stored: 2000,
        stored_unit: 'mg',
        actor_user_id: OWNER,
      },
    ])

    const { rows: events } = await migrator.query(
      `select payload->'changes' changes from api.change_events
        where entity_type='dataset' and entity_uuid=$1 and record_id is null`,
      [datasetId],
    )

    const changes = events.flatMap((event) =>
      Object.values(
        event.changes as Record<string, { to: number; entered?: unknown }>,
      ),
    )

    expect(changes).toContainEqual(
      expect.objectContaining({ to: 2000, entered: { value: 2, unit: 'g' } }),
    )
    expect(changes).toContainEqual(expect.objectContaining({ to: 7 }))
    expect(changes.find((change) => change.to === 7)).not.toHaveProperty(
      'entered',
    )
  })

  it('ignores an "entered" the caller sends', async () => {
    const owner = await actor()
    const { datasetId, mass } = await massDataset()

    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,$3)`,
      [
        datasetId,
        JSON.stringify([
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: { [mass]: 3 },
            entered: { [mass]: { value: 3, unit: 'kg' } },
          },
        ]),
        `units-${crypto.randomUUID()}`,
      ],
    )

    const { rows: entries } = await migrator.query(
      `select count(*)::int n from api.quantity_entries where object_id=$1`,
      [datasetId],
    )

    expect(entries[0].n).toBe(0)
  })
})

describe('sheet cells', () => {
  it('converts a sheet’s own number column and refuses another kind', async () => {
    const field = {
      ...createAdHocTextField('Mass'),
      logicalType: 'decimal',
      quantity: MASS,
    }
    const row = crypto.randomUUID()

    await setActorJwt(migrator, OWNER, WS)
    const instanceId = (
      await migrator.query<{ id: string }>(
        `select (api.create_sheet_instance($1,'Weighing',null,null,$2,null,$3::jsonb)).id`,
        [
          WS,
          PROJECT,
          JSON.stringify({
            bindings: [],
            localFields: [field],
            localValues: { [row]: { [field.fieldId]: 1 } },
            calculationOverrides: {},
            presentation: {
              columnOrder: [field.fieldId],
              hiddenColumnIds: [],
              columnWidths: {},
              frozenColumnCount: 0,
              density: 'standard',
              filters: [],
              sorts: [],
            },
            provenance: { createdFrom: 'ad_hoc' },
          }),
        ],
      )
    ).rows[0]!.id

    const owner = await actor()

    const setCell = async (value: unknown) => {
      const revision = (
        await migrator.query<{ revision: string }>(
          'select revision from api.sheet_instances where id=$1',
          [instanceId],
        )
      ).rows[0]!.revision

      await owner.query(
        `select api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)`,
        [
          instanceId,
          revision,
          crypto.randomUUID(),
          JSON.stringify([{ kind: 'local', rowKey: row }]),
          JSON.stringify([{ rowKey: row, fieldId: field.fieldId, value }]),
        ],
      )
    }

    await setCell('0.25 g')

    const { rows: state } = await migrator.query(
      `select state->'localValues'->$2->$3 value from api.sheet_instances where id=$1`,
      [instanceId, row, field.fieldId],
    )

    expect(state[0].value).toBe(250)
    await expect(setCell('2 mL')).rejects.toThrow(/wrong_unit/)

    const { rows: entries } = await owner.query(
      `select entered_unit, stored_value::float8 stored, row_key from api.quantity_entries where object_kind='instance' and object_id=$1`,
      [instanceId],
    )

    expect(entries).toEqual([{ entered_unit: 'g', stored: 250, row_key: row }])
  })
})

describe('record fields', () => {
  it('converts a record field with a unit and refuses another kind', async () => {
    const owner = await actor()

    const created = (
      await owner.query(
        `select * from api.create_model_field($1,'experiment','sample_mass','Sample mass','decimal',true,null,'{}'::jsonb)`,
        [WS],
      )
    ).rows[0]

    await owner.query(
      `select api.configure_model_field_semantics($1,$2::jsonb,'one',null,null)`,
      [created.id, JSON.stringify(MASS)],
    )
    await owner.query(`select api.activate_model_field($1)`, [created.id])

    const record = (
      await migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,custom_fields,created_by_user_id)
         values($1,$2,'experiment','EXP-UNIT-0001','Weighing','{"sample_mass":"1.5 g"}',$3) returning id, custom_fields`,
        [WS, PROJECT, OWNER],
      )
    ).rows[0]

    expect(record.custom_fields).toEqual({ sample_mass: 1500 })

    await owner.query(
      `update api.records set custom_fields='{"sample_mass":{"value":20,"unit":"µg"}}' where id=$1`,
      [record.id],
    )

    const { rows: entries } = await owner.query(
      `select entered_value::float8 entered, entered_unit, stored_value::float8 stored, field_key
         from api.quantity_entries where object_kind='record' and object_id=$1 order by created_at, stored_value`,
      [record.id],
    )

    expect(entries).toEqual([
      {
        entered: 1.5,
        entered_unit: 'g',
        stored: 1500,
        field_key: 'sample_mass',
      },
      {
        entered: 20,
        entered_unit: 'µg',
        stored: 0.02,
        field_key: 'sample_mass',
      },
    ])

    await expect(
      owner.query(
        `update api.records set custom_fields='{"sample_mass":"2 mL"}' where id=$1`,
        [record.id],
      ),
    ).rejects.toThrow(/Sample mass: 2 mL can't be stored in mg/)
  })
})
