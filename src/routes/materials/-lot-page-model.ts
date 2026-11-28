/**
 * The reagent lot page's own model: the keys its reads are filed under, the
 * sections it offers and the words it prints for a movement.
 */
import { z } from 'zod'

import type { MaterialListRow } from '#/components/materials/materials-data'
import type { RecordFact } from '#/components/record-page/record-page'
import type { ReagentMovement } from '#/lib/reagent-data'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

import { stockOfTotal } from '../-materials-page-model'

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
export const lotTabSchema = z.enum([
  'details',
  'ledger',
  'used',
  'results',
  'history',
])

export type LotTab = z.infer<typeof lotTabSchema>

export function dayLabel(iso: string | null): string {
  return formatDate(iso, { timeZone: 'UTC' })
}

export function dateTimeLabel(iso: string): string {
  return formatDate(iso, { time: true, timeZone: 'UTC' })
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

/** Lot, stock, location and supplier: what a person checks before using it. */
export function lotFacts(row: MaterialListRow): RecordFact[] {
  return [
    { label: t('library.materials.lot.lot'), value: row.lot, mono: true },
    { label: t('library.materials.lot.stock'), value: stockOfTotal(row) },
    { label: t('library.materials.lot.location'), value: row.location },
    { label: t('library.materials.lot.supplier'), value: row.supplier },
  ]
}
