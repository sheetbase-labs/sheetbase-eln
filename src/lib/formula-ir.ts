import { z } from 'zod'

import {
  SCIENTIFIC_CORE_FUNCTIONS,
  SHEETBASE_ENGINE_VERSION,
  SHEETBASE_FUNCTION_PROFILE,
  SHEETBASE_SYNTAX_PROFILE,
} from './formula-profile'
import { SHEETBASE_LITERAL_PROFILE } from './scientific-literals'

export const FORMULA_LIMITS = Object.freeze({
  source: 8192,
  slots: 10_000,
  rangeCells: 100_000,
  rows: 10_000,
  columns: 256,
})

export type CellIdentity = Readonly<{ rowId: string; columnId: string }>

export type AnchorFlags = Readonly<{
  columnAbsolute: boolean
  rowAbsolute: boolean
}>

export type FormulaBinding = Readonly<
  | {
      kind: 'cell'
      slot: number
      tableId?: string
      cell: CellIdentity
      anchor: AnchorFlags
    }
  | {
      kind: 'range'
      slot: number
      tableId?: string
      members: ReadonlyArray<ReadonlyArray<CellIdentity>>
      start: AnchorFlags
      end: AnchorFlags
    }
>

export type FormulaNode =
  | { kind: 'number' | 'string' | 'boolean'; value: number | string | boolean }
  | { kind: 'reference'; slot: number }
  | { kind: 'unary'; operator: '+' | '-'; operand: FormulaNode }
  | { kind: 'percent'; operand: FormulaNode }
  | { kind: 'binary'; operator: string; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; functionId: string; arguments: FormulaNode[] }

export interface FormulaArtifact {
  version: 1
  syntaxProfile: typeof SHEETBASE_SYNTAX_PROFILE
  functionProfile: typeof SHEETBASE_FUNCTION_PROFILE
  source: string
  template: FormulaNode
  bindings: readonly FormulaBinding[]
  engineExpression: string
}

export type FormulaParseResult =
  | { status: 'supported'; artifact: FormulaArtifact }
  | {
      status: 'unsupported'
      source: string
      functionIds: string[]
      artifact: FormulaArtifact
    }

export interface PersistedFormulaArtifact extends FormulaArtifact {
  literalProfile: typeof SHEETBASE_LITERAL_PROFILE
  engineVersion: typeof SHEETBASE_ENGINE_VERSION
  status: FormulaParseResult['status']
  dependencies: readonly (CellIdentity & { tableId: string })[]
}

export class FormulaSyntaxError extends Error {
  constructor(
    public readonly code: 'syntax' | 'limit' | 'reference' | 'cross-sheet',
    message: string,
  ) {
    super(message)
    this.name = 'FormulaSyntaxError'
  }
}

export interface FormulaMaps {
  tableId?: string
  name?: string
  rowIds: readonly string[]
  columnIds: readonly string[]
  tables?: readonly FormulaMaps[]
}

type Token = {
  type:
    | 'number'
    | 'string'
    | 'boolean'
    | 'ref'
    | 'crossRef'
    | 'identifier'
    | 'operator'
    | 'punct'
    | 'eof'
  text: string
  sheet?: string
}

/**
 * Convert `**` exponentiation to the engine's `^` operator, preserving
 * string literals verbatim. Users expect `**` (Python/JavaScript style) to
 * work; the engine only understands `^`. Applied at the parser entry point
 * so server-side validation canonicalises identically to the client editors.
 *
 * String literals (`"…"`, with `""` as an escaped quote) are copied untouched
 * — `="pattern ** here"` keeps its `**`. Everything else outside a string has
 * `**` replaced by `^`.
 */
export function normalizeExponentiation(source: string): string {
  let result = ''
  let i = 0

  while (i < source.length) {
    if (source[i] === '"') {
      // Copy the string literal verbatim, handling "" escaped quotes.
      result += source[i++]

      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            result += '""'
            i += 2
            continue
          }

          result += source[i++]
          break
        }

        result += source[i++]
      }

      continue
    }

    if (source[i] === '*' && source[i + 1] === '*') {
      result += '^'
      i += 2
      continue
    }

    result += source[i++]
  }

  return result
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 1

  while (i < source.length) {
    const rest = source.slice(i)
    const white = /^\s+/.exec(rest)

    if (white) {
      i += white[0].length
      continue
    }

    if (/^[{}[\]#]/.test(rest))
      throw new FormulaSyntaxError(
        'syntax',
        'Arrays and spill formulas are not supported.',
      )
    const quotedCross = /^'((?:[^']|'')+)'!(\$?[A-Za-z]{1,3}\$?\d+)/.exec(rest)

    if (quotedCross) {
      tokens.push({
        type: 'crossRef',
        text: quotedCross[2],
        sheet: quotedCross[1].replaceAll("''", "'"),
      })
      i += quotedCross[0].length
      continue
    }

    const plainCross =
      /^([A-Za-z_][A-Za-z0-9_.]*)!(\$?[A-Za-z]{1,3}\$?\d+)/.exec(rest)

    if (plainCross) {
      tokens.push({
        type: 'crossRef',
        text: plainCross[2],
        sheet: plainCross[1],
      })
      i += plainCross[0].length
      continue
    }

    if (/^[!']/.test(rest))
      throw new FormulaSyntaxError(
        'cross-sheet',
        'Cross-sheet references require a quoted or identifier sheet name.',
      )
    const string = /^"(?:[^"]|"")*"/.exec(rest)

    if (string) {
      tokens.push({ type: 'string', text: string[0] })
      i += string[0].length
      continue
    }

    const ref = /^(?:\$?[A-Za-z]{1,3}\$?\d+)/.exec(rest)

    if (ref) {
      tokens.push({ type: 'ref', text: ref[0] })
      i += ref[0].length
      continue
    }

    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(rest)

    if (number) {
      tokens.push({ type: 'number', text: number[0] })
      i += number[0].length
      continue
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)

    if (identifier) {
      const upper = identifier[0].toUpperCase()

      if (upper === 'OFFSET' || upper === 'VERSION')
        throw new FormulaSyntaxError('syntax', `${upper} is a protected token.`)
      tokens.push({
        type: upper === 'TRUE' || upper === 'FALSE' ? 'boolean' : 'identifier',
        text: upper,
      })
      i += identifier[0].length
      continue
    }

    const operator = /^(?:<>|<=|>=|[+\-*/^&%=<>])/.exec(rest)

    if (operator) {
      tokens.push({ type: 'operator', text: operator[0] })
      i += operator[0].length
      continue
    }

    if (/^[(),:]/.test(rest)) {
      tokens.push({ type: 'punct', text: rest[0] })
      i++
      continue
    }

    throw new FormulaSyntaxError(
      'syntax',
      `Unexpected token at character ${i + 1}.`,
    )
  }

  tokens.push({ type: 'eof', text: '' })

  return tokens
}

function columnIndex(label: string) {
  let n = 0

  for (const c of label) n = n * 26 + c.charCodeAt(0) - 64

  return n - 1
}

function parseRef(text: string) {
  const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(text.toUpperCase())!

  return {
    column: columnIndex(match[2]),
    row: Number(match[4]) - 1,
    anchor: { columnAbsolute: match[1] === '$', rowAbsolute: match[3] === '$' },
  }
}

const precedence = new Map([
  ['=', 1],
  ['<>', 1],
  ['<', 1],
  ['<=', 1],
  ['>', 1],
  ['>=', 1],
  ['&', 2],
  ['+', 3],
  ['-', 3],
  ['*', 4],
  ['/', 4],
  ['^', 5],
])

const coreFunctions = new Set<string>(SCIENTIFIC_CORE_FUNCTIONS)

export function parseFormula(
  source: string,
  maps: FormulaMaps,
): FormulaParseResult {
  const normalized = normalizeExponentiation(source)

  if (!normalized.startsWith('='))
    throw new FormulaSyntaxError('syntax', 'A formula must begin with =.')

  if (normalized.length > FORMULA_LIMITS.source)
    throw new FormulaSyntaxError('limit', 'Formula exceeds 8,192 characters.')

  if (
    maps.rowIds.length > FORMULA_LIMITS.rows ||
    maps.columnIds.length > FORMULA_LIMITS.columns
  )
    throw new FormulaSyntaxError(
      'limit',
      'Table exceeds the calculation profile dimensions.',
    )
  const tokens = tokenize(normalized)
  let position = 0
  const bindings: FormulaBinding[] = []
  const unsupported = new Set<string>()
  let rangeCells = 0

  const resolveTable = (sheet?: string) => {
    if (!sheet) return maps

    const candidates = (maps.tables ?? []).filter(
      (table) =>
        table.name?.toLocaleLowerCase('en-US') ===
        sheet.toLocaleLowerCase('en-US'),
    )

    if (candidates.length !== 1)
      throw new FormulaSyntaxError(
        'cross-sheet',
        candidates.length
          ? `Sheet name ${sheet} is ambiguous.`
          : `Sheet ${sheet} was not found in this notebook.`,
      )

    return candidates[0]
  }

  const peek = () => tokens[position]
  const take = () => tokens[position++]

  const expect = (text: string) => {
    if (peek().text !== text)
      throw new FormulaSyntaxError(
        'syntax',
        `Expected ${text || 'end of formula'}.`,
      )
    take()
  }

  const bindingFor = (firstText: string, sheet?: string): FormulaNode => {
    const first = parseRef(firstText)
    const referenceTable = resolveTable(sheet)

    const resolve = (ref: ReturnType<typeof parseRef>) => {
      const rowId = referenceTable.rowIds[ref.row],
        columnId = referenceTable.columnIds[ref.column]

      if (!rowId || !columnId)
        throw new FormulaSyntaxError(
          'reference',
          `Reference ${firstText} is outside the stable table maps.`,
        )

      return { rowId, columnId }
    }

    const slot = bindings.length
    const tableBinding: Pick<FormulaMaps, 'tableId'> = {}

    if (sheet) tableBinding.tableId = referenceTable.tableId

    if (peek().text !== ':') {
      bindings.push({
        kind: 'cell',
        slot,
        ...tableBinding,
        cell: resolve(first),
        anchor: first.anchor,
      })
    } else {
      take()
      const endToken = take()

      if (endToken.type !== 'ref')
        throw new FormulaSyntaxError(
          'syntax',
          'Ranges require two finite A1 cell references.',
        )
      const end = parseRef(endToken.text)

      const rowStep = end.row >= first.row ? 1 : -1,
        columnStep = end.column >= first.column ? 1 : -1,
        rowCount = Math.abs(end.row - first.row) + 1,
        columnCount = Math.abs(end.column - first.column) + 1

      rangeCells += rowCount * columnCount

      if (rangeCells > FORMULA_LIMITS.rangeCells)
        throw new FormulaSyntaxError(
          'limit',
          'Captured ranges exceed 100,000 cells.',
        )

      const members = Array.from({ length: rowCount }, (_item, r) =>
        Array.from({ length: columnCount }, (_member, c) =>
          resolve({
            row: first.row + r * rowStep,
            column: first.column + c * columnStep,
            anchor: first.anchor,
          }),
        ),
      )

      bindings.push({
        kind: 'range',
        slot,
        ...tableBinding,
        members,
        start: first.anchor,
        end: end.anchor,
      })
    }

    if (bindings.length > FORMULA_LIMITS.slots)
      throw new FormulaSyntaxError(
        'limit',
        'Formula exceeds 10,000 reference slots.',
      )

    return { kind: 'reference', slot }
  }

  const primary = (): FormulaNode => {
    const token = take()

    if (token.type === 'number') {
      const value = Number(token.text)

      const significantDigits = token.text
        .replace(/^[+-]/, '')
        .split(/[Ee]/)[0]
        .replace('.', '')
        .replace(/^0+/, '').length

      if (!Number.isFinite(value) || significantDigits > 15)
        throw new FormulaSyntaxError(
          'syntax',
          'Numeric literals must be finite and have at most 15 significant digits.',
        )

      return { kind: 'number', value }
    }

    if (token.type === 'string')
      return {
        kind: 'string',
        value: token.text.slice(1, -1).replaceAll('""', '"'),
      }

    if (token.type === 'boolean')
      return { kind: 'boolean', value: token.text === 'TRUE' }

    if (token.type === 'ref' || token.type === 'crossRef')
      return bindingFor(token.text, token.sheet)

    if (token.text === '(') {
      const node = expression(0)
      expect(')')

      return node
    }

    if (token.type === 'identifier') {
      if (peek().text !== '(')
        throw new FormulaSyntaxError(
          'syntax',
          'Named expressions and aliases are not supported.',
        )
      take()
      const args: FormulaNode[] = []

      if (peek().text !== ')') {
        for (;;) {
          args.push(expression(0))

          if (peek().text !== ',') break
          take()
        }
      }

      expect(')')

      if (!coreFunctions.has(token.text)) unsupported.add(token.text)

      return { kind: 'call', functionId: token.text, arguments: args }
    }

    if (token.text === '+' || token.text === '-')
      return { kind: 'unary', operator: token.text, operand: expression(6) }
    throw new FormulaSyntaxError('syntax', 'Expected a scalar expression.')
  }

  const expression = (minimum: number): FormulaNode => {
    let left = primary()

    if (peek().text === '%') {
      take()
      left = { kind: 'percent', operand: left }

      if (peek().text === '%')
        throw new FormulaSyntaxError(
          'syntax',
          'Repeated percent operators are not supported.',
        )
    }

    while (
      peek().type === 'operator' &&
      peek().text !== '%' &&
      (precedence.get(peek().text) ?? -1) >= minimum
    ) {
      const operator = take().text,
        p = precedence.get(operator)!

      const right = expression(p + 1)
      left = { kind: 'binary', operator, left, right }
    }

    return left
  }

  const template = expression(0)

  if (peek().type !== 'eof')
    throw new FormulaSyntaxError('syntax', 'Unexpected trailing formula input.')

  if (
    template.kind === 'reference' &&
    bindings[template.slot]?.kind === 'range'
  )
    throw new FormulaSyntaxError(
      'syntax',
      'A range cannot be returned as a top-level scalar formula.',
    )

  const artifact: FormulaArtifact = {
    version: 1,
    syntaxProfile: SHEETBASE_SYNTAX_PROFILE,
    functionProfile: SHEETBASE_FUNCTION_PROFILE,
    source: normalized,
    template,
    bindings,
    engineExpression: '',
  }

  artifact.engineExpression = emitFormula(artifact, maps)

  if (artifact.engineExpression.length > FORMULA_LIMITS.source)
    throw new FormulaSyntaxError(
      'limit',
      'The normalized formula exceeds 8,192 characters.',
    )

  if (unsupported.size)
    return {
      status: 'unsupported',
      source: normalized,
      functionIds: [...unsupported].sort(),
      artifact: Object.freeze(artifact),
    }

  return { status: 'supported', artifact: Object.freeze(artifact) }
}

/** Builds the exact JSON contract consumed by the trusted SQL writer. */
export function buildPersistedFormulaArtifact(
  result: FormulaParseResult,
  tableId: string,
): PersistedFormulaArtifact {
  const dependencies = new Map<string, CellIdentity & { tableId: string }>()

  for (const binding of result.artifact.bindings) {
    const cells =
      binding.kind === 'cell' ? [binding.cell] : binding.members.flat()

    const sourceTableId = binding.tableId ?? tableId

    for (const cell of cells)
      dependencies.set(`${sourceTableId}/${cell.rowId}/${cell.columnId}`, {
        tableId: sourceTableId,
        ...cell,
      })
  }

  return Object.freeze({
    ...result.artifact,
    literalProfile: SHEETBASE_LITERAL_PROFILE,
    engineVersion: SHEETBASE_ENGINE_VERSION,
    status: result.status,
    dependencies: Object.freeze(
      [...dependencies.values()].sort((a, b) =>
        `${a.tableId}/${a.rowId}/${a.columnId}`.localeCompare(
          `${b.tableId}/${b.rowId}/${b.columnId}`,
        ),
      ),
    ),
  })
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ownKeys = (
  value: z.output<typeof objectSchema>,
  keys: readonly string[],
) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value)

const objectEnvelopeSchema = z.object({})

const objectSchema = z.custom<object>(
  (value) => objectEnvelopeSchema.safeParse(value).success,
)

/** Check the original own keys, not a stripped Zod result; retain input identity. */
function exactObject<
  Fields extends NonNullable<Parameters<typeof z.object>[0]>,
>(fields: Fields) {
  const schema = z.object(fields)
  const keys = Object.keys(fields)

  return z.custom<z.output<typeof schema>>((input) => {
    const object = objectSchema.safeParse(input)

    return (
      object.success &&
      ownKeys(object.data, keys) &&
      schema.safeParse(input).success
    )
  })
}

const uuidSchema = z.string().regex(UUID)
const identitySchema = exactObject({ rowId: uuidSchema, columnId: uuidSchema })

const anchorSchema = exactObject({
  columnAbsolute: z.boolean(),
  rowAbsolute: z.boolean(),
})

const unknownArraySchema = z.custom<unknown[]>((value) => Array.isArray(value))

const bindingHeaderSchema = z.object({
  kind: z.unknown().optional(),
  slot: z.unknown().optional(),
  tableId: z.unknown().optional(),
})

const cellFields = {
  kind: z.literal('cell'),
  slot: z.number(),
  cell: identitySchema,
  anchor: anchorSchema,
}

const rangeFields = {
  kind: z.literal('range'),
  slot: z.number(),
  members: unknownArraySchema.refine((members) => members.length > 0),
  start: anchorSchema,
  end: anchorSchema,
}

const cellSchema = exactObject(cellFields)
const crossCellSchema = exactObject({ ...cellFields, tableId: uuidSchema })
const rangeSchema = exactObject(rangeFields)
const crossRangeSchema = exactObject({ ...rangeFields, tableId: uuidSchema })

const membersSchema = z.custom<CellIdentity[][]>((value) => {
  const rows = unknownArraySchema.safeParse(value)

  return (
    rows.success &&
    rows.data.every((row) => {
      const cells = unknownArraySchema.safeParse(row)

      return (
        cells.success &&
        cells.data.every((cell) => identitySchema.safeParse(cell).success)
      )
    })
  )
})

const nodeHeaderSchema = z.object({ kind: z.unknown().optional() })

const numberNodeSchema = exactObject({
  kind: z.literal('number'),
  value: z.number(),
})

const stringNodeSchema = exactObject({
  kind: z.literal('string'),
  value: z.string(),
})

const booleanNodeSchema = exactObject({
  kind: z.literal('boolean'),
  value: z.boolean(),
})

const referenceNodeSchema = exactObject({
  kind: z.literal('reference'),
  slot: z.number().refine(Number.isInteger),
})

const unaryNodeSchema = exactObject({
  kind: z.literal('unary'),
  operator: z.enum(['+', '-']),
  operand: z.unknown(),
})

const percentNodeSchema = exactObject({
  kind: z.literal('percent'),
  operand: z.unknown(),
})

const binaryNodeSchema = exactObject({
  kind: z.literal('binary'),
  // Preserve v1's persisted `operator in precedence` contract, including inherited
  // Object names; the source tokenizer still only produces the twelve operators.
  operator: z
    .string()
    .refine(
      (operator) => precedence.has(operator) || operator in Object.prototype,
    ),
  left: z.unknown(),
  right: z.unknown(),
})

const callNodeSchema = exactObject({
  kind: z.literal('call'),
  functionId: z.string().regex(/^[A-Z][A-Z0-9.]*$/),
  arguments: unknownArraySchema,
})

function fail(message: string): never {
  throw new FormulaSyntaxError(
    'syntax',
    `Invalid persisted formula: ${message}`,
  )
}

/** Decodes stored bindings, including ordered slots and captured range limits. */
const bindingsSchema = z.custom<FormulaBinding[]>((value) => {
  const parsed = unknownArraySchema
    .refine((bindings) => bindings.length <= FORMULA_LIMITS.slots)
    .safeParse(value)

  if (!parsed.success) fail('bindings exceed the profile.')
  const bindings = parsed.data

  let rangeCells = 0
  bindings.forEach((binding, slot) => {
    const header = bindingHeaderSchema.safeParse(binding)

    if (!header.success || header.data.slot !== slot)
      fail('binding slots must be bijective and ordered.')

    if (header.data.kind === 'cell') {
      const schema = header.data.tableId ? crossCellSchema : cellSchema

      if (!schema.safeParse(binding).success)
        fail('cell binding shape is invalid.')
    } else if (header.data.kind === 'range') {
      const schema = header.data.tableId ? crossRangeSchema : rangeSchema
      const range = schema.safeParse(binding)

      if (!range.success) fail('range binding shape is invalid.')
      const members = membersSchema.safeParse(range.data.members)

      if (!members.success)
        fail('ranges must be nonempty rectangles of stable identities.')
      const width = members.data[0]?.length ?? 0

      if (!width || members.data.some((row) => row.length !== width))
        fail('ranges must be nonempty rectangles of stable identities.')
      rangeCells += members.data.length * width

      if (rangeCells > FORMULA_LIMITS.rangeCells)
        fail('captured ranges exceed the profile.')
    } else fail('binding kind is invalid.')
  })

  return true
})

// Unknown is the storage I/O boundary; the schema immediately decodes all bindings.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function decodeFormulaBindings(value: unknown): FormulaBinding[] {
  return bindingsSchema.parse(value)
}

/** Decodes a stored tree and checks its reference-slot bijection. */
export function decodeFormulaNode(
  // Unknown is the storage I/O boundary; the tree schema immediately decodes it.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  bindingCount: number,
): FormulaNode {
  return formulaTreeSchema(bindingCount).parse(value).template
}

function formulaTreeSchema(bindingCount: number) {
  const referenced = new Set<number>()
  const calls = new Set<string>()
  let nodes = 0

  const nodeSchema: z.ZodType<FormulaNode> = z.custom<FormulaNode>(
    (candidate) => {
      const header = nodeHeaderSchema.safeParse(candidate)

      if (!header.success) fail('formula tree is invalid.')

      if (++nodes > FORMULA_LIMITS.source) fail('formula tree is too large.')

      switch (header.data.kind) {
        case 'number':
          if (!numberNodeSchema.safeParse(candidate).success)
            fail('number node is invalid.')

          break
        case 'string':
          if (!stringNodeSchema.safeParse(candidate).success)
            fail('string node is invalid.')
          break
        case 'boolean':
          if (!booleanNodeSchema.safeParse(candidate).success)
            fail('boolean node is invalid.')
          break

        case 'reference': {
          const reference = referenceNodeSchema.safeParse(candidate)

          if (
            !reference.success ||
            reference.data.slot < 0 ||
            reference.data.slot >= bindingCount ||
            referenced.has(reference.data.slot)
          )
            fail('reference slots must form a bijection.')
          referenced.add(reference.data.slot)
          break
        }

        case 'unary': {
          const unary = unaryNodeSchema.safeParse(candidate)

          if (!unary.success) fail('unary node is invalid.')
          nodeSchema.parse(unary.data.operand)
          break
        }

        case 'percent': {
          const percent = percentNodeSchema.safeParse(candidate)

          if (!percent.success) fail('percent node is invalid.')
          nodeSchema.parse(percent.data.operand)
          break
        }

        case 'binary': {
          const binary = binaryNodeSchema.safeParse(candidate)

          if (!binary.success) fail('binary node is invalid.')
          nodeSchema.parse(binary.data.left)
          nodeSchema.parse(binary.data.right)
          break
        }

        case 'call': {
          const call = callNodeSchema.safeParse(candidate)

          if (!call.success) fail('call node is invalid.')
          calls.add(call.data.functionId)
          call.data.arguments.forEach((argument) => nodeSchema.parse(argument))
          break
        }

        default:
          fail('node kind is invalid.')
      }

      return true
    },
  )

  return nodeSchema.transform((template) => {
    if (referenced.size !== bindingCount)
      fail('reference slots must form a bijection.')

    return { template, calls }
  })
}

const artifactFields = {
  version: z.literal(1),
  syntaxProfile: z.literal(SHEETBASE_SYNTAX_PROFILE),
  functionProfile: z.literal(SHEETBASE_FUNCTION_PROFILE),
  source: z.unknown(),
  template: z.unknown(),
  bindings: z.unknown(),
  engineExpression: z.unknown(),
  literalProfile: z.literal(SHEETBASE_LITERAL_PROFILE),
  engineVersion: z.literal(SHEETBASE_ENGINE_VERSION),
  status: z.enum(['supported', 'unsupported']),
  dependencies: z.unknown(),
}

const artifactHeaderSchema = z.object(artifactFields)

const formulaSourceSchema = z
  .string()
  .startsWith('=')
  .max(FORMULA_LIMITS.source)

const dependencySchema = exactObject({
  tableId: uuidSchema,
  rowId: uuidSchema,
  columnId: uuidSchema,
})

/** Validates the complete untrusted JSON contract loaded from formula storage. */
const artifactSchema = z.custom<PersistedFormulaArtifact>((value) => {
  const object = objectSchema.safeParse(value)

  if (!object.success) fail('artifact must be an object.')

  if (!ownKeys(object.data, Object.keys(artifactFields)))
    fail('artifact fields do not match v1.')
  const header = artifactHeaderSchema.safeParse(value)

  if (!header.success) fail('profile, version, or status is not allowed.')
  const artifact = header.data

  if (!formulaSourceSchema.safeParse(artifact.source).success)
    fail('source is invalid.')

  if (!formulaSourceSchema.safeParse(artifact.engineExpression).success)
    fail('engine expression is invalid.')

  const bindings = decodeFormulaBindings(artifact.bindings)
  const { calls } = formulaTreeSchema(bindings.length).parse(artifact.template)

  const hasUnsupported = [...calls].some((id) => !coreFunctions.has(id))

  // A `supported` formula must not contain unsupported functions. The reverse
  // is intentionally lenient: a formula persisted as `unsupported` under an
  // earlier profile may become calculable after the allow-list expands (e.g.
  // v1 → v2), so `unsupported` with no unsupported functions is a benign
  // transitional state rather than an integrity violation.
  if (artifact.status === 'supported' && hasUnsupported)
    fail('status does not match function semantics.')

  const parsedDependencies = unknownArraySchema.safeParse(artifact.dependencies)

  if (!parsedDependencies.success) fail('dependencies must be an array.')
  const dependencies = parsedDependencies.data
  const expected = new Set<string>()

  for (const binding of bindings) {
    const cells =
      binding.kind === 'cell' ? [binding.cell] : binding.members.flat()

    cells.forEach((cell) =>
      expected.add(`${binding.tableId ?? ''}/${cell.rowId}/${cell.columnId}`),
    )
  }

  const actual = new Set<string>()
  const uniqueDependencies = new Set<string>()

  for (const input of dependencies) {
    const parsed = dependencySchema.safeParse(input)

    if (!parsed.success) fail('dependency shape is invalid.')
    const dependency = parsed.data
    const key = `${dependency.tableId}/${dependency.rowId}/${dependency.columnId}`
    const sameTableKey = `/${dependency.rowId}/${dependency.columnId}`

    if (uniqueDependencies.has(key)) fail('dependencies must be unique.')
    uniqueDependencies.add(key)
    actual.add(expected.has(sameTableKey) ? sameTableKey : key)
  }

  if (
    actual.size !== expected.size ||
    [...actual].some((key) => !expected.has(key))
  )
    fail('dependencies do not match bindings.')

  return true
})

export function validatePersistedFormulaArtifact(
  // Unknown is the persisted JSON boundary and is decoded by the schema immediately.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
): PersistedFormulaArtifact {
  return artifactSchema.parse(value)
}

export function calculationSheetName(tableId: string) {
  if (!UUID.test(tableId))
    throw new FormulaSyntaxError('reference', 'Scientific table ID is invalid.')

  return `sb_${tableId.toLowerCase().replaceAll('-', '')}`
}

function a1(column: number, row: number, anchor: AnchorFlags) {
  let name = ''

  for (let n = column + 1; n; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name

  return `${anchor.columnAbsolute ? '$' : ''}${name}${anchor.rowAbsolute ? '$' : ''}${row + 1}`
}

export function emitFormula(
  artifact: FormulaArtifact,
  maps: FormulaMaps,
): string {
  const emitBinding = (slot: number) => {
    const binding = artifact.bindings[slot]

    const sourceMaps = binding.tableId
      ? (maps.tables ?? []).find((table) => table.tableId === binding.tableId)
      : maps

    if (!sourceMaps)
      throw new FormulaSyntaxError(
        'reference',
        'A bound sheet is missing from the notebook workbook.',
      )

    const sourceRows = new Map(sourceMaps.rowIds.map((id, i) => [id, i])),
      sourceColumns = new Map(sourceMaps.columnIds.map((id, i) => [id, i]))

    const sheetPrefix =
      binding.tableId && binding.tableId !== maps.tableId
        ? `'${calculationSheetName(binding.tableId)}'!`
        : ''

    const coord = (cell: CellIdentity, anchor: AnchorFlags) => {
      const row = sourceRows.get(cell.rowId),
        column = sourceColumns.get(cell.columnId)

      if (row === undefined || column === undefined)
        throw new FormulaSyntaxError(
          'reference',
          'A bound row or column is missing or retired.',
        )

      return a1(column, row, anchor)
    }

    if (binding.kind === 'cell')
      return `${sheetPrefix}${coord(binding.cell, binding.anchor)}`

    const first = binding.members[0]?.[0],
      lastRow = binding.members.at(-1),
      last = lastRow!.at(-1)!

    const firstRow = sourceRows.get(first.rowId),
      firstColumn = sourceColumns.get(first.columnId),
      lastRowIndex = sourceRows.get(last.rowId),
      lastColumn = sourceColumns.get(last.columnId)

    if (
      firstRow === undefined ||
      firstColumn === undefined ||
      lastRowIndex === undefined ||
      lastColumn === undefined
    )
      throw new FormulaSyntaxError(
        'reference',
        'A bound row or column is missing or retired.',
      )

    const rowStep = lastRowIndex >= firstRow ? 1 : -1,
      columnStep = lastColumn >= firstColumn ? 1 : -1

    // A captured range may not silently change shape or become non-contiguous.
    binding.members.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (
          sourceRows.get(cell.rowId) !== firstRow + r * rowStep ||
          sourceColumns.get(cell.columnId) !== firstColumn + c * columnStep
        )
          throw new FormulaSyntaxError(
            'reference',
            'The bound range is no longer rectangular and contiguous.',
          )
      }),
    )

    return `${sheetPrefix}${coord(first, binding.start)}:${coord(last, binding.end)}`
  }

  const emit = (node: FormulaNode): string => {
    switch (node.kind) {
      case 'number':
        return String(node.value)
      case 'string':
        return `"${String(node.value).replaceAll('"', '""')}"`
      case 'boolean':
        return node.value ? 'TRUE' : 'FALSE'
      case 'reference':
        return emitBinding(node.slot)
      case 'unary':
        return `(${node.operator}${emit(node.operand)})`
      case 'percent':
        // The engine has no postfix percent token; `/100` is the same value.
        return `(${emit(node.operand)}/100)`
      case 'binary':
        return `(${emit(node.left)}${node.operator}${emit(node.right)})`
      case 'call':
        return `${node.functionId}(${node.arguments.map(emit).join(',')})`
    }
  }

  return `=${emit(artifact.template)}`
}
