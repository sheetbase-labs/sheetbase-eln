/**
 * Extension points that run something: operations and analysis kinds.
 *
 * The older points (object actions, panels, commands) only describe where a
 * button goes. These two declare work a plugin does for the lab, so their
 * declarations are stricter: every input and output is named and typed, the
 * code is one named Python function in the plugin's package, and anything
 * unknown is rejected, never ignored.
 *
 * - An **operation** is something a plugin can do: named inputs in, named
 *   outputs back. One declaration becomes the assistant tool, the MCP tool, the
 *   API route, the pipeline action and the webhook events (see
 *   `operation-descriptors.ts`).
 * - An **analysis kind** gets dataset rows and returns a result table, with an
 *   optional chart, that the analysis block draws.
 *
 * The code runs in the same isolated, network-less container as pipeline
 * Python steps. A plugin never signs, approves or attests, and never owns
 * canonical data: whatever it returns is a result, and a write goes through a
 * card a person presses (assistant) or a pipeline a person published.
 *
 * Validation here is mirrored in `internal.validate_extension_runner_points`
 * for direct-SQL installs; `tests/db/extension-tool-points.test.ts` keeps the
 * two in step.
 */

import type { ExtensionDataContributions } from './data-points'

export const EXTENSION_RUNNER_POINTS = [
  'operations',
  'analysis-kinds',
  'pipeline-steps',
  'calculators',
  'checks',
  'search-providers',
  'connectors',
  'importers',
  'exporters',
  'previews',
  'sameness-keys',
  'event-hooks',
] as const

/**
 * Every plugin point an administrator can switch off on its own: the two that
 * run work, the five that put a plugin into screens and tables (`hooks.ts`),
 * and panels (a panel with a screen or UI bundle).
 */
export const EXTENSION_SWITCH_POINTS = [
  ...EXTENSION_RUNNER_POINTS,
  'blocks',
  'panels',
  'table-cells',
  'columns',
  'row-actions',
  'field-types',
] as const

export type ExtensionRunnerPoint = (typeof EXTENSION_SWITCH_POINTS)[number]

export function isRunnerPoint(value: string): value is ExtensionRunnerPoint {
  return (EXTENSION_SWITCH_POINTS as readonly string[]).includes(value)
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
  /** What a person sees next to the box. Falls back to the name. */
  label?: string
  /** A unit shown beside a number, such as `µL` or `mg/mL`. */
  unit?: string
}

/** The Python function a declaration runs: `module:function` in the package's `python/` folder. */
export interface ExtensionRunner {
  kind: 'python'
  entry: string
}

export interface ExtensionOperationDeclaration {
  id: string
  title: string
  /** What the model reads to decide when to call it, and what the API lists. */
  description: string
  /** `write` operations only ever run from a card a person presses. */
  access: 'read' | 'write'
  inputs: ExtensionField[]
  outputs: ExtensionField[]
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
  /** The data never leaves the isolated runner. */
  runner: ExtensionRunner
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

export interface ExtensionRunnerContributions extends ExtensionDataContributions {
  operations?: ExtensionOperationDeclaration[]
  'analysis-kinds'?: ExtensionAnalysisKindDeclaration[]
}

export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]{0,48}$/
export const EXTENSION_FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/
export const MAX_EXTENSION_FIELDS = 24
export const MAX_EXTENSION_DECLARATIONS = 25
/** `module:function`, lower case, in the package's python/ folder. */
export const EXTENSION_ENTRY_RE =
  /^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*):([a-z_][a-z0-9_]*)$/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max
  )
}

export function fieldList(
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
    if (entry.label !== undefined && !text(entry.label, 1, 80)) {
      errors.push(
        `${where} ${label} ${entry.name} label must be 1-80 characters`,
      )
      return null
    }
    if (entry.unit !== undefined && !text(entry.unit, 1, 24)) {
      errors.push(
        `${where} ${label} ${entry.name} unit must be 1-24 characters`,
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
      ...(typeof entry.label === 'string' ? { label: entry.label.trim() } : {}),
      ...(typeof entry.unit === 'string' ? { unit: entry.unit.trim() } : {}),
    })
  }
  return out
}

export function runner(
  where: string,
  value: unknown,
  errors: string[],
): ExtensionRunner | null {
  if (!isRecord(value) || value.kind !== 'python') {
    errors.push(`${where} needs a python runner`)
    return null
  }
  if (
    typeof value.entry !== 'string' ||
    !EXTENSION_ENTRY_RE.test(value.entry)
  ) {
    errors.push(
      `${where} runner entry must look like module:function, such as ops:viability`,
    )
    return null
  }
  return { kind: 'python', entry: value.entry }
}

export function head(
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

export function list(
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

export function parseOperations(
  value: unknown,
  errors: string[],
): ExtensionOperationDeclaration[] | null {
  const entries = list('operations', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionOperationDeclaration[] = []
  for (const entry of entries) {
    const name = head('operations', entry, seen, errors, true)
    if (!name) return null
    if (entry.access !== 'read' && entry.access !== 'write') {
      errors.push(`${name} access must be read or write`)
      return null
    }
    const inputs = fieldList(name, 'inputs', entry.inputs, errors)
    const outputs = fieldList(name, 'outputs', entry.outputs, errors)
    const run = runner(name, entry.runner, errors)
    if (!inputs || !outputs || !run) return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      description: (entry.description as string).trim(),
      access: entry.access,
      inputs,
      outputs,
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
    const run = runner(name, entry.runner, errors)
    if (!run) return null
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

/**
 * The name a plugin operation goes by everywhere: the assistant and MCP tool,
 * the pipeline action and the API route all use `plugin.<key>.<id>`.
 */
export function pluginOperationName(
  pluginKey: string,
  operationId: string,
): `plugin.${string}.${string}` {
  return `plugin.${pluginKey}.${operationId}`
}

const PLUGIN_NAME_RE =
  /^plugin\.([a-z][a-z0-9-]{0,48})\.([a-z][a-z0-9-]{0,48})$/

/** Splits `plugin.<key>.<id>`; null for anything else. */
export function parsePluginName(
  name: string,
): { key: string; id: string } | null {
  const match = PLUGIN_NAME_RE.exec(name)
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
