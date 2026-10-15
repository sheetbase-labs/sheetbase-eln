/**
 * Prose runs.
 *
 * The notebook stores prose as `rich_text` rows, so a paragraph of writing and
 * the paragraph under it are two rows. That is what lets a comment anchor, a
 * revision diff and a per-row optimistic version address each one — but it also
 * means the authoring surface has to hide the seams, or the document reads as a
 * stack of separate boxes.
 *
 * A *prose run* is a maximal sequence of consecutive `rich_text` rows. Inside a
 * run the rows render continuously, with no per-block frame, and a Backspace at
 * the start of a row can join it into the row above. A lone `rich_text` row
 * between two other block kinds is not a run: it keeps its ordinary framing
 * because there is no seam to hide.
 *
 * These helpers are pure so the rules can be tested without a DOM.
 */

import { isRichTextPayload } from './blocks/rich-text'

export interface ProseRunPosition {
  /** Number of rows in the run; a run member always belongs to at least two. */
  size: number
  /** Zero-based position of this row within the run. */
  indexInRun: number
  isFirst: boolean
  isLast: boolean
}

/**
 * Positions of every row that belongs to a multi-row prose run, keyed by block
 * id. A row absent from the result is not part of a run and renders framed.
 */
export function proseRunMembers(
  blocks: readonly { id: string; type: string }[],
): Partial<Record<string, ProseRunPosition>> {
  const members: Partial<Record<string, ProseRunPosition>> = {}
  let runStart = 0
  while (runStart < blocks.length) {
    if (blocks[runStart].type !== 'rich_text') {
      runStart += 1
      continue
    }
    let runEnd = runStart
    while (
      runEnd + 1 < blocks.length &&
      blocks[runEnd + 1].type === 'rich_text'
    ) {
      runEnd += 1
    }
    const size = runEnd - runStart + 1
    if (size > 1) {
      for (let i = runStart; i <= runEnd; i += 1) {
        const indexInRun = i - runStart
        members[blocks[i].id] = {
          size,
          indexInRun,
          isFirst: indexInRun === 0,
          isLast: indexInRun === size - 1,
        }
      }
    }
    runStart = runEnd + 1
  }
  return members
}

/** An empty top-level paragraph, in either of the two shapes the contract allows. */
function isEmptyParagraph(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const paragraph = node as { type?: unknown; content?: unknown }
  if (paragraph.type !== 'paragraph') return false
  return !Array.isArray(paragraph.content) || paragraph.content.length === 0
}

/** What a Backspace at the start of a row means. */
export type ProseBackspaceAction = 'join' | 'delete-row' | 'none'

/**
 * Decide what Backspace at the start of a row does, from the two facts that
 * matter. Kept separate from the effect so the rule is testable without a DOM —
 * getting it wrong either silently discards a paragraph or deletes a row that
 * has content.
 *
 * - the rows can be joined → join them
 * - otherwise, an empty row is deleted, which is what the key did before joins
 *   existed
 * - otherwise nothing: a row with content and nothing to join into is left
 *   exactly as it is
 */
export function proseBackspaceAction(input: {
  currentIsEmpty: boolean
  joined: Record<string, unknown> | null
}): ProseBackspaceAction {
  if (input.joined) return 'join'
  return input.currentIsEmpty ? 'delete-row' : 'none'
}

/**
 * Join the row below into the row above, for a Backspace at the start of a
 * paragraph: the row boundary disappears and the text order is preserved.
 *
 * The paragraph the caret sits in is the paragraph that disappears at the seam,
 * so a leading *empty* paragraph is dropped rather than carried up — otherwise
 * Backspace at the start of an empty paragraph would leave a blank line behind,
 * which is the opposite of what it looks like it should do.
 *
 * Returns `null` when either payload is not prose, or when the row below brings
 * nothing with it. Both cases mean "no join happened": the caller deletes the
 * row instead, or does nothing.
 *
 * Text-level merging — pulling the first line of the row below up onto the last
 * line of the row above — is deliberately not done here. It needs one editor
 * spanning both rows, which is a larger change than this helper.
 */
export function joinProsePayloads(
  previous: unknown,
  next: unknown,
): Record<string, unknown> | null {
  if (!isRichTextPayload(previous) || !isRichTextPayload(next)) return null
  const [first, ...rest] = next.doc.content
  const carried = isEmptyParagraph(first) ? rest : next.doc.content
  if (carried.length === 0) return null
  return {
    doc: {
      ...previous.doc,
      content: [...previous.doc.content, ...carried],
    },
  }
}
