import type { Tone } from '#/components/v3/ui/status'
import { t } from '#/copy'
import { DETAIL_FIELDS } from '#/lib/bio-registry'
import type {
  ParentRole,
  RegistryEntry,
  RegistryKind,
  RegistryStatus,
} from '#/lib/bio-registry'

export const STATUS_TONE: Record<RegistryStatus, Tone> = {
  active: 'ok',
  retired: 'none',
}

export function statusLabel(status: RegistryStatus): string {
  return t(`registry.statuses.${status}`)
}

export function kindLabel(kind: RegistryKind): string {
  return t(`registry.kindOne.${kind}`)
}

export function roleLabel(role: ParentRole): string {
  return t(`registry.roles.${role}`)
}

export function fieldLabel(key: string): string {
  return t(`registry.fields.${key as 'purpose'}`)
}

/** A value as it reads: choices are translated, everything else is as typed. */
export function valueLabel(value: string): string {
  switch (value) {
    case 'untested':
    case 'negative':
    case 'positive':
    case 'monoclonal':
    case 'polyclonal':
      return t(`registry.choices.${value}`)
    default:
      return value
  }
}

/** The one line a list shows beside a name, from the most telling details. */
export function summaryOf(entry: RegistryEntry): string {
  const d = entry.details
  const pick = (...keys: string[]) =>
    keys
      .map((k) => d[k])
      .filter((v): v is string => Boolean(v))
      .map(valueLabel)
  switch (entry.kind) {
    case 'construct': {
      const seq = d.seqLength
        ? [
            t(
              `sequences.summary.length.${d.seqMolecule === 'protein' ? 'protein' : d.seqMolecule === 'rna' ? 'rna' : 'dna'}`,
              { count: Number(d.seqLength) },
            ),
            d.seqTopology
              ? t(
                  `sequences.summary.${d.seqTopology === 'circular' ? 'circular' : 'linear'}`,
                )
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : ''
      return [seq, ...pick('purpose', 'selection')].filter(Boolean).join(' · ')
    }
    case 'cell_line':
      return pick('species', 'cellType', 'tissue').join(' · ')
    case 'antibody':
      return pick('target', 'hostSpecies', 'clonality', 'clone').join(' · ')
  }
}

/** The details a kind asks for that have a value, in the order they are asked. */
export function filledDetails(
  entry: RegistryEntry,
): { key: string; label: string; value: string }[] {
  return DETAIL_FIELDS[entry.kind]
    .filter((field) => entry.details[field.key])
    .map((field) => ({
      key: field.key,
      label: fieldLabel(field.key),
      value: valueLabel(entry.details[field.key]),
    }))
}

export function entryText(entry: RegistryEntry): string {
  return [
    entry.registryId,
    entry.name,
    entry.description ?? '',
    ...Object.values(entry.details),
  ]
    .join(' ')
    .toLowerCase()
}
