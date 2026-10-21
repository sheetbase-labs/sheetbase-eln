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
  rows: Array<Record<string, unknown>>
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

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
export function requirementErrors(requirements: unknown): string[] {
  if (!Array.isArray(requirements))
    return ['Requirements must be a list of name==version lines.']
  const errors: string[] = []
  if (requirements.length > MAX_PYTHON_REQUIREMENTS)
    errors.push(`At most ${MAX_PYTHON_REQUIREMENTS} packages can be declared.`)
  const seen = new Set<string>()
  for (const entry of requirements) {
    if (typeof entry !== 'string') {
      errors.push('Each requirement must be text.')
      continue
    }
    const parsed = parseRequirement(entry)
    if (!parsed) {
      errors.push(
        `“${entry.slice(0, 80)}” is not pinned. Write it as name==version, for example scipy==1.15.3.`,
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

function columnErrors(columns: unknown, where: string): string[] {
  if (!Array.isArray(columns)) return [`${where} must be a list of columns.`]
  const errors: string[] = []
  if (columns.length > MAX_CONTRACT_COLUMNS)
    errors.push(`${where} has more than ${MAX_CONTRACT_COLUMNS} columns.`)
  const names = new Set<string>()
  for (const column of columns) {
    if (
      !isObject(column) ||
      typeof column.name !== 'string' ||
      !PYTHON_COLUMN_NAME_RE.test(column.name)
    ) {
      errors.push(`${where} has a column without a valid name.`)
      continue
    }
    if (names.has(column.name))
      errors.push(`${where} lists column “${column.name}” twice.`)
    names.add(column.name)
    if (!(PYTHON_COLUMN_TYPES as readonly unknown[]).includes(column.type))
      errors.push(
        `${where} column “${column.name}” needs a type: ${PYTHON_COLUMN_TYPES.join(', ')}.`,
      )
    if (column.nullable !== undefined && typeof column.nullable !== 'boolean')
      errors.push(
        `${where} column “${column.name}” nullable must be true or false.`,
      )
  }
  return errors
}

/** Why a contract cannot be saved; empty when it can. */
export function contractErrors(contract: unknown): string[] {
  if (!isObject(contract)) return ['The contract must be an object.']
  const errors: string[] = []
  if (contract.inputs !== undefined) {
    if (!isObject(contract.inputs))
      errors.push('Contract inputs must map input names to columns.')
    else
      for (const [alias, columns] of Object.entries(contract.inputs)) {
        if (!/^[a-z][a-z0-9_]{0,47}$/.test(alias))
          errors.push(`“${alias}” is not a valid input name.`)
        errors.push(...columnErrors(columns, `Input ${alias}`))
      }
  }
  if (contract.output !== undefined) {
    if (!isObject(contract.output))
      errors.push('Contract output must be an object.')
    else {
      errors.push(...columnErrors(contract.output.columns, 'Output'))
      if (
        contract.output.additionalColumns !== undefined &&
        typeof contract.output.additionalColumns !== 'boolean'
      )
        errors.push('Output additionalColumns must be true or false.')
    }
  }
  for (const key of Object.keys(contract))
    if (key !== 'inputs' && key !== 'output')
      errors.push(`Unknown contract key “${key}”.`)
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
  boolean: 'False',
  date: '"1970-01-01"',
  timestamp: '"1970-01-01T00:00:00Z"',
  json: 'None',
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
const MODULE_DISTRIBUTION: Record<string, string> = {
  sklearn: 'scikit-learn',
  yaml: 'pyyaml',
  PIL: 'pillow',
  cv2: 'opencv-python',
  dateutil: 'python-dateutil',
  bs4: 'beautifulsoup4',
  skimage: 'scikit-image',
  statsmodels: 'statsmodels',
}

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
      message:
        'Define transform(inputs, parameters) and return rows or a DataFrame.',
    })
  } else {
    const match = /^def\s+transform\s*\(([^)]*)\)/.exec(lines[defIndex])
    const parameters = match
      ? match[1].split(',').filter((part) => part.trim()).length
      : 2
    if (match && parameters !== 2)
      diagnostics.push({
        level: 'error',
        message:
          'transform takes exactly two arguments: inputs and parameters.',
        line: defIndex + 1,
      })
  }
  const installed = options.installed
  if (installed) {
    const reported = new Set<string>()
    for (const { module, line } of importedModules(code)) {
      if (STDLIB.has(module) || reported.has(module)) continue
      const dist = normalisePackageName(MODULE_DISTRIBUTION[module] ?? module)
      if (installed[dist] !== undefined) continue
      reported.add(module)
      diagnostics.push({
        level: 'warning',
        message: `“${module}” is not installed in this runtime. Packages cannot be installed while a pipeline runs; ask an administrator to add it to the Python image.`,
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
  return {
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(output ? { output } : {}),
  }
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
  return normaliseContract({
    ...contract,
    output: {
      columns,
      ...(additionalColumns ? { additionalColumns: true } : {}),
    },
  })
}

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/

function columnTypeOf(value: unknown): PythonColumnType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number')
    return Number.isInteger(value) ? 'integer' : 'decimal'
  if (typeof value === 'string') {
    if (DATE_TEXT.test(value)) return 'date'
    if (TIMESTAMP_TEXT.test(value)) return 'timestamp'
    return 'text'
  }
  return 'json'
}

/**
 * The columns a set of result rows has, with the narrowest type that holds every
 * value. Used to turn a test run's result into a contract in one click.
 */
export function inferColumns(
  rows: ReadonlyArray<Record<string, unknown>>,
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
    else if ([...seen].every((t) => t === 'integer' || t === 'decimal'))
      type = 'decimal'
    else if ([...seen].every((t) => t === 'date' || t === 'timestamp'))
      type = 'timestamp'
    else type = [...seen].every((t) => t !== 'json') ? 'text' : 'json'
    return { name, type, ...(nullable.has(name) ? {} : { nullable: false }) }
  })
}
