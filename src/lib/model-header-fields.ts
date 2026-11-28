/**
 * A record model chooses which of its fields the record page's header says,
 * beside the ID and status. The choice lives on each field of the model's
 * version (`show_in_header`), so every record of the model reads it from the
 * definition and no screen lists fields of its own.
 */

/** The header has room for this many facts, the model's own first. */
export const HEADER_FIELD_LIMIT = 4

/** The fields a model puts in the header, in the model's order, at most four. */
export function headerFieldsOf<
  T extends { showInHeader?: boolean; displayOrder: number; lifecycle: string },
>(fields: readonly T[]): T[] {
  return fields
    .filter((field) => field.showInHeader && field.lifecycle !== 'retired')
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, HEADER_FIELD_LIMIT)
}

/** How many fields of a version's draft are chosen for the header. */
export function headerFieldCount(
  fields: readonly { show_in_header?: boolean; lifecycle: string }[],
): number {
  return fields.filter(
    (field) => field.show_in_header && field.lifecycle !== 'retired',
  ).length
}

/** The model's facts first, then the page's own, up to the header's room. */
export function withHeaderFacts<T>(own: readonly T[], fallback: readonly T[]) {
  return [...own, ...fallback].slice(0, HEADER_FIELD_LIMIT)
}
