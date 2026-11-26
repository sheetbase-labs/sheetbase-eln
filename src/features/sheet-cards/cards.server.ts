import { z } from 'zod'

import { buildSheetCalculationExpression } from '#/lib/sheet-calculation'
import { createAdHocTextField } from '#/lib/sheet-local-data'
import {
  cardSchema,
  changed,
  fail,
  findBlock,
  findLayout,
  findProjectId,
  findRecord,
  fieldNamed,
  activeFields,
  readSheet,
  findSheet,
  layoutVersions,
  ok,
  recordLabel,
  rpcCard,
  same,
  sheetLabel,
} from '#/lib/assistant-rpc-cards.server'
import type { RpcCard } from '#/lib/assistant-rpc-cards.server'
import type { RpcArgs, RpcJson } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import { SHEET_CARDS } from './cards'
import type { SheetCardsProposeToolName } from './cards'

/**
 * The sheet cards (see `cards.ts`). A sheet's own columns and rows are its
 * local state: the model names columns by label, the builder gives each new
 * one an ID, and the card lists what will change.
 */

const covers = (tool: SheetCardsProposeToolName): readonly string[] =>
  SHEET_CARDS.find((card) => card.tool === tool)?.covers ?? []

const COLUMN_TYPES = ['text', 'number', 'integer', 'boolean', 'date'] as const

const LOGICAL_TYPE = {
  text: 'text',
  number: 'decimal',
  integer: 'integer',
  boolean: 'boolean',
  date: 'date',
} as const

const columnSpec = z.strictObject({
  label: z.string().min(1).max(120).describe('The column heading.'),
  type: z
    .enum(COLUMN_TYPES)
    .default('text')
    .describe(
      'What it holds: text (the default), number, integer, boolean or date.',
    ),
})

const cell = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])

const sheetName = z
  .string()
  .min(1)
  .max(200)
  .describe('The sheet, by its ID (SHT-0012) or its name.')

const layoutName = z
  .string()
  .min(1)
  .max(200)
  .describe('The sheet layout, by its name or key.')

function newField(spec: z.infer<typeof columnSpec>, taken: Set<string>) {
  const base = createAdHocTextField(spec.label, [...taken])
  taken.add(base.key)

  // The same field the app makes for a typed column, with the chosen type.
  return { ...base, logicalType: LOGICAL_TYPE[spec.type] }
}

type NewField = ReturnType<typeof newField>

/** A value built from parsed JSON and the IDs made in this file, as the card sends it. */
const toJson = <TValue extends object>(value: TValue): RpcJson =>
  // SAFETY: every part is a JSON value read from the database or made in this file; the database checks the whole when the button is pressed.
  value as RpcJson

const sheetHref = (id: string) => `/sheets/${id}`

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const createSchema = cardSchema({
  name: z.string().min(1).max(200).describe('The new sheet’s name.'),
  description: z.string().max(2_000).optional(),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('The project it belongs to, by name, key or ID (PRJ-0008).'),
  notebook: z
    .string()
    .max(200)
    .optional()
    .describe(
      'A notebook or experiment it is made for, by ID (EXP-0004) or name.',
    ),
  columns: z
    .array(columnSpec)
    .max(30)
    .optional()
    .describe('Its columns, for a sheet with its own columns.'),
  layout: layoutName
    .optional()
    .describe('Start from a sheet layout instead of blank columns.'),
})

const sheetCreate = rpcCard({
  tool: 'sheetbase.sheet.create',
  covers: covers('sheetbase.sheet.create'),
  description:
    'Propose making a new sheet: a blank one with the columns you name, or one started from a sheet layout. It can belong to a project and a notebook.',
  schema: createSchema,
  async build(input, { client, workspaceId }) {
    const project = input.project
      ? await findProjectId(client, input.project)
      : null

    if (project && !project.ok) return project

    const notebook = input.notebook
      ? await findRecord(client, input.notebook)
      : null

    if (notebook && !notebook.ok) return notebook

    const projectId = project?.value.id ?? notebook?.value.project_id ?? null

    const common = {
      p_workspace_id: workspaceId,
      p_name: input.name.trim(),
      p_description: input.description ?? null,
      p_project_id: projectId,
      p_notebook_record_id: notebook?.value.id ?? null,
    }

    const changes = [changed('New sheet', null, input.name.trim())]

    if (project) changes.push(changed('Project', null, project.value.title))

    if (notebook)
      changes.push(changed('Notebook', null, recordLabel(notebook.value)))

    if (input.layout) {
      const layout = await findLayout(client, input.layout)

      if (!layout.ok) return layout
      const versions = await layoutVersions(client, layout.value.id)
      const published = versions.find((v) => v.lifecycle === 'published')

      if (!published) {
        return fail(
          `${layout.value.name} has no published version to start from.`,
        )
      }

      changes.push(
        changed('Layout', null, `${layout.value.name} v${published.version}`),
      )

      return ok({
        target: input.name.trim(),
        deepLink: null,
        changes,
        rpc: 'create_sheet_instance_from_definition',
        args: {
          ...common,
          p_source_definition_version_id: published.id,
          p_state: {
            bindings: [],
            localFields: [],
            localValues: {},
            calculationOverrides: {},
            provenance: { createdFrom: 'definition_version' },
          },
          p_parameter_inputs: [],
        },
      })
    }

    const taken = new Set<string>()
    const fields = (input.columns ?? []).map((spec) => newField(spec, taken))

    if (fields.length > 0) {
      changes.push(
        changed('Columns', null, fields.map((field) => field.label).join(', ')),
      )
    }

    return ok({
      target: input.name.trim(),
      deepLink: null,
      changes,
      rpc: 'create_sheet_instance',
      args: {
        ...common,
        p_source_definition_version_id: null,
        p_state: {
          bindings: [],
          localFields: toJson(fields),
          localValues: {},
          calculationOverrides: {},
          presentation: {
            columnOrder: fields.map((field) => field.fieldId),
            hiddenColumnIds: [],
            columnWidths: {},
            frozenColumnCount: 0,
            density: 'standard',
            filters: [],
            sorts: [],
          },
          provenance: { createdFrom: 'ad_hoc' },
        },
      },
    })
  },
})

const editDataSchema = cardSchema({
  sheet: sheetName,
  addColumns: z
    .array(columnSpec)
    .max(30)
    .optional()
    .describe('New columns to add to the sheet.'),
  retireColumns: z
    .array(z.string().min(1).max(120))
    .max(30)
    .optional()
    .describe('Columns to take out of use, by heading.'),
  rows: z
    .array(z.record(z.string().min(1).max(120), cell))
    .max(200)
    .optional()
    .describe(
      'New rows to add, each by column heading: { "Sample": "S-0142", "Mass": 4.2 }. A column that is new in this card can be used too.',
    ),
})

const sheetEditData = rpcCard({
  tool: 'sheetbase.sheet.edit_data',
  covers: covers('sheetbase.sheet.edit_data'),
  description:
    'Propose changing the data typed into a sheet: add columns, take columns out of use, and add rows of values (by column heading). For a sheet whose columns come from a dataset, use the dataset tools.',
  schema: editDataSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)
    const taken = new Set(state.localFields.map((field) => field.key))
    const added = (input.addColumns ?? []).map((spec) => newField(spec, taken))

    const labelToId = new Map(
      activeFields(state).map((field) => [
        field.label.toLowerCase(),
        field.fieldId,
      ]),
    )

    for (const field of added)
      labelToId.set(field.label.toLowerCase(), field.fieldId)

    const retiring: string[] = []

    for (const label of input.retireColumns ?? []) {
      const existing = fieldNamed(state, label)

      if (!existing)
        return fail(`${sheetLabel(found.value)} has no column “${label}”.`)
      retiring.push(existing.fieldId)
      labelToId.delete(existing.label.toLowerCase())
    }

    const rowKeys: string[] = []
    const cells: RpcArgs[] = []

    for (const row of input.rows ?? []) {
      const rowKey = crypto.randomUUID()
      rowKeys.push(rowKey)

      for (const [label, value] of Object.entries(row)) {
        const fieldId = labelToId.get(label.trim().toLowerCase())

        if (!fieldId)
          return fail(`${sheetLabel(found.value)} has no column “${label}”.`)

        if (value !== null) cells.push({ rowKey, fieldId, value })
      }
    }

    if (added.length === 0 && retiring.length === 0 && rowKeys.length === 0) {
      return fail(
        'Nothing to change: name columns to add or remove, or rows to add.',
      )
    }

    const changes = []

    if (added.length > 0)
      changes.push(
        changed('Columns added', null, added.map((f) => f.label).join(', ')),
      )

    if (retiring.length > 0)
      changes.push(
        changed(
          'Columns removed',
          (input.retireColumns ?? []).join(', '),
          'Out of use',
        ),
      )

    if (rowKeys.length > 0)
      changes.push(changed('Rows added', null, String(rowKeys.length)))

    return ok({
      target: sheetLabel(found.value),
      deepLink: sheetHref(found.value.id),
      changes,
      rpc: 'mutate_sheet_instance_local_state',
      args: {
        p_instance_id: found.value.id,
        p_expected_revision: found.value.revision,
        p_retry_token: crypto.randomUUID(),
        p_field_changes: [
          ...added.map((field) => ({ operation: 'add', field: toJson(field) })),
          ...retiring.map((fieldId) => ({ operation: 'retire', fieldId })),
        ],
        p_rows: rowKeys.map((rowKey) => ({ kind: 'local', rowKey })),
        p_cells: cells,
      },
    })
  },
})

const calculateSchema = cardSchema({
  sheet: sheetName,
  label: z.string().min(1).max(200).describe('The calculation’s heading.'),
  formula: z
    .string()
    .min(2)
    .max(1_000)
    .optional()
    .describe(
      'A row formula over the sheet’s columns, naming each column in curly braces: "={Mass}/{Volume}".',
    ),
  retire: z
    .boolean()
    .optional()
    .describe(
      'true takes the calculation with this heading out of use instead.',
    ),
})

const COLUMN_LETTERS = (index: number): string => {
  let n = index
  let letters = ''

  do {
    letters = String.fromCodePoint(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)

  return letters
}

const sheetCalculate = rpcCard({
  tool: 'sheetbase.sheet.calculate',
  covers: covers('sheetbase.sheet.calculate'),
  description:
    'Propose adding a calculated column to a sheet from a formula over its columns, or taking one out of use. Name the columns in curly braces.',
  schema: calculateSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)
    const calculations = state.instanceCalculations

    if (input.retire) {
      const existing = calculations.find(
        (calc) => calc.lifecycle === 'active' && same(calc.label, input.label),
      )

      if (!existing)
        return fail(
          `${sheetLabel(found.value)} has no calculation “${input.label}”.`,
        )

      return ok({
        target: sheetLabel(found.value),
        deepLink: sheetHref(found.value.id),
        changes: [changed(existing.label, 'In use', 'Out of use')],
        rpc: 'mutate_sheet_instance_calculations',
        args: {
          p_instance_id: found.value.id,
          p_expected_revision: found.value.revision,
          p_retry_token: crypto.randomUUID(),
          p_changes: [{ operation: 'retire', calculationId: existing.id }],
        },
      })
    }

    if (!input.formula)
      return fail('Give the formula to add, such as ={Mass}/{Volume}.')

    const fields = activeFields(state)

    const grid = [
      ...fields.map((field) => ({
        id: field.fieldId,
        origin: 'local' as const,
        label: field.label,
      })),
      ...calculations
        .filter((calc) => calc.lifecycle === 'active')
        .map((calc) => ({
          id: calc.id,
          origin: 'calculation' as const,
          label: calc.label,
        })),
    ]

    const unknownNames: string[] = []

    const gridFormula = input.formula.replaceAll(
      /\{([^}]+)\}/g,
      (_match, name: string) => {
        const index = grid.findIndex((column) => same(column.label, name))

        if (index < 0) unknownNames.push(name)

        return `${COLUMN_LETTERS(Math.max(index, 0))}1`
      },
    )

    const unknown = unknownNames.at(0)

    if (unknown !== undefined)
      return fail(`${sheetLabel(found.value)} has no column “${unknown}”.`)

    let expression: ReturnType<typeof buildSheetCalculationExpression>

    try {
      expression = buildSheetCalculationExpression({
        source: gridFormula.startsWith('=') ? gridFormula : `=${gridFormula}`,
        columns: grid,
      })
    } catch (error) {
      return fail(
        `That formula does not work: ${error instanceof Error ? error.message : 'it could not be read'}.`,
      )
    }

    const id = crypto.randomUUID()

    const taken = new Set([
      ...state.localFields.map((field) => field.key),
      ...calculations.map((calc) => calc.key),
    ])

    const base = createAdHocTextField(input.label, [...taken])
    const label = input.label.trim()

    const outputField = {
      ...base,
      fieldId: id,
      label,
      logicalType: 'decimal',
      computation: { mode: 'computed', expressionId: id },
    }

    return ok({
      target: sheetLabel(found.value),
      deepLink: sheetHref(found.value.id),
      changes: [changed(label, null, input.formula.trim())],
      rpc: 'mutate_sheet_instance_calculations',
      args: {
        p_instance_id: found.value.id,
        p_expected_revision: found.value.revision,
        p_retry_token: crypto.randomUUID(),
        p_changes: [
          {
            operation: 'add',
            calculation: {
              id,
              key: base.key,
              label,
              lifecycle: 'active',
              outputField: toJson(outputField),
              dependencies: toJson(expression.dependencies),
              expression: {
                language: 'sheetbase-formula-v1',
                source: expression.source,
              },
            },
          },
        ],
      },
    })
  },
})

const commentSchema = cardSchema({
  sheet: sheetName,
  body: z.string().min(1).max(4_000).describe('The comment.'),
  column: z
    .string()
    .max(120)
    .optional()
    .describe('The column it is about, by heading.'),
  row: z
    .strictObject({
      column: z
        .string()
        .min(1)
        .max(120)
        .describe('A column to find the row by.'),
      equals: z
        .union([z.string(), z.number()])
        .describe('The value in that column.'),
    })
    .optional()
    .describe('The row it is about, found by a value in one of its columns.'),
})

const sheetComment = rpcCard({
  tool: 'sheetbase.sheet.comment',
  covers: covers('sheetbase.sheet.comment'),
  description:
    'Propose a comment on a sheet, on a cell (a row and a column), a whole row, or a column. Name the row by a value in one of its columns.',
  schema: commentSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)

    if (!input.column && !input.row) {
      return fail('Say which row or column the comment is about.')
    }

    const column = input.column ? fieldNamed(state, input.column) : undefined

    if (input.column && !column) {
      return fail(`${sheetLabel(found.value)} has no column “${input.column}”.`)
    }

    let rowKeys: string[]

    if (input.row) {
      const by = fieldNamed(state, input.row.column)

      if (!by)
        return fail(
          `${sheetLabel(found.value)} has no column “${input.row.column}”.`,
        )

      const matches = Object.entries(state.localValues)
        .filter(([, values]) =>
          same(cellText(values[by.fieldId]), cellText(input.row?.equals)),
        )
        .map(([rowKey]) => rowKey)

      if (matches.length !== 1) {
        return fail(
          matches.length === 0
            ? `No row has “${input.row.equals}” in ${by.label}.`
            : `${matches.length} rows have “${input.row.equals}” in ${by.label}. Name a value that is only in one.`,
        )
      }

      rowKeys = matches
    } else {
      rowKeys = Object.keys(state.localValues).slice(0, 500)

      if (rowKeys.length === 0)
        return fail(`${sheetLabel(found.value)} has no rows yet.`)
    }

    const targetKind = column
      ? input.row
        ? 'sheet_cell'
        : 'sheet_range'
      : 'sheet_row'

    const where = [
      input.row ? `row with ${input.row.equals} in ${input.row.column}` : null,
      column ? `column ${column.label}` : null,
    ]
      .filter(Boolean)
      .join(', ')

    return ok({
      target: sheetLabel(found.value),
      deepLink: sheetHref(found.value.id),
      changes: [changed(where, null, input.body)],
      rpc: 'create_sheet_comment',
      args: {
        p_instance_id: found.value.id,
        p_expected_instance_revision: found.value.revision,
        p_target_kind: targetKind,
        p_target: {
          instanceId: found.value.id,
          rowKeys: [...rowKeys].sort(),
          fieldIds: column ? [column.fieldId] : [],
        },
        p_body: input.body,
        p_mentions: [],
      },
    })
  },
})

const upgradeSchema = cardSchema({ sheet: sheetName })

const sheetUpgrade = rpcCard({
  tool: 'sheetbase.sheet.upgrade_layout',
  covers: covers('sheetbase.sheet.upgrade_layout'),
  description:
    'Propose moving a sheet to the newest published version of the sheet layout it was made from. If the move needs choices (clashes with its own columns), the card says so and nothing changes.',
  schema: upgradeSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { sourceVersionId } = await readSheet(client, found.value.id)

    if (!sourceVersionId)
      return fail(
        `${sheetLabel(found.value)} was not made from a sheet layout.`,
      )

    const current = (
      await client.list<{
        definition_id: string
        version: number
      }>(
        'sheet_definition_versions',
        `?id=eq.${sourceVersionId}&select=definition_id,version&limit=1`,
      )
    ).at(0)

    if (!current) return fail('Its sheet layout version could not be found.')
    const versions = await layoutVersions(client, current.definition_id)
    const latest = versions.find((v) => v.lifecycle === 'published')

    if (!latest || latest.version <= current.version) {
      return fail(
        `${sheetLabel(found.value)} already has the newest published version (v${current.version}).`,
      )
    }

    return ok({
      target: sheetLabel(found.value),
      deepLink: sheetHref(found.value.id),
      changes: [
        changed('Layout version', `v${current.version}`, `v${latest.version}`),
      ],
      rpc: 'apply_sheet_instance_definition_upgrade',
      args: {
        p_instance_id: found.value.id,
        p_expected_instance_revision: found.value.revision,
        p_target_definition_version_id: latest.id,
        p_decisions: [],
        p_parameter_inputs: [],
      },
    })
  },
})

const addToNotebookSchema = cardSchema({
  sheet: sheetName,
  notebook: z
    .string()
    .min(1)
    .max(200)
    .describe('The notebook or experiment, by ID (EXP-0004) or name.'),
})

const sheetAddToNotebook = rpcCard({
  tool: 'sheetbase.sheet.add_to_notebook',
  covers: covers('sheetbase.sheet.add_to_notebook'),
  description:
    'Propose putting an existing sheet into a notebook as a block, at the end.',
  schema: addToNotebookSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const record = await findRecord(client, input.notebook)

    if (!record.ok) return record

    return ok({
      target: sheetLabel(found.value),
      deepLink: `/records/${record.value.id}`,
      changes: [changed('In notebook', null, recordLabel(record.value))],
      rpc: 'insert_sheet_instance_block',
      args: {
        p_record_id: record.value.id,
        p_after_block_id: null,
        p_expected_structure_version: null,
        p_instance_id: found.value.id,
      },
    })
  },
})

const duplicateSchema = cardSchema({
  notebook: z
    .string()
    .min(1)
    .max(200)
    .describe('The notebook or experiment the sheet is in.'),
  position: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Which sheet block, counting from 1, when it has several.'),
})

const sheetDuplicateInNotebook = rpcCard({
  tool: 'sheetbase.sheet.duplicate_in_notebook',
  covers: covers('sheetbase.sheet.duplicate_in_notebook'),
  description:
    'Propose copying a sheet block in a notebook: the copy is a new sheet placed right after it.',
  schema: duplicateSchema,
  async build(input, { client }) {
    const record = await findRecord(client, input.notebook)

    if (!record.ok) return record

    const block = await findBlock(
      client,
      record.value,
      ['sheet'],
      input.position,
    )

    if (!block.ok) return block

    return ok({
      target: recordLabel(record.value),
      deepLink: `/records/${record.value.id}`,
      changes: [changed('Sheet block', null, 'A copy, right after it')],
      rpc: 'duplicate_sheet_instance_block',
      args: {
        p_block_id: block.value.id,
        p_expected_structure_version: await structureVersion(
          client,
          record.value.id,
        ),
      },
    })
  },
})

async function structureVersion(
  client: DataClient,
  recordId: string,
): Promise<number> {
  const rows = await client.list<{ structure_version: number }>(
    'records',
    `?id=eq.${recordId}&select=structure_version&limit=1`,
  )

  return rows.at(0)?.structure_version ?? 1
}

const saveAsLayoutSchema = cardSchema({
  sheet: sheetName,
  name: z.string().min(1).max(200).describe('The layout’s name.'),
  description: z.string().max(2_000).optional(),
})

const keyFrom = (name: string): string => {
  const key = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 50)

  return /^[a-z]/.test(key) ? key : `layout_${key || '1'}`
}

const sheetSaveAsLayout = rpcCard({
  tool: 'sheetbase.sheet.save_as_layout',
  covers: covers('sheetbase.sheet.save_as_layout'),
  description:
    'Propose saving a sheet’s own columns and calculations as a new sheet layout (a draft) that other sheets can start from.',
  schema: saveAsLayoutSchema,
  async build(input, { client }) {
    const found = await findSheet(client, input.sheet)

    if (!found.ok) return found
    const { state } = await readSheet(client, found.value.id)
    const fields = activeFields(state)

    if (fields.length === 0)
      return fail(
        `${sheetLabel(found.value)} has no columns of its own to save.`,
      )

    return ok({
      target: sheetLabel(found.value),
      deepLink: sheetHref(found.value.id),
      changes: [
        changed('New layout', null, input.name.trim()),
        changed('Columns', null, fields.map((field) => field.label).join(', ')),
      ],
      rpc: 'extract_sheet_definition_draft',
      args: {
        p_instance_id: found.value.id,
        p_expected_instance_revision: found.value.revision,
        p_key: keyFrom(input.name),
        p_name: input.name.trim(),
        p_description: input.description ?? null,
        p_selection: {
          bindings: [],
          columnIds: [],
          joinIds: [],
          localFieldIds: fields.map((field) => field.fieldId),
          calculationIds: state.instanceCalculations
            .filter((calc) => calc.lifecycle === 'active')
            .map((calc) => calc.id),
          rowIdentity: { kind: 'local', columnIds: [fields[0].fieldId] },
          includePresentation: true,
        },
      },
    })
  },
})

// ---------------------------------------------------------------------------
// Sheet layouts (sheet definitions)
// ---------------------------------------------------------------------------

function declaredColumn(field: NewField): RpcJson {
  return {
    id: field.fieldId,
    field: toJson(field),
    source: { kind: 'declared' },
  }
}

function layoutConfiguration(fields: ReadonlyArray<NewField>): RpcJson {
  return {
    formatVersion: 1,
    parameters: [],
    bindings: [],
    rowIdentity: { kind: 'local', columnIds: [fields[0].fieldId] },
    joins: [],
    columns: fields.map(declaredColumn),
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: fields.map((field) => field.fieldId),
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
  }
}

const layoutCreateSchema = cardSchema({
  name: z.string().min(1).max(200).describe('The layout’s name.'),
  description: z.string().max(2_000).optional(),
  columns: z
    .array(columnSpec)
    .min(1)
    .max(30)
    .describe('Its columns. The first one identifies each row.'),
})

const layoutCreate = rpcCard({
  tool: 'sheetbase.sheet_layout.create',
  covers: covers('sheetbase.sheet_layout.create'),
  description:
    'Propose a new sheet layout with its first draft version: the columns sheets made from it start with. Publish it with the publish tool.',
  schema: layoutCreateSchema,
  async build(input, { client, workspaceId }) {
    const key = keyFrom(input.name)

    const taken = new Set<string>()
    const fields = input.columns.map((spec) => newField(spec, taken))
    const existing = await findLayout(client, key)

    if (existing.ok && existing.value.key === key) {
      return fail(
        `A sheet layout with the key ${key} already exists. Pick another name.`,
      )
    }

    return ok({
      target: input.name.trim(),
      deepLink: null,
      changes: [
        changed('New layout', null, input.name.trim()),
        changed('Columns', null, fields.map((field) => field.label).join(', ')),
      ],
      rpc: 'create_sheet_definition',
      args: {
        p_workspace_id: workspaceId,
        p_key: key,
        p_name: input.name.trim(),
        p_description: input.description ?? null,
        p_configuration: layoutConfiguration(fields),
      },
    })
  },
})

const layoutRenameSchema = cardSchema({
  layout: layoutName,
  name: z.string().min(1).max(200).optional().describe('A new name.'),
  description: z.string().max(2_000).optional().describe('A new description.'),
})

const layoutRename = rpcCard({
  tool: 'sheetbase.sheet_layout.rename',
  covers: covers('sheetbase.sheet_layout.rename'),
  description: 'Propose changing a sheet layout’s name or description.',
  schema: layoutRenameSchema,
  async build(input, { client }) {
    const found = await findLayout(client, input.layout)

    if (!found.ok) return found

    if (input.name === undefined && input.description === undefined) {
      return fail('Give a new name or description.')
    }

    const patch: RpcArgs = {}
    const changes = []

    if (input.name !== undefined) {
      patch.name = input.name.trim()
      changes.push(changed('Name', found.value.name, input.name.trim()))
    }

    if (input.description !== undefined) {
      patch.description = input.description
      changes.push(changed('Description', null, input.description))
    }

    return ok({
      target: found.value.name,
      deepLink: `/sheet-definitions/${found.value.id}`,
      changes,
      rpc: 'update_sheet_definition',
      args: {
        p_definition_id: found.value.id,
        p_expected_revision: found.value.revision,
        p_patch: patch,
      },
    })
  },
})

const cellValue = z.union([z.string(), z.number(), z.boolean()])

/** A cell's value as the words a person would type to match it. */
const cellText = (value: RpcJson | undefined): string => {
  const parsed = cellValue.safeParse(value)

  return parsed.success ? String(parsed.data) : ''
}

const layoutColumnsSchema = {
  layout: layoutName,
  addColumns: z
    .array(columnSpec)
    .max(30)
    .optional()
    .describe('Columns to add.'),
  removeColumns: z
    .array(z.string().min(1).max(120))
    .max(30)
    .optional()
    .describe('Columns to take out, by heading.'),
} as const

const configurationSchema = z.looseObject({
  columns: z.array(
    z.looseObject({
      id: z.string(),
      field: z.looseObject({ key: z.string(), label: z.string() }),
    }),
  ),
  presentation: z.looseObject({ columnOrder: z.array(z.string()) }),
})

/** The version's configuration with the columns changed, or what went wrong. */
function changeConfiguration(
  stored: RpcJson | undefined,
  add: ReadonlyArray<z.infer<typeof columnSpec>>,
  remove: readonly string[],
):
  | { ok: true; configuration: RpcJson; added: string[]; removed: string[] }
  | { ok: false; message: string } {
  const parsed = configurationSchema.safeParse(stored)

  if (!parsed.success)
    return { ok: false, message: 'That version’s columns could not be read.' }
  const config = parsed.data
  const taken = new Set(config.columns.map((column) => column.field.key))
  const removedIds = new Set<string>()
  const removed: string[] = []

  for (const label of remove) {
    const column = config.columns.find((each) => same(each.field.label, label))

    if (!column)
      return { ok: false, message: `The layout has no column “${label}”.` }
    removedIds.add(column.id)
    removed.push(column.field.label)
  }

  const fields = add.map((spec) => newField(spec, taken))

  const columns = [
    ...config.columns.filter((column) => !removedIds.has(column.id)),
    ...fields.map(declaredColumn),
  ]

  const configuration = toJson({
    ...config,
    columns,
    presentation: {
      ...config.presentation,
      columnOrder: [
        ...config.presentation.columnOrder.filter((id) => !removedIds.has(id)),
        ...fields.map((field) => field.fieldId),
      ],
    },
  })

  return {
    ok: true,
    configuration,
    added: fields.map((field) => field.label),
    removed,
  }
}

const addVersionSchema = cardSchema(layoutColumnsSchema)

const layoutAddVersion = rpcCard({
  tool: 'sheetbase.sheet_layout.add_version',
  covers: covers('sheetbase.sheet_layout.add_version'),
  description:
    'Propose starting a new draft version of a sheet layout from its latest version, with columns added or taken out. Publish it with the publish tool.',
  schema: addVersionSchema,
  async build(input, { client }) {
    const found = await findLayout(client, input.layout)

    if (!found.ok) return found
    const latest = (await layoutVersions(client, found.value.id)).at(0)

    if (!latest)
      return fail(`${found.value.name} has no version to start from.`)

    const rows = await client.list<{ configuration: RpcJson }>(
      'sheet_definition_versions',
      `?id=eq.${latest.id}&select=configuration&limit=1`,
    )

    const next = changeConfiguration(
      rows.at(0)?.configuration,
      input.addColumns ?? [],
      input.removeColumns ?? [],
    )

    if (!next.ok) return next

    return ok({
      target: found.value.name,
      deepLink: `/sheet-definitions/${found.value.id}`,
      changes: [
        changed(
          'New version',
          `v${latest.version}`,
          `v${latest.version + 1} (draft)`,
        ),
        ...(next.added.length > 0
          ? [changed('Columns added', null, next.added.join(', '))]
          : []),
        ...(next.removed.length > 0
          ? [changed('Columns removed', next.removed.join(', '), 'Gone')]
          : []),
      ],
      rpc: 'create_sheet_definition_version',
      args: {
        p_definition_id: found.value.id,
        p_expected_definition_revision: found.value.revision,
        p_configuration: next.configuration,
      },
    })
  },
})

const editDraftSchema = cardSchema(layoutColumnsSchema)

const layoutEditDraft = rpcCard({
  tool: 'sheetbase.sheet_layout.edit_draft',
  covers: covers('sheetbase.sheet_layout.edit_draft'),
  description:
    'Propose changing the draft version of a sheet layout: add columns or take columns out. Only a draft can change.',
  schema: editDraftSchema,
  async build(input, { client }) {
    const found = await findLayout(client, input.layout)

    if (!found.ok) return found

    const draft = (await layoutVersions(client, found.value.id)).find(
      (v) => v.lifecycle === 'draft',
    )

    if (!draft)
      return fail(
        `${found.value.name} has no draft version. Start a new version first.`,
      )

    const rows = await client.list<{ configuration: RpcJson }>(
      'sheet_definition_versions',
      `?id=eq.${draft.id}&select=configuration&limit=1`,
    )

    const next = changeConfiguration(
      rows.at(0)?.configuration,
      input.addColumns ?? [],
      input.removeColumns ?? [],
    )

    if (!next.ok) return next

    if (next.added.length === 0 && next.removed.length === 0) {
      return fail('Name columns to add or take out.')
    }

    return ok({
      target: `${found.value.name} v${draft.version} (draft)`,
      deepLink: `/sheet-definitions/${found.value.id}`,
      changes: [
        ...(next.added.length > 0
          ? [changed('Columns added', null, next.added.join(', '))]
          : []),
        ...(next.removed.length > 0
          ? [changed('Columns removed', next.removed.join(', '), 'Gone')]
          : []),
      ],
      rpc: 'update_sheet_definition_draft',
      args: {
        p_version_id: draft.id,
        p_expected_revision: draft.revision,
        p_configuration: next.configuration,
      },
    })
  },
})

const retireVersionSchema = cardSchema({
  layout: layoutName,
  version: z.number().int().min(1).describe('The version number to retire.'),
})

const layoutRetireVersion = rpcCard({
  tool: 'sheetbase.sheet_layout.retire_version',
  covers: covers('sheetbase.sheet_layout.retire_version'),
  description:
    'Propose retiring one published version of a sheet layout, so new sheets cannot start from it. Sheets already made from it keep working.',
  schema: retireVersionSchema,
  async build(input, { client }) {
    const found = await findLayout(client, input.layout)

    if (!found.ok) return found

    const version = (await layoutVersions(client, found.value.id)).find(
      (v) => v.version === input.version,
    )

    if (!version)
      return fail(`${found.value.name} has no version ${input.version}.`)

    if (version.lifecycle === 'retired')
      return fail(`Version ${input.version} is already retired.`)

    return ok({
      target: `${found.value.name} v${version.version}`,
      deepLink: `/sheet-definitions/${found.value.id}`,
      changes: [changed('Version', version.lifecycle, 'Retired')],
      rpc: 'retire_sheet_definition_version',
      args: { p_version_id: version.id, p_expected_revision: version.revision },
    })
  },
})

export const SHEET_CARD_SPECS: readonly RpcCard[] = [
  sheetCreate,
  sheetEditData,
  sheetCalculate,
  sheetComment,
  sheetUpgrade,
  sheetAddToNotebook,
  sheetDuplicateInNotebook,
  sheetSaveAsLayout,
  layoutCreate,
  layoutRename,
  layoutAddVersion,
  layoutEditDraft,
  layoutRetireVersion,
]
