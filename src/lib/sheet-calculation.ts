import { z } from 'zod'

import type { FormulaNode } from './formula-ir'
import { buildPersistedFormulaArtifact, parseFormula } from './formula-ir'
import { buildScientificWorkbook } from './scientific-workbook'
import type { FieldDefinition } from './field-definition'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

export const sheetCalculationDependencySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('column'), id: uuid }).strict(),
  z.object({ kind: z.literal('local-field'), id: uuid }).strict(),
  z.object({ kind: z.literal('calculation'), id: uuid }).strict(),
])

export const sheetInstanceCalculationSchema = z
  .object({
    id: uuid,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
    label: z.string().trim().min(1).max(200),
    lifecycle: z.enum(['active', 'retired']),
    outputField: sheetFieldDefinitionSchema,
    dependencies: z.array(sheetCalculationDependencySchema).max(64),
    expression: z
      .object({
        language: z.literal('sheetbase-formula-v1'),
        source: z.string().trim().min(1).max(8_192),
      })
      .strict(),
  })
  .strict()
  .superRefine((calculation, context) => {
    if (
      calculation.outputField.fieldId !== calculation.id ||
      calculation.outputField.computation.mode !== 'computed' ||
      calculation.outputField.computation.expressionId !== calculation.id ||
      calculation.outputField.cardinality !== 'one' ||
      !['integer', 'decimal'].includes(calculation.outputField.logicalType)
    )
      context.addIssue({
        code: 'custom',
        path: ['outputField'],
        message:
          'Calculation output must be a scalar numeric computed FieldDefinition with matching identity.',
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
): SheetCalculationDependency['kind'] {
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
}): SheetCalculationDependency[] {
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
  const dependencies: SheetCalculationDependency[] = []
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

export type SheetCalculationInput = {
  dependency: SheetCalculationDependency
  field: FieldDefinition
  state: 'present' | 'missing' | 'unmatched'
  value?: unknown
  provenance: unknown
}

export type SheetCalculationResult =
  | { status: 'value'; value: number; dependencyProvenance: unknown[] }
  | {
      status: 'error'
      errorCode:
        | 'MISSING'
        | 'UNMATCHED'
        | 'TYPE'
        | 'QUANTITY'
        | 'DIV_BY_ZERO'
        | 'EVALUATION'
      diagnostic: string
      dependencyProvenance: unknown[]
    }

const quantityKey = (field: FieldDefinition) =>
  field.quantity === null ? null : JSON.stringify(field.quantity)

function expressionQuantity(
  node: FormulaNode,
  quantities: Array<string | null>,
): string | null {
  switch (node.kind) {
    case 'number':
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
        if (left !== right)
          throw new Error(
            'Addition and subtraction require exact quantity metadata.',
          )
        return left
      }
      if (node.operator === '*') {
        if (left !== null && right !== null)
          throw new Error(
            'Multiplication of two quantities is outside the safe profile.',
          )
        return left ?? right
      }
      if (node.operator === '/') {
        if (right === null) return left
        if (left === right) return null
        throw new Error(
          'Division requires an exact quantity match or a scalar divisor.',
        )
      }
      if (node.operator === '^') {
        if (right !== null || left !== null)
          throw new Error(
            'Quantity exponentiation is outside the safe profile.',
          )
        return null
      }
      throw new Error(
        'Only arithmetic operators are supported by this profile.',
      )
    }
    case 'string':
    case 'boolean':
    case 'call':
      throw new Error('Only deterministic scalar arithmetic is supported.')
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
    input.inputs.some(
      ({ field, value }) =>
        !['integer', 'decimal'].includes(field.logicalType) ||
        field.cardinality !== 'one' ||
        typeof value !== 'number' ||
        !Number.isFinite(value),
    )
  )
    return {
      status: 'error',
      errorCode: 'TYPE',
      diagnostic:
        'The safe calculation profile accepts scalar numeric inputs only.',
      dependencyProvenance,
    }

  const rowId = '00000000-0000-4000-8000-000000000001'
  const tableId = '00000000-0000-4000-8000-000000000002'
  const outputColumnId = input.calculationId
  const columns = [
    ...input.inputs.map((item, index) => ({
      id: item.dependency.id,
      createdAt: new Date(index).toISOString(),
      logicalType: item.field.logicalType as 'integer' | 'decimal',
    })),
    {
      id: outputColumnId,
      createdAt: new Date(input.inputs.length).toISOString(),
      logicalType: input.outputField.logicalType as 'integer' | 'decimal',
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
    if (
      actualDependencies.some(
        (id) => id === null || !declaredIds.includes(id),
      ) ||
      declaredIds.some((id) => !actualDependencies.includes(id))
    )
      throw new Error(
        'A1 references must exactly match the semantic dependencies.',
      )
    const inferred = expressionQuantity(
      parsed.artifact.template,
      actualDependencies.map((id) =>
        quantityKey(
          input.inputs.find(({ dependency }) => dependency.id === id)!.field,
        ),
      ),
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
    if (!result.logical.ok || typeof result.logical.value !== 'number')
      return {
        status: 'error',
        errorCode: 'TYPE',
        diagnostic: 'Formula result did not match the declared numeric output.',
        dependencyProvenance,
      }
    return {
      status: 'value',
      value: result.logical.value,
      dependencyProvenance,
    }
  } finally {
    workbook.destroy()
  }
}
