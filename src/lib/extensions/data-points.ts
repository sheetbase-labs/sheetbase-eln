/**
 * The data and search extension points: what a plugin can add to the way a lab
 * moves, checks, finds and shows data.
 *
 * - `pipeline-steps`: takes named tables in and gives a table back. It is the
 *   data combiner (join two datasets, stack plates) and any other step a
 *   pipeline can use.
 * - `calculators`: named numbers in, named numbers out, next to the bench
 *   calculator.
 * - `checks`: reads a table and says pass, warn or fail with a reason. A gate
 *   can require one to pass.
 * - `search-providers`: finds records the built-in search can't, such as
 *   structures that contain a substructure.
 * - `connectors`: pulls data in from elsewhere. A plugin has no network, so a
 *   connector is two functions: `run` says which request to make (to a host an
 *   administrator approved), and `parse` turns the answer into rows.
 * - `importers`: reads a file format Sheetbase does not know into rows.
 * - `exporters`: writes a table as a file format Sheetbase does not offer.
 * - `previews`: shows what is inside a file format Sheetbase can't open.
 * - `sameness-keys`: says when two registry entries are the same thing (the
 *   canonical structure, the normalised sequence).
 * - `event-hooks`: reacts to something that happened in the lab, and can leave
 *   a note in the Inbox. It never changes records itself.
 *
 * Every declaration names its inputs and outputs, the code is one named Python
 * function of the plugin's package, and anything unknown is refused. The same
 * rules are written in SQL (`internal.validate_extension_runner_points`) and in
 * Python (`sheetbase_plugin.package`); shared cases in
 * `sdks/plugin-python/tests/package_cases.json` keep the three in step.
 */
import { eventByName } from '../event-catalogue'
import {
  EXTENSION_FIELD_NAME_RE,
  MAX_EXTENSION_FIELDS,
  fieldList,
  head,
  isRecord,
  list,
  runner,
  text,
} from './points'
import type {
  ExtensionField,
  ExtensionRunner,
  ExtensionRunnerPoint,
} from './points'

export interface ExtensionResultColumn {
  name: string
  type: 'number' | 'text'
}

export interface ExtensionTableInput {
  name: string
  label: string
  required: boolean
}

export interface ExtensionPipelineStepDeclaration {
  id: string
  title: string
  description?: string
  /** The tables the step reads, by name. */
  tables: ExtensionTableInput[]
  /** Settings the pipeline author fills in. */
  parameters: ExtensionField[]
  result: { columns: ExtensionResultColumn[] }
  runner: ExtensionRunner
}

export interface ExtensionCalculatorDeclaration {
  id: string
  title: string
  description: string
  inputs: ExtensionField[]
  outputs: ExtensionField[]
  runner: ExtensionRunner
}

export interface ExtensionCheckInput {
  name: string
  label: string
  type: 'number' | 'category'
  required: boolean
}

export interface ExtensionCheckDeclaration {
  id: string
  title: string
  description: string
  /** Table columns the person binds, by name. */
  inputs: ExtensionCheckInput[]
  runner: ExtensionRunner
}

export interface ExtensionSearchProviderDeclaration {
  id: string
  title: string
  description: string
  /** The kinds of record the provider is handed to look through, such as `sample`. */
  types: string[]
  runner: ExtensionRunner
}

export interface ExtensionConnectorSetting {
  name: string
  label: string
  /** Kept sealed, never shown again after it is saved. */
  secret: boolean
  required: boolean
}

export interface ExtensionConnectorDeclaration {
  id: string
  title: string
  description: string
  /** The only hosts the app will call for this connector (HTTPS, port 443). */
  hosts: string[]
  settings: ExtensionConnectorSetting[]
  parameters: ExtensionField[]
  /** `runner` says which requests to make; `parse` turns the answers into rows. */
  runner: ExtensionRunner
  parse: ExtensionRunner
}

export const EXTENSION_ENCODINGS = ['text', 'base64'] as const
export type ExtensionEncoding = (typeof EXTENSION_ENCODINGS)[number]

export interface ExtensionImporterDeclaration {
  id: string
  title: string
  description: string
  /** File extensions it reads, lower case with the dot. */
  extensions: string[]
  encoding: ExtensionEncoding
  runner: ExtensionRunner
}

export interface ExtensionExporterDeclaration {
  id: string
  title: string
  description: string
  /** The extension of the file it writes, such as `.fasta`. */
  extension: string
  mime: string
  encoding: ExtensionEncoding
  parameters: ExtensionField[]
  runner: ExtensionRunner
}

export interface ExtensionPreviewDeclaration {
  id: string
  title: string
  description: string
  extensions: string[]
  encoding: ExtensionEncoding
  runner: ExtensionRunner
}

export interface ExtensionSamenessKeyDeclaration {
  id: string
  title: string
  description: string
  /** What it reads from an entry. */
  fields: ExtensionField[]
  runner: ExtensionRunner
}

export interface ExtensionEventHookDeclaration {
  id: string
  title: string
  description: string
  /** Event names as they go out to webhooks, such as `qc.violation`. */
  events: string[]
  runner: ExtensionRunner
}

export interface ExtensionDataContributions {
  'pipeline-steps'?: ExtensionPipelineStepDeclaration[]
  calculators?: ExtensionCalculatorDeclaration[]
  checks?: ExtensionCheckDeclaration[]
  'search-providers'?: ExtensionSearchProviderDeclaration[]
  connectors?: ExtensionConnectorDeclaration[]
  importers?: ExtensionImporterDeclaration[]
  exporters?: ExtensionExporterDeclaration[]
  previews?: ExtensionPreviewDeclaration[]
  'sameness-keys'?: ExtensionSamenessKeyDeclaration[]
  'event-hooks'?: ExtensionEventHookDeclaration[]
}

export const MAX_TABLE_INPUTS = 6
export const MAX_LIST_ITEMS = 10
export const MAX_CONNECTOR_SETTINGS = 8
export const EXTENSION_HOST_RE =
  /^(?!\d+(?:\.\d+){3}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
export const EXTENSION_FILE_EXTENSION_RE = /^\.[a-z0-9]{1,12}$/
export const EXTENSION_RECORD_TYPE_RE = /^[a-z][a-z0-9_-]{0,40}$/
export const EXTENSION_MIME_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/

function columns(
  where: string,
  value: unknown,
  errors: string[],
): ExtensionResultColumn[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_EXTENSION_FIELDS
  ) {
    errors.push(`${where} result needs 1-${MAX_EXTENSION_FIELDS} columns`)
    return null
  }
  const seen = new Set<string>()
  const out: ExtensionResultColumn[] = []
  for (const column of value as unknown[]) {
    if (
      !isRecord(column) ||
      typeof column.name !== 'string' ||
      !EXTENSION_FIELD_NAME_RE.test(column.name) ||
      seen.has(column.name) ||
      (column.type !== 'number' && column.type !== 'text')
    ) {
      errors.push(
        `${where} result columns need a unique name and a type of number or text`,
      )
      return null
    }
    seen.add(column.name)
    out.push({ name: column.name, type: column.type })
  }
  return out
}

function strings(
  where: string,
  label: string,
  value: unknown,
  pattern: RegExp,
  errors: string[],
  hint: string,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_LIST_ITEMS ||
    !value.every((entry) => typeof entry === 'string' && pattern.test(entry))
  ) {
    errors.push(
      `${where} ${label} needs 1-${MAX_LIST_ITEMS} entries, each ${hint}`,
    )
    return null
  }
  if (new Set(value).size !== value.length) {
    errors.push(`${where} ${label} repeats an entry`)
    return null
  }
  return value as string[]
}

function encoding(
  where: string,
  value: unknown,
  errors: string[],
): ExtensionEncoding | null {
  if (value !== 'text' && value !== 'base64') {
    errors.push(`${where} encoding must be text or base64`)
    return null
  }
  return value
}

function labelled(
  where: string,
  label: string,
  value: unknown,
  errors: string[],
  extra: (entry: Record<string, unknown>) => boolean,
  max: number,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length > max) {
    errors.push(`${where} ${label} must be a list of at most ${max}`)
    return null
  }
  const seen = new Set<string>()
  for (const entry of value as unknown[]) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !EXTENSION_FIELD_NAME_RE.test(entry.name) ||
      seen.has(entry.name) ||
      !text(entry.label, 1, 80) ||
      typeof entry.required !== 'boolean' ||
      !extra(entry)
    ) {
      errors.push(
        `${where} ${label} need a unique name, a label of 1-80 characters and required`,
      )
      return null
    }
    seen.add(entry.name)
  }
  return value as Array<Record<string, unknown>>
}

type Parsed<T> = T[] | null

function each<T>(
  point: ExtensionRunnerPoint,
  value: unknown,
  errors: string[],
  descriptionRequired: boolean,
  build: (entry: Record<string, unknown>, where: string) => T | null,
): Parsed<T> {
  const entries = list(point, value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of entries) {
    const where = head(point, entry, seen, errors, descriptionRequired)
    if (!where) return null
    const built = build(entry, where)
    if (!built) return null
    out.push({
      id: entry.id,
      title: (entry.title as string).trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      ...built,
    })
  }
  return out
}

export function parsePipelineSteps(
  value: unknown,
  errors: string[],
): Parsed<ExtensionPipelineStepDeclaration> {
  return each<ExtensionPipelineStepDeclaration>(
    'pipeline-steps',
    value,
    errors,
    false,
    (entry, where) => {
      const tables = labelled(
        where,
        'tables',
        entry.tables,
        errors,
        () => true,
        MAX_TABLE_INPUTS,
      )
      if (!tables || tables.length < 1) {
        if (tables) errors.push(`${where} needs at least one table`)
        return null
      }
      const parameters = fieldList(
        where,
        'parameters',
        entry.parameters,
        errors,
      )
      const run = runner(where, entry.runner, errors)
      const result = isRecord(entry.result) ? entry.result : null
      const resultColumns = columns(where, result?.columns, errors)
      if (!parameters || !run || !resultColumns) return null
      return {
        tables: tables.map((table) => ({
          name: table.name as string,
          label: (table.label as string).trim(),
          required: table.required as boolean,
        })),
        parameters,
        result: { columns: resultColumns },
        runner: run,
      } as unknown as ExtensionPipelineStepDeclaration
    },
  )
}

export function parseCalculators(
  value: unknown,
  errors: string[],
): Parsed<ExtensionCalculatorDeclaration> {
  return each<ExtensionCalculatorDeclaration>(
    'calculators',
    value,
    errors,
    true,
    (entry, where) => {
      const inputs = fieldList(where, 'inputs', entry.inputs, errors)
      const outputs = fieldList(where, 'outputs', entry.outputs, errors)
      const run = runner(where, entry.runner, errors)
      if (!inputs || !outputs || !run) return null
      if (inputs.length < 1 || outputs.length < 1) {
        errors.push(`${where} needs at least one input and one output`)
        return null
      }
      return { inputs, outputs, runner: run } as never
    },
  )
}

export function parseChecks(
  value: unknown,
  errors: string[],
): Parsed<ExtensionCheckDeclaration> {
  return each<ExtensionCheckDeclaration>(
    'checks',
    value,
    errors,
    true,
    (entry, where) => {
      const inputs = labelled(
        where,
        'inputs',
        entry.inputs,
        errors,
        (input) => input.type === 'number' || input.type === 'category',
        MAX_EXTENSION_FIELDS,
      )
      const run = runner(where, entry.runner, errors)
      if (!inputs || !run) return null
      if (inputs.length < 1) {
        errors.push(`${where} needs at least one input`)
        return null
      }
      return {
        inputs: inputs.map((input) => ({
          name: input.name as string,
          label: (input.label as string).trim(),
          type: input.type as 'number' | 'category',
          required: input.required as boolean,
        })),
        runner: run,
      } as never
    },
  )
}

export function parseSearchProviders(
  value: unknown,
  errors: string[],
): Parsed<ExtensionSearchProviderDeclaration> {
  return each<ExtensionSearchProviderDeclaration>(
    'search-providers',
    value,
    errors,
    true,
    (entry, where) => {
      const types = strings(
        where,
        'types',
        entry.types,
        EXTENSION_RECORD_TYPE_RE,
        errors,
        'like sample or registry_entry',
      )
      const run = runner(where, entry.runner, errors)
      if (!types || !run) return null
      return { types, runner: run } as never
    },
  )
}

export function parseConnectors(
  value: unknown,
  errors: string[],
): Parsed<ExtensionConnectorDeclaration> {
  return each<ExtensionConnectorDeclaration>(
    'connectors',
    value,
    errors,
    true,
    (entry, where) => {
      const hosts = strings(
        where,
        'hosts',
        entry.hosts,
        EXTENSION_HOST_RE,
        errors,
        'a host name such as api.example.org',
      )
      const settings = labelled(
        where,
        'settings',
        entry.settings,
        errors,
        (setting) => typeof setting.secret === 'boolean',
        MAX_CONNECTOR_SETTINGS,
      )
      const parameters = fieldList(
        where,
        'parameters',
        entry.parameters,
        errors,
      )
      const run = runner(where, entry.runner, errors)
      const parse = runner(`${where} parse`, entry.parse, errors)
      if (!hosts || !settings || !parameters || !run || !parse) return null
      return {
        hosts,
        settings: settings.map((setting) => ({
          name: setting.name as string,
          label: (setting.label as string).trim(),
          secret: setting.secret as boolean,
          required: setting.required as boolean,
        })),
        parameters,
        runner: run,
        parse,
      } as never
    },
  )
}

export function parseImporters(
  value: unknown,
  errors: string[],
): Parsed<ExtensionImporterDeclaration> {
  return each<ExtensionImporterDeclaration>(
    'importers',
    value,
    errors,
    true,
    (entry, where) => {
      const extensions = strings(
        where,
        'extensions',
        entry.extensions,
        EXTENSION_FILE_EXTENSION_RE,
        errors,
        'like .mzml',
      )
      const enc = encoding(where, entry.encoding, errors)
      const run = runner(where, entry.runner, errors)
      if (!extensions || !enc || !run) return null
      return { extensions, encoding: enc, runner: run } as never
    },
  )
}

export function parseExporters(
  value: unknown,
  errors: string[],
): Parsed<ExtensionExporterDeclaration> {
  return each<ExtensionExporterDeclaration>(
    'exporters',
    value,
    errors,
    true,
    (entry, where) => {
      if (
        typeof entry.extension !== 'string' ||
        !EXTENSION_FILE_EXTENSION_RE.test(entry.extension)
      ) {
        errors.push(`${where} extension must look like .fasta`)
        return null
      }
      if (
        typeof entry.mime !== 'string' ||
        !EXTENSION_MIME_RE.test(entry.mime)
      ) {
        errors.push(`${where} mime must look like text/plain`)
        return null
      }
      const enc = encoding(where, entry.encoding, errors)
      const parameters = fieldList(
        where,
        'parameters',
        entry.parameters,
        errors,
      )
      const run = runner(where, entry.runner, errors)
      if (!enc || !parameters || !run) return null
      return {
        extension: entry.extension,
        mime: entry.mime,
        encoding: enc,
        parameters,
        runner: run,
      } as never
    },
  )
}

export function parsePreviews(
  value: unknown,
  errors: string[],
): Parsed<ExtensionPreviewDeclaration> {
  return each<ExtensionPreviewDeclaration>(
    'previews',
    value,
    errors,
    true,
    (entry, where) => {
      const extensions = strings(
        where,
        'extensions',
        entry.extensions,
        EXTENSION_FILE_EXTENSION_RE,
        errors,
        'like .mzml',
      )
      const enc = encoding(where, entry.encoding, errors)
      const run = runner(where, entry.runner, errors)
      if (!extensions || !enc || !run) return null
      return { extensions, encoding: enc, runner: run } as never
    },
  )
}

export function parseSamenessKeys(
  value: unknown,
  errors: string[],
): Parsed<ExtensionSamenessKeyDeclaration> {
  return each<ExtensionSamenessKeyDeclaration>(
    'sameness-keys',
    value,
    errors,
    true,
    (entry, where) => {
      const fields = fieldList(where, 'fields', entry.fields, errors)
      const run = runner(where, entry.runner, errors)
      if (!fields || !run) return null
      if (fields.length < 1) {
        errors.push(`${where} needs at least one field`)
        return null
      }
      return { fields, runner: run } as never
    },
  )
}

export function parseEventHooks(
  value: unknown,
  errors: string[],
): Parsed<ExtensionEventHookDeclaration> {
  return each<ExtensionEventHookDeclaration>(
    'event-hooks',
    value,
    errors,
    true,
    (entry, where) => {
      if (
        !Array.isArray(entry.events) ||
        entry.events.length < 1 ||
        entry.events.length > MAX_LIST_ITEMS
      ) {
        errors.push(`${where} events needs 1-${MAX_LIST_ITEMS} event names`)
        return null
      }
      const events: string[] = []
      for (const name of entry.events as unknown[]) {
        const known = typeof name === 'string' ? eventByName(name) : undefined
        // Hooks match the name that goes out on the wire to webhooks.
        if (!known?.wireName) {
          errors.push(`${where} names an unknown event: ${String(name)}`)
          return null
        }
        if (events.includes(known.wireName)) {
          errors.push(`${where} repeats the event ${known.wireName}`)
          return null
        }
        events.push(known.wireName)
      }
      const run = runner(where, entry.runner, errors)
      if (!run) return null
      return { events, runner: run } as never
    },
  )
}

/** The parser for each data point, by name. */
export const DATA_POINT_PARSERS = {
  'pipeline-steps': parsePipelineSteps,
  calculators: parseCalculators,
  checks: parseChecks,
  'search-providers': parseSearchProviders,
  connectors: parseConnectors,
  importers: parseImporters,
  exporters: parseExporters,
  previews: parsePreviews,
  'sameness-keys': parseSamenessKeys,
  'event-hooks': parseEventHooks,
} as const

export type DataPoint = keyof typeof DATA_POINT_PARSERS

export const DATA_POINTS = Object.keys(DATA_POINT_PARSERS) as DataPoint[]

export function isDataPoint(value: string): value is DataPoint {
  return (DATA_POINTS as readonly string[]).includes(value)
}
