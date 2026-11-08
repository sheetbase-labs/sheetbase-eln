import type { RegistryEntry, RegistryModel } from '#/lib/bio-registry'

export function entryStatus(entry: RegistryEntry): 'active' | 'retired' {
  return entry.archived_at ? 'retired' : 'active'
}

/** The values an entry holds that read as words, in the order they were set. */
function readableValues(
  entry: RegistryEntry,
  model: RegistryModel | undefined,
): string[] {
  return Object.entries(entry.custom_fields ?? {})
    .filter(
      ([key]) =>
        key !== model?.registry_sequence_field &&
        key !== model?.registry_structure_field,
    )
    .map(([, value]) =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value).trim()
        : '',
    )
    .filter(
      (value) =>
        value !== '' &&
        !value.startsWith('seq:') &&
        !/\bM {2}END\b/.test(value),
    )
}

/** The one line a list shows beside a name: the first few things filled in. */
export function entrySummary(
  entry: RegistryEntry,
  model: RegistryModel | undefined,
): string {
  return readableValues(entry, model).slice(0, 3).join(' · ')
}

export function entryText(entry: RegistryEntry): string {
  return [entry.identifier, entry.title, ...readableValues(entry, undefined)]
    .join(' ')
    .toLowerCase()
}
