/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- this file is the YAML boundary: the parser hands back untyped nodes, and each branch below is the check that turns them into the configuration the shared validator then judges. */
/**
 * The version file: one pipeline version written as YAML text, the form
 * Advanced mode edits, downloads and pushes from git. It holds exactly what a
 * stored version holds (format 2) in names a person would write: lists of
 * named things (parameters, inputs) are maps, a step is a map with its kind as
 * the key that carries its settings, and the keys this module owns are
 * snake_case. Settings that are data of their own (a form step's form, a
 * Python contract, an action's arguments) keep their stored names.
 *
 * `checkVersionFile` is the one reader: it reads text, builds the version it
 * says and runs the shared validator over it, answering every problem with the
 * line and column it is on. `versionFileText` is the one writer, so a version
 * that is written and read again is the same version. Docs:
 * docs/subsystems/pipelines.md, "The version file".
 */
import {
  Document,
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
} from 'yaml'
import { z } from 'zod'

import { t } from '#/copy'
import { PIPELINE_STEP_KINDS, validatePipelineConfig } from './config'
import type {
  PipelineConfig,
  PipelineParameter,
  PipelineStepKind,
} from './config'
import { isNoCodeKind } from './no-code/forms'
import { DEFAULT_START_RULES, startRulesSchema } from './start-rules'
import type { StartRules } from './start-rules'
import { noCodeStatement } from './no-code/generate'
import { parseNoCodeForm } from './no-code/schema'

type Path = Array<string | number>

/** A mistake in the file, where it is, and sometimes the one edit that fixes it. */
export interface FileProblem {
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
  /** Characters on the line to underline. */
  length: number
  message: string
  fix?: FileFix
}

/** Replace `length` characters at a position with `text`. */
export interface FileFix {
  label: string
  line: number
  column: number
  length: number
  text: string
}

/** One line of the outline: a section of the file or a step in it. */
export interface OutlineItem {
  label: string
  /** The step kind, as a word, for a step. */
  kind?: string
  count?: number
  line: number
  /** Last line the item covers. */
  endLine: number
  depth: 0 | 1
}

export interface VersionFileResult {
  /** The version the file says; null while the file cannot be read as one. */
  config: PipelineConfig | null
  /**
   * The start rules the file's `starts:` block says; undefined when the file
   * has none (the pipeline's rules stay as they are). They belong to the
   * pipeline, not the version, so saving the file sets them separately.
   */
  startRules?: StartRules
  problems: FileProblem[]
  outline: OutlineItem[]
  lineCount: number
}

export interface VersionFileMeta {
  /** What the pipeline is called: the first line of the file. */
  title?: string
  /** The pipeline's id (`PL-0021`) or key. */
  pipeline: string
  /** The version this file is a draft or copy of. */
  version?: number | null
  /** A short remark after the version number. */
  versionNote?: string
  /** The pipeline's start rules, written as `starts:` when they are not the defaults. */
  startRules?: StartRules
}

/** What a file may be checked against. */
export interface VersionFileTarget {
  /** Every name the file may call its pipeline: display id and key. */
  pipeline?: string[]
  /**
   * The Python runtime to pin when the file names none. The file does not
   * carry the pin; whoever saves the version supplies the runner's.
   */
  pythonRuntime?: string
  /** The workspace's parameter sets by key, for the file's `include:`. */
  sets?: Record<string, PipelineParameter[]>
}

const TOP_KEYS = [
  'pipeline',
  'version',
  'mode',
  'include',
  'starts',
  'description',
  'python_runtime',
  'python_requirements',
  'parameters',
  'inputs',
  'steps',
  'output',
  'outputs',
] as const

/** The pipeline's start rules; they belong to the pipeline, so a version does not store them. */
const START_KEYS: Names = {
  conditions_match: 'conditionsMatch',
  window: 'window',
  min_new_rows: 'minNewRows',
  wait_minutes: 'waitMinutes',
  missed_runs: 'missedRuns',
}

const WINDOW_KEYS: Names = {
  days: 'days',
  from: 'from',
  to: 'to',
  time_zone: 'timeZone',
}

type Names = Record<string, string>

/** File key to stored key, in the order the file writes them. */
const PARAMETER_KEYS: Names = {
  type: 'type',
  required: 'required',
  default: 'default',
  description: 'description',
}

const INPUT_KEYS: Names = {
  required: 'required',
  description: 'description',
  schema: 'schemaId',
}

const OUTPUT_KEYS: Names = {
  mode: 'mode',
  schema_version_id: 'schemaVersionId',
  dataset_id: 'datasetId',
  dataset_name: 'datasetName',
  dataset_label: 'datasetLabel',
  field_mapping: 'fieldMapping',
  from: 'from',
}

const ASK_KEYS: Names = {
  fields: 'fields',
  asked_user_ids: 'askedUserIds',
  skip_steps: 'skipSteps',
  no_answer: 'noAnswer',
  expires_hours: 'expiresHours',
}

const ACTION_KEYS: Names = {
  operation: 'operation',
  arguments: 'arguments',
  mode: 'mode',
  for_each: 'forEach',
}

const NOTIFY_KEYS: Names = {
  subscription_id: 'subscriptionId',
  payload: 'payload',
}

const PLUGIN_KEYS: Names = { operation: 'operation', arguments: 'arguments' }

/** A remote job: the connection and queue it goes to, the secret it is sent with, its script and its time limit. */
const REMOTE_KEYS: Names = {
  connection: 'connection',
  queue: 'queue',
  secret: 'secret',
  script: 'script',
  limit_minutes: 'limitMinutes',
}

/** Lakehouse SQL: the open tables it reads, then its statement. */
/** A web call: the connection, method and path it asks, the secret it is sent with, a body, and where the rows are in the answer. */
const WEB_KEYS: Names = {
  connection: 'connection',
  method: 'method',
  path: 'path',
  secret: 'secret',
  body: 'body',
  items: 'itemsPath',
}

const LAKE_KEYS: Names = { tables: 'tables', sql: 'statement' }

/** The keys of a step that are not its kind. */
const STEP_KEYS = ['id', 'note', 'only_if_rows', 'contract'] as const

/** The settings object of a step kind, with its key names. */
const KIND_OBJECTS: Partial<Record<PipelineStepKind, Names>> = {
  plugin: PLUGIN_KEYS,
  remote_job: REMOTE_KEYS,
  lakehouse: LAKE_KEYS,
  web_call: WEB_KEYS,
  ask: ASK_KEYS,
  action: ACTION_KEYS,
  notify: NOTIFY_KEYS,
}

const KIND_WORDS: Record<PipelineStepKind, string> = {
  filter: 'filter',
  join: 'join',
  calculate: 'calculate',
  check_ranges: 'check ranges',
  flag: 'flag',
  sql: 'SQL',
  python: 'Python',
  plugin: 'plugin',
  lakehouse: 'lakehouse',
  remote_job: 'remote job',
  web_call: 'web call',
  ask: 'ask a person',
  action: 'ELN action',
  notify: 'notify',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invert = (names: Names): Names =>
  Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]))

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]

    row[0] = i

    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]

      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = keep
    }
  }

  return row[b.length]
}

/** The known word closest to `word`, when it is near enough to be a typing slip. */
export function closest(word: string, known: readonly string[]): string | null {
  const limit = word.length <= 4 ? 1 : 2
  let best: string | null = null
  let bestDistance = limit + 1

  for (const candidate of known) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase())

    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }

  return best
}

// -- Locating ----------------------------------------------------------------

interface Place {
  line: number
  column: number
  length: number
}

function locator(doc: Document.Parsed, counter: LineCounter, text: string) {
  return (path: Path, target: 'key' | 'value' = 'value'): Place => {
    let node: unknown = doc.contents
    let key: unknown = null
    let found = 0

    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find(
          (item) => isScalar(item.key) && String(item.key.value) === segment,
        )

        if (!pair) break
        key = pair.key
        node = pair.value
      } else if (isSeq(node) && typeof segment === 'number') {
        const item = node.items.at(segment)

        if (item === undefined) break
        key = null
        node = item
      } else break

      found += 1
    }

    const withRange = (value: unknown): [number, number] | null =>
      typeof value === 'object' &&
      value !== null &&
      'range' in value &&
      Array.isArray(value.range) &&
      typeof value.range[0] === 'number' &&
      typeof value.range[1] === 'number'
        ? [value.range[0], value.range[1]]
        : null

    const range = (target === 'key' || !found ? withRange(key) : null) ??
      withRange(node) ??
      withRange(key) ?? [0, 0]

    const at = counter.linePos(range[0])
    const lineEnd = text.indexOf('\n', range[0])
    const end = Math.min(range[1], lineEnd === -1 ? text.length : lineEnd)

    return {
      line: at.line,
      column: at.col,
      length: Math.max(1, end - range[0]),
    }
  }
}

// -- Reading -----------------------------------------------------------------

interface Report {
  (
    path: Path,
    message: string,
    options?: { key?: boolean; suggest?: readonly string[]; word?: string },
  ): void
}

/** Rename the keys of a mapping from the file's names to the stored ones. */
function readKeys(
  value: unknown,
  names: Names,
  path: Path,
  report: Report,
  what: string,
): Record<string, unknown> | null {
  if (!isObject(value)) {
    report(
      path,
      t('features.pipelineVersionFile.problems.mustBeMapping', { what }),
    )

    return null
  }

  const out: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    const stored = names[key]

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- a name map is looked up by an arbitrary key a person typed.
    if (stored === undefined) {
      report(
        [...path, key],
        t('features.pipelineVersionFile.problems.unknownKey', { key, what }),
        {
          key: true,
          suggest: Object.keys(names),
          word: key,
        },
      )
      continue
    }

    out[stored] = entry
  }

  return out
}

/**
 * `include:` lists parameter sets by key. Their parameters join the version's
 * own (copied, so the version stands alone), and each entry remembers which
 * ones it brought in.
 */
function readIncludes(
  value: Record<string, unknown>,
  config: Record<string, unknown>,
  report: Report,
  sets: Record<string, PipelineParameter[]>,
): void {
  if (!('include' in value)) return

  if (!Array.isArray(value.include)) {
    report(['include'], t('features.pipelineVersionFile.problems.includeList'))

    return
  }

  const own = z
    .array(z.looseObject({ name: z.string() }))
    .safeParse(config.parameters)

  const taken = new Map<string, string>()

  for (const entry of own.success ? own.data : []) taken.set(entry.name, '')

  const include: Array<{ set: string; parameters: string[] }> = []
  const brought: unknown[] = []

  value.include.forEach((entry, index) => {
    const key = typeof entry === 'string' ? entry : ''
    const found = Object.hasOwn(sets, key) ? sets[key] : undefined

    if (!found) {
      report(
        ['include', index],
        t('features.pipelineVersionFile.problems.noSetCalled', {
          name: String(entry),
        }),
        { suggest: Object.keys(sets), word: String(entry) },
      )

      return
    }

    for (const parameter of found) {
      const before = taken.get(parameter.name)

      if (before !== undefined)
        report(
          ['include', index],
          t('features.pipelineVersionFile.problems.setParameterTaken', {
            name: parameter.name,
            where: before || 'the file',
          }),
        )

      taken.set(parameter.name, key)
    }

    include.push({ set: key, parameters: found.map((p) => p.name) })
    brought.push(...found)
  })

  config.include = include
  config.parameters = [
    ...brought,
    ...(Array.isArray(config.parameters) ? config.parameters : []),
  ]
}

/** `output:` is the one output; `outputs:` is a list of them, the first being the one a Standard pipeline shows. */
function readOutputs(
  value: Record<string, unknown>,
  config: Record<string, unknown>,
  report: Report,
): void {
  if ('output' in value && 'outputs' in value) {
    report(
      ['outputs'],
      t('features.pipelineVersionFile.problems.outputTwice'),
      { key: true },
    )

    return
  }

  if ('output' in value) {
    config.output =
      readKeys(value.output, OUTPUT_KEYS, ['output'], report, 'output') ??
      undefined

    return
  }

  if (!('outputs' in value)) return

  if (!Array.isArray(value.outputs) || value.outputs.length === 0) {
    report(
      ['outputs'],
      t('features.pipelineVersionFile.problems.outputsMustBeList'),
    )

    return
  }

  const read = value.outputs.map((entry, index) =>
    readKeys(entry, OUTPUT_KEYS, ['outputs', index], report, 'output'),
  )

  config.output = read[0] ?? undefined

  if (read.length > 1)
    config.moreOutputs = read.slice(1).filter((entry) => entry !== null)
}

function readStep(
  raw: unknown,
  index: number,
  ids: readonly string[],
  report: Report,
): Record<string, unknown> | null {
  const path: Path = ['steps', index]

  if (!isObject(raw)) {
    report(path, t('features.pipelineVersionFile.problems.stepMustBeMapping'))

    return null
  }

  const kinds = Object.keys(raw).filter((key) =>
    PIPELINE_STEP_KINDS.some((kind) => kind === key),
  )

  let typo = false

  for (const key of Object.keys(raw)) {
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- a step has a dozen keys at most.
    if (kinds.includes(key) || STEP_KEYS.some((known) => known === key))
      continue

    typo = true
    report(
      [...path, key],
      t('features.pipelineVersionFile.problems.unknownKey', {
        key,
        what: 'step',
      }),
      {
        key: true,
        suggest: [...STEP_KEYS, ...PIPELINE_STEP_KINDS],
        word: key,
      },
    )
  }

  if (kinds.length === 0) {
    // A mistyped kind is already reported where it is; the step is not also "empty".
    if (!typo)
      report(
        path,
        t('features.pipelineVersionFile.problems.stepNeedsKind', {
          kinds: PIPELINE_STEP_KINDS.join(', '),
        }),
      )

    return null
  }

  if (kinds.length > 1) {
    report(
      [...path, kinds[1]],
      t('features.pipelineVersionFile.problems.stepOneKind'),
      { key: true },
    )

    return null
  }

  const kind = PIPELINE_STEP_KINDS.find((known) => known === kinds[0])

  if (!kind) return null

  const step: Record<string, unknown> = { kind }

  if ('id' in raw) step.name = raw.id
  else report(path, t('features.pipelineVersionFile.problems.stepNeedsId'))

  if ('note' in raw) step.note = raw.note

  if ('only_if_rows' in raw) step.onlyIfRows = raw.only_if_rows

  const settings = raw[kind]
  const at: Path = [...path, kind]

  if (kind === 'sql' || kind === 'python') {
    step.statement = settings

    if ('contract' in raw && kind === 'python') step.contract = raw.contract
    else if ('contract' in raw)
      report(
        [...path, 'contract'],
        t('features.pipelineVersionFile.problems.contractOnlyPython'),
        { key: true },
      )
  } else if (isNoCodeKind(kind)) {
    const form = parseNoCodeForm(
      kind,
      z.json().safeParse(settings).data ?? null,
    )

    step.form = settings

    if (!form) {
      report(at, t('data.noCode.formInvalid'))
    } else {
      const made = noCodeStatement(kind, form)

      if (made.ok) step.statement = made.statement
      else report(at, made.reason)
    }

    if ('contract' in raw)
      report(
        [...path, 'contract'],
        t('features.pipelineVersionFile.problems.contractOnlyPython'),
        { key: true },
      )
  } else {
    const names = KIND_OBJECTS[kind]

    const read = names
      ? readKeys(settings, names, at, report, KIND_WORDS[kind])
      : null

    if (read && kind === 'remote_job') {
      step.remoteJob = read
    } else if (read && kind === 'web_call') {
      step.webCall = read
    } else if (read && kind === 'lakehouse') {
      step.statement = read.statement
      step.lake = { tables: read.tables }
    } else if (read) {
      step[kind] = read

      if (kind === 'ask' && Array.isArray(read.skipSteps)) {
        read.skipSteps.forEach((skip, n) => {
          // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- a skip list is a few names.
          if (typeof skip === 'string' && !ids.includes(skip))
            report(
              [...at, 'skip_steps', n],
              t('features.pipelineVersionFile.problems.noStepCalled', {
                name: skip,
              }),
              {
                suggest: ids,
                word: skip,
              },
            )
        })
      }
    }

    if ('contract' in raw)
      report(
        [...path, 'contract'],
        t('features.pipelineVersionFile.problems.contractOnlyPython'),
        { key: true },
      )
  }

  return step
}

/** `starts:` as the pipeline's start rules; mistakes are marked on the key that holds them. */
function readStarts(
  value: Record<string, unknown>,
  report: Report,
): StartRules | undefined {
  if (!('starts' in value)) return undefined

  const at: Path = ['starts']
  const read = readKeys(value.starts, START_KEYS, at, report, 'starts')

  if (!read) return undefined

  if (isObject(read.window)) {
    const window = readKeys(
      read.window,
      WINDOW_KEYS,
      [...at, 'window'],
      report,
      'window',
    )

    if (window) read.window = window
  }

  const parsed = startRulesSchema.safeParse(read)

  if (parsed.success) return parsed.data

  const fileNames: Record<string, string> = {
    ...invert(WINDOW_KEYS),
    ...invert(START_KEYS),
  }

  const fileKey = (stored: PropertyKey) =>
    typeof stored === 'string' ? (fileNames[stored] ?? stored) : String(stored)

  for (const issue of parsed.error.issues)
    report(
      [...at, ...issue.path.map(fileKey)],
      t('features.pipelineVersionFile.problems.startRule', {
        message: issue.message.toLowerCase(),
      }),
      { key: false },
    )

  return undefined
}

/** The map of named things as the list the stored version keeps. */
function readNamed(
  value: unknown,
  names: Names,
  path: Path,
  report: Report,
  what: string,
): Array<Record<string, unknown>> | null {
  if (!isObject(value)) {
    report(
      path,
      t('features.pipelineVersionFile.problems.mustBeMapping', {
        what: `${what}s`,
      }),
    )

    return null
  }

  const list: Array<Record<string, unknown>> = []

  for (const [name, entry] of Object.entries(value)) {
    const read = readKeys(entry, names, [...path, name], report, what)

    if (read) list.push({ name, ...read })
  }

  return list
}

// -- Mapping the validator's fields to the file ------------------------------

const SEGMENT = /([^.[\]]+)|\[(\d+)\]/g

function fieldSegments(field: string): Path {
  return [...field.matchAll(SEGMENT)].map((m) =>
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- an unmatched regex group is undefined at runtime.
    m[2] !== undefined ? Number(m[2]) : m[1],
  )
}

/** Where in the file a field of the stored version is written. */
function pathOfField(
  field: string,
  config: PipelineConfig,
  outputsList = false,
): Path {
  const [head, ...rest] = fieldSegments(field)
  const second = rest.at(0)

  const renamed = (names: Names, key: string | number | undefined) =>
    typeof key === 'string' ? (invert(names)[key] ?? key) : key

  switch (head) {
    case 'parameters':
    case 'inputs': {
      if (typeof second !== 'number') return [head]
      const list = head === 'parameters' ? config.parameters : config.inputs
      const name = list.at(second)?.name

      if (!name) return [head]
      const tail = rest.slice(1)
      const names = head === 'parameters' ? PARAMETER_KEYS : INPUT_KEYS

      if (tail[0] === 'name') return [head, name]

      return [
        head,
        name,
        ...[renamed(names, tail[0]), ...tail.slice(1)].filter(
          (s) => s !== undefined,
        ),
      ]
    }

    case 'steps': {
      if (typeof second !== 'number') return ['steps']
      const step = config.steps.at(second)
      const base: Path = ['steps', second]

      if (!step) return base
      const key = rest.at(1)
      const deeper = rest.slice(2)

      if (key === undefined) return base

      if (key === 'name') return [...base, 'id']

      if (key === 'note') return [...base, 'note']

      if (key === 'onlyIfRows') return [...base, 'only_if_rows']

      if (step.kind === 'lakehouse') {
        if (key === 'statement') return [...base, 'lakehouse', 'sql']

        if (key === 'lake') return [...base, 'lakehouse', 'tables']
      }

      if (step.kind === 'web_call' && key === 'webCall')
        return [
          ...base,
          'web_call',
          ...[renamed(WEB_KEYS, deeper[0]), ...deeper.slice(1)].filter(
            (s) => s !== undefined,
          ),
        ]

      if (step.kind === 'remote_job' && key === 'remoteJob')
        return [
          ...base,
          'remote_job',
          ...[renamed(REMOTE_KEYS, deeper[0]), ...deeper.slice(1)].filter(
            (s) => s !== undefined,
          ),
        ]

      if (key === 'kind' || key === 'statement') return [...base, step.kind]

      if (key === 'contract') return [...base, 'contract', ...deeper]

      if (key === 'form') return [...base, step.kind, ...deeper]

      const names = KIND_OBJECTS[step.kind]

      if (key === step.kind && names)
        return [
          ...base,
          step.kind,
          ...[renamed(names, deeper[0]), ...deeper.slice(1)].filter(
            (s) => s !== undefined,
          ),
        ]

      return [...base, step.kind]
    }

    case 'moreOutputs':
      return [
        'outputs',
        ...(typeof second === 'number' ? [second + 1] : []),
        ...[renamed(OUTPUT_KEYS, rest.at(1)), ...rest.slice(2)].filter(
          (s) => s !== undefined,
        ),
      ]
    case 'output':
      return [
        ...(outputsList ? ['outputs', 0] : ['output']),
        ...[renamed(OUTPUT_KEYS, second), ...rest.slice(1)].filter(
          (s) => s !== undefined,
        ),
      ]
    case 'description':
      return ['description']
    case 'pythonRuntime':
      return ['python_runtime']
    case 'pythonRequirements':
      return ['python_requirements', ...rest]
    case 'mode':
      return ['mode']
    default:
      return []
  }
}

// -- Checking ----------------------------------------------------------------

const EMPTY_FILE_LINES = 1

/** Read the file, build the version it says, check it, and say where each mistake is. */
export function checkVersionFile(
  text: string,
  target: VersionFileTarget = {},
): VersionFileResult {
  const counter = new LineCounter()
  const doc = parseDocument(text, { lineCounter: counter, uniqueKeys: true })
  const where = locator(doc, counter, text)
  const problems: FileProblem[] = []

  const lineCount = Math.max(
    EMPTY_FILE_LINES,
    text.replace(/\n$/, '').split('\n').length,
  )

  const outline = outlineOf(doc, counter, lineCount)

  const add = (place: Place, message: string, fix?: FileFix) => {
    if (
      !problems.some((p) => p.line === place.line && p.column === place.column)
    )
      problems.push({ ...place, message, fix })
  }

  for (const error of doc.errors) {
    const start = error.pos[0]
    const at = counter.linePos(start)
    const lineEnd = text.indexOf('\n', start)

    add(
      {
        line: at.line,
        column: at.col,
        length: Math.max(
          1,
          Math.min(error.pos[1], lineEnd === -1 ? text.length : lineEnd) -
            start,
        ),
      },
      error.message.split('\n')[0].replace(/\.$/, ''),
    )
  }

  if (doc.errors.length) return finish(problems, null, outline, lineCount)

  const report: Report = (path, message, options) => {
    const place = where(path, options?.key ? 'key' : 'value')

    const guess =
      options?.word && options.suggest
        ? closest(options.word, options.suggest)
        : null

    add(
      place,
      guess
        ? t('features.pipelineVersionFile.problems.didYouMean', {
            message,
            guess,
          })
        : message,
      guess
        ? {
            label: t('features.pipelineVersionFile.problems.changeTo', {
              to: guess,
            }),
            ...place,
            text: guess,
          }
        : undefined,
    )
  }

  const value: unknown = doc.toJS()

  if (!isObject(value)) {
    report(
      [],
      t('features.pipelineVersionFile.problems.mustBeMapping', {
        what: 'The file',
      }),
    )

    return finish(problems, null, outline, lineCount)
  }

  for (const key of Object.keys(value)) {
    if (TOP_KEYS.some((known) => known === key)) continue

    report(
      [key],
      t('features.pipelineVersionFile.problems.unknownKey', {
        key,
        what: 'file',
      }),
      {
        key: true,
        suggest: TOP_KEYS,
        word: key,
      },
    )
  }

  const names = target.pipeline?.filter(Boolean) ?? []

  if (names.length) {
    if (typeof value.pipeline !== 'string')
      report(
        [],
        t('features.pipelineVersionFile.problems.needsPipeline', {
          name: names[0],
        }),
      )
    else if (
      !names.some(
        (n) => n.toLowerCase() === String(value.pipeline).toLowerCase(),
      )
    )
      report(
        ['pipeline'],
        t('features.pipelineVersionFile.problems.otherPipeline', {
          name: names[0],
          found: String(value.pipeline),
        }),
      )
  }

  if ('mode' in value && value.mode !== 'advanced')
    report(['mode'], t('features.pipelineVersionFile.problems.modeAdvanced'))

  if (
    value.version !== undefined &&
    value.version !== null &&
    !Number.isInteger(value.version)
  )
    report(
      ['version'],
      t('features.pipelineVersionFile.problems.versionNumber'),
    )

  const ids = Array.isArray(value.steps)
    ? value.steps.map((s) =>
        isObject(s) && typeof s.id === 'string' ? s.id : '',
      )
    : []

  const config: Record<string, unknown> = {
    configVersion: 2,
    mode: 'advanced',
    description: value.description,
    pythonRuntime: value.python_runtime,
    pythonRequirements: value.python_requirements,
    parameters:
      'parameters' in value
        ? (readNamed(
            value.parameters,
            PARAMETER_KEYS,
            ['parameters'],
            report,
            'parameter',
          ) ?? [])
        : [],
    inputs:
      'inputs' in value
        ? (readNamed(value.inputs, INPUT_KEYS, ['inputs'], report, 'input') ??
          [])
        : [],
    output: { mode: 'none', datasetLabel: '' },
  }

  const startRules = readStarts(value, report)

  readOutputs(value, config, report)
  readIncludes(value, config, report, target.sets ?? {})

  if (!Array.isArray(value.steps)) {
    if ('steps' in value)
      report(
        ['steps'],
        t('features.pipelineVersionFile.problems.stepsMustBeList'),
      )
    else report([], t('features.pipelineVersionFile.problems.needsSteps'))

    config.steps = []
  } else {
    config.steps = value.steps
      .map((raw, index) => readStep(raw, index, ids, report))
      .filter((step) => step !== null)
  }

  for (const key of ['description', 'pythonRuntime', 'pythonRequirements'])
    if (config[key] === undefined) delete config[key]

  const built = z.custom<PipelineConfig>().safeParse(config)

  if (
    built.success &&
    built.data.pythonRuntime === undefined &&
    target.pythonRuntime &&
    built.data.steps.some((step) => step.kind === 'python')
  )
    built.data.pythonRuntime = target.pythonRuntime

  // The file is only a version when every part of it could be read.
  if (!built.success || problems.length)
    return finish(problems, null, outline, lineCount)

  for (const error of validatePipelineConfig(built.data)) {
    let path = pathOfField(error.field, built.data, 'outputs' in value)

    // The pin is not in the file: the first Python step is what needs it.
    if (error.field === 'pythonRuntime' && value.python_runtime === undefined) {
      // react-doctor-disable-next-line react-doctor/js-index-maps -- one lookup per python-capable error; the lists are a handful of steps.
      const first = built.data.steps.findIndex((s) => s.kind === 'python')

      path = ['steps', first, 'python']
    }

    add(
      where(path, error.field.endsWith('.name') ? 'key' : 'value'),
      error.message,
    )
  }

  const result = finish(
    problems,
    problems.length ? null : built.data,
    outline,
    lineCount,
  )

  if (result.config && startRules) result.startRules = startRules

  return result
}

function finish(
  problems: FileProblem[],
  config: PipelineConfig | null,
  outline: OutlineItem[],
  lineCount: number,
): VersionFileResult {
  return {
    config,
    problems: [...problems].sort(
      (a, b) => a.line - b.line || a.column - b.column,
    ),
    outline,
    lineCount,
  }
}

// -- Outline -----------------------------------------------------------------

const SECTIONS: Record<string, string> = {
  include: 'Includes',
  starts: 'Starts',
  parameters: 'Parameters',
  inputs: 'Inputs',
  steps: 'Steps',
  output: 'Output',
  outputs: 'Outputs',
}

function outlineOf(
  doc: Document.Parsed,
  counter: LineCounter,
  lineCount: number,
): OutlineItem[] {
  const root = doc.contents

  if (!isMap(root)) return []

  const line = (node: unknown): number => {
    const range =
      typeof node === 'object' &&
      node !== null &&
      'range' in node &&
      Array.isArray(node.range)
        ? node.range
        : null

    return typeof range?.[0] === 'number' ? counter.linePos(range[0]).line : 1
  }

  const items: OutlineItem[] = []
  const pairs = root.items.filter((pair) => isScalar(pair.key))

  pairs.forEach((pair, index) => {
    const key = isScalar(pair.key) ? String(pair.key.value) : ''
    const label = SECTIONS[key]

    if (!label) return
    const start = line(pair.key)
    const next = pairs.at(index + 1)
    const endLine = next ? line(next.key) - 1 : lineCount
    const value = pair.value

    const count = isMap(value)
      ? value.items.length
      : isSeq(value)
        ? value.items.length
        : undefined

    items.push({
      label,
      count: key === 'output' ? undefined : count,
      line: start,
      endLine,
      depth: 0,
    })

    if (key === 'steps' && isSeq(value)) {
      value.items.forEach((step, n) => {
        if (!isMap(step)) return
        const after = value.items.at(n + 1)
        const id = step.get('id')
        const kind = PIPELINE_STEP_KINDS.find((k) => step.has(k))

        items.push({
          label: typeof id === 'string' ? id : `step ${n + 1}`,
          kind: kind ? KIND_WORDS[kind] : undefined,
          line: line(step),
          endLine: after ? line(after) - 1 : endLine,
          depth: 1,
        })
      })
    }
  })

  return items
}

// -- Writing -----------------------------------------------------------------

function writeKeys(value: unknown, names: Names): unknown {
  if (!isObject(value)) return value
  const stored = invert(names)
  const out: Record<string, unknown> = {}

  // The file's order, not the order the version happened to be saved in.
  for (const [fileKey, storedKey] of Object.entries(names))
    if (value[storedKey] !== undefined && value[storedKey] !== null)
      out[fileKey] = value[storedKey]

  for (const [key, entry] of Object.entries(value))
    if (!(key in stored) && entry !== undefined && entry !== null)
      out[key] = entry

  return out
}

/** The rules that differ from the defaults, in the file's words; null when there are none. */
function writeStarts(rules: StartRules): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}

  if (rules.conditionsMatch !== DEFAULT_START_RULES.conditionsMatch)
    out.conditions_match = rules.conditionsMatch

  if (rules.window) out.window = writeKeys(rules.window, WINDOW_KEYS)

  if (rules.minNewRows !== null) out.min_new_rows = rules.minNewRows

  if (rules.waitMinutes !== DEFAULT_START_RULES.waitMinutes)
    out.wait_minutes = rules.waitMinutes

  if (rules.missedRuns !== DEFAULT_START_RULES.missedRuns)
    out.missed_runs = rules.missedRuns

  return Object.keys(out).length ? out : null
}

function writeNamed(list: ReadonlyArray<{ name: string }>, names: Names) {
  return Object.fromEntries(
    list.map(({ name, ...rest }) => [name, writeKeys(rest, names)]),
  )
}

function writeStep(
  step: PipelineConfig['steps'][number],
): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...step }
  const entry: Record<string, unknown> = { id: step.name }

  if (step.note) entry.note = step.note

  if (raw.onlyIfRows === true) entry.only_if_rows = true

  switch (step.kind) {
    case 'sql':
    case 'python':
      entry[step.kind] = step.statement

      if (step.kind === 'python' && step.contract)
        entry.contract = step.contract
      break
    case 'plugin':
      entry.plugin = writeKeys(step.plugin, PLUGIN_KEYS)
      break
    case 'remote_job':
      entry.remote_job = writeKeys(step.remoteJob, REMOTE_KEYS)
      break
    case 'web_call':
      entry.web_call = writeKeys(step.webCall, WEB_KEYS)
      break
    case 'lakehouse':
      entry.lakehouse = writeKeys(
        { tables: step.lake.tables, statement: step.statement },
        LAKE_KEYS,
      )
      break
    case 'ask':
      entry.ask = writeKeys(step.ask, ASK_KEYS)
      break
    case 'action':
      entry.action = writeKeys(step.action, ACTION_KEYS)
      break
    case 'notify':
      entry.notify = writeKeys(step.notify, NOTIFY_KEYS)
      break
    default:
      entry[step.kind] = step.form
  }

  return entry
}

/** The version as file text. Reading it again gives the same version. */
export function versionFileText(
  config: PipelineConfig,
  meta: VersionFileMeta,
): string {
  const body: Record<string, unknown> = {
    pipeline: meta.pipeline,
    version: meta.version ?? undefined,
    mode: config.mode,
    include: config.include?.length
      ? config.include.map((i) => i.set)
      : undefined,
    description: config.description || undefined,
    python_requirements: config.pythonRequirements?.length
      ? config.pythonRequirements
      : undefined,
  }

  const included = new Set((config.include ?? []).flatMap((i) => i.parameters))
  const own = config.parameters.filter((p) => !included.has(p.name))

  if (own.length) body.parameters = writeNamed(own, PARAMETER_KEYS)

  if (config.inputs.length) body.inputs = writeNamed(config.inputs, INPUT_KEYS)

  const starts = meta.startRules ? writeStarts(meta.startRules) : null

  if (starts) body.starts = starts

  body.steps = config.steps.map(writeStep)

  if (config.moreOutputs?.length)
    body.outputs = [config.output, ...config.moreOutputs].map((output) =>
      writeKeys(output, OUTPUT_KEYS),
    )
  else body.output = writeKeys(config.output, OUTPUT_KEYS)

  const doc = new Document(body)

  if (meta.title && isMap(doc.contents))
    doc.contents.commentBefore = ` ${meta.title}`

  if (meta.versionNote && meta.version != null && isMap(doc.contents)) {
    const version = doc.contents.items.find(
      (pair) => isScalar(pair.key) && pair.key.value === 'version',
    )

    if (version && isScalar(version.value))
      version.value.comment = ` ${meta.versionNote}`
  }

  flowSmallMaps(doc, ['parameters', 'inputs'])

  return doc.toString({ lineWidth: 0 })
}

/** A parameter or input that is a few plain values reads best on one line. */
function flowSmallMaps(doc: Document, keys: string[]) {
  const root = doc.contents

  if (!isMap(root)) return

  for (const key of keys) {
    const section = root.get(key, true)

    if (!isMap(section)) continue

    for (const pair of section.items) {
      const entry = pair.value

      if (
        isMap(entry) &&
        entry.items.length <= 4 &&
        entry.items.every(
          (p) => isScalar(p.value) && scalarText(p.value.value).length < 40,
        )
      )
        entry.flow = true
    }
  }
}

/** The file written tidily: the same text and comments, laid out the one way. Unreadable text is left alone. */
export function formatVersionFile(text: string): string {
  const doc = parseDocument(text, { uniqueKeys: true })

  return doc.errors.length ? text : doc.toString({ lineWidth: 0 })
}

/** The text with a fix applied. */
export function applyFix(text: string, fix: FileFix): string {
  const lines = text.split('\n')

  const before = lines
    .slice(0, fix.line - 1)
    .reduce((sum, l) => sum + l.length + 1, 0)

  const start = before + fix.column - 1

  return text.slice(0, start) + fix.text + text.slice(start + fix.length)
}

/** Offset of the start of a 1-based line. */
export function lineOffset(text: string, line: number): number {
  return text
    .split('\n')
    .slice(0, line - 1)
    .reduce((sum, l) => sum + l.length + 1, 0)
}

/** A scalar's value as the text it shows. */
function scalarText(value: unknown): string {
  return value === null || value === undefined ? '' : JSON.stringify(value)
}
