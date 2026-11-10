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
 * - `publishers`: sends data out to another system. Like a connector it has no
 *   network of its own: `runner` says which requests to make (POST, PUT or
 *   PATCH to a host an administrator approved, with a body made from the rows)
 *   and `parse` turns the answers into a message for the person.
 * - `notification-channels`: another way for a notification to reach a person,
 *   such as a Slack message. The person says where it goes (their `destination`);
 *   `runner` turns the notification into the requests to make.
 * - `importers`: reads a file format Sheetbase does not know into rows.
 * - `exporters`: writes a table as a file format Sheetbase does not offer.
 * - `previews`: shows what is inside a file format Sheetbase can't open.
 * - `sameness-keys`: says when two registry entries are the same thing (the
 *   canonical structure, the normalised sequence).
 * - `event-hooks`: reacts to something that happened in the lab. It can leave a
 *   note in the Inbox, raise or clear a flag a gate waits on, ask for a
 *   sign-off, and change the record the event was about.
 * - `record-hooks`: runs when a record or file is created, edited, uploaded or
 *   changes status. Before the save it can refuse with a message or fill in
 *   fields; after it, it can write a summary, add to a search index, raise
 *   flags, ask for sign-off and change records.
 * - `instrument-parsers`: reads the file an instrument writes into rows, and is
 *   recognised by the file's extension and the text it must carry.
 * - `label-formats`: lays out a label: the lines it prints for a record.
 * - `barcode-formats`: draws a code (bars or a square grid) for a value, and
 *   can read a scanned code back into the value it stands for.
 * - `storage-rules`: says whether a sample may go where it is being put (a
 *   freezer too warm, a box that is for something else) before it is filed.
 *
 * Every declaration names its inputs and outputs, the code is one named Python
 * function of the plugin's package, and anything unknown is refused. The same
 * rules are written in SQL (`internal.validate_extension_runner_points`) and in
 * Python (`sheetbase_plugin.package`); shared cases in
 * `sdks/plugin-python/tests/package_cases.json` keep the three in step.
 */
import { z } from 'zod'

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
  /**
   * The provider keeps an index (see `index` in a record hook's answer) and
   * does not want every document: it is first asked with none, answers with a
   * `nearest` that has `verify`, and then gets only the records the index
   * found, to check and score.
   */
  indexed?: boolean
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

/** A publisher is a connector that sends rows out instead of reading rows in. */
export type ExtensionPublisherDeclaration = ExtensionConnectorDeclaration

export interface ExtensionChannelDestination {
  /** What the person is asked for, such as “Slack member ID”. */
  label: string
  /** An example shown inside the box. */
  hint?: string
}

export interface ExtensionNotificationChannelDeclaration {
  id: string
  title: string
  description: string
  /** The only hosts the app will call for this channel (HTTPS, port 443). */
  hosts: string[]
  /** Set once by an administrator; secrets stay sealed. */
  settings: ExtensionConnectorSetting[]
  /** Where each person's notifications go, in the channel's own words. */
  destination: ExtensionChannelDestination
  /** Turns a notification into the requests to make. */
  runner: ExtensionRunner
  /**
   * Reads the answers and raises a plain error when the service refused (Slack
   * answers 200 with `ok: false`). Without it, any answer outside 2xx is a refusal.
   */
  parse?: ExtensionRunner
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

export const RECORD_HOOK_WHEN = [
  'created',
  'edited',
  'uploaded',
  'status-changed',
] as const

export type RecordHookWhen = (typeof RECORD_HOOK_WHEN)[number]

export const RECORD_HOOK_TIMING = ['before', 'after'] as const

export type RecordHookTiming = (typeof RECORD_HOOK_TIMING)[number]

export interface ExtensionRecordHookDeclaration {
  id: string
  title: string
  description: string
  /** What sets it off. A save of a file is `uploaded`; a status change is also an edit to listeners of `edited` only if they ask for both. */
  when: RecordHookWhen[]
  /** `before` runs inside the save and can refuse it; `after` runs once it is saved. */
  timing: RecordHookTiming
  /** Only these kinds of record (`experiment`, `sample`, `file`, a model's key). Absent means every kind. */
  kinds?: string[]
  /** For `status-changed`: only a change to one of these statuses. */
  statuses?: string[]
  /** For `uploaded`: hand the plugin the file's contents. */
  file?: ExtensionEncoding
  runner: ExtensionRunner
}

export interface ExtensionInstrumentParserDeclaration {
  id: string
  title: string
  description: string
  /** File extensions the instrument writes, lower case with the dot. */
  extensions: string[]
  encoding: ExtensionEncoding
  /** The instrument or vendor it reads, as people would say it, such as `Acme plate reader`. */
  instrument?: string
  /** Text the file must carry to be recognised (any one of these), so two parsers can share an extension. */
  contains?: string[]
  runner: ExtensionRunner
}

export const BARCODE_DIMENSIONS = ['1d', '2d'] as const

export type BarcodeDimension = (typeof BARCODE_DIMENSIONS)[number]

export interface ExtensionLabelFormatDeclaration {
  id: string
  title: string
  description: string
  /** The kinds of record it lays out: `sample`, `material` or `record`. */
  kinds: string[]
  runner: ExtensionRunner
}

export interface ExtensionBarcodeFormatDeclaration {
  id: string
  title: string
  description: string
  /** `1d`: a row of bars. `2d`: a square grid of dots. */
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the existing plugin.json wire field for barcode dimensionality, not an unnamed object type (hooks.test.ts barcode declarations).
  shape: BarcodeDimension
  /** Draws the code for a value. */
  runner: ExtensionRunner
  /** Turns the text a scanner read back into the value it stands for. */
  parse?: ExtensionRunner
}

export interface ExtensionStorageRuleDeclaration {
  id: string
  title: string
  description: string
  runner: ExtensionRunner
}

export interface ExtensionDataContributions {
  'pipeline-steps'?: ExtensionPipelineStepDeclaration[]
  calculators?: ExtensionCalculatorDeclaration[]
  checks?: ExtensionCheckDeclaration[]
  'search-providers'?: ExtensionSearchProviderDeclaration[]
  connectors?: ExtensionConnectorDeclaration[]
  publishers?: ExtensionPublisherDeclaration[]
  'notification-channels'?: ExtensionNotificationChannelDeclaration[]
  importers?: ExtensionImporterDeclaration[]
  exporters?: ExtensionExporterDeclaration[]
  previews?: ExtensionPreviewDeclaration[]
  'sameness-keys'?: ExtensionSamenessKeyDeclaration[]
  'event-hooks'?: ExtensionEventHookDeclaration[]
  'record-hooks'?: ExtensionRecordHookDeclaration[]
  'instrument-parsers'?: ExtensionInstrumentParserDeclaration[]
  'label-formats'?: ExtensionLabelFormatDeclaration[]
  'barcode-formats'?: ExtensionBarcodeFormatDeclaration[]
  'storage-rules'?: ExtensionStorageRuleDeclaration[]
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw pipeline result columns enter here; bounded list, per-column schema and duplicate checks construct ExtensionResultColumn values (hooks.test.ts malformed declarations).
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

  for (const candidate of value) {
    const parsed = z
      .object({
        name: z.string().regex(EXTENSION_FIELD_NAME_RE),
        type: z.enum(['number', 'text']),
      })
      .safeParse(candidate)

    if (!parsed.success || seen.has(parsed.data.name)) {
      errors.push(
        `${where} result columns need a unique name and a type of number or text`,
      )

      return null
    }

    seen.add(parsed.data.name)
    out.push(parsed.data)
  }

  return out
}

function strings(
  where: string,
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The manifest field is parsed by the bounded string/grammar schema below, then checked for duplicates before returning strings (hooks.test.ts data-point declarations).
  value: unknown,
  pattern: RegExp,
  errors: string[],
  hint: string,
): string[] | null {
  const parsed = z
    .array(z.string().regex(pattern))
    .min(1)
    .max(MAX_LIST_ITEMS)
    .safeParse(value)

  if (!parsed.success) {
    errors.push(
      `${where} ${label} needs 1-${MAX_LIST_ITEMS} entries, each ${hint}`,
    )

    return null
  }

  if (new Set(parsed.data).size !== parsed.data.length) {
    errors.push(`${where} ${label} repeats an entry`)

    return null
  }

  return parsed.data
}

function encoding(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the encoding decoder: only the two wire literals text/base64 return successfully; malformed declarations are refused in hooks.test.ts.
  value: unknown,
  errors: string[],
): ExtensionEncoding | null {
  if (value !== 'text' && value !== 'base64') {
    errors.push(`${where} encoding must be text or base64`)

    return null
  }

  return value
}

const tableInput = z.object({
  name: z.string().regex(EXTENSION_FIELD_NAME_RE),
  label: z.string().trim().min(1).max(80),
  required: z.boolean(),
})

const checkInput = tableInput.extend({ type: z.enum(['number', 'category']) })
const connectionSetting = tableInput.extend({ secret: z.boolean() })

function labelled<T extends ExtensionTableInput>(
  where: string,
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw table/check/settings lists enter here; the supplied owner schema validates each entry and duplicate names are rejected before returning T (hooks.test.ts).
  value: unknown,
  errors: string[],
  schema: z.ZodType<T>,
  max: number,
): T[] | null {
  if (!Array.isArray(value) || value.length > max) {
    errors.push(`${where} ${label} must be a list of at most ${max}`)

    return null
  }

  const seen = new Set<string>()
  const out: T[] = []

  for (const candidate of value) {
    const parsed = schema.safeParse(candidate)

    if (!parsed.success || seen.has(parsed.data.name)) {
      errors.push(
        `${where} ${label} need a unique name, a label of 1-80 characters and required`,
      )

      return null
    }

    seen.add(parsed.data.name)
    out.push(parsed.data)
  }

  return out
}

type Parsed<T> = T[] | null

function each<T>(
  point: ExtensionRunnerPoint,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the shared declaration-list boundary: list bounds and raw-object checks precede head identity parsing and the point-specific builder; no raw entry is returned (hooks.test.ts malformed declarations).
  value: unknown,
  errors: string[],
  descriptionRequired: boolean,
  build: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Only raw fields reach this callback after list/head checks. Each point validates its semantic fields and constructs T; this dictionary stays inside that partial-parse phase and is never returned as a declaration (hooks.test.ts malformed inputs).
    entry: Record<string, unknown>,
    where: string,
    identity: Pick<
      ExtensionCalculatorDeclaration,
      'id' | 'title' | 'description'
    >,
  ) => T | null,
): Parsed<T> {
  const entries = list(point, value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: T[] = []

  for (const entry of entries) {
    const metadata = head(point, entry, seen, errors, descriptionRequired)

    if (!metadata) return null

    const built = build(entry, metadata.name, {
      id: metadata.identity.id,
      title: metadata.identity.title,
      description: metadata.identity.description ?? '',
    })

    if (!built) return null
    out.push(built)
  }

  return out
}

export function parsePipelineSteps(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw pipeline declarations delegate immediately to each; table, parameter, result-column and runner decoders construct the typed result (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionPipelineStepDeclaration> {
  return each<ExtensionPipelineStepDeclaration>(
    'pipeline-steps',
    value,
    errors,
    false,
    (entry, where, identity) => {
      const tables = labelled(
        where,
        'tables',
        entry.tables,
        errors,
        tableInput,
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

      const declaration: ExtensionPipelineStepDeclaration = {
        id: identity.id,
        title: identity.title,
        tables,
        parameters,
        result: { columns: resultColumns },
        runner: run,
      }

      if (entry.description !== undefined)
        declaration.description = identity.description

      return declaration
    },
  )
}

export function parseCalculators(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw calculator declarations delegate immediately to each and fieldList/runner; empty inputs/outputs are refused before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionCalculatorDeclaration> {
  return each<ExtensionCalculatorDeclaration>(
    'calculators',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const inputs = fieldList(where, 'inputs', entry.inputs, errors)
      const outputs = fieldList(where, 'outputs', entry.outputs, errors)
      const run = runner(where, entry.runner, errors)

      if (!inputs || !outputs || !run) return null

      if (inputs.length < 1 || outputs.length < 1) {
        errors.push(`${where} needs at least one input and one output`)

        return null
      }

      return { ...identity, inputs, outputs, runner: run }
    },
  )
}

export function parseChecks(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw check declarations enter through each; labelled check-input schemas and runner validation precede construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionCheckDeclaration> {
  return each<ExtensionCheckDeclaration>(
    'checks',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const inputs = labelled(
        where,
        'inputs',
        entry.inputs,
        errors,
        checkInput,
        MAX_EXTENSION_FIELDS,
      )

      const run = runner(where, entry.runner, errors)

      if (!inputs || !run) return null

      if (inputs.length < 1) {
        errors.push(`${where} needs at least one input`)

        return null
      }

      return {
        ...identity,
        inputs,
        runner: run,
      }
    },
  )
}

export function parseSearchProviders(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw search declarations enter through each; record-type grammar, indexed boolean and runner are checked before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionSearchProviderDeclaration> {
  return each<ExtensionSearchProviderDeclaration>(
    'search-providers',
    value,
    errors,
    true,
    (entry, where, identity) => {
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

      if (!z.boolean().optional().safeParse(entry.indexed).success) {
        errors.push(`${where} indexed must be true or false`)

        return null
      }

      const declaration: ExtensionSearchProviderDeclaration = {
        ...identity,
        types,
        runner: run,
      }

      if (entry.indexed === true) declaration.indexed = true

      return declaration
    },
  )
}

function connectorBuilder(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This builder is inside the manifest boundary; hosts, settings, parameters and both runners are decoded below before a connector is constructed. Raw fields never escape (shared package cases).
  entry: Record<string, unknown>,
  where: string,
  errors: string[],
  identity: Pick<ExtensionConnectorDeclaration, 'id' | 'title' | 'description'>,
): ExtensionConnectorDeclaration | null {
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
    connectionSetting,
    MAX_CONNECTOR_SETTINGS,
  )

  const parameters = fieldList(where, 'parameters', entry.parameters, errors)
  const run = runner(where, entry.runner, errors)
  const parse = runner(`${where} parse`, entry.parse, errors)

  if (!hosts || !settings || !parameters || !run || !parse) return null

  return {
    ...identity,
    hosts,
    settings,
    parameters,
    runner: run,
    parse,
  }
}

export function parseConnectors(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw connectors delegate immediately to each/connectorBuilder, which validate hosts, settings, parameters and both runners (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionConnectorDeclaration> {
  return each<ExtensionConnectorDeclaration>(
    'connectors',
    value,
    errors,
    true,
    (entry, where, identity) =>
      connectorBuilder(entry, where, errors, identity),
  )
}

export function parsePublishers(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw publishers delegate immediately to each/connectorBuilder and reject reserved row/name parameters before returning a declaration (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionPublisherDeclaration> {
  return each<ExtensionPublisherDeclaration>(
    'publishers',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const built = connectorBuilder(entry, where, errors, identity)

      if (!built) return null

      if (
        built.parameters.some((p) => p.name === 'rows' || p.name === 'name')
      ) {
        errors.push(`${where} parameters can’t be called rows or name`)

        return null
      }

      return built
    },
  )
}

export function parseNotificationChannels(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw channels delegate immediately to each; hosts, settings, destination text and runners are checked before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionNotificationChannelDeclaration> {
  return each<ExtensionNotificationChannelDeclaration>(
    'notification-channels',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const hosts = strings(
        where,
        'hosts',
        entry.hosts,
        EXTENSION_HOST_RE,
        errors,
        'a host name such as slack.com',
      )

      const settings = labelled(
        where,
        'settings',
        entry.settings,
        errors,
        connectionSetting,
        MAX_CONNECTOR_SETTINGS,
      )

      const destination = entry.destination

      if (
        !isRecord(destination) ||
        !text(destination.label, 1, 80) ||
        (destination.hint !== undefined && !text(destination.hint, 1, 120))
      ) {
        errors.push(
          `${where} destination needs a label of 1-80 characters and may have a hint of up to 120`,
        )

        return null
      }

      const run = runner(where, entry.runner, errors)

      const parse =
        entry.parse === undefined
          ? undefined
          : runner(`${where} parse`, entry.parse, errors)

      if (!hosts || !settings || !run || parse === null) return null

      const declaration: ExtensionNotificationChannelDeclaration = {
        ...identity,
        hosts,
        settings,
        destination: {
          label: destination.label.trim(),
        },
        runner: run,
      }

      if (destination.hint !== undefined)
        declaration.destination.hint = z.string().parse(destination.hint).trim()

      if (parse) declaration.parse = parse

      return declaration
    },
  )
}

export function parseImporters(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw importers delegate immediately to each; file-extension grammar, encoding and runner are decoded before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionImporterDeclaration> {
  return each<ExtensionImporterDeclaration>(
    'importers',
    value,
    errors,
    true,
    (entry, where, identity) => {
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

      return { ...identity, extensions, encoding: enc, runner: run }
    },
  )
}

export function parseExporters(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw exporters delegate immediately to each; extension/MIME grammar, encoding, parameters and runner are decoded before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionExporterDeclaration> {
  return each<ExtensionExporterDeclaration>(
    'exporters',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const extension = z
        .string()
        .regex(EXTENSION_FILE_EXTENSION_RE)
        .safeParse(entry.extension)

      if (!extension.success) {
        errors.push(`${where} extension must look like .fasta`)

        return null
      }

      const mime = z.string().regex(EXTENSION_MIME_RE).safeParse(entry.mime)

      if (!mime.success) {
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
        ...identity,
        extension: extension.data,
        mime: mime.data,
        encoding: enc,
        parameters,
        runner: run,
      }
    },
  )
}

export function parsePreviews(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw previews delegate immediately to each; file-extension grammar, encoding and runner are decoded before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionPreviewDeclaration> {
  return each<ExtensionPreviewDeclaration>(
    'previews',
    value,
    errors,
    true,
    (entry, where, identity) => {
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

      return { ...identity, extensions, encoding: enc, runner: run }
    },
  )
}

export function parseSamenessKeys(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw sameness rules delegate immediately to each and fieldList/runner, rejecting empty fields before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionSamenessKeyDeclaration> {
  return each<ExtensionSamenessKeyDeclaration>(
    'sameness-keys',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const fields = fieldList(where, 'fields', entry.fields, errors)
      const run = runner(where, entry.runner, errors)

      if (!fields || !run) return null

      if (fields.length < 1) {
        errors.push(`${where} needs at least one field`)

        return null
      }

      return { ...identity, fields, runner: run }
    },
  )
}

export function parseEventHooks(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw event reactions delegate immediately to each; bounded catalogue event names, duplicates and runner are checked before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionEventHookDeclaration> {
  return each<ExtensionEventHookDeclaration>(
    'event-hooks',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const names = z
        .array(z.unknown())
        .min(1)
        .max(MAX_LIST_ITEMS)
        .safeParse(entry.events)

      if (!names.success) {
        errors.push(`${where} events needs 1-${MAX_LIST_ITEMS} event names`)

        return null
      }

      const events = new Set<string>()

      for (const name of names.data) {
        const parsedName = z.string().safeParse(name)

        const known = parsedName.success
          ? eventByName(parsedName.data)
          : undefined

        // Hooks match the name that goes out on the wire to webhooks.
        if (!known?.wireName) {
          errors.push(`${where} names an unknown event: ${String(name)}`)

          return null
        }

        if (events.has(known.wireName)) {
          errors.push(`${where} repeats the event ${known.wireName}`)

          return null
        }

        events.add(known.wireName)
      }

      const run = runner(where, entry.runner, errors)

      if (!run) return null

      return { ...identity, events: [...events], runner: run }
    },
  )
}

export const EXTENSION_STATUS_RE = /^[a-z][a-z0-9_]{0,40}$/

function unique(
  where: string,
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Optional record kind/status lists enter here; the string grammar and nonempty/duplicate checks below reject malformed values (hooks.test.ts record hooks).
  value: unknown,
  pattern: RegExp,
  errors: string[],
  hint: string,
): string[] | null | undefined {
  if (value === undefined) return undefined
  const parsed = z.array(z.string().regex(pattern)).min(1).safeParse(value)

  if (!parsed.success) {
    errors.push(`${where} ${label} needs at least one entry, each ${hint}`)

    return null
  }

  if (new Set(parsed.data).size !== parsed.data.length) {
    errors.push(`${where} ${label} repeats an entry`)

    return null
  }

  return parsed.data
}

export function parseRecordHooks(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw record hooks delegate immediately to each; timing/when, kinds/statuses, upload encoding and runner checks construct the declaration (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionRecordHookDeclaration> {
  return each<ExtensionRecordHookDeclaration>(
    'record-hooks',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const parsedWhen = z
        .array(z.enum(RECORD_HOOK_WHEN))
        .min(1)
        .safeParse(entry.when)

      if (
        !parsedWhen.success ||
        new Set(parsedWhen.data).size !== parsedWhen.data.length
      ) {
        errors.push(
          `${where} when needs one or more different entries from ${RECORD_HOOK_WHEN.join(', ')}`,
        )

        return null
      }

      const when = parsedWhen.data
      const timing = z.enum(RECORD_HOOK_TIMING).safeParse(entry.timing)

      if (!timing.success) {
        errors.push(`${where} timing must be before or after`)

        return null
      }

      const kinds = unique(
        where,
        'kinds',
        entry.kinds,
        EXTENSION_RECORD_TYPE_RE,
        errors,
        'like experiment or sample',
      )

      const statuses = unique(
        where,
        'statuses',
        entry.statuses,
        EXTENSION_STATUS_RE,
        errors,
        'like in_review',
      )

      if (kinds === null || statuses === null) return null

      if (statuses && !when.includes('status-changed')) {
        errors.push(`${where} statuses only apply to status-changed`)

        return null
      }

      let file: ExtensionEncoding | undefined

      if (entry.file !== undefined) {
        if (!when.includes('uploaded')) {
          errors.push(`${where} file only applies to uploaded`)

          return null
        }

        const enc = encoding(`${where} file`, entry.file, errors)

        if (!enc) return null
        file = enc
      }

      const run = runner(where, entry.runner, errors)

      if (!run) return null

      const declaration: ExtensionRecordHookDeclaration = {
        ...identity,
        when,
        timing: timing.data,
        runner: run,
      }

      if (kinds) declaration.kinds = kinds

      if (statuses) declaration.statuses = statuses

      if (file) declaration.file = file

      return declaration
    },
  )
}

export const LABEL_KINDS = ['sample', 'material', 'record'] as const
export const MAX_RECOGNISE_TEXTS = 5

export function parseInstrumentParsers(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw instrument parsers delegate immediately to each; extension, encoding, bounded recognition text and runner checks construct the declaration (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionInstrumentParserDeclaration> {
  return each<ExtensionInstrumentParserDeclaration>(
    'instrument-parsers',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const extensions = strings(
        where,
        'extensions',
        entry.extensions,
        EXTENSION_FILE_EXTENSION_RE,
        errors,
        'like .xlsx',
      )

      const enc = encoding(where, entry.encoding, errors)

      if (entry.instrument !== undefined && !text(entry.instrument, 1, 120)) {
        errors.push(`${where} instrument must be 1-120 characters`)

        return null
      }

      let contains: string[] | undefined

      if (entry.contains !== undefined) {
        if (
          !Array.isArray(entry.contains) ||
          entry.contains.length < 1 ||
          entry.contains.length > MAX_RECOGNISE_TEXTS ||
          !entry.contains.every((item) => text(item, 1, 80)) ||
          new Set(entry.contains).size !== entry.contains.length
        ) {
          errors.push(
            `${where} contains needs 1-${MAX_RECOGNISE_TEXTS} different texts of 1-80 characters`,
          )

          return null
        }

        contains = entry.contains
      }

      const run = runner(where, entry.runner, errors)

      if (!extensions || !enc || !run) return null

      const declaration: ExtensionInstrumentParserDeclaration = {
        ...identity,
        extensions,
        encoding: enc,
        runner: run,
      }

      if (entry.instrument !== undefined)
        declaration.instrument = z.string().parse(entry.instrument).trim()

      if (contains) declaration.contains = contains

      return declaration
    },
  )
}

export function parseLabelFormats(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw label formats delegate immediately to each; record-kind grammar and runner are checked before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionLabelFormatDeclaration> {
  return each<ExtensionLabelFormatDeclaration>(
    'label-formats',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const kinds = strings(
        where,
        'kinds',
        entry.kinds,
        EXTENSION_RECORD_TYPE_RE,
        errors,
        'like sample',
      )

      const run = runner(where, entry.runner, errors)

      if (!kinds || !run) return null

      return { ...identity, kinds, runner: run }
    },
  )
}

export function parseBarcodeFormats(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw barcode formats delegate immediately to each; dimensionality and both runners are decoded before construction (hooks.test.ts malformed 3d case and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionBarcodeFormatDeclaration> {
  return each<ExtensionBarcodeFormatDeclaration>(
    'barcode-formats',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const dimension = z.enum(BARCODE_DIMENSIONS).safeParse(entry.shape)

      if (!dimension.success) {
        errors.push(`${where} shape must be 1d or 2d`)

        return null
      }

      const run = runner(where, entry.runner, errors)

      const parse =
        entry.parse === undefined
          ? undefined
          : runner(`${where} parse`, entry.parse, errors)

      if (!run || parse === null) return null

      const declaration: ExtensionBarcodeFormatDeclaration = {
        ...identity,
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- This is the existing plugin.json barcode field; hooks.test.ts verifies its 1d/2d round-trip and rejects 3d.
        shape: dimension.data,
        runner: run,
      }

      if (parse) declaration.parse = parse

      return declaration
    },
  )
}

export function parseStorageRules(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw storage rules delegate immediately to each for identity and runner validation before construction (hooks.test.ts and shared package cases).
  value: unknown,
  errors: string[],
): Parsed<ExtensionStorageRuleDeclaration> {
  return each<ExtensionStorageRuleDeclaration>(
    'storage-rules',
    value,
    errors,
    true,
    (entry, where, identity) => {
      const run = runner(where, entry.runner, errors)

      if (!run) return null

      return { ...identity, runner: run }
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
  publishers: parsePublishers,
  'notification-channels': parseNotificationChannels,
  importers: parseImporters,
  exporters: parseExporters,
  previews: parsePreviews,
  'sameness-keys': parseSamenessKeys,
  'event-hooks': parseEventHooks,
  'record-hooks': parseRecordHooks,
  'instrument-parsers': parseInstrumentParsers,
  'label-formats': parseLabelFormats,
  'barcode-formats': parseBarcodeFormats,
  'storage-rules': parseStorageRules,
} as const

export type DataPoint = keyof typeof DATA_POINT_PARSERS

export const DATA_POINTS = Object.keys(DATA_POINT_PARSERS).filter(isDataPoint)

export function isDataPoint(value: string): value is DataPoint {
  return Object.hasOwn(DATA_POINT_PARSERS, value)
}
