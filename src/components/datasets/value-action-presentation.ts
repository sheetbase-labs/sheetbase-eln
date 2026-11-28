import { z } from 'zod'

import { t } from '#/copy'
import type { DatasetSystemFlagProvenance } from '#/lib/dataset-flags'
import { formatDate, formatNotebookDateTime } from '#/lib/notebook-data'
import { displayTimeOrDuration } from '#/lib/time-duration'
import { personName } from '#/lib/well-person'
import type { MarkOutOfRangeDialogProps } from './value-actions'

interface RuleThresholdMembers {
  min?: DatasetSystemFlagProvenance['threshold']
  max?: DatasetSystemFlagProvenance['threshold']
  cvPercent?: DatasetSystemFlagProvenance['threshold']
  replicateCount?: DatasetSystemFlagProvenance['threshold']
  maxCvPercent?: DatasetSystemFlagProvenance['threshold']
}

// Members remain opaque native values. Keep the original object, including
// inherited properties, getters and proxies; parsing must not read members.
const ruleThresholdSchema = z.custom<RuleThresholdMembers>((value) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Historical thresholds accept every non-null object, including arrays and native objects, without reading or validating its members.
  return value !== null && typeof value === 'object'
})

/** Object provenance uses JSON; non-objects retain native String semantics. */
export function formatProvenanceValue(
  value: DatasetSystemFlagProvenance['evaluatedValue'],
): string {
  if (value == null) return t('data.valueActions.noValue')

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This discriminator preserves JSON.stringify for all historical objects, including toJSON hooks, rather than applying native String to them.
  if (typeof value === 'object') return JSON.stringify(value)

  // oxlint-disable-next-line typescript/no-base-to-string -- Non-object provenance historically uses String, including functions and symbols; JSON encoding or template coercion changes their display or throws.
  return String(value)
}

/** Selected values use native String, not provenance's object JSON encoding. */
export function formatSelectedValue(
  value: MarkOutOfRangeDialogProps['value'],
): string {
  // oxlint-disable-next-line typescript/no-base-to-string -- Selected native values retain String's string hint, object/custom stringification and symbol support; only nullish values display an em dash.
  return value == null ? '—' : String(value)
}

/**
 * A dataset cell as people read it: times as 09:10, durations as 2 h 30 min,
 * dates as 28 Nov 2026, date and time as 28 Nov 2026, 08:46, people by name.
 */
export function formatDatasetValue(
  logicalType: string,
  value: MarkOutOfRangeDialogProps['value'],
  people?: ReadonlyMap<string, string>,
): string {
  if (value != null && (logicalType === 'time' || logicalType === 'duration'))
    return displayTimeOrDuration(logicalType, value)

  const instant = z.string().safeParse(value)

  if (
    instant.success &&
    (logicalType === 'timestamp' || logicalType === 'date') &&
    !Number.isNaN(Date.parse(instant.data))
  )
    return logicalType === 'date'
      ? formatDate(instant.data)
      : formatNotebookDateTime(instant.data)

  const person = z.string().safeParse(value)

  if (logicalType === 'person' && person.success)
    return personName(person.data, people)

  return formatSelectedValue(value)
}

/** Rule summaries preserve each rule's original property reads and coercion. */
export function formatRuleThreshold(
  rule: DatasetSystemFlagProvenance['rule'],
  threshold: DatasetSystemFlagProvenance['threshold'],
): string | null {
  const parsed = ruleThresholdSchema.safeParse(threshold)

  if (!parsed.success) return null
  const th = parsed.data

  if (rule === 'out_of_range') {
    const { min, max } = th

    // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- Bounds retain native template string-hint coercion, min before max, including object hooks and symbol failures; String(symbol) would incorrectly succeed.
    if (min != null && max != null) return `expected ${min}–${max}`

    // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- A lone maximum retains native template coercion and throws for symbols, unlike String.
    if (max != null) return `expected at most ${max}`

    // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- A lone minimum retains native template coercion and throws for symbols, unlike String.
    if (min != null) return `expected at least ${min}`

    return null
  }

  if (rule === 'missing_unit') return t('data.valueActions.fieldRequiresUnit')
  const parts: string[] = []

  // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- Keep the second CV getter read and native template coercion; getters may change between reads and symbols must throw.
  if (th.cvPercent != null) parts.push(`CV ${th.cvPercent}%`)

  // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- Keep the second replicate getter read and native template coercion, including object hooks and symbol failures.
  if (th.replicateCount != null) parts.push(`${th.replicateCount} replicates`)

  // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- Keep the second limit getter read and native template coercion, including object hooks and symbol failures.
  if (th.maxCvPercent != null) parts.push(`limit ${th.maxCvPercent}%`)

  return parts.length ? parts.join(' · ') : null
}
