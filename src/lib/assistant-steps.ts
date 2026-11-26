import { z } from 'zod'

import { t } from '#/copy'

import { cardAction } from './assistant-card-actions'
import { WORKSPACE_TOOL_NAME } from './assistant-workspace'

/**
 * What the assistant's step list says for each tool call.
 *
 * Every tool has its own wording, built from the tool and the arguments the
 * model gave it: "Opened sample SMP-0042", "Searched protocols for “PicoGreen”".
 * There is no generic fallback; `assistant-steps.test.ts` fails when a tool the
 * assistant can call has no entry here, so a new tool cannot ship without one.
 *
 * Steps are plain data (`StepWords`) first and text second, so that several
 * steps in a row can be said as one line ("Searched protocols, templates and
 * the workspace for “PicoGreen” (4 searches)") with each step still there to
 * expand.
 */

export type StepState = 'running' | 'done' | 'failed'

type Verb =
  | 'open'
  | 'read'
  | 'search'
  | 'lookup'
  | 'check'
  | 'find'
  | 'run'
  | 'convert'
  | 'use'
  | 'prepare'

/** Steps of one family that follow each other are said as one line. */
type Family = 'search' | 'lookup' | 'open'

export interface StepWords {
  verb: Verb
  /** What the step touched, as a plain noun phrase: "protocols", "sample". */
  noun: string
  /** The record's identifier, shown after the noun and linked by the row. */
  ref?: string
  /** The words searched for, already quoted. */
  term?: string
  /** A condition the lookup applied, such as "status is open". */
  where?: string
  family?: Family
  /** Show the records the result named under the step. */
  lists?: boolean
  /** The step is about one record the result names, when the call didn't. */
  refFromResult?: boolean
}

/** What the browser knows about one call: its input and, once back, its result. */
export interface StepCall {
  toolName: string
  input: unknown
  state: StepState
  /** Identifiers of the records the result named. */
  refs?: readonly string[]
  /** Why the call failed, in the words the tool gave. */
  error?: string
}

const bag = z.record(z.string(), z.json())

type Args = Record<string, z.core.util.JSONType>

const argsOf = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- See StepCall.input.
  input: unknown,
): Args => bag.safeParse(input).data ?? {}

const stringArg = (args: Args, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = z.string().trim().min(1).safeParse(args[key]).data

    if (value) return value
  }

  return undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A name or identifier the model passed, when it is not a bare row id. */
const nameArg = (args: Args, ...keys: string[]): string | undefined => {
  const value = stringArg(args, ...keys)

  return value && !UUID.test(value) ? value.slice(0, 60) : undefined
}

const quoted = (value: string | undefined): string | undefined =>
  value ? `“${value.slice(0, 40)}”` : undefined

const humane = (value: string): string => value.replaceAll('_', ' ')

const termOf = (args: Args): string | undefined =>
  quoted(stringArg(args, 'query', 'contains', 'name', 'search', 'text'))

/** "status is open, kind is sample" from an equality-filter object. */
const whereOf = (args: Args): string | undefined => {
  const filters = z.record(z.string(), z.string()).safeParse(args.filters).data

  if (!filters) return undefined

  const parts = Object.entries(filters)
    .slice(0, 3)
    .map(([key, value]) => `${humane(key)} is ${value.slice(0, 40)}`)

  return parts.length > 0 ? parts.join(' and ') : undefined
}

/** The record a call names, by identifier when it gave one. */
const recordArg = (args: Args, ...keys: string[]): string | undefined =>
  nameArg(args, ...(keys.length > 0 ? keys : ['record', 'recordId']))

type Spec = (args: Args) => StepWords

const search = (noun: string, term?: (args: Args) => string | undefined) =>
  ((args) => ({
    verb: 'search',
    noun,
    term: (term ?? termOf)(args),
    family: 'search',
    lists: true,
  })) satisfies Spec

const lookupArea = (fallback: string) =>
  ((args) => {
    const area = stringArg(args, 'area', 'resource')

    return {
      verb: 'lookup',
      noun: `${args.openOnly === true ? 'open ' : ''}${area ? humane(area) : fallback}`,
      term: termOf(args),
      where: whereOf(args),
      family: 'lookup',
      lists: true,
    }
  }) satisfies Spec

const open = (noun: string, ...keys: string[]) =>
  ((args) => ({
    verb: 'open',
    noun,
    ref: recordArg(args, ...keys),
    family: 'open',
    refFromResult: true,
  })) satisfies Spec

const about = (verb: Verb, noun: string, ...keys: string[]) =>
  ((args) => ({
    verb,
    noun,
    ref: recordArg(args, ...keys),
    refFromResult: true,
  })) satisfies Spec

const plain = (verb: Verb, noun: string) =>
  (() => ({ verb, noun })) satisfies Spec

/** Every tool the assistant reads with, by name. */
const READ_SPECS = {
  'sheetbase.context.assemble': (args) => {
    const refs = z
      .array(z.looseObject({ kind: z.string() }))
      .safeParse(args.objectRefs).data

    const kinds = [...new Set((refs ?? []).map((ref) => humane(ref.kind)))]

    return {
      verb: 'read',
      noun: kinds.length === 1 ? (kinds[0] ?? 'page') : 'this page',
      refFromResult: kinds.length === 1,
    }
  },
  'sheetbase.canonical.read': lookupArea('the workspace'),
  'sheetbase.search': search('the workspace'),
  'sheetbase.search.semantic': search('the lab’s work by meaning'),
  'sheetbase.literature.search': search('published papers'),
  'sheetbase.storage.readings': (args) => ({
    verb: 'check',
    noun:
      args.outOfRangeOnly === true
        ? 'out-of-range freezer and room readings'
        : 'freezer and room readings',
  }),
  'sheetbase.dataset_rows.query': about('read', 'rows of dataset', 'datasetId'),
  'sheetbase.dataset_version_rows.query': about(
    'read',
    'rows of a saved version of dataset',
    'datasetId',
  ),
  'sheetbase.sheet_instance_rows.query': about(
    'read',
    'rows of sheet',
    'instanceId',
  ),
  'sheetbase.guide': (args) => ({
    verb: 'check',
    noun: 'the Sheetbase guide',
    term: quoted(stringArg(args, 'topic', 'resource', 'name')),
  }),
  [WORKSPACE_TOOL_NAME]: (args) => {
    const pages = z
      .array(
        z.looseObject({
          route: z.string(),
          title: z.string().optional(),
        }),
      )
      .safeParse(args.pages).data

    const names = (pages ?? []).map((page) => page.title ?? humane(page.route))

    return {
      verb: 'open',
      noun: `${names.length > 0 ? names.join(', ') : 'pages'} in your workspace`,
    }
  },
  'sheetbase.schedule.read': (args) => ({
    verb: 'read',
    noun: args.mine === true ? 'your bookings' : 'the schedule',
    term: quoted(nameArg(args, 'instrument')),
  }),
  'sheetbase.schedule.free_time': (args) => ({
    verb: 'find',
    noun: 'free time',
    term: quoted(nameArg(args, 'instrument')),
  }),
  'sheetbase.lab.list': lookupArea('the lab'),
  'sheetbase.facility.report': (args) => ({
    verb: 'read',
    noun: `${stringArg(args, 'report') ?? 'spend and usage'} report`,
    term: quoted(
      stringArg(args, 'period') === undefined
        ? undefined
        : humane(stringArg(args, 'period') ?? ''),
    ),
  }),
  'sheetbase.inbox.read': plain('check', 'what is waiting on you'),
  'sheetbase.steps.read': about('read', 'steps of experiment'),
  'sheetbase.series.read': about('read', 'series of experiment'),
  'sheetbase.parts.read': about('read', 'parts of experiment'),
  'sheetbase.gates.read': about('check', 'what holds back experiment'),
  'sheetbase.protocol.read': (args) =>
    'recordId' in args
      ? open('protocol', 'recordId')(args)
      : search('protocols')(args),
  'sheetbase.protocols.read': open('protocol', 'protocol'),
  'sheetbase.record.read': open('record', 'record'),
  'sheetbase.assistant.created': plain(
    'read',
    'what the assistant made in earlier chats',
  ),
  'sheetbase.stock.read': search('stock'),
  'sheetbase.template.list': search('templates'),
  'sheetbase.templates.read': open('template', 'template'),
  'sheetbase.models.read': open('record model', 'model'),
  'sheetbase.sheet_definitions.read': open('sheet layout', 'definition'),
  'sheetbase.model.dependencies': about(
    'check',
    'what depends on record model',
    'model',
  ),
  'sheetbase.agents.list': lookupArea('agent activity'),
  'sheetbase.ai_preferences.list': plain('read', 'the saved assistant notes'),
  'sheetbase.changes.recent': plain('read', 'recent changes'),
  'sheetbase.attachment.read': (args) => ({
    verb: 'read',
    noun: 'the attached file',
    term: quoted(stringArg(args, 'file')),
  }),
  'sheetbase.measurement_table.query': (args) => ({
    verb: 'lookup',
    noun: `measurement table ${nameArg(args, 'table') ?? ''}`.trim(),
    ref: recordArg(args, 'record'),
    where: stringArg(args, 'where'),
    lists: true,
  }),
  'sheetbase.comments.read': about('read', 'comments on', 'record'),
  'sheetbase.files.read': (args) => ({
    verb: 'search',
    noun: 'files',
    term: quoted(stringArg(args, 'name', 'contains')),
    family: 'search',
    lists: true,
  }),
  'sheetbase.approvals.read': (args) => ({
    verb: 'lookup',
    noun: `${stringArg(args, 'state') ?? ''} approvals`.trim(),
    family: 'lookup',
  }),
  'sheetbase.pipeline_connections.list': lookupArea('pipeline connections'),
  'sheetbase.pipeline_remote.read': lookupArea('remote pipeline data'),
  'sheetbase.projects.read': lookupArea('projects'),
  'sheetbase.workspace.read': lookupArea('the workspace'),
  'sheetbase.record_results.read': about('read', 'results of', 'record'),
  'sheetbase.analysis.run': (args) => ({
    verb: 'run',
    noun: `${stringArg(args, 'kind') ?? 'an'} analysis on dataset`,
    ref: recordArg(args, 'dataset'),
    refFromResult: true,
  }),
  'sheetbase.units.convert': (args) => ({
    verb: 'convert',
    noun: [
      stringArg(args, 'value'),
      stringArg(args, 'from'),
      'to',
      stringArg(args, 'to'),
    ]
      .filter(Boolean)
      .join(' '),
  }),
  'sheetbase.tools.find': (args) => ({
    verb: 'find',
    noun: 'a tool',
    term: quoted(stringArg(args, 'query')),
  }),
  'plugin.protocols-io.search': (args) => ({
    verb: 'search',
    noun: 'protocols.io',
    term: termOf(args),
    family: 'search',
    lists: true,
  }),
  'plugin.protocols-io.read': plain('read', 'a protocol on protocols.io'),
  'plugin.protocols-io.import': plain('read', 'a protocol on protocols.io'),
} satisfies Record<string, Spec>

const READ_STEPS = new Map<string, Spec>(Object.entries(READ_SPECS))

/** A tool's last name part is what it does; the rest is what it does it to. */
const proposalAction = (name: string): string => {
  const parts = name.split('.').slice(1)
  const action = humane(parts.at(-1) ?? '')
  const noun = humane(parts.slice(0, -1).join(' '))

  return noun ? `${action} ${noun}` : action
}

/** Plug-in tools are `plugin.<plug-in>.<tool>`. */
const PLUGIN_TOOL = /^plugin\.([^.]+)\.(.+)$/

/** The names that have a hand-written reading, for the guard test. */
export const READ_STEP_TOOLS: readonly string[] = [...READ_STEPS.keys()]

/** What a change-proposing tool does, as it would follow "a card to". */
export { proposalAction }

/** The wording for one call. Calls to a change-proposing tool say what card they prepare. */
export function stepWords(call: StepCall): StepWords {
  const args = argsOf(call.input)
  const spec = READ_STEPS.get(call.toolName)

  if (spec) {
    const words = spec(args)

    // A lookup that took a bare row id names the record once the result does.
    return words.refFromResult && !words.ref && call.refs?.[0]
      ? { ...words, ref: call.refs[0] }
      : words
  }

  const plugin = PLUGIN_TOOL.exec(call.toolName)

  if (plugin) {
    return {
      verb: 'use',
      noun: t('notebook.assistantPanel.step.pluginObject', {
        tool: humane(plugin[2]),
        plugin: humane(plugin[1]),
      }),
    }
  }

  return {
    verb: 'prepare',
    noun: t('notebook.assistantPanel.step.cardObject', {
      action: cardAction(call.toolName) ?? proposalAction(call.toolName),
    }),
    ref:
      recordArg(args, 'record', 'recordId', 'sample', 'experiment') ??
      call.refs?.[0],
  }
}

const verbWords = (verb: Verb) => ({
  past: t(`notebook.assistantPanel.step.verbs.${verb}.past`),
  ing: t(`notebook.assistantPanel.step.verbs.${verb}.ing`),
  base: t(`notebook.assistantPanel.step.verbs.${verb}.base`),
})

const objectOf = (words: StepWords): string =>
  words.ref ? `${words.noun} ${words.ref}` : words.noun

/** The object with what was searched for or filtered on: "protocols for “PicoGreen”". */
function objectWith(object: string, words: StepWords): string {
  if (words.term) {
    return t('notebook.assistantPanel.step.objectFor', {
      object,
      term: words.term,
    })
  }

  return words.where
    ? t('notebook.assistantPanel.step.objectWhere', {
        object,
        term: words.where,
      })
    : object
}

/** One step as a sentence. Identifiers in it are linked by the row. */
export function stepLine(words: StepWords, state: StepState): string {
  return t('notebook.assistantPanel.step.line', {
    verb: verbWords(words.verb)[state === 'running' ? 'ing' : 'past'],
    object: objectWith(objectOf(words), words),
  })
}

/** What went wrong, as the tool said it, in a form that follows a colon. */
function reasonOf(error: string | undefined): string {
  const text = error?.trim().replace(/\.$/, '')

  if (!text) return t('notebook.assistantPanel.step.reasonFallback')

  return /^[A-Z][a-z]/.test(text)
    ? `${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text
}

/** A failed step: what it could not do, and why. */
export function failedLine(words: StepWords, error: string | undefined) {
  return t('notebook.assistantPanel.step.failed', {
    verb: verbWords(words.verb).base,
    object: objectWith(objectOf(words), words),
    reason: reasonOf(error),
  })
}

/** The wording and the sentence for one call in whatever state it is in. */
export function callLine(call: StepCall): string {
  const words = stepWords(call)

  return call.state === 'failed'
    ? failedLine(words, call.error)
    : stepLine(words, call.state)
}

const listFormat = new Intl.ListFormat('en-GB', {
  style: 'long',
  type: 'conjunction',
})

const list = (items: readonly string[]): string => listFormat.format(items)

const plural = (noun: string): string =>
  noun.endsWith('s') ? noun : `${noun}s`

const unique = (items: readonly string[]): string[] => [...new Set(items)]

/** Calls that follow each other and read alike, said as one line. */
export function mergedLine(steps: readonly StepWords[]): string {
  const first = steps.at(0)

  if (!first) return ''

  const byNoun = new Map<string, string[]>()

  for (const step of steps) {
    byNoun.set(step.noun, [
      ...(byNoun.get(step.noun) ?? []),
      ...(step.ref ? [step.ref] : []),
    ])
  }

  const objects = [...byNoun.entries()].map(([noun, refs]) => {
    const distinct = unique(refs)

    if (distinct.length === 0) return noun

    return `${distinct.length > 1 ? plural(noun) : noun} ${list(distinct)}`
  })

  const terms = unique(steps.flatMap((step) => (step.term ? [step.term] : [])))

  const wheres = unique(
    steps.flatMap((step) => (step.where ? [step.where] : [])),
  )

  const withTerms = (object: string): string => {
    if (terms.length > 0) {
      return t('notebook.assistantPanel.step.objectFor', {
        object,
        term: list(terms),
      })
    }

    return wheres.length > 0
      ? t('notebook.assistantPanel.step.objectWhere', {
          object,
          term: list(wheres),
        })
      : object
  }

  const line = t('notebook.assistantPanel.step.line', {
    verb: verbWords(first.verb).past,
    object: withTerms(list(objects)),
  })

  if (first.family !== 'search' && first.family !== 'lookup') return line

  return t('notebook.assistantPanel.step.merged', {
    line,
    count: t(`notebook.assistantPanel.step.mergedUnit.${first.family}`, {
      count: steps.length,
    }),
  })
}

/** Can these two steps be said together? */
export function sameFamily(a: StepWords, b: StepWords): boolean {
  return a.family !== undefined && a.family === b.family && a.verb === b.verb
}

/** What a finished lookup found, as "Found SMP-0042, SMP-0043 and 3 more". */
export function foundLine(refs: readonly string[], shown = 4): string | null {
  if (refs.length === 0) return null

  const head = refs.slice(0, shown)

  return refs.length > shown
    ? t('notebook.assistantPanel.step.foundMore', {
        refs: head.join(', '),
        count: refs.length - shown,
      })
    : t('notebook.assistantPanel.step.found', { refs: list(head) })
}

/** One line in the list: a single call, or several that read alike. */
export interface StepItem {
  calls: StepCall[]
  words: StepWords[]
}

/**
 * The calls of one answer as list lines. Finished calls of one family that
 * follow each other become one item; a running or failed call always stands
 * alone, so what is happening and what went wrong stay in view.
 */
export function groupSteps(calls: readonly StepCall[]): StepItem[] {
  const items: StepItem[] = []

  for (const call of calls) {
    const words = stepWords(call)
    const last = items.at(-1)
    const previous = last?.words.at(-1)

    const joins =
      call.state === 'done' &&
      last !== undefined &&
      previous !== undefined &&
      last.calls.every((earlier) => earlier.state === 'done') &&
      sameFamily(previous, words)

    if (joins) {
      last.calls.push(call)
      last.words.push(words)
    } else {
      items.push({ calls: [call], words: [words] })
    }
  }

  return items
}

/** The sentence for an item: one call as itself, several as one merged line. */
export function itemLine(item: StepItem): string {
  const call = item.calls.at(0)
  const words = item.words.at(0)

  if (!call || !words) return ''

  return item.calls.length > 1 ? mergedLine(item.words) : callLine(call)
}
