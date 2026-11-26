import { z } from 'zod'

import { findModel } from '#/lib/assistant-labwork.server'
import {
  cardSchema,
  changed,
  fail,
  fieldNamed,
  findDataset,
  findSheet,
  findTable,
  ok,
  readSheet,
  rpcCard,
  same,
  sheetLabel,
} from '#/lib/assistant-rpc-cards.server'
import type { RpcCard } from '#/lib/assistant-rpc-cards.server'
import type { RpcArgs, RpcJson } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import { DATASET_CARDS } from './cards'
import type { DatasetCardsProposeToolName } from './cards'

/**
 * The dataset cards (see `cards.ts`). A dataset's columns are named by label;
 * the builder finds each column's ID in the dataset's current table version.
 */

const covers = (tool: DatasetCardsProposeToolName): readonly string[] =>
  DATASET_CARDS.find((card) => card.tool === tool)?.covers ?? []

const COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const

const columnSpec = z.strictObject({
  label: z.string().min(1).max(120).describe('The column heading.'),
  type: z
    .enum(COLUMN_TYPES)
    .default('text')
    .describe(
      'text (the default), integer, decimal, boolean, date or timestamp.',
    ),
  required: z
    .boolean()
    .optional()
    .describe('true if every row must have a value.'),
})

const cell = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])

const datasetRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The dataset, by its ID (DS-0311) or its name.')

const sheetRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The sheet, by its ID (SHT-0012) or its name.')

const tableRef = (what: string) =>
  z.string().min(1).max(200).describe(`${what}, by its name, key or ID.`)

const datasetHref = (id: string) => `/datasets/${id}`

const keyFrom = (label: string, taken: Set<string>): string => {
  const stem =
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_')
      .replaceAll(/^_+|_+$/g, '')
      .slice(0, 50) || 'column'

  const base = /^[a-z]/.test(stem) ? stem : `c_${stem}`
  let key = base
  let n = 2

  while (taken.has(key)) {
    key = `${base}_${n}`
    n += 1
  }

  taken.add(key)

  return key
}

interface VersionField {
  field_id: string
  key: string
  label: string
  lifecycle: string
  [column: string]: RpcJson
}

const FIELD_COLUMNS =
  'field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order'

function versionFields(client: DataClient, versionId: string) {
  return client.list<VersionField>(
    'dataset_schema_version_fields',
    `?schema_version_id=eq.${encodeURIComponent(versionId)}&select=${FIELD_COLUMNS}&order=display_order.asc`,
  )
}

// ---------------------------------------------------------------------------

const addRowsSchema = cardSchema({
  dataset: datasetRef,
  rows: z
    .array(z.record(z.string().min(1).max(120), cell))
    .min(1)
    .max(2_000)
    .describe(
      'The rows to add, each by column heading: { "Sample": "S-0142", "OD600": 0.42 }. A value for a quantity column can carry its unit ("2 g").',
    ),
  reason: z
    .string()
    .max(400)
    .optional()
    .describe('Why they are added, kept with each value.'),
})

const addRows = rpcCard({
  tool: 'sheetbase.dataset.add_rows',
  covers: covers('sheetbase.dataset.add_rows'),
  description:
    'Propose adding rows of values to a dataset, by column heading. Each row is a new row; it does not change rows that are already there.',
  schema: addRowsSchema,
  async build(input, { client }) {
    const found = await findDataset(client, input.dataset)

    if (!found.ok) return found

    if (found.value.lifecycle !== 'active') {
      return fail(`${sheetLabel(found.value)} is archived. Restore it first.`)
    }

    const fields = (
      await versionFields(client, found.value.schema_version_id)
    ).filter((field) => field.lifecycle !== 'retired')

    const rows: RpcJson[] = []

    for (const row of input.rows) {
      const values: Record<string, RpcJson> = {}

      for (const [label, value] of Object.entries(row)) {
        const field = fields.find(
          (each) => same(each.label, label) || same(each.key, label),
        )

        if (!field) {
          return fail(
            `${sheetLabel(found.value)} has no column “${label}”. Its columns are ${fields.map((each) => each.label).join(', ')}.`,
          )
        }

        values[field.field_id] = value
      }

      const created: RpcArgs = {
        operation: 'create',
        rowId: crypto.randomUUID(),
        values,
      }

      if (input.reason) created.reason = input.reason
      rows.push(created)
    }

    const first = Object.entries(input.rows[0])
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${String(value)}`)
      .join(', ')

    return ok({
      target: sheetLabel(found.value),
      deepLink: datasetHref(found.value.id),
      changes: [
        changed('Rows added', null, String(rows.length)),
        changed('First row', null, first),
      ],
      rpc:
        rows.length > 1_000
          ? 'commit_dataset_row_batch_atomic'
          : 'commit_dataset_row_batch',
      args: {
        p_dataset_id: found.value.id,
        p_expected_dataset_revision: found.value.revision,
        p_rows: rows,
        p_idempotency_key: crypto.randomUUID(),
      },
    })
  },
})

// ---------------------------------------------------------------------------

const createFromColumnsSchema = cardSchema({
  name: z.string().min(1).max(200).describe('The structure’s name.'),
  columns: z.array(columnSpec).min(1).max(60),
})

const createFromColumns = rpcCard({
  tool: 'sheetbase.dataset.create_from_columns',
  covers: covers('sheetbase.dataset.create_from_columns'),
  description:
    'Propose making and publishing a dataset structure (a measurement table) straight from a list of columns, the way the import page does for a first import. Needs dataset work access, not schema editing.',
  schema: createFromColumnsSchema,
  build(input, { workspaceId }) {
    const taken = new Set<string>()

    const fields = input.columns.map((column) => ({
      key: keyFrom(column.label, taken),
      label: column.label.trim(),
      logical_type: column.type,
      nullable: column.required !== true,
    }))

    return Promise.resolve(
      ok({
        target: input.name.trim(),
        deepLink: null,
        changes: [
          changed('New structure', null, input.name.trim()),
          changed(
            'Columns',
            null,
            fields.map((field) => field.label).join(', '),
          ),
        ],
        rpc: 'create_dataset_structure_from_file',
        args: {
          p_workspace_id: workspaceId,
          p_name: input.name.trim(),
          p_fields: fields,
        },
      }),
    )
  },
})

// ---------------------------------------------------------------------------

const addColumnsSchema = cardSchema({
  dataset: datasetRef,
  columns: z.array(columnSpec).min(1).max(30).describe('The columns to add.'),
})

const addColumns = rpcCard({
  tool: 'sheetbase.dataset.add_columns',
  covers: covers('sheetbase.dataset.add_columns'),
  description:
    'Propose adding columns to a dataset. It makes a new version of the dataset’s table with the old columns kept and the new ones added, and moves the dataset to it.',
  schema: addColumnsSchema,
  async build(input, { client }) {
    const found = await findDataset(client, input.dataset)

    if (!found.ok) return found
    const existing = await versionFields(client, found.value.schema_version_id)
    const taken = new Set(existing.map((field) => field.key))

    for (const column of input.columns) {
      if (
        existing.some(
          (field) =>
            same(field.label, column.label) && field.lifecycle !== 'retired',
        )
      ) {
        return fail(
          `${sheetLabel(found.value)} already has a column “${column.label}”.`,
        )
      }
    }

    const added = input.columns.map((column) => ({
      field_id: null,
      key: keyFrom(column.label, taken),
      label: column.label.trim(),
      description: null,
      logical_type: column.type,
      nullable: column.required !== true,
      default_value: null,
      quantity: null,
      validation: {},
      category: null,
      relationship: null,
      cardinality: 'one',
      lifecycle: 'active',
      display_order: null,
    }))

    return ok({
      target: sheetLabel(found.value),
      deepLink: datasetHref(found.value.id),
      changes: [
        changed(
          'Columns added',
          null,
          added.map((field) => field.label).join(', '),
        ),
      ],
      rpc: 'apply_dataset_schema_evolution',
      args: {
        p_schema_version_id: found.value.schema_version_id,
        p_fields: [...existing, ...added],
        p_idempotency_key: crypto.randomUUID(),
        p_expected_revision: null,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const moveUnderSchema = cardSchema({
  table: tableRef('The measurement table to move'),
  under: tableRef('The measurement table it should extend').optional(),
})

const moveUnder = rpcCard({
  tool: 'sheetbase.measurement_table.move_under',
  covers: covers('sheetbase.measurement_table.move_under'),
  description:
    'Propose moving a measurement table under another one it extends, or leaving out `under` to make it a top-level table.',
  schema: moveUnderSchema,
  async build(input, { client }) {
    const table = await findTable(client, input.table)

    if (!table.ok) return table
    const parent = input.under ? await findTable(client, input.under) : null

    if (parent && !parent.ok) return parent

    if (parent?.value.id === table.value.id) {
      return fail('A table cannot extend itself.')
    }

    return ok({
      target: table.value.name,
      deepLink: `/models/${table.value.id}`,
      changes: [
        changed('Extends', null, parent?.value.name ?? 'Nothing (top level)'),
      ],
      rpc: 'reparent_dataset_schema',
      args: {
        p_definition_id: table.value.id,
        p_parent_id: parent?.value.id ?? null,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const promoteColumnSchema = cardSchema({
  sheet: sheetRef,
  column: z
    .string()
    .min(1)
    .max(120)
    .describe('The sheet’s own column to promote, by heading.'),
  table: tableRef('The measurement table to add it to').optional(),
  recordType: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Or the record type to add it to as a field, by name or key.'),
  reason: z
    .string()
    .min(1)
    .max(400)
    .describe('Why the column should be promoted.'),
})

const promoteColumn = rpcCard({
  tool: 'sheetbase.dataset.promote_column',
  covers: covers('sheetbase.dataset.promote_column'),
  description:
    'Propose asking to promote a sheet’s own column into a measurement table (or a record type’s fields). It is a request: it forks a draft version and raises an approval, and writes nothing to any dataset until it is approved.',
  schema: promoteColumnSchema,
  async build(input, { client }) {
    if ((input.table ? 1 : 0) + (input.recordType ? 1 : 0) !== 1) {
      return fail(
        'Name either the measurement table or the record type, not both.',
      )
    }

    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)
    const field = fieldNamed(state, input.column)

    if (!field)
      return fail(
        `${sheetLabel(found.value)} has no column “${input.column}” of its own.`,
      )

    const table = input.table ? await findTable(client, input.table) : null

    if (table && !table.ok) return table

    const model = input.recordType
      ? await findModel(client, input.recordType)
      : null

    if (model && !model.ok) return model

    return ok({
      target: sheetLabel(found.value),
      deepLink: `/sheets/${found.value.id}`,
      changes: [
        changed(
          'Promote column',
          field.label,
          table?.value.name ?? `${model?.value.name ?? ''} (record type)`,
        ),
        changed('Reason', null, input.reason),
      ],
      rpc: 'request_column_promotion',
      args: {
        p_instance_id: found.value.id,
        p_field_id: field.fieldId,
        p_target: table ? 'dataset_schema' : 'model_field',
        p_schema_definition_id: table?.value.id ?? null,
        p_model_key: model?.value.key ?? null,
        p_reason: input.reason,
        p_idempotency_key: crypto.randomUUID(),
        p_expected_revision: found.value.revision,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const applyPromotionSchema = cardSchema({
  sheet: sheetRef,
  column: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Which promotion, by the column’s heading, when there are several.',
    ),
})

const applyPromotion = rpcCard({
  tool: 'sheetbase.dataset.apply_promotion',
  covers: covers('sheetbase.dataset.apply_promotion'),
  description:
    'Propose settling a column promotion that has been decided. After an approval it writes the dataset and retires the sheet’s own column; after a return or withdrawal it only records the outcome. Refused while the approval is pending.',
  schema: applyPromotionSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found

    const rows = await client.list<{
      id: string
      field_id: string
      state: string
      target: string
    }>(
      'column_promotions',
      `?sheet_instance_id=eq.${found.value.id}&state=in.(approved,returned,withdrawn)&select=id,field_id,state,target&order=requested_at.desc&limit=10`,
    )

    if (rows.length === 0) {
      return fail(
        `${sheetLabel(found.value)} has no decided promotion waiting to be settled.`,
      )
    }

    const { state } = await readSheet(client, found.value.id)

    const label = (row: { field_id: string }) =>
      state.localFields.find((field) => field.fieldId === row.field_id)
        ?.label ?? 'a column'

    const chosen = input.column
      ? rows.filter((row) => same(label(row), input.column ?? ''))
      : rows

    if (chosen.length !== 1) {
      return fail(
        chosen.length === 0
          ? `No waiting promotion is for “${input.column}”.`
          : `${chosen.length} promotions are waiting (${chosen.map(label).join(', ')}). Say which column.`,
      )
    }

    const [promotion] = chosen

    return ok({
      target: sheetLabel(found.value),
      deepLink: `/sheets/${found.value.id}`,
      changes: [
        changed(
          label(promotion),
          'Promotion',
          promotion.state === 'approved'
            ? 'Apply to the dataset'
            : `Record as ${promotion.state}`,
        ),
      ],
      rpc: 'apply_column_promotion',
      args: {
        p_promotion_id: promotion.id,
        p_idempotency_key: crypto.randomUUID(),
      },
    })
  },
})

// ---------------------------------------------------------------------------

const promoteCalculationSchema = cardSchema({
  sheet: sheetRef,
  calculation: z
    .string()
    .min(1)
    .max(200)
    .describe('The sheet’s own calculation, by heading.'),
  target: z
    .enum(['sheet_layout', 'measurement_table'])
    .describe(
      'Where to promote it: the sheet’s layout, or a measurement table.',
    ),
  table: tableRef('The measurement table').optional(),
})

const promoteCalculation = rpcCard({
  tool: 'sheetbase.dataset.promote_calculation',
  covers: covers('sheetbase.dataset.promote_calculation'),
  description:
    'Propose promoting a sheet’s own calculation into its sheet layout or into a measurement table, so every sheet and dataset made from it gets it.',
  schema: promoteCalculationSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)

    const calculation = state.instanceCalculations.find(
      (each) =>
        each.lifecycle === 'active' && same(each.label, input.calculation),
    )

    if (!calculation)
      return fail(
        `${sheetLabel(found.value)} has no calculation “${input.calculation}”.`,
      )

    const table =
      input.target === 'measurement_table' && input.table
        ? await findTable(client, input.table)
        : null

    if (table && !table.ok) return table

    if (input.target === 'measurement_table' && !table) {
      return fail('Name the measurement table to promote it into.')
    }

    return ok({
      target: sheetLabel(found.value),
      deepLink: `/sheets/${found.value.id}`,
      changes: [
        changed(
          calculation.label,
          'Calculation of this sheet',
          input.target === 'sheet_layout'
            ? 'Sheet layout'
            : `${table?.value.name ?? ''} (measurement table)`,
        ),
      ],
      rpc: 'promote_calculation',
      args: {
        p_instance_id: found.value.id,
        p_calculation_id: calculation.id,
        p_target:
          input.target === 'sheet_layout'
            ? 'sheet_definition'
            : 'dataset_schema',
        p_schema_definition_id: table?.value.id ?? null,
        p_idempotency_key: crypto.randomUUID(),
      },
    })
  },
})

export const DATASET_CARD_SPECS: readonly RpcCard[] = [
  addRows,
  createFromColumns,
  addColumns,
  moveUnder,
  promoteColumn,
  applyPromotion,
  promoteCalculation,
]
