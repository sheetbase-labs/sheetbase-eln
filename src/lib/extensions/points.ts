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

import { z } from 'zod'

import type { ExtensionDataContributions } from './data-points'

export const EXTENSION_RUNNER_POINTS = [
  'operations',
  'analysis-kinds',
  'pipeline-steps',
  'calculators',
  'checks',
  'search-providers',
  'connectors',
  'publishers',
  'notification-channels',
  'importers',
  'exporters',
  'previews',
  'sameness-keys',
  'event-hooks',
  'record-hooks',
  'instrument-parsers',
  'label-formats',
  'barcode-formats',
  'storage-rules',
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
  // Whole screens a plugin draws itself (`ui-points.ts` holds the shapes).
  'pages',
  'settings-pages',
  'dashboard-widgets',
  'report-sections',
] as const

export type ExtensionRunnerPoint = (typeof EXTENSION_SWITCH_POINTS)[number]

export function isRunnerPoint(value: string): value is ExtensionRunnerPoint {
  return z.enum(EXTENSION_SWITCH_POINTS).safeParse(value).success
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

/**
 * Sanity bounds on a declaration, not on what a plugin may do: far above what
 * a real plugin declares, so a malformed file can't ask for a million of them.
 */
export const MAX_EXTENSION_FIELDS = 500
export const MAX_EXTENSION_DECLARATIONS = 1000

/** `module:function`, lower case, in the package's python/ folder. */
export const EXTENSION_ENTRY_RE =
  /^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*):([a-z_][a-z0-9_]*)$/

const declarationIdentity = z.object({
  id: z.string().regex(EXTENSION_ID_RE),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600).optional(),
})

const operationField = z.object({
  name: z.string().regex(EXTENSION_FIELD_NAME_RE),
  type: z.enum(EXTENSION_FIELD_TYPES),
  required: z.boolean(),
  description: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
})

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This guard only admits raw declaration objects, not typed domain values. Each owner parser checks their fields before constructing a declaration; malformed objects are covered by manifest.test.ts.
export function isRecord(value: unknown): value is Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This is the raw object boundary: null and arrays must be rejected before enumerating unknown declaration fields. It makes no claim about the values of those fields.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(
  // Declaration text is untrusted; the string schema verifies both representation and trimmed bounds before this predicate succeeds.
  value: unknown,
  min: number,
  max: number,
): value is string {
  return z
    .string()
    .refine((entry) => entry.trim().length >= min && entry.trim().length <= max)
    .safeParse(value).success
}

export function fieldList(
  where: string,
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plugin operation fields enter here; the bounded array and operationField schemas reject malformed fields before returning typed declarations.
  value: unknown,
  errors: string[],
): ExtensionField[] | null {
  const parsedList = z
    .array(z.unknown())
    .max(MAX_EXTENSION_FIELDS)
    .safeParse(value)

  if (!parsedList.success) {
    errors.push(
      `${where} ${label} must be a list of at most ${MAX_EXTENSION_FIELDS}`,
    )

    return null
  }

  const seen = new Set<string>()
  const out: ExtensionField[] = []

  for (const entry of parsedList.data) {
    const named = operationField.pick({ name: true }).safeParse(entry)

    if (!named.success) {
      errors.push(`${where} ${label} names must match ^[a-z][a-z0-9_]{0,47}$`)

      return null
    }

    const parsed = operationField.safeParse(entry)

    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      const prefix = `${where} ${label} ${named.data.name}`

      const problem =
        field === 'required'
          ? 'must say whether it is required'
          : field === 'description'
            ? 'description must be 1-300 characters'
            : field === 'label'
              ? 'label must be 1-80 characters'
              : field === 'unit'
                ? 'unit must be 1-24 characters'
                : `has an unknown type (use ${EXTENSION_FIELD_TYPES.join(', ')})`

      errors.push(`${prefix} ${problem}`)

      return null
    }

    const field = parsed.data

    if (seen.has(field.name)) {
      errors.push(`${where} ${label} repeats ${field.name}`)

      return null
    }

    seen.add(field.name)

    const declaration: ExtensionField = {
      name: field.name,
      type: field.type,
      required: field.required,
    }

    if (field.description !== undefined)
      declaration.description = field.description

    if (field.label !== undefined) declaration.label = field.label

    if (field.unit !== undefined) declaration.unit = field.unit
    out.push(declaration)
  }

  return out
}

export function runner(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Python runner declarations cross the manifest boundary here; kind and entry schemas reject malformed values before constructing a runner.
  value: unknown,
  errors: string[],
): ExtensionRunner | null {
  const kind = z.object({ kind: z.literal('python') }).safeParse(value)

  if (!kind.success) {
    errors.push(`${where} needs a python runner`)

    return null
  }

  const parsed = z
    .object({
      kind: z.literal('python'),
      entry: z.string().regex(EXTENSION_ENTRY_RE),
    })
    .safeParse(value)

  if (!parsed.success) {
    errors.push(
      `${where} runner entry must look like module:function, such as ops:viability`,
    )

    return null
  }

  return parsed.data
}

export function head(
  point: ExtensionRunnerPoint,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parses the shared manifest identity; id is checked before duplicate/title/description errors to retain the author-facing contract.
  entry: unknown,
  seen: Set<string>,
  errors: string[],
  descriptionRequired: boolean,
) {
  const where = `contributions.${point}`
  const id = declarationIdentity.pick({ id: true }).safeParse(entry)

  if (!id.success) {
    errors.push(`${where} entry ids must match ^[a-z][a-z0-9-]{0,48}$`)

    return null
  }

  if (seen.has(id.data.id)) {
    errors.push(`${where} has a duplicate id: ${id.data.id}`)

    return null
  }

  seen.add(id.data.id)
  const name = `${where}.${id.data.id}`
  const parsed = declarationIdentity.safeParse(entry)

  if (!parsed.success) {
    errors.push(
      parsed.error.issues[0]?.path[0] === 'title'
        ? `${name} title must be 1-120 characters`
        : `${name} description must be 1-600 characters`,
    )

    return null
  }

  if (descriptionRequired && parsed.data.description === undefined) {
    errors.push(`${name} description must be 1-600 characters`)

    return null
  }

  return { name, identity: parsed.data }
}

export function list(
  point: ExtensionRunnerPoint,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The contribution-list boundary first parses a bounded array, then admits only raw objects; each point parser constructs its typed declarations from those objects.
  value: unknown,
  errors: string[],
) {
  const parsed = z
    .array(z.unknown())
    .max(MAX_EXTENSION_DECLARATIONS)
    .safeParse(value)

  if (!parsed.success) {
    errors.push(
      `contributions.${point} must be a list of at most ${MAX_EXTENSION_DECLARATIONS}`,
    )

    return null
  }

  if (!parsed.data.every(isRecord)) {
    errors.push(`contributions.${point} entries must be objects`)

    return null
  }

  return parsed.data
}

export function parseOperations(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public manifest boundary delegates immediately to the bounded list parser, then parses identity, fields and runner before returning an operation (manifest.test.ts).
  value: unknown,
  errors: string[],
): ExtensionOperationDeclaration[] | null {
  const entries = list('operations', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionOperationDeclaration[] = []

  for (const entry of entries) {
    const metadata = head('operations', entry, seen, errors, true)

    if (!metadata) return null
    const { name, identity } = metadata

    if (entry.access !== 'read' && entry.access !== 'write') {
      errors.push(`${name} access must be read or write`)

      return null
    }

    const inputs = fieldList(name, 'inputs', entry.inputs, errors)
    const outputs = fieldList(name, 'outputs', entry.outputs, errors)
    const run = runner(name, entry.runner, errors)

    if (!inputs || !outputs || !run) return null
    out.push({
      id: identity.id,
      title: identity.title,
      description: identity.description ?? '',
      access: entry.access,
      inputs,
      outputs,
      runner: run,
    })
  }

  return out
}

export function parseAnalysisKinds(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public manifest boundary parses the raw list, identity, named input/result columns and chart references before returning an analysis kind (manifest.test.ts).
  value: unknown,
  errors: string[],
): ExtensionAnalysisKindDeclaration[] | null {
  const entries = list('analysis-kinds', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionAnalysisKindDeclaration[] = []

  for (const entry of entries) {
    const metadata = head('analysis-kinds', entry, seen, errors, false)

    if (!metadata) return null
    const { name, identity } = metadata

    const inputList = z
      .array(z.unknown())
      .min(1)
      .max(MAX_EXTENSION_FIELDS)
      .safeParse(entry.inputs)

    if (!inputList.success) {
      errors.push(`${name} needs 1-${MAX_EXTENSION_FIELDS} inputs`)

      return null
    }

    const inputs: ExtensionAnalysisKindDeclaration['inputs'] = []
    const inputNames = new Set<string>()

    for (const raw of inputList.data) {
      const input = z
        .object({
          name: z.string().regex(EXTENSION_FIELD_NAME_RE),
          label: z.string().trim().min(1).max(80),
          type: z.enum(['number', 'category']),
          required: z.boolean(),
        })
        .safeParse(raw)

      if (!input.success || inputNames.has(input.data.name)) {
        errors.push(
          `${name} inputs need a unique name, a label, a type of number or category, and required`,
        )

        return null
      }

      inputNames.add(input.data.name)
      inputs.push(input.data)
    }

    const run = runner(name, entry.runner, errors)

    if (!run) return null

    const result = z
      .object({
        columns: z.array(z.unknown()).min(1).max(MAX_EXTENSION_FIELDS),
        chart: z.unknown().optional(),
      })
      .safeParse(entry.result)

    if (!result.success) {
      errors.push(`${name} result needs 1-${MAX_EXTENSION_FIELDS} columns`)

      return null
    }

    const columns: ExtensionAnalysisColumn[] = []
    const columnNames = new Set<string>()

    for (const raw of result.data.columns) {
      const column = z
        .object({
          name: z.string().regex(EXTENSION_FIELD_NAME_RE),
          type: z.enum(['number', 'text']),
        })
        .safeParse(raw)

      if (!column.success || columnNames.has(column.data.name)) {
        errors.push(
          `${name} result columns need a unique name and a type of number or text`,
        )

        return null
      }

      columnNames.add(column.data.name)
      columns.push(column.data)
    }

    let chart: ExtensionAnalysisKindDeclaration['result']['chart']

    if (result.data.chart !== undefined) {
      const numeric = new Set(
        columns.flatMap((column) =>
          column.type === 'number' ? [column.name] : [],
        ),
      )

      const parsed = z
        .object({
          type: z.enum(EXTENSION_CHART_TYPES),
          x: z.string().refine((column) => columnNames.has(column)),
          y: z.string().refine((column) => numeric.has(column)),
          group: z
            .string()
            .refine((column) => columnNames.has(column))
            .optional(),
        })
        .safeParse(result.data.chart)

      if (!parsed.success) {
        errors.push(
          `${name} chart needs a type (line, scatter or bar), an x column, a numeric y column and an optional group column, all from the result columns`,
        )

        return null
      }

      const c = parsed.data
      chart = { type: c.type, x: c.x, y: c.y }

      if (c.group !== undefined) chart.group = c.group
    }

    const declaration: ExtensionAnalysisKindDeclaration = {
      id: identity.id,
      title: identity.title,
      inputs,
      runner: run,
      result: { columns },
    }

    if (identity.description !== undefined)
      declaration.description = identity.description

    if (chart) declaration.result.chart = chart
    out.push(declaration)
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

const JSON_SCHEMA_TYPE = {
  text: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  json: {},
} satisfies Record<
  ExtensionFieldType,
  Pick<z.core.JSONSchema.JSONSchema, 'type' | 'pattern'>
>

/** The JSON schema a model or MCP client sees for a tool's declared inputs. */
export function fieldsJsonSchema(fields: readonly ExtensionField[]) {
  const properties = new Map<
    string,
    Pick<z.core.JSONSchema.JSONSchema, 'type' | 'pattern' | 'description'>
  >()

  for (const field of fields) {
    const property: Pick<
      z.core.JSONSchema.JSONSchema,
      'type' | 'pattern' | 'description'
    > = { ...JSON_SCHEMA_TYPE[field.type] }

    if (field.description) property.description = field.description
    properties.set(field.name, property)
  }

  return {
    type: 'object',
    properties: Object.fromEntries(properties),
    required: fields.flatMap((field) => (field.required ? [field.name] : [])),
    additionalProperties: false,
  }
}
