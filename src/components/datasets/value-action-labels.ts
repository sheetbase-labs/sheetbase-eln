import { t } from '#/copy'
import type { DatasetValueFlagKind } from '#/lib/dataset-flags'

/** Human labels for the canonical flag kinds (DB is authoritative). */
export const FLAG_KIND_LABELS: Record<DatasetValueFlagKind, string> = {
  out_of_range: t('data.valueActions.outRange'),
  missing_unit: t('data.valueActions.missingUnit'),
  above_curve: t('data.valueActions.aboveCurve'),
  high_cv: t('data.valueActions.highReplicateCv'),
}

/** Design reason categories (canvas DialogsRecord, "Mark out of range"). */
export const FLAG_REASON_CATEGORIES = [
  t('data.valueActions.aboveAssaySValidated'),
  t('data.valueActions.instrumentHandlingError'),
  t('data.valueActions.reasonOther'),
] as const

export type FlagReasonCategory = (typeof FLAG_REASON_CATEGORIES)[number]
