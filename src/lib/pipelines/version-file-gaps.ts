/**
 * The room under a line for its error message. The text lives in one textarea,
 * which cannot leave a gap, so the gap is made of real lines holding only this
 * invisible character. They exist in what the textarea shows, never in the
 * file: these helpers move text and the caret between the two.
 */
export const GAP = '⁣'

/** How many lines of room a message takes. */
export const GAP_LINES = 2

/** The text the textarea shows: the file with room after each of `lines` (1-based). */
export function withGaps(text: string, lines: readonly number[]): string {
  if (!lines.length) return text
  const after = new Set(lines)
  const gap = Array.from({ length: GAP_LINES }, () => GAP)

  return text
    .split('\n')
    .flatMap((line, index) => (after.has(index + 1) ? [line, ...gap] : [line]))
    .join('\n')
}

/** The file a textarea shows: the room taken out, and any stray gap character with it. */
export function withoutGaps(shown: string): string {
  if (!shown.includes(GAP)) return shown

  return shown
    .split('\n')
    .filter((line) => line !== GAP)
    .join('\n')
    .replaceAll(GAP, '')
}

/** A caret offset in the file, as an offset in the text shown. */
export function shownOffset(
  text: string,
  lines: readonly number[],
  offset: number,
): number {
  const after = new Set(lines)
  let at = 0
  let extra = 0

  for (const [index, line] of text.split('\n').entries()) {
    const end = at + line.length

    if (offset <= end) return offset + extra
    at = end + 1

    if (after.has(index + 1)) extra += GAP_LINES * (GAP.length + 1)
  }

  return offset + extra
}

/** A caret offset in the text shown, as an offset in the file. */
export function fileOffset(shown: string, offset: number): number {
  let at = 0
  let removed = 0

  for (const line of shown.split('\n')) {
    const end = at + line.length

    if (line === GAP) {
      if (offset <= end) return Math.max(0, at - removed - 1)
      removed += line.length + 1
    } else if (offset <= end) return offset - removed

    at = end + 1
  }

  return offset - removed
}
