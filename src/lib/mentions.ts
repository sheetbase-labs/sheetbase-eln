/**
 * @mentions in a comment. A comment's body names people as `@Their Name`; the
 * server keeps only the user ids it is sent, and only those of workspace
 * members, so this module turns the names a person typed into those ids. The
 * body is never rewritten: what was typed is what is stored and shown.
 */

export interface MentionCandidate {
  userId: string
  name: string
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The characters that may follow a name for the `@` to still be a mention. */
const BOUNDARY = /[\s.,;:!?)\]}'"]/

/**
 * The user ids named by `@Name` tokens in `body`. A name matches case-
 * insensitively, may contain spaces, and must end at a word boundary, so
 * `@Ada Lovelace,` names Ada and `@Adam` does not. The longest name wins when
 * one is a prefix of another. Each person appears once, in the order named.
 */
export function extractMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): string[] {
  const ordered = candidates
    .filter((candidate) => normalise(candidate.name) !== '')
    .sort((a, b) => b.name.length - a.name.length)
  const found: string[] = []
  const lower = body.toLowerCase()
  for (
    let at = lower.indexOf('@');
    at !== -1;
    at = lower.indexOf('@', at + 1)
  ) {
    // A mention starts a word: "a@b.com" is an address, not a mention.
    if (at > 0 && !/[\s([{'"]/.test(lower.charAt(at - 1))) continue
    const rest = lower.slice(at + 1)
    for (const candidate of ordered) {
      const name = normalise(candidate.name)
      if (!rest.startsWith(name)) continue
      const next = rest.charAt(name.length)
      if (next !== '' && !BOUNDARY.test(next)) continue
      if (!found.includes(candidate.userId)) found.push(candidate.userId)
      break
    }
  }
  return found
}

/**
 * The partial name being typed at the caret, if the caret sits in an `@word`:
 * `"Thanks @ad"` with the caret at the end gives `{ query: 'ad', start: 7 }`,
 * where `start` is the index of the `@`.
 */
export function activeMention(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/[\s([{'"]/.test(before.charAt(at - 1))) return null
  const query = before.slice(at + 1)
  // Two words are allowed ("Ada Love") so a full name can be typed out; a
  // newline or a third word ends the mention.
  if (/\n/.test(query) || query.split(' ').length > 2) return null
  return { query, start: at }
}

/** The candidates whose name starts with, or has a word starting with, `query`. */
export function matchMentions(
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 6,
): MentionCandidate[] {
  const needle = normalise(query)
  return candidates
    .filter((candidate) => {
      const name = normalise(candidate.name)
      if (name === '') return false
      return (
        needle === '' ||
        name.startsWith(needle) ||
        name.split(' ').some((word) => word.startsWith(needle))
      )
    })
    .slice(0, limit)
}

/** `text` with the active `@query` replaced by `@Name `, and the new caret. */
export function insertMention(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } | null {
  const active = activeMention(text, caret)
  if (!active) return null
  const inserted = `@${name} `
  return {
    text: text.slice(0, active.start) + inserted + text.slice(caret),
    caret: active.start + inserted.length,
  }
}
