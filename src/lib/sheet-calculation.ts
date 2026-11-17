import { z } from 'zod'

import { flagKey, isValueFlagged } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'
import type { FormulaNode } from './formula-ir'
import {
  buildPersistedFormulaArtifact,
  emitFormula,
  parseFormula,
} from './formula-ir'
import { buildScientificWorkbook } from './scientific-workbook'
import type { FieldDefinition } from './field-definition'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

/**
 * What an Instance's own calculation can read: a Definition column, a local
 * field or another calculation.
 */
export const sheetInstanceCalculationDependencySchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('column'), id: uuid }),
    z.strictObject({ kind: z.literal('local-field'), id: uuid }),
    z.strictObject({ kind: z.literal('calculation'), id: uuid }),
  ],
)

/**
 * What a calculation of a Definition can read. A `parameter` is a scalar
 * parameter of the Definition (a setting such as a pass threshold): the value
 * the Instance resolved for it, or the Definition's default.
 */
export const sheetCalculationDependencySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('column'), id: uuid }),
  z.strictObject({ kind: z.literal('local-field'), id: uuid }),
  z.strictObject({ kind: z.literal('calculation'), id: uuid }),
  z.strictObject({ kind: z.literal('parameter'), id: uuid }),
])

/** The logical types a calculation can produce: numbers and pass/fail style text or booleans. */
export const CALCULATION_OUTPUT_TYPES = [
  'integer',
  'decimal',
  'text',
  'boolean',
] as const

export const sheetInstanceCalculationSchema = z
  .strictObject({
    id: uuid,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
    label: z.string().trim().min(1).max(200),
    lifecycle: z.enum(['active', 'retired']),
    outputField: sheetFieldDefinitionSchema,
    dependencies: z.array(sheetInstanceCalculationDependencySchema).max(64),
    expression: z.strictObject({
      language: z.literal('sheetbase-formula-v1'),
      source: z.string().trim().min(1).max(8_192),
    }),
  })
  .superRefine((calculation, context) => {
    if (
      calculation.outputField.fieldId !== calculation.id ||
      calculation.outputField.computation.mode !== 'computed' ||
      calculation.outputField.computation.expressionId !== calculation.id ||
      calculation.outputField.cardinality !== 'one' ||
      !CALCULATION_OUTPUT_TYPES.some(
        (type) => type === calculation.outputField.logicalType,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['outputField'],
        message:
          'Calculation output must be a scalar number, text or boolean computed FieldDefinition with matching identity.',
      })

    const dependencyIds = calculation.dependencies.map(
      (dependency) => dependency.id,
    )

    if (
      new Set(dependencyIds).size !== dependencyIds.length ||
      dependencyIds.includes(calculation.id)
    )
      context.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message:
          'Calculation dependencies must be unique and cannot be self-referential.',
      })
  })

export type SheetCalculationDependency = z.infer<
  typeof sheetCalculationDependencySchema
>

export type SheetInstanceCalculationDependency = z.infer<
  typeof sheetInstanceCalculationDependencySchema
>

export type SheetInstanceCalculation = z.infer<
  typeof sheetInstanceCalculationSchema
>

export type SheetCalculationColumnOrigin = 'bound' | 'local' | 'calculation'

const DEPENDENCY_MAP_TABLE_ID = '00000000-0000-4000-8000-0000000000f2'

function dummyRowIds(count: number): string[] {
  const size = Math.min(Math.max(count, 1), 256)

  return Array.from({ length: size }, (_, index) => {
    const n = String(index + 1).padStart(12, '0')

    return `00000000-0000-4000-8000-${n}`
  })
}

function dependencyKind(
  origin: SheetCalculationColumnOrigin,
): SheetInstanceCalculationDependency['kind'] {
  if (origin === 'bound') return 'column'

  if (origin === 'calculation') return 'calculation'

  return 'local-field'
}

/**
 * Derive Sheet calculation dependencies from the formula using the existing
 * formula-IR bindings. Declared dependencies must match referenced columns
 * exactly; unused columns must not be claimed.
 */
export function sheetCalculationDependenciesFromExpression(input: {
  source: string
  columns: ReadonlyArray<{
    id: string
    origin: SheetCalculationColumnOrigin
  }>
  rowCount?: number
}): SheetInstanceCalculationDependency[] {
  const source = input.source.trim()

  if (!source.startsWith('=')) throw new Error('A formula must begin with =.')

  const parsed = parseFormula(source, {
    tableId: DEPENDENCY_MAP_TABLE_ID,
    rowIds: dummyRowIds(input.rowCount ?? 32),
    columnIds: input.columns.map((column) => column.id),
  })

  const artifact = buildPersistedFormulaArtifact(
    parsed,
    DEPENDENCY_MAP_TABLE_ID,
  )

  const originById = new Map(
    input.columns.map((column) => [column.id, column.origin]),
  )

  const seen = new Set<string>()
  const dependencies: SheetInstanceCalculationDependency[] = []

  for (const cell of artifact.dependencies) {
    if (seen.has(cell.columnId)) continue
    seen.add(cell.columnId)
    const origin = originById.get(cell.columnId)

    if (!origin)
      throw new Error(
        'A formula referenced a column that is not on this Sheet.',
      )
    dependencies.push({ kind: dependencyKind(origin), id: cell.columnId })
  }

  return dependencies
}

/** Store row-wise formulas against dependency slots, not visible grid offsets. */
export function buildSheetCalculationExpression(input: {
  source: string
  columns: ReadonlyArray<{
    id: string
    origin: SheetCalculationColumnOrigin
  }>
}) {
  const dependencies = sheetCalculationDependenciesFromExpression({
    ...input,
    rowCount: 1,
  })

  const maps = {
    tableId: DEPENDENCY_MAP_TABLE_ID,
    rowIds: dummyRowIds(1),
    columnIds: input.columns.map((column) => column.id),
  }

  const artifact = buildPersistedFormulaArtifact(
    parseFormula(input.source.trim(), maps),
    DEPENDENCY_MAP_TABLE_ID,
  )

  return {
    dependencies,
    source: emitFormula(artifact, {
      ...maps,
      columnIds: dependencies.map((dependency) => dependency.id),
    }),
  }
}

export type SheetCalculationInput = {
  dependency: SheetCalculationDependency
  field: FieldDefinition
  state: 'present' | 'missing' | 'unmatched' | 'excluded'
  value?: unknown
  provenance: unknown
}

/** Provenance that names a Dataset row and field; anything else is not a matched Dataset row. */
const DATASET_PROVENANCE = z.object({
  sourceKind: z.literal('dataset'),
  sourceRowId: z.string(),
  sourceFieldId: z.string(),
})

/** The logical types a calculation can read: numbers, text and booleans. */
const INPUT_LOGICAL_TYPES = ['integer', 'decimal', 'text', 'boolean'] as const

/** A number, including the NaN a formula can produce; `typeof` would call it a number too. */
const NUMBER_OR_NAN = z.union([z.number(), z.nan()])

/** What a calculation can produce: a number, a text such as Pass or Fail, or a boolean. */
export type SheetCalculationValue = number | string | boolean

/** The value an input must carry for its declared logical type. */
function inputValueSchema(logicalType: (typeof INPUT_LOGICAL_TYPES)[number]) {
  switch (logicalType) {
    case 'text':
      return z.string()
    case 'boolean':
      return z.boolean()
    case 'integer':
    case 'decimal':
      return z.number().finite()
  }
}

/** The value a result must have for the output's declared logical type. */
function outputValueSchema(
  logicalType: (typeof CALCULATION_OUTPUT_TYPES)[number],
) {
  switch (logicalType) {
    case 'text':
      return z.string()
    case 'boolean':
      return z.boolean()
    case 'integer':
    case 'decimal':
      return NUMBER_OR_NAN
  }
}

function inputLogicalType(field: FieldDefinition) {
  return INPUT_LOGICAL_TYPES.find((type) => type === field.logicalType)
}

/**
 * DSET-01.2 — resolve the active Dataset Value Flag behind a bound input's
 * provenance, if any. A flagged value is excluded from ƒx evaluation by
 * default; clearing the flag leaves the value present. Provenance that is not
 * a matched Dataset row is never excluded, so unbound/local inputs are not
 * affected. Shares the canonical index with charts, analyses and pipelines.
 */
export function flaggedValueForProvenance(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- An input's provenance is JSONB on the block payload; `DATASET_PROVENANCE` decides whether it names a Dataset row and field.
  provenance: unknown,
  flagIndex: ReadonlyMap<string, DatasetValueFlag>,
): DatasetValueFlag | undefined {
  const candidate = DATASET_PROVENANCE.safeParse(provenance)

  if (!candidate.success) return undefined

  const { sourceRowId, sourceFieldId } = candidate.data

  if (!isValueFlagged(flagIndex, sourceRowId, sourceFieldId)) return undefined

  return flagIndex.get(flagKey(sourceRowId, sourceFieldId))
}

export type SheetCalculationResult =
  | {
      status: 'value'
      value: SheetCalculationValue
      dependencyProvenance: unknown[]
    }
  | {
      status: 'error'
      errorCode:
        | 'MISSING'
        | 'UNMATCHED'
        | 'EXCLUDED'
        | 'TYPE'
        | 'QUANTITY'
        | 'DIV_BY_ZERO'
        | 'EVALUATION'
      diagnostic: string
      dependencyProvenance: unknown[]
    }

const quantityKey = (field: FieldDefinition) =>
  field.quantity === null ? null : JSON.stringify(field.quantity)

/** The comparison operators of the formula language. */
const COMPARISON_OPERATORS = new Set(['=', '<>', '<', '<=', '>', '>='])

/** Logical functions: their arguments are plain values and they produce none with a unit. */
const LOGIC_FUNCTIONS = new Set(['AND', 'OR', 'NOT', 'XOR'])

const QUANTITY_RULES = {
  addition: 'Addition and subtraction require exact quantity metadata.',
  multiplication:
    'Multiplication of two quantities is outside the safe profile.',
  division: 'Division requires an exact quantity match or a scalar divisor.',
  exponent: 'Quantity exponentiation is outside the safe profile.',
  comparison:
    'A comparison needs like quantity metadata on both sides, or a plain number on one side.',
  logic: 'Logical functions take plain values, not quantities.',
  branches: 'The two answers of IF must carry the same quantity metadata.',
  unsupported: 'Only deterministic scalar arithmetic is supported.',
} as const

function expressionQuantity(
  node: FormulaNode,
  quantities: Array<string | null>,
): string | null {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return null
    case 'reference':
      return quantities[node.slot] ?? null
    case 'unary':
    case 'percent':
      return expressionQuantity(node.operand, quantities)
    case 'binary': {
      const left = expressionQuantity(node.left, quantities)
      const right = expressionQuantity(node.right, quantities)

      if (node.operator === '+' || node.operator === '-') {
        if (left !== right) throw new Error(QUANTITY_RULES.addition)

        return left
      }

      if (node.operator === '*') {
        if (left !== null && right !== null)
          throw new Error(QUANTITY_RULES.multiplication)

        return left ?? right
      }

      if (node.operator === '/') {
        if (right === null) return left

        if (left === right) return null
        throw new Error(QUANTITY_RULES.division)
      }

      if (node.operator === '^') {
        if (right !== null || left !== null)
          throw new Error(QUANTITY_RULES.exponent)

        return null
      }

      if (COMPARISON_OPERATORS.has(node.operator)) {
        // Like units compare, and so does anything against a plain number.
        if (left !== null && right !== null && left !== right)
          throw new Error(QUANTITY_RULES.comparison)

        return null
      }

      throw new Error(QUANTITY_RULES.unsupported)
    }

    case 'call': {
      const quantities_ = node.arguments.map((argument) =>
        expressionQuantity(argument, quantities),
      )

      if (LOGIC_FUNCTIONS.has(node.functionId)) {
        if (quantities_.some((quantity) => quantity !== null))
          throw new Error(QUANTITY_RULES.logic)

        return null
      }

      if (node.functionId === 'IF') {
        const [condition, whenTrue, whenFalse] = quantities_

        if (node.arguments.length < 2 || node.arguments.length > 3)
          throw new Error(QUANTITY_RULES.unsupported)

        if (condition !== null) throw new Error(QUANTITY_RULES.logic)

        // Without an else, the answer is FALSE when the test fails.
        const otherwise = node.arguments.length === 3 ? whenFalse : null

        if (whenTrue !== otherwise) throw new Error(QUANTITY_RULES.branches)

        return whenTrue
      }

      throw new Error(QUANTITY_RULES.unsupported)
    }
  }
}

/**
 * Evaluate one semantic row. A1 is parsed only against the definition's fixed
 * dependency-slot order; durable meaning remains the UUID dependency array.
 */
export function evaluateSheetCalculation(input: {
  calculationId: string
  expression: string
  outputField: FieldDefinition
  inputs: SheetCalculationInput[]
}): SheetCalculationResult {
  const dependencyProvenance = input.inputs.map((item) => item.provenance)
  const excluded = input.inputs.find((item) => item.state === 'excluded')

  if (excluded)
    return {
      status: 'error',
      errorCode: 'EXCLUDED',
      diagnostic: 'A flagged value is excluded from this calculation.',
      dependencyProvenance,
    }
  const absent = input.inputs.find((item) => item.state !== 'present')

  if (absent)
    return {
      status: 'error',
      errorCode: absent.state === 'unmatched' ? 'UNMATCHED' : 'MISSING',
      diagnostic:
        absent.state === 'unmatched'
          ? 'A governed dependency source was unmatched.'
          : 'A calculation dependency is missing.',
      dependencyProvenance,
    }

  if (
    input.inputs.some(({ field, value }) => {
      const type = inputLogicalType(field)

      return (
        type === undefined ||
        field.cardinality !== 'one' ||
        !inputValueSchema(type).safeParse(value).success
      )
    })
  )
    return {
      status: 'error',
      errorCode: 'TYPE',
      diagnostic:
        'The safe calculation profile accepts scalar number, text and boolean inputs only.',
      dependencyProvenance,
    }

  const outputType = CALCULATION_OUTPUT_TYPES.find(
    (type) => type === input.outputField.logicalType,
  )

  if (outputType === undefined)
    return {
      status: 'error',
      errorCode: 'TYPE',
      diagnostic:
        'The safe calculation profile produces a number, text or a boolean.',
      dependencyProvenance,
    }

  const rowId = '00000000-0000-4000-8000-000000000001'
  const tableId = '00000000-0000-4000-8000-000000000002'
  const outputColumnId = input.calculationId

  const columns = [
    ...input.inputs.map((item, index) => ({
      id: item.dependency.id,
      createdAt: new Date(index).toISOString(),
      logicalType: z.enum(INPUT_LOGICAL_TYPES).parse(item.field.logicalType),
    })),
    {
      id: outputColumnId,
      createdAt: new Date(input.inputs.length).toISOString(),
      logicalType: outputType,
    },
  ]

  let parsed: ReturnType<typeof parseFormula>

  try {
    parsed = parseFormula(input.expression, {
      tableId,
      rowIds: [rowId],
      columnIds: columns.map(({ id }) => id),
    })

    if (parsed.status !== 'supported') throw new Error('Unsupported function.')

    const actualDependencies = parsed.artifact.bindings.map((binding) =>
      binding.kind === 'cell' ? binding.cell.columnId : null,
    )

    const declaredIds = input.inputs.map(({ dependency }) => dependency.id)
    const declaredIdSet = new Set(declaredIds)
    const actualDependencySet = new Set(actualDependencies)

    if (
      actualDependencies.some((id) => id === null || !declaredIdSet.has(id)) ||
      declaredIds.some((id) => !actualDependencySet.has(id))
    )
      throw new Error(
        'A1 references must exactly match the semantic dependencies.',
      )

    const fieldByDependency = new Map(
      input.inputs.map(({ dependency, field }) => [dependency.id, field]),
    )

    const inferred = expressionQuantity(
      parsed.artifact.template,
      actualDependencies.flatMap((id) => {
        const field = id === null ? undefined : fieldByDependency.get(id)

        return field === undefined ? [] : [quantityKey(field)]
      }),
    )

    if (inferred !== quantityKey(input.outputField))
      throw new Error(
        'Output quantity metadata does not exactly match the expression.',
      )
  } catch (error) {
    return {
      status: 'error',
      errorCode:
        error instanceof Error &&
        error.message.toLowerCase().includes('quantity')
          ? 'QUANTITY'
          : 'EVALUATION',
      diagnostic:
        error instanceof Error
          ? error.message
          : 'Invalid calculation expression.',
      dependencyProvenance,
    }
  }

  const workbook = buildScientificWorkbook([
    {
      id: tableId,
      columns,
      rows: [
        {
          id: rowId,
          createdAt: new Date(0).toISOString(),
          cells: Object.fromEntries([
            ...input.inputs.map((item) => [
              item.dependency.id,
              { literal: item.value },
            ]),
            [outputColumnId, {}],
          ]),
        },
      ],
    },
  ])

  try {
    workbook.setFormula(
      { tableId, rowId, columnId: outputColumnId },
      input.expression,
    )
    const result = workbook.get({ tableId, rowId, columnId: outputColumnId })

    if (result.status === 'error')
      return {
        status: 'error',
        errorCode:
          result.error === 'DIV_BY_ZERO' ? 'DIV_BY_ZERO' : 'EVALUATION',
        diagnostic: `Formula evaluated to ${result.error}.`,
        dependencyProvenance,
      }

    const output = result.logical.ok
      ? outputValueSchema(outputType).safeParse(result.logical.value)
      : undefined

    if (!output?.success)
      return {
        status: 'error',
        errorCode: 'TYPE',
        diagnostic: 'Formula result did not match the declared output type.',
        dependencyProvenance,
      }

    return {
      status: 'value',
      value: output.data,
      dependencyProvenance,
    }
  } finally {
    workbook.destroy()
  }
}
