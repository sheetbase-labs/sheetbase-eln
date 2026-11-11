/**
 * The reagent lot page's own model: the keys its reads are filed under, the
 * sections it offers and the words it prints for a movement.
 */
import { z } from 'zod'

import type { ReagentMovement } from '#/lib/reagent-data'

export const lotQueryKey = (lotId: string) =>
  ['ui-port', 'materials', 'lot', lotId] as const

export const lotLedgerQueryKey = (lotId: string) =>
  ['ui-port', 'materials', 'ledger', lotId] as const

/** Added material fields this page lays out itself (quantity, release). */
export const LOT_PAGE_FIELDS = [
  'initial_quantity',
  'received',
  'released_by',
  'released_at',
  'certificate',
] as const

/** The sections the lot page offers. */
export const lotTabSchema = z.enum(['details', 'ledger', 'used'])

export type LotTab = z.infer<typeof lotTabSchema>

export function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return '—'

  return date
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .replace('Sept', 'Sep')
}

export function dateTimeLabel(iso: string): string {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return '—'

  return date
    .toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    .replace('Sept', 'Sep')
}

export function amount(value: number, unit: string | null): string {
  // "1 unit", "2 units": a unit stored in the plural reads as one at one.
  const shown = unit && value === 1 ? unit.replace(/s$/, '') : unit

  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}${shown ? ` ${shown}` : ''}`
}

/** A movement's signed change, or a dash for the operations that move no stock. */
export function movementChange(movement: ReagentMovement): string {
  if (movement.operation === 'consume')
    return `−${amount(Math.abs(movement.quantityDelta), movement.unit)}`

  if (movement.operation === 'receive')
    return `+${amount(Math.abs(movement.quantityDelta), movement.unit)}`

  return '—'
}

/** Whether a lot can be drawn from: not held, not expired, not empty, not consumed. */
export function isLotUsable(
  status: string,
  quantity: number | null,
  tabs: readonly string[],
): boolean {
  return (
    status !== 'quarantined' &&
    !tabs.includes('expired') &&
    status !== 'consumed' &&
    (quantity ?? 0) > 0
  )
}

/** What the printed label states: lot, storage, use-by and the signal word. */
export interface LotLabelSource {
  lot: string | null
  condition: string | null
  useBy: string | null
  signalWord: string | null
}

export function lotLabelSource(
  lot: string | null,
  storage: string | null,
  expiry: string | null,
  signalWord: string | null,
): LotLabelSource {
  return {
    lot,
    condition: storage,
    useBy: expiry ? dayLabel(expiry) : null,
    signalWord,
  }
}
