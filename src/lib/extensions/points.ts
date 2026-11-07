/**
 * Extension points that run something: pipeline actions, assistant tools and
 * analysis kinds.
 *
 * The older points (object actions, panels, commands) only describe where a
 * button goes. These three declare work an administrator-installed extension
 * does for the lab, so their declarations are stricter: every input and
 * output is named and typed, the runner is one of two fixed kinds, and
 * anything unknown is rejected, never ignored.
 *
 * - A **webhook** runner is called with a signed JSON request (the same
 *   signing the parser webhooks use) and answers `{ "output": ... }`.
 * - A **python** runner is a function `run(input)` that Sheetbase runs in the
 *   same isolated, network-less container as pipeline Python steps.
 *
 * An extension never signs, approves or attests, and never owns canonical
 * data: whatever it returns is a result, and a write goes through a card a
 * person presses (assistant) or a pipeline a person published.
 *
 * Validation here is mirrored in `internal.validate_extension_manifest` for
 * direct-SQL installs; `tests/db/extension-tool-points.test.ts` keeps the two
 * in step.
 */

export const EXTENSION_RUNNER_POINTS = [
  'pipeline-actions',
  'assistant-tools',
  'analysis-kinds',
] as const

export type ExtensionRunnerPoint = (typeof EXTENSION_RUNNER_POINTS)[number]

export function isRunnerPoint(value: string): value is ExtensionRunnerPoint {
  return (EXTENSION_RUNNER_POINTS as readonly string[]).includes(value)
}

export const EXTENSION_FIELD_TYPES = [
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'json',
] as const
export type ExtensionFieldType = (typeof EXTENSION_FIELD_TYPES)[number]

/** A named, typed value an extension reads or returns. */
export interface ExtensionField {
  name: string
  type: ExtensionFieldType
  required: boolean
  description?: string
}

export type ExtensionRunner =
  { kind: 'webhook'; url: string } | { kind: 'python'; code: string }

export interface ExtensionPipelineActionDeclaration {
  id: string
  title: string
  description?: string
  inputs: ExtensionField[]
  outputs: ExtensionField[]
  runner: ExtensionRunner
}

export interface ExtensionAssistantToolDeclaration {
  id: string
  title: string
  /** What the model reads to decide when to call the tool. */
  description: string
  /** `write` tools only ever run from a card a person presses. */
  access: 'read' | 'write'
  inputs: ExtensionField[]
  runner: ExtensionRunner
}

export const EXTENSION_CHART_TYPES = ['line', 'scatter', 'bar'] as const
export type ExtensionChartType = (typeof EXTENSION_CHART_TYPES)[number]

export interface ExtensionAnalysisColumn {
  name: string
  type: 'number' | 'text'
}

export interface ExtensionAnalysisKindDeclaration {
  id: string
  title: string
  description?: string
  /** Dataset columns the person binds: numbers or categories. */
  inputs: Array<{
    name: string
    label: string
    type: 'number' | 'category'
    required: boolean
  }>
  /** Only Python: the data never leaves the isolated runner. */
  runner: { kind: 'python'; code: string }
  result: {
    columns: ExtensionAnalysisColumn[]
    chart?: {
      type: ExtensionChartType
      x: string
      y: string
      group?: string
    }
  }
}

export interface ExtensionRunnerContributions {
  'pipeline-actions'?: ExtensionPipelineActionDeclaration[]
  'assistant-tools'?: ExtensionAssistantToolDeclaration[]
  'analysis-kinds'?: ExtensionAnalysisKindDeclaration[]
}

export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]{0,48}$/
export const EXTENSION_FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/
export const MAX_EXTENSION_FIELDS = 24
export const MAX_EXTENSION_DECLARATIONS = 25
export const MAX_EXTENSION_CODE = 20_000
export const MAX_EXTENSION_URL = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max
  )
}

function fieldList(
  where: string,
  label: string,
  value: unknown,
  errors: string[],
): ExtensionField[] | null {
  if (!Array.isArray(value) || value.length > MAX_EXTENSION_FIELDS) {
    errors.push(
      `${where} ${label} must be a list of at most ${MAX_EXTENSION_FIELDS}`,
    )
    return null
  }
  const seen = new Set<string>()
  const out: ExtensionField[] = []
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !EXTENSION_FIELD_NAME_RE.test(entry.name)
    ) {
      errors.push(`${where} ${label} names must match ^[a-z][a-z0-9_]{0,47}$`)
      return null
    }
    if (
      typeof entry.type !== 'string' ||
      !(EXTENSION_FIELD_TYPES as readonly string[]).includes(entry.type)
    ) {
      errors.push(
        `${where} ${label} ${entry.name} has an unknown type (use ${EXTENSION_FIELD_TYPES.join(', ')})`,
      )
      return null
    }
    if (typeof entry.required !== 'boolean') {
      errors.push(
        `${where} ${label} ${entry.name} must say whether it is required`,
      )
      return null
    }
    if (entry.description !== undefined && !text(entry.description, 1, 300)) {
      errors.push(
        `${where} ${label} ${entry.name} description must be 1-300 characters`,
      )
      return null
    }
    if (seen.has(entry.name)) {
      errors.push(`${where} ${label} repeats ${entry.name}`)
      return null
    }
    seen.add(entry.name)
    out.push({
      name: entry.name,
      type: entry.type as ExtensionFieldType,
      required: entry.required,
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
    })
  }
  return out
}

function runner(
  where: string,
  value: unknown,
  errors: string[],
  pythonOnly: boolean,
): ExtensionRunner | null {
  if (!isRecord(value)) {
    errors.push(`${where} needs a runner`)
    return null
  }
  if (value.kind === 'webhook' && !pythonOnly) {
    const url = value.url
    if (
      typeof url !== 'string' ||
      url.length > MAX_EXTENSION_URL ||
      !/^https:\/\/[^\s/@]+(?:\/[^\s]*)?$/.test(url)
    ) {
      errors.push(
        `${where} webhook runner needs an https: address of at most ${MAX_EXTENSION_URL} characters`,
      )
      return null
    }
    return { kind: 'webhook', url }
  }
  if (value.kind === 'python') {
    if (
      typeof value.code !== 'string' ||
      value.code.trim().length < 1 ||
      value.code.length > MAX_EXTENSION_CODE
    ) {
      errors.push(
        `${where} python runner needs code of 1-${MAX_EXTENSION_CODE} characters`,
      )
      return null
    }
    return { kind: 'python', code: value.code }
  }
  errors.push(
    `${where} runner kind must be ${pythonOnly ? 'python' : 'webhook or python'}`,
  )
  return null
}

function head(
  point: ExtensionRunnerPoint,
  entry: Record<string, unknown>,
  seen: Set<string>,
  errors: string[],
  descriptionRequired: boolean,
): string | null {
  const where = `contributions.${point}`
  if (typeof entry.id !== 'string' || !EXTENSION_ID_RE.test(entry.id)) {
    errors.push(`${where} entry ids must match ^[a-z][a-z0-9-]{0,48}$`)
    return null
  }
  if (seen.has(entry.id)) {
    errors.push(`${where} has a duplicate id: ${entry.id}`)
    return null
  }
  seen.add(entry.id)
  const name = `${where}.${entry.id}`
  if (!text(entry.title, 1, 120)) {
    errors.push(`${name} title must be 1-120 characters`)
    return null
  }
  if (
    descriptionRequired
      ? !text(entry.description, 1, 600)
      : entry.description !== undefined && !text(entry.description, 1, 600)
  ) {
    errors.push(`${name} description must be 1-600 characters`)
    return null
  }
  return name
}

function list(
  point: ExtensionRunnerPoint,
  value: unknown,
  errors: string[],
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length > MAX_EXTENSION_DECLARATIONS) {
    errors.push(
      `contributions.${point} must be a list of at most ${MAX_EXTENSION_DECLARATIONS}`,
    )
    return null
  }
  const out: Array<Record<string, unknown>> = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      errors.push(`contributions.${point} entries must be objects`)
      return null
    }
    out.push(entry)
  }
  return out
}

export function parsePipelineActions(
  value: unknown,
  errors: string[],
): ExtensionPipelineActionDeclaration[] | null {
  const entries = list('pipeline-actions', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionPipelineActionDeclaration[] = []
  for (const entry of entries) {
    const name = head('pipeline-actions', entry, seen, errors, false)
    if (!name) return null
    const inputs = fieldList(name, 'inputs', entry.inputs, errors)
    const outputs = fieldList(name, 'outputs', entry.outputs, errors)
    const run = runner(name, entry.runner, errors, false)
    if (!inputs || !outputs || !run) return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      inputs,
      outputs,
      runner: run,
    })
  }
  return out
}

export function parseAssistantTools(
  value: unknown,
  errors: string[],
): ExtensionAssistantToolDeclaration[] | null {
  const entries = list('assistant-tools', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionAssistantToolDeclaration[] = []
  for (const entry of entries) {
    const name = head('assistant-tools', entry, seen, errors, true)
    if (!name) return null
    if (entry.access !== 'read' && entry.access !== 'write') {
      errors.push(`${name} access must be read or write`)
      return null
    }
    const inputs = fieldList(name, 'inputs', entry.inputs, errors)
    const run = runner(name, entry.runner, errors, false)
    if (!inputs || !run) return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      description: (entry.description as string).trim(),
      access: entry.access,
      inputs,
      runner: run,
    })
  }
  return out
}

export function parseAnalysisKinds(
  value: unknown,
  errors: string[],
): ExtensionAnalysisKindDeclaration[] | null {
  const entries = list('analysis-kinds', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionAnalysisKindDeclaration[] = []
  for (const entry of entries) {
    const name = head('analysis-kinds', entry, seen, errors, false)
    if (!name) return null
    if (
      !Array.isArray(entry.inputs) ||
      entry.inputs.length < 1 ||
      entry.inputs.length > MAX_EXTENSION_FIELDS
    ) {
      errors.push(`${name} needs 1-${MAX_EXTENSION_FIELDS} inputs`)
      return null
    }
    const inputs: ExtensionAnalysisKindDeclaration['inputs'] = []
    const inputNames = new Set<string>()
    for (const input of entry.inputs as unknown[]) {
      if (
        !isRecord(input) ||
        typeof input.name !== 'string' ||
        !EXTENSION_FIELD_NAME_RE.test(input.name) ||
        inputNames.has(input.name) ||
        !text(input.label, 1, 80) ||
        (input.type !== 'number' && input.type !== 'category') ||
        typeof input.required !== 'boolean'
      ) {
        errors.push(
          `${name} inputs need a unique name, a label, a type of number or category, and required`,
        )
        return null
      }
      inputNames.add(input.name)
      inputs.push({
        name: input.name,
        label: input.label.trim(),
        type: input.type,
        required: input.required,
      })
    }
    const run = runner(name, entry.runner, errors, true)
    if (!run || run.kind !== 'python') return null
    const result = entry.result
    if (
      !isRecord(result) ||
      !Array.isArray(result.columns) ||
      result.columns.length < 1 ||
      result.columns.length > MAX_EXTENSION_FIELDS
    ) {
      errors.push(`${name} result needs 1-${MAX_EXTENSION_FIELDS} columns`)
      return null
    }
    const columns: ExtensionAnalysisColumn[] = []
    const columnNames = new Set<string>()
    for (const column of result.columns as unknown[]) {
      if (
        !isRecord(column) ||
        typeof column.name !== 'string' ||
        !EXTENSION_FIELD_NAME_RE.test(column.name) ||
        columnNames.has(column.name) ||
        (column.type !== 'number' && column.type !== 'text')
      ) {
        errors.push(
          `${name} result columns need a unique name and a type of number or text`,
        )
        return null
      }
      columnNames.add(column.name)
      columns.push({ name: column.name, type: column.type })
    }
    let chart: ExtensionAnalysisKindDeclaration['result']['chart']
    if (result.chart !== undefined) {
      const c = result.chart
      const numeric = new Set(
        columns.filter((column) => column.type === 'number').map((x) => x.name),
      )
      if (
        !isRecord(c) ||
        typeof c.type !== 'string' ||
        !(EXTENSION_CHART_TYPES as readonly string[]).includes(c.type) ||
        typeof c.x !== 'string' ||
        !columnNames.has(c.x) ||
        typeof c.y !== 'string' ||
        !numeric.has(c.y) ||
        (c.group !== undefined &&
          (typeof c.group !== 'string' || !columnNames.has(c.group)))
      ) {
        errors.push(
          `${name} chart needs a type (line, scatter or bar), an x column, a numeric y column and an optional group column, all from the result columns`,
        )
        return null
      }
      chart = {
        type: c.type as ExtensionChartType,
        x: c.x,
        y: c.y,
        ...(typeof c.group === 'string' ? { group: c.group } : {}),
      }
    }
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      inputs,
      runner: run,
      result: { columns, ...(chart ? { chart } : {}) },
    })
  }
  return out
}

/** The wire name a model or MCP client sees for an extension tool. */
export function extensionToolName(
  extensionKey: string,
  toolId: string,
): `extension.${string}.${string}` {
  return `extension.${extensionKey}.${toolId}`
}

/** The action name a pipeline step uses for an extension action. */
export function extensionOperationName(
  extensionKey: string,
  actionId: string,
): string {
  return `extension.${extensionKey}.${actionId}`
}

const EXTENSION_NAME_RE =
  /^extension\.([a-z][a-z0-9-]{0,48})\.([a-z][a-z0-9-]{0,48})$/

/** Splits `extension.<key>.<id>`; null for anything else. */
export function parseExtensionName(
  name: string,
): { key: string; id: string } | null {
  const match = EXTENSION_NAME_RE.exec(name)
  return match ? { key: match[1], id: match[2] } : null
}

const JSON_SCHEMA_TYPE: Record<ExtensionFieldType, Record<string, unknown>> = {
  text: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  json: {},
}

/** The JSON schema a model or MCP client sees for a tool's declared inputs. */
export function fieldsJsonSchema(
  fields: readonly ExtensionField[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [
        field.name,
        {
          ...JSON_SCHEMA_TYPE[field.type],
          ...(field.description ? { description: field.description } : {}),
        },
      ]),
    ),
    required: fields.filter((field) => field.required).map((f) => f.name),
    additionalProperties: false,
  }
}
