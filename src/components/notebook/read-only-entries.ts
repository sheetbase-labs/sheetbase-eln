/**
 * Render keys for value-only snapshots without persisted row identity. Distinct
 * values survive reordering; identical occurrences remain separate. Editable
 * drafts must use their own stable local keys, not these content-derived keys.
 */
export function readOnlyEntries<T>(
  values: readonly T[],
  signature: (value: T) => string,
) {
  const occurrences = new Map<string, number>()

  return values.map((value) => {
    const content = signature(value)
    const occurrence = occurrences.get(content) ?? 0
    occurrences.set(content, occurrence + 1)

    return { key: JSON.stringify([content, occurrence]), value }
  })
}
