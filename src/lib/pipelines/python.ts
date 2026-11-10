import { t } from '#/copy'
import { z } from 'zod'
import { pipelineJsonObjectSchema } from './types'
/**
 * Python step contract: what a Python step declares about its environment and
 * its data, as pure functions shared by the authoring UI, the configuration
 * validator and the test-run route.
 *
 * Isolation does not change. Code still runs in the broker's fresh container
 * with no network, so a step cannot install anything. A step *declares* the
 * packages it needs (pinned `name==version`); the runner checks the pinned
 * runtime image provides exactly those versions before the code runs. The
 * contract describes the rows going in and the DataFrame coming out; the
 * worker enforces it inside the container (docker/pipeline-python/worker.py).
 */

export const PYTHON_COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'json',
] as const

export type PythonColumnType = (typeof PYTHON_COLUMN_TYPES)[number]

export interface PythonColumn {
  name: string
  type: PythonColumnType
  /** Whether a missing value (None) is acceptable. Default true. */
  nullable?: boolean
}

/**
 * The rows a Python step receives and returns.
 *
 * `inputs` names the columns each input alias must have (`previous` and
 * `answer` are valid aliases too). `output` is the DataFrame the step must
 * return; undeclared columns are refused unless `additionalColumns` is true,
 * so a result always has the shape the output mapping was written against.
 */
export interface PythonContract {
  inputs?: Record<string, PythonColumn[]>
  output?: {
    columns: PythonColumn[]
    additionalColumns?: boolean
  }
}

/** The interpreter and declared-package versions a step actually ran with. */
export interface PythonEnvironment {
  python: string
  packages: Record<string, string>
}

/** What the test-run route returns for a step that ran. */
export interface PythonTestRunSuccess {
  ok: true
  rows: PythonResultRow[]
  rowCount: number
  truncated: boolean
  /** The result's columns with the types its values have. */
  columns: PythonColumn[]
  logs: string[]
  runtime: string
  environment?: PythonEnvironment
  durationMs: number
}

/** What it returns for a step that failed: the message, its output and the line. */
export interface PythonTestRunFailure {
  ok: false
  error: string
  code: string
  logs: string[]
  line?: number
  durationMs: number
}

export const MAX_PYTHON_REQUIREMENTS = 50
export const MAX_CONTRACT_COLUMNS = 256
export const PYTHON_COLUMN_NAME_RE = /^[^\s\0][^\0]{0,127}$/

/** `name==version`, nothing else: no ranges, extras, URLs or index options. */
export const PYTHON_REQUIREMENT_RE =
  /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)==([A-Za-z0-9](?:[A-Za-z0-9.!+_-]*[A-Za-z0-9])?)$/

const rawObjectSchema = z.record(z.string(), z.unknown())

/** JSON rows returned by the isolated worker, after scientific-value serialization. */
export const pythonResultRowsSchema = z.array(pipelineJsonObjectSchema)

export type PythonResultRow = z.infer<typeof pythonResultRowsSchema>[number]

const rawColumnsSchema = z.array(z.unknown())
const columnNameSchema = z.string().regex(PYTHON_COLUMN_NAME_RE)
const columnTypeSchema = z.enum(PYTHON_COLUMN_TYPES)

/** PEP 503 name normalisation, so `Scikit_Learn` and `scikit-learn` agree. */
export function normalisePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

export function parseRequirement(
  line: string,
): { name: string; version: string } | null {
  const match = PYTHON_REQUIREMENT_RE.exec(line.trim())

  return match
    ? { name: normalisePackageName(match[1]), version: match[2] }
    : null
}

/** Why a list of requirement lines cannot be saved; empty when it can. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public validator is the untrusted authoring/HTTP boundary; schema failures must become the existing user-facing diagnostics.
export function requirementErrors(requirements: unknown): string[] {
  const list = rawColumnsSchema.safeParse(requirements)

  if (!list.success) return [t('data.pipelinePython.requirementsMustListName')]
  const errors: string[] = []

  if (list.data.length > MAX_PYTHON_REQUIREMENTS)
    errors.push(
      t('data.pipelinePython.mostPackagesDeclared', {
        MAX_PYTHON_REQUIREMENTS,
      }),
    )
  const seen = new Set<string>()

  for (const entry of list.data) {
    const text = z.string().safeParse(entry)

    if (!text.success) {
      errors.push(t('data.pipelinePython.eachRequirementMustText'))
      continue
    }

    const parsed = parseRequirement(text.data)

    if (!parsed) {
      errors.push(
        t('data.pipelinePython.pinnedWriteNameVersion', {
          slice: text.data.slice(0, 80),
        }),
      )
      continue
    }

    if (seen.has(parsed.name))
      errors.push(`${parsed.name} is declared more than once.`)
    seen.add(parsed.name)
  }

  return errors
}

/**
 * The declared requirements the runtime does not provide. `installed` maps
 * normalised distribution names to versions, as the runner reports them.
 */
export function unmetRequirements(
  requirements: readonly string[],
  installed: Partial<Record<string, string>>,
): string[] {
  const unmet: string[] = []

  for (const line of requirements) {
    const parsed = parseRequirement(line)

    if (!parsed) continue
    const have = installed[parsed.name]

    if (have === undefined)
      unmet.push(`${parsed.name}==${parsed.version} is not in this runtime.`)
    else if (have !== parsed.version)
      unmet.push(
        `${parsed.name}==${parsed.version} was requested but this runtime has ${have}.`,
      )
  }

  return unmet
}

function columnErrors(
  list: ReturnType<typeof rawColumnsSchema.safeParse>,
  where: string,
): string[] {
  if (!list.success) return [`${where} must be a list of columns.`]
  const errors: string[] = []

  if (list.data.length > MAX_CONTRACT_COLUMNS)
    errors.push(`${where} has more than ${MAX_CONTRACT_COLUMNS} columns.`)
  const names = new Set<string>()

  for (const entry of list.data) {
    const parsed = rawObjectSchema.safeParse(entry)

    const name = columnNameSchema.safeParse(
      parsed.success ? parsed.data.name : undefined,
    )

    if (!parsed.success || !name.success) {
      errors.push(`${where} has a column without a valid name.`)
      continue
    }

    const column = parsed.data

    if (names.has(name.data))
      errors.push(`${where} lists column “${name.data}” twice.`)
    names.add(name.data)

    if (!columnTypeSchema.safeParse(column.type).success)
      errors.push(
        `${where} column “${name.data}” needs a type: ${PYTHON_COLUMN_TYPES.join(', ')}.`,
      )

    if (!z.boolean().optional().safeParse(column.nullable).success)
      errors.push(
        `${where} column “${name.data}” nullable must be true or false.`,
      )
  }

  return errors
}

/** Why a contract cannot be saved; empty when it can. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public validator decodes untrusted saved/HTTP contracts and returns all existing diagnostics instead of throwing.
export function contractErrors(input: unknown): string[] {
  const parsed = rawObjectSchema.safeParse(input)

  if (!parsed.success) return [t('data.pipelinePython.contractMustObject')]
  const contract = parsed.data
  const errors: string[] = []

  if (contract.inputs !== undefined) {
    const inputs = rawObjectSchema.safeParse(contract.inputs)

    if (!inputs.success)
      errors.push(t('data.pipelinePython.contractInputsMustMap'))
    else
      for (const [alias, columns] of Object.entries(inputs.data)) {
        if (!/^[a-z][a-z0-9_]{0,47}$/.test(alias))
          errors.push(t('data.pipelinePython.validInputName', { alias }))
        errors.push(
          ...columnErrors(
            rawColumnsSchema.safeParse(columns),
            t('data.pipelinePython.input', { alias }),
          ),
        )
      }
  }

  if (contract.output !== undefined) {
    const output = rawObjectSchema.safeParse(contract.output)

    if (!output.success)
      errors.push(t('data.pipelinePython.contractOutputMustObject'))
    else {
      errors.push(
        ...columnErrors(
          rawColumnsSchema.safeParse(output.data.columns),
          'Output',
        ),
      )

      if (
        !z.boolean().optional().safeParse(output.data.additionalColumns).success
      )
        errors.push(t('data.pipelinePython.outputAdditionalcolumnsMustTrue'))
    }
  }

  for (const key of Object.keys(contract))
    if (key !== 'inputs' && key !== 'output')
      errors.push(t('data.pipelinePython.unknownContractKey', { key }))

  return errors
}

// ---------------------------------------------------------------------------
// Starting code
// ---------------------------------------------------------------------------

export interface SkeletonOptions {
  inputs: Array<{ name: string }>
  parameters: Array<{ name: string; type: string }>
  /** Whether an earlier step's result arrives as `previous`. */
  hasPrevious?: boolean
  contract?: PythonContract
}

const PY_DEFAULTS: Record<PythonColumnType, string> = {
  text: '""',
  integer: '0',
  decimal: '0.0',
  boolean: t('data.pipelinePython.false'),
  date: '"1970-01-01"',
  timestamp: '"1970-01-01T00:00:00Z"',
  json: t('common.states.none'),
}

/**
 * A starting point written from what the pipeline already declares: one
 * DataFrame per input, a note for each parameter, and a result with the
 * contract's columns. It is only a head start; the person edits it freely.
 */
export function pythonSkeleton(options: SkeletonOptions): string {
  const lines = [
    'import pandas as pd',
    '',
    '',
    'def transform(inputs, parameters):',
  ]

  const aliases = [
    ...options.inputs.map((input) => input.name).filter(Boolean),
    ...(options.hasPrevious ? ['previous'] : []),
  ]

  for (const alias of aliases) {
    const columns = options.contract?.inputs?.[alias]
    lines.push(`    ${alias} = pd.DataFrame(inputs["${alias}"])`)

    if (columns?.length)
      lines.push(
        `    # ${alias} columns: ${columns.map((c) => `${c.name} (${c.type})`).join(', ')}`,
      )
  }

  for (const parameter of options.parameters)
    lines.push(
      `    ${parameter.name} = parameters["${parameter.name}"]  # ${parameter.type}`,
    )

  if (aliases.length || options.parameters.length) lines.push('')
  const output = options.contract?.output?.columns

  if (output?.length) {
    lines.push('    return pd.DataFrame({')

    for (const column of output)
      lines.push(
        `        ${JSON.stringify(column.name)}: [${PY_DEFAULTS[column.type]}],`,
      )
    lines.push('    })')
  } else {
    lines.push(
      aliases.length
        ? `    return ${aliases[0]}`
        : '    return pd.DataFrame({"value": [1]})',
    )
  }

  return `${lines.join('\n')}\n`
}

/** The code a new SQL step starts with, and so a language switch can tell it is untouched. */
export const DEFAULT_SQL_STATEMENT = 'select * from previous'

/** True when a statement is a starter (empty, the SQL default or a skeleton). */
export function isStarterStatement(statement: string): boolean {
  const trimmed = statement.trim()

  return (
    trimmed === '' ||
    trimmed === DEFAULT_SQL_STATEMENT ||
    /^import pandas as pd\s+def transform\(inputs, parameters\):/.test(trimmed)
  )
}

// ---------------------------------------------------------------------------
// Static feedback while typing
// ---------------------------------------------------------------------------

export interface PythonDiagnostic {
  level: 'error' | 'warning'
  message: string
  line?: number
}

/** Python 3.12 standard-library top-level modules; imports of these need no package. */
const STDLIB = new Set(
  (
    '__future__ abc argparse array ast asyncio base64 bisect builtins calendar cmath collections ' +
    'colorsys concurrent contextlib copy csv dataclasses datetime decimal difflib enum errno ' +
    'fnmatch fractions functools gc glob gzip hashlib heapq hmac html http io itertools json ' +
    'keyword linecache locale logging lzma math numbers operator os pathlib pickle platform ' +
    'pprint queue random re reprlib secrets shlex shutil signal statistics string struct sys ' +
    'tempfile textwrap threading time timeit traceback types typing unicodedata unittest uuid ' +
    'warnings weakref zipfile zlib zoneinfo'
  ).split(' '),
)

/** Import names that differ from their distribution name. */
const MODULE_DISTRIBUTION = new Map([
  ['sklearn', 'scikit-learn'],
  ['yaml', 'pyyaml'],
  ['PIL', 'pillow'],
  ['cv2', 'opencv-python'],
  ['dateutil', 'python-dateutil'],
  ['bs4', 'beautifulsoup4'],
  ['skimage', 'scikit-image'],
  ['statsmodels', 'statsmodels'],
])

/** Top-level module names a program imports (approximate, line-based). */
export function importedModules(
  code: string,
): Array<{ module: string; line: number }> {
  const found: Array<{ module: string; line: number }> = []
  code.split('\n').forEach((text, index) => {
    const from = /^\s*from\s+([A-Za-z_]\w*)/.exec(text)

    if (from) return void found.push({ module: from[1], line: index + 1 })
    const plain = /^\s*import\s+(.+)$/.exec(text)

    if (!plain) return

    for (const part of plain[1].split(',')) {
      const name = /^\s*([A-Za-z_]\w*)/.exec(part)

      if (name) found.push({ module: name[1], line: index + 1 })
    }
  })

  return found
}

export function analysePython(
  code: string,
  options: { installed?: Partial<Record<string, string>> } = {},
): PythonDiagnostic[] {
  const diagnostics: PythonDiagnostic[] = []
  const lines = code.split('\n')
  const defIndex = lines.findIndex((line) => /^def\s+transform\s*\(/.test(line))

  if (defIndex < 0) {
    diagnostics.push({
      level: 'error',
      message: t('data.pipelinePython.defineTransformInputsParameters'),
    })
  } else {
    const match = /^def\s+transform\s*\(([^)]*)\)/.exec(lines[defIndex])

    const parameters = match
      ? match[1].split(',').filter((part) => part.trim()).length
      : 2

    if (match && parameters !== 2)
      diagnostics.push({
        level: 'error',
        message: t('data.pipelinePython.transformTakesExactlyTwo'),
        line: defIndex + 1,
      })
  }

  const installed = options.installed

  if (installed) {
    const reported = new Set<string>()

    for (const { module, line } of importedModules(code)) {
      if (STDLIB.has(module) || reported.has(module)) continue

      const dist = normalisePackageName(
        MODULE_DISTRIBUTION.get(module) ?? module,
      )

      if (installed[dist] !== undefined) continue
      reported.add(module)
      diagnostics.push({
        level: 'warning',
        message: t('data.pipelinePython.installedRuntimePackagesCannot', {
          module,
        }),
        line,
      })
    }
  }

  return diagnostics
}

/** Parse the contents of a requirements textarea, ignoring blanks and comments. */
export function parseRequirementsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Editing a contract
// ---------------------------------------------------------------------------

/** A contract with nothing left in it is no contract: drop empty parts, or all of it. */
export function normaliseContract(
  contract: PythonContract | undefined,
): PythonContract | undefined {
  if (!contract) return undefined

  const inputs = Object.fromEntries(
    Object.entries(contract.inputs ?? {}).filter(
      ([, columns]) => columns.length > 0,
    ),
  )

  const output = contract.output?.columns.length ? contract.output : undefined

  if (!Object.keys(inputs).length && !output) return undefined

  const normalised: PythonContract = {}

  if (Object.keys(inputs).length) normalised.inputs = inputs

  if (output) normalised.output = output

  return normalised
}

export function setContractInput(
  contract: PythonContract | undefined,
  alias: string,
  columns: PythonColumn[],
): PythonContract | undefined {
  return normaliseContract({
    ...contract,
    inputs: { ...contract?.inputs, [alias]: columns },
  })
}

export function setContractOutput(
  contract: PythonContract | undefined,
  columns: PythonColumn[],
  additionalColumns?: boolean,
): PythonContract | undefined {
  const output: NonNullable<PythonContract['output']> = { columns }

  if (additionalColumns) output.additionalColumns = true

  return normaliseContract({
    ...contract,
    output,
  })
}

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/

function columnTypeOf(value: PythonResultRow[string]): PythonColumnType {
  if (z.boolean().safeParse(value).success) return 'boolean'

  const number = z.number().safeParse(value)

  if (number.success)
    return Number.isInteger(number.data) ? 'integer' : 'decimal'

  const text = z.string().safeParse(value)

  if (text.success) {
    if (DATE_TEXT.test(text.data)) return 'date'

    if (TIMESTAMP_TEXT.test(text.data)) return 'timestamp'

    return 'text'
  }

  return 'json'
}

/**
 * The columns a set of result rows has, with the narrowest type that holds every
 * value. Used to turn a test run's result into a contract in one click.
 */
export function inferColumns(
  rows: readonly Partial<PythonResultRow>[],
): PythonColumn[] {
  const order: string[] = []
  const types = new Map<string, Set<PythonColumnType>>()
  const nullable = new Set<string>()

  for (const row of rows)
    for (const [name, value] of Object.entries(row)) {
      if (!types.has(name)) {
        types.set(name, new Set())
        order.push(name)
      }

      if (value === null || value === undefined) nullable.add(name)
      else types.get(name)?.add(columnTypeOf(value))
    }

  return order.map((name) => {
    const seen = types.get(name) ?? new Set<PythonColumnType>()
    let type: PythonColumnType

    if (seen.size === 0) type = 'text'
    else if (seen.size === 1) type = [...seen][0]
    else if ([...seen].every((ty) => ty === 'integer' || ty === 'decimal'))
      type = 'decimal'
    else if ([...seen].every((ty) => ty === 'date' || ty === 'timestamp'))
      type = 'timestamp'
    else type = [...seen].every((ty) => ty !== 'json') ? 'text' : 'json'

    const column: PythonColumn = { name, type }

    if (!nullable.has(name)) column.nullable = false

    return column
  })
}
