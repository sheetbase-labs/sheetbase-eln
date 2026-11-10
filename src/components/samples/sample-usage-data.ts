import type { SampleQuantityBalances } from '#/lib/samples'
import { t } from '#/copy'

export interface UsageSegments {
  used: number
  reserved: number
  free: number
  /** Registered volume: used + current. */
  total: number
  usedPct: number
  reservedPct: number
  freePct: number
}

export function computeUsageSegments(
  balances: SampleQuantityBalances | null,
): UsageSegments {
  const used = balances?.used ?? 0
  const reserved = balances?.reserved ?? 0
  const free = balances?.free ?? 0
  const total = used + reserved + free
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0)

  return {
    used,
    reserved,
    free,
    total,
    usedPct: pct(used),
    reservedPct: pct(reserved),
    freePct: pct(free),
  }
}

/** A reservation's lifecycle state in the design's status vocabulary. */
export function reservationStateLabel(state: string) {
  if (state === 'cancelled')
    return {
      tone: 'none' as const,
      label: t('library.samples.sampleUsage.cancelled'),
    }

  if (state === 'fulfilled')
    return {
      tone: 'ok' as const,
      label: t('library.samples.sampleUsage.fulfilled'),
    }

  return {
    tone: 'progress' as const,
    label: t('library.samples.sampleUsage.active'),
  }
}
