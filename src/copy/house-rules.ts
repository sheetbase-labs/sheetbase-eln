import type { CatalogueTree, Message } from './types'
import { isMessage, isPlural } from './format'

/**
 * The copy house rules (docs/development/copy.md) that a machine can check.
 * Each rule carries the fix, so a failure says what to type instead.
 */
export interface HouseRule {
  readonly id: string
  readonly pattern: RegExp
  readonly fix: string
}

const CONTRACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['could not', 'couldn’t'],
  ['cannot', 'can’t'],
  ['do not', 'don’t'],
  ['does not', 'doesn’t'],
  ['did not', 'didn’t'],
  ['is not', 'isn’t'],
  ['are not', 'aren’t'],
  ['was not', 'wasn’t'],
  ['has not', 'hasn’t'],
  ['have not', 'haven’t'],
  ['will not', 'won’t'],
  ['would not', 'wouldn’t'],
  ['should not', 'shouldn’t'],
]

export const HOUSE_RULES: readonly HouseRule[] = [
  ...CONTRACTIONS.map(([long, short]): HouseRule => ({
    id: `contraction:${long}`,
    pattern: new RegExp(`\\b${long}\\b`, 'i'),
    fix: `write “${short}”; hints and errors use contractions (a statement a person signs keeps its formal wording: list its key in house-rules-pending.json)`,
  })),
  {
    id: 'straight-apostrophe',
    pattern: /\w'\w/,
    fix: 'use a curly apostrophe (’), not a straight one',
  },
  {
    id: 'retry',
    pattern: /\bRetry\b/,
    fix: 'say “Try again”, never “Retry”',
  },
  {
    id: 'developer-word',
    pattern: /\b(payload|UUID|RPC|canonical)\b/i,
    fix: 'name it the way a scientist would (payload → details, canonical → leave it out); IDs, UUIDs and RPC names stay out of the screen',
  },
  {
    id: 'old-term',
    pattern:
      /\b(materiali[sz]e|provenance|dataset schema|schema version|promote a column|column promotion)\b/i,
    fix: 'use the plain term from the table in docs/development/copy.md (materialise → save as dataset, provenance → source, dataset schema → dataset structure)',
  },
]

export interface Leaf {
  readonly key: string
  readonly text: string
}

/** Every message in a catalogue, plural forms as `key#category`. */
export function catalogueLeaves(tree: CatalogueTree, prefix = ''): Leaf[] {
  return Object.entries(tree).flatMap(([name, value]): Leaf[] => {
    const key = `${prefix}${name}`

    return isMessage(value)
      ? messageLeaves(key, value)
      : catalogueLeaves(value, `${key}.`)
  })
}

function messageLeaves(key: string, message: Message): Leaf[] {
  if (!isPlural(message)) return [{ key, text: message }]

  return Object.entries(message).map(([category, text]) => ({
    key: `${key}#${category}`,
    text,
  }))
}

/** Rule ids a message breaks, in rule order. */
export function brokenRules(text: string): HouseRule[] {
  return HOUSE_RULES.filter((rule) => rule.pattern.test(text))
}
