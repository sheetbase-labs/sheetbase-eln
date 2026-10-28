/** A stored token the way a person reads it: "needs_review" → "Needs review". */
export function sentenceCase(value: string | null | undefined): string {
  const words = (value ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
