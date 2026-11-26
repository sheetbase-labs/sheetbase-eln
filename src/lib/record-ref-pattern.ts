/**
 * The identifier families that have a page of their own ("EXP-0142"). Shared
 * by the pieces that find identifiers in text: the one that turns them into
 * links in the browser and the one that notes which records a lookup touched.
 */
export const RECORD_REF = /\b(?:EXP|SMP|MAT|PRT|DS|INS|PRJ|PL|AN)-\d{3,6}\b/g

/** The distinct identifiers in some text, first seen first, at most `limit`. */
export function recordRefsIn(text: string, limit = 12): string[] {
  const seen = new Set<string>()

  for (const match of text.matchAll(RECORD_REF)) {
    seen.add(match[0])

    if (seen.size >= limit) break
  }

  return [...seen]
}
