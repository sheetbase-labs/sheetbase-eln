import type { ProviderToolDef } from './ai-providers/types'

/**
 * Which of the assistant's tools go to the model on a step.
 *
 * The full set is hundreds of definitions, which is most of a request's
 * size. A step offers only a small always-on core plus the tools whose
 * subject the person mentioned, and the model can ask for more with the
 * find-tools tool. Running a tool is never limited by this: it only decides
 * what is sent.
 */

export const FIND_TOOLS_NAME = 'sheetbase__tools__find'

/** Always sent: the lookups every question can start from. */
const CORE_TOOLS: ReadonlySet<string> = new Set([
  FIND_TOOLS_NAME,
  'sheetbase__canonical__read',
  'sheetbase__search',
  'sheetbase__guide',
  'sheetbase__workspace__open',
  'sheetbase__lab__list',
  // Dependent changes travel as one plan card, so the model must always be able to reach it.
  'sheetbase__plan__propose',
  'sheetbase__record__read',
  'sheetbase__assistant__created',
])

/** Most tools sent on top of the core. */
export const MAX_SELECTED_TOOLS = 12

/** Most tools one find-tools call adds. */
export const MAX_FOUND_TOOLS = 12

/** Name parts that say what a tool does, not what it is about. */
const ACTION_WORDS: ReadonlySet<string> = new Set([
  'read',
  'list',
  'get',
  'set',
  'add',
  'remove',
  'delete',
  'update',
  'create',
  'draft',
  'new',
  'open',
  'start',
  'move',
  'mark',
  'save',
  'sheetbase',
  'by',
  'to',
  'of',
  'and',
  'the',
  'for',
  'with',
])

/** Everyday words that point at a tool's subject. */
const SYNONYM_TABLE = {
  book: ['booking', 'schedule', 'instrument'],
  free: ['schedule', 'booking'],
  calendar: ['schedule'],
  order: ['reagent', 'shipment'],
  stock: ['reagent', 'stocktake', 'storage'],
  freezer: ['storage', 'sample'],
  box: ['storage', 'sample'],
  aliquot: ['sample'],
  plate: ['plate', 'worklist', 'robot'],
  assay: ['series', 'plate', 'study'],
  result: ['dataset', 'step', 'measurement'],
  data: ['dataset', 'measurement'],
  table: ['dataset', 'measurement', 'model'],
  row: ['dataset'],
  column: ['model', 'dataset'],
  field: ['model'],
  notebook: ['notebook', 'record', 'block'],
  analyse: ['dataset', 'analysis', 'plugin'],
  analysis: ['dataset', 'analysis', 'plugin'],
  code: ['notebook', 'plugin'],
  who: ['member', 'group'],
  user: ['member', 'group', 'invitation'],
  people: ['member', 'group'],
  access: ['group', 'project', 'member'],
  share: ['project', 'group'],
  broken: ['incident', 'instrument'],
  repair: ['instrument', 'incident'],
  paper: ['semantic'],
  todo: ['inbox'],
  task: ['inbox', 'step', 'planner'],
  plan: ['planner', 'experiment'],
  template: ['template', 'experiment', 'protocol'],
  method: ['protocol'],
  sop: ['protocol'],
  approve: ['approval'],
  review: ['approval', 'comment'],
  signature: ['approval'],
  pipeline: ['pipeline', 'run'],
  report: ['report', 'dataset'],
  qc: ['qc', 'series'],
  quality: ['qc'],
  hold: ['legal_hold', 'retention', 'blocker'],
  delete: ['retention', 'legal_hold'],
  label: ['label_template'],
  print: ['label_template'],
  // A new reagent, buffer or standard is a record of the material kind.
  material: ['material', 'record'],
  reagent: ['reagent', 'record'],
  buffer: ['reagent', 'record'],
  standard: ['record'],
  consumable: ['record'],
  link: ['record'],
  milestone: ['part', 'gate'],
  // "Why" questions: what stops a record, what is left, why it is flagged.
  why: ['blocker'],
  stop: ['blocker'],
  stopping: ['blocker'],
  block: ['blocker'],
  blocking: ['blocker'],
  blocked: ['blocker'],
  submit: ['blocker', 'approval'],
  submitted: ['blocker', 'approval'],
  ready: ['blocker'],
  readiness: ['blocker'],
  flag: ['blocker', 'dataset'],
  flagged: ['blocker', 'dataset'],
  holding: ['blocker'],
  overdue: ['blocker', 'inbox'],
  remember: ['preference'],
  prefer: ['preference'],
  note: ['preference'],
} satisfies Record<string, string[]>

const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(SYNONYM_TABLE),
)

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`

  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss'))
    return word.slice(0, -1)

  return word
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{2,}/g) ?? []).map(stem)
}

/** The words that say what a tool is about. */
function subjectWords(name: string): string[] {
  return name
    .split('__')
    .flatMap((part) => part.split('_'))
    .map(stem)
    .filter((word) => !ACTION_WORDS.has(word))
}

/** Everyday words for what a tool does, so "add a new material" favours the tools that make things. */
const ACTION_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['create', ['create', 'new', 'make', 'register', 'add', 'start']],
  ['add', ['add', 'new', 'create', 'register']],
  ['archive', ['archive', 'retire', 'remove']],
  ['restore', ['restore', 'unarchive']],
  ['move', ['move', 'transfer', 'relocate']],
  ['update', ['change', 'edit', 'update', 'rename', 'write', 'fill']],
  ['complete', ['complete', 'finish', 'done']],
  ['set', ['set', 'change']],
  ['log', ['log', 'record', 'add', 'new']],
])

/** How many of a tool's own action words the person's words ask for. */
function actionScore(name: string, textWords: ReadonlySet<string>): number {
  return name
    .split('__')
    .flatMap((part) => part.split('_'))
    .filter((part) => ACTION_SYNONYMS.has(part))
    .filter((part) =>
      (ACTION_SYNONYMS.get(part) ?? []).some((word) => textWords.has(word)),
    ).length
}

/** Subjects the text points at: its own words and what they usually mean. */
function wanted(text: string): Set<string> {
  const subjects = new Set<string>()

  for (const word of words(text)) {
    subjects.add(word)

    for (const extra of SYNONYMS.get(word) ?? []) {
      for (const part of extra.split('_')) subjects.add(part)
    }
  }

  return subjects
}

/**
 * The core, every tool already used or found this turn, and the tools whose
 * subject the text mentions, best matches first, capped.
 */
export function selectTools(
  defs: readonly ProviderToolDef[],
  text: string,
  enabled: ReadonlySet<string>,
): ProviderToolDef[] {
  const subjects = wanted(text)
  const textWords = new Set(words(text))

  const scored = defs
    .flatMap((def) => {
      if (CORE_TOOLS.has(def.name) || enabled.has(def.name)) return []

      const subject = subjectWords(def.name).filter((word) =>
        subjects.has(word),
      ).length

      // The verb only breaks ties between tools about the same subject.
      const score = subject > 0 ? subject + actionScore(def.name, textWords) : 0

      return score > 0 ? [{ def, score }] : []
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SELECTED_TOOLS)
    .map((entry) => entry.def)

  const sent = new Set(scored.map((def) => def.name))

  return defs.filter(
    (def) =>
      CORE_TOOLS.has(def.name) || enabled.has(def.name) || sent.has(def.name),
  )
}

/** The tools that best fit a free-text need, for the find-tools tool. */
export function findTools(
  defs: readonly ProviderToolDef[],
  query: string,
): ProviderToolDef[] {
  const subjects = wanted(query)
  const queryWords = new Set(words(query))

  return defs
    .flatMap((def) => {
      if (def.name === FIND_TOOLS_NAME) return []

      const score =
        subjectWords(def.name).filter((word) => subjects.has(word)).length * 3 +
        words(def.description).filter((word) => queryWords.has(word)).length

      return score > 0 ? [{ def, score }] : []
    })
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FOUND_TOOLS)
    .map((entry) => entry.def)
}

export function findToolsDef(): ProviderToolDef {
  return {
    name: FIND_TOOLS_NAME,
    description:
      'Only a few tools are listed at first. If you need to do or look up something and no listed tool fits, call this with a short description of the job (for example "move a sample to another freezer") and the matching tools become available on your next step.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you need to do or look up, in a few words.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }
}
