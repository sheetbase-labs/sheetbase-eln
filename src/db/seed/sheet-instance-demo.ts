/**
 * Canonical demo Sheet grids. Seeds create CORE-03 ad-hoc Sheet Instances
 * (`insert_sheet_instance_block` + `mutate_sheet_instance_local_state`), not
 * scientific tables.
 */
import type { Client } from 'pg'

const seedUuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export function storedLocalField(
  fieldId: string,
  key: string,
  label: string,
  logicalType: 'text' | 'decimal' | 'integer',
) {
  return {
    fieldId,
    key,
    label,
    description: null,
    logicalType,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' as const },
    lifecycle: 'active' as const,
  }
}

type SeededInstance = {
  id: string
  revision: string
  state: Record<string, unknown>
}

type LocalField = ReturnType<typeof storedLocalField>

function asInstance(row: {
  id: string
  revision: string | number | bigint
  state: Record<string, unknown>
}): SeededInstance {
  return {
    id: row.id,
    revision: String(row.revision),
    state: row.state,
  }
}

async function loadInstance(
  client: Client,
  instanceId: string,
): Promise<SeededInstance> {
  const loaded = await client.query<{
    id: string
    revision: string
    state: Record<string, unknown>
  }>(
    `SELECT id, revision::text, state FROM api.sheet_instances WHERE id = $1`,
    [instanceId],
  )
  if (!loaded.rows[0]) {
    throw new Error(`Sheet Instance ${instanceId} was not found after insert`)
  }
  return asInstance(loaded.rows[0])
}

async function insertSheetInstanceBlock(
  client: Client,
  recordId: string,
  instanceId: string | null,
): Promise<SeededInstance> {
  const created = await client.query<{ result: { instance: { id: string } } }>(
    `SELECT api.insert_sheet_instance_block($1,NULL,NULL,$2) result`,
    [recordId, instanceId],
  )
  const createdId = created.rows[0]?.result?.instance?.id
  if (!createdId) {
    throw new Error('insert_sheet_instance_block did not return an Instance')
  }
  return loadInstance(client, createdId)
}

export async function ensureNotebookSheetInstance(
  client: Client,
  recordId: string,
): Promise<SeededInstance> {
  const fromBlock = await client.query<{
    id: string
    revision: string
    state: Record<string, unknown>
  }>(
    `SELECT i.id, i.revision::text, i.state
       FROM api.sheet_instances i
       JOIN api.blocks b ON b.payload->>'instanceId' = i.id::text
      WHERE b.record_id = $1 AND b.type = 'sheet' AND i.lifecycle = 'active'
      ORDER BY i.created_at
      LIMIT 1`,
    [recordId],
  )
  if (fromBlock.rows[0]) return asInstance(fromBlock.rows[0])

  const owned = await client.query<{
    id: string
    revision: string
    state: Record<string, unknown>
  }>(
    `SELECT id, revision::text, state
       FROM api.sheet_instances
      WHERE notebook_record_id = $1 AND lifecycle = 'active'
      ORDER BY created_at
      LIMIT 1`,
    [recordId],
  )
  if (owned.rows[0]) {
    return insertSheetInstanceBlock(client, recordId, owned.rows[0].id)
  }
  return insertSheetInstanceBlock(client, recordId, null)
}

export async function seedAdHocSheetGrid(
  client: Client,
  instance: SeededInstance,
  input: {
    fields: LocalField[]
    rows: Array<{ rowKey: string; values: Record<string, string | number> }>
  },
): Promise<void> {
  const localValues = (instance.state.localValues ?? {}) as Record<
    string,
    unknown
  >
  if (Object.keys(localValues).length >= input.rows.length) return

  const existingFields = (instance.state.localFields ?? []) as Array<{
    fieldId: string
    key: string
    lifecycle: string
  }>
  const active = existingFields.filter((field) => field.lifecycle === 'active')
  const first = active[0]
  if (!first) {
    throw new Error('ad-hoc Sheet Instance is missing its default local field')
  }

  const existingKeys = new Set(active.map((field) => field.key))
  const alreadyConfigured = input.fields.every((field) =>
    existingKeys.has(field.key),
  )
  const [primary, ...extra] = input.fields
  const fieldChanges = alreadyConfigured
    ? []
    : [
        { operation: 'edit', field: { ...primary, fieldId: first.fieldId } },
        ...extra.map((field) => ({ operation: 'add', field })),
      ]
  const idByKey = Object.fromEntries(
    alreadyConfigured
      ? active.map((field) => [field.key, field.fieldId])
      : [
          [primary.key, first.fieldId],
          ...extra.map((field) => [field.key, field.fieldId]),
        ],
  )
  const rows = input.rows.map((row) => ({ kind: 'local', rowKey: row.rowKey }))
  const cells = input.rows.flatMap((row) =>
    input.fields.map((field) => ({
      rowKey: row.rowKey,
      fieldId: idByKey[field.key],
      value: row.values[field.key],
    })),
  )

  await client.query(
    `SELECT api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
    [
      instance.id,
      instance.revision,
      crypto.randomUUID(),
      JSON.stringify(fieldChanges),
      JSON.stringify(rows),
      JSON.stringify(cells),
    ],
  )
}

export function virusStabilitySheetFields(): LocalField[] {
  return [
    storedLocalField(seedUuid(0x1d0), 'time_days', 'Time (days)', 'integer'),
    storedLocalField(
      seedUuid(0x1d1),
      'log_titer',
      'Log titer (TCID50/mL)',
      'decimal',
    ),
    storedLocalField(seedUuid(0x1d2), 'condition', 'Condition', 'text'),
    storedLocalField(seedUuid(0x1d3), 'batch', 'Batch', 'text'),
    storedLocalField(seedUuid(0x1d4), 'recovery', 'Recovery (%)', 'decimal'),
    storedLocalField(seedUuid(0x1d5), 'potency', 'Potency (U/mL)', 'decimal'),
  ]
}

export function virusStabilitySheetRows(): Array<{
  rowKey: string
  values: Record<string, string | number>
}> {
  const timePoints = [0, 3, 7, 14, 21, 28, 42, 56] as const
  const profiles = [
    {
      condition: 'Control',
      batch: 'AAV-24-017',
      start: 7.26,
      losses: [0, 0.04, 0.1, 0.22, 0.36, 0.51, 0.79, 1.08],
    },
    {
      condition: '5% sucrose',
      batch: 'AAV-24-021',
      start: 7.24,
      losses: [0, 0.02, 0.05, 0.1, 0.16, 0.23, 0.36, 0.51],
    },
    {
      condition: '5% trehalose',
      batch: 'AAV-24-026',
      start: 7.27,
      losses: [0, 0.01, 0.03, 0.07, 0.11, 0.16, 0.25, 0.34],
    },
    {
      condition: '0.01% poloxamer',
      batch: 'AAV-24-031',
      start: 7.23,
      losses: [0, 0.02, 0.04, 0.08, 0.13, 0.19, 0.29, 0.41],
    },
  ] as const
  return profiles.flatMap((profile, profileIndex) =>
    timePoints.map((time, index) => {
      const logTiter = Number(
        (profile.start - profile.losses[index]).toFixed(2),
      )
      const recovery = Number((100 * 10 ** -profile.losses[index]).toFixed(1))
      const potency = Number(
        Math.max(0, 98 - profile.losses[index] * 48).toFixed(1),
      )
      const rowIndex = profileIndex * timePoints.length + index
      return {
        rowKey: seedUuid(0x1e0 + rowIndex),
        values: {
          time_days: time,
          log_titer: logTiter,
          condition: profile.condition,
          batch: profile.batch,
          recovery,
          potency,
        },
      }
    }),
  )
}

export function monthShowcaseSheetFields(): LocalField[] {
  return [
    storedLocalField(seedUuid(0x5d0), 'construct', 'Construct', 'text'),
    storedLocalField(seedUuid(0x5d1), 'moi', 'MOI', 'decimal'),
    storedLocalField(
      seedUuid(0x5d2),
      'transduction',
      'Transduction (%)',
      'decimal',
    ),
    storedLocalField(seedUuid(0x5d3), 'viability', 'Viability (%)', 'decimal'),
  ]
}

export function monthShowcaseSheetRows(): Array<{
  rowKey: string
  values: Record<string, string | number>
}> {
  const constructs = ['CD19-CAR', 'BCMA-CAR'] as const
  const mois = [1, 3, 5, 10] as const
  return constructs.flatMap((construct, constructIndex) =>
    mois.map((moi, index) => ({
      rowKey: seedUuid(0x5e0 + constructIndex * mois.length + index),
      values: {
        construct,
        moi,
        transduction: Number((42 + constructIndex * 8 + moi * 3.5).toFixed(1)),
        viability: Number((94 - moi * 1.2 - constructIndex * 0.8).toFixed(1)),
      },
    })),
  )
}

export async function seedNotebookSheetGrid(
  client: Client,
  recordId: string,
  input: {
    fields: LocalField[]
    rows: Array<{ rowKey: string; values: Record<string, string | number> }>
  },
): Promise<void> {
  const instance = await ensureNotebookSheetInstance(client, recordId)
  await seedAdHocSheetGrid(client, instance, input)
}
