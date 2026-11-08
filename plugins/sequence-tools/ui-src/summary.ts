import { t } from '#/copy'
import type { SequenceSummary } from '#/lib/sequence'

/** "Plasmid" style one-liner: DNA · circular · 5,428 bp · 12 features. */
export function summaryLine(s: SequenceSummary): string {
  return [
    t(`sequences.summary.${s.molecule}`),
    t(`sequences.summary.${s.topology}`),
    t(`sequences.summary.length.${s.molecule}`, { count: s.length }),
    t('sequences.summary.features', { count: s.featureCount }),
    s.gc === null ? null : t('sequences.summary.gc', { value: s.gc }),
  ]
    .filter(Boolean)
    .join(' · ')
}
