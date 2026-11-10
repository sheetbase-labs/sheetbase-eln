import { t } from '#/copy'
import { POOL_MAX_SAMPLES } from '#/lib/samples'
import type { PlaceChoice } from '#/lib/storage-positions'
import { formatQuantityAmount, parseQuantityInput } from './quantity-input'

/** Both quantity operations encode the same optional new-container destination. */
export function quantityDestination(title: string, place: PlaceChoice | null) {
  return {
    newContainer: {
      title: title.trim() || undefined,
      storageLocation:
        place?.kind === 'text' ? place.text.trim() || undefined : undefined,
    },
    place: place?.kind === 'position' ? place : undefined,
  }
}

export const ALIQUOT_MAX_TUBES = 96

export interface AliquotPlan {
  count: number | null
  quantityEach: number | null
  total: number | null
  error: string | null
  remaining: number | null
}

export function canSubmitAliquots(
  plan: AliquotPlan,
  busy: boolean,
  purpose: string,
) {
  return (
    !busy &&
    Boolean(purpose) &&
    plan.count != null &&
    plan.quantityEach != null &&
    plan.error == null
  )
}

/** UI preview only. The server checks the whole split atomically. */
export function planAliquots(
  rawCount: string,
  rawEach: string,
  free: number | null,
  unit: string | null,
): AliquotPlan {
  const count = parseQuantityInput(rawCount)
  const quantityEach = parseQuantityInput(rawEach)
  const empty = { count, quantityEach, total: null, remaining: null }

  if (count == null || quantityEach == null) return { ...empty, error: null }

  if (!Number.isInteger(count) || count < 1 || count > ALIQUOT_MAX_TUBES)
    return {
      ...empty,
      error: t('library.samples.aliquotDialog.enterAWholeNumberOf', {
        aliquotMaxTubes: ALIQUOT_MAX_TUBES,
      }),
    }

  if (quantityEach <= 0)
    return {
      ...empty,
      error: t('library.samples.aliquotDialog.eachTubeNeedsAnAmount'),
    }
  const total = count * quantityEach
  const suffix = unit ? ` ${unit}` : ''

  if (free != null && total > free + 1e-9)
    return {
      count,
      quantityEach,
      total,
      remaining: null,
      error: t('library.samples.aliquotDialog.isButOnlyIsFree', {
        count,
        quantityEach: formatQuantityAmount(quantityEach),
        suffix,
        total: formatQuantityAmount(total),
        suffix2: suffix,
        free: formatQuantityAmount(free),
        suffix3: suffix,
      }),
    }

  return {
    count,
    quantityEach,
    total,
    error: null,
    remaining: free == null ? null : free - total,
  }
}

export interface PoolRow {
  id: string
  identifier: string
  title: string
  free: number | null
  unit: string | null
  metadataVersion: number
  take: string
}

export interface PoolPlan {
  amounts: Array<number | null>
  total: number | null
  unit: string | null
  error: string | null
}

export function canSubmitPool(plan: PoolPlan, busy: boolean, purpose: string) {
  return (
    !busy &&
    Boolean(purpose) &&
    plan.total != null &&
    plan.error == null &&
    plan.amounts.every((amount) => amount != null)
  )
}

/** Keep row order and the first refusal. The server remains authoritative. */
export function planPool(rows: PoolRow[]): PoolPlan {
  const amounts = rows.map((row) => parseQuantityInput(row.take))

  const units = [
    ...new Set(rows.flatMap((row) => (row.unit ? [row.unit] : []))),
  ]

  const unit = units[0] ?? null
  const empty = { amounts, total: null, unit }

  if (rows.length > POOL_MAX_SAMPLES)
    return {
      ...empty,
      error: t('library.samples.poolDialog.tooMany', { max: POOL_MAX_SAMPLES }),
    }

  if (units.length > 1)
    return {
      ...empty,
      error: t('library.samples.poolDialog.mixedUnits', {
        units: units.join(', '),
      }),
    }

  if (rows.length < 2)
    return { ...empty, error: t('library.samples.poolDialog.needAnother') }
  let total = 0

  for (const [index, row] of rows.entries()) {
    const amount = amounts[index]

    if (amount == null) return { ...empty, error: null }

    if (amount <= 0)
      return {
        ...empty,
        error: t('library.samples.poolDialog.needAmount', {
          identifier: row.identifier,
        }),
      }

    if (row.free != null && amount > row.free + 1e-9)
      return {
        ...empty,
        error: t('library.samples.poolDialog.tooMuch', {
          identifier: row.identifier,
          free: formatQuantityAmount(row.free),
          suffix: unit ? ` ${unit}` : '',
        }),
      }
    total += amount
  }

  return { amounts, total, unit, error: null }
}
