import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchReagentsCount,
  fetchReagentsPage,
  reagentAttention,
} from '#/lib/reagent-data'
import type { Reagent } from '#/lib/reagent-data'
import type { RegistryQuery } from '#/lib/registry'

/** UI port (roadmap-4/ui-app3): the materials registry, mapped from real
 * reagent records onto the app-3 list shape. */

export interface MaterialListRow {
  uuid: string
  id: string
  name: string
  supplier: string
  lot: string
  stock: string
  location: string
  status: { tone: Tone; label: string }
  attention?: { tone: Tone; label: string }
  tabs: string[]
  metadataVersion: number
  /** Lot block detail, shown in the inspector. */
  catalogNo: string | null
  received: string | null
  releasedBy: string | null
  releasedAt: string | null
  certificate: string | null
  /** Quantity as received, so the inspector can show "2 of 6 units". */
  initialQuantity: number | null
  unit: string | null
  /** Expiry as the inspector states it: "Expires 1 Oct 2026 (6 days)". */
  expiryNote: string | null
}

const EMPTY_QUERY: RegistryQuery = {
  pageIndex: 0,
  pageSize: 200,
  // Newest lot first, which is the order the registry design lists them in; the
  // identifier sequence is allocation order, so it reads as arrival order.
  sorting: [{ id: 'identifier', desc: true }],
  grouping: [],
  filters: [],
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  available: { tone: 'ok', label: 'Available' },
  reserved: { tone: 'progress', label: 'Reserved' },
  consumed: { tone: 'stored', label: 'Consumed' },
  quarantined: { tone: 'warn', label: 'Quarantine' },
  expired: { tone: 'bad', label: 'Expired' },
}

/**
 * The registry list shows a lot's standing, not its lifecycle word: an available
 * lot reads as released until it expires, and one inside the warning window reads
 * as expiring. Quarantine and expiry keep their own labels because the tabs are
 * built from them.
 */
function lotStatus(
  reagent: Reagent,
  attention: ReturnType<typeof reagentAttention>,
): { tone: Tone; label: string } {
  if (reagent.status === 'quarantined') return STATUS.quarantined
  const expiry = reagent.expiry ? new Date(reagent.expiry) : null
  if (reagent.status === 'expired' || attention.expired) {
    return expiry && !Number.isNaN(expiry.getTime())
      ? {
          tone: 'bad',
          label: `Expired ${shortDate(expiry)}`,
        }
      : STATUS.expired
  }
  if (expiry && !Number.isNaN(expiry.getTime())) {
    if (attention.nearExpiry) {
      return {
        tone: 'warn',
        label: `Expires ${expiry.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        })}`,
      }
    }
    return {
      tone: 'ok',
      label: `Released · ${shortMonth(expiry)} ${expiry.getUTCFullYear()}`,
    }
  }
  return (
    STATUS[reagent.status] ?? {
      tone: 'none',
      label: reagent.status.replace(/_/g, ' '),
    }
  )
}

/** Day and month, e.g. "1 Oct". */
function shortDate(date: Date): string {
  return `${date.getUTCDate()} ${shortMonth(date)}`
}

/** Three-letter month, e.g. "Sep" (the design never uses "Sept"). */
function shortMonth(date: Date): string {
  return date
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    .slice(0, 3)
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The inspector states the expiry in full - date and days remaining - where the
 * list only needs the short form.
 */
function expiryNote(
  reagent: Reagent,
  attention: ReturnType<typeof reagentAttention>,
): string | null {
  if (!reagent.expiry) return null
  const date = new Date(reagent.expiry)
  if (Number.isNaN(date.getTime())) return null
  const days = attention.daysToExpiry
  if (attention.expired) {
    return days != null && days < 0
      ? `Expired ${formatDay(reagent.expiry)} (${Math.abs(days)} days ago)`
      : `Expired ${formatDay(reagent.expiry)}`
  }
  if (attention.nearExpiry && days != null) {
    return `Expires ${formatDay(reagent.expiry)} (${days} ${days === 1 ? 'day' : 'days'})`
  }
  return null
}

export function toMaterialListRow(reagent: Reagent): MaterialListRow {
  const attention = reagentAttention(reagent)
  const status = lotStatus(reagent, attention)
  // A lot is in stock, or held aside, or gone; quarantine and expiry are their own
  // tabs rather than members of the stock list. Expiring is a view over stock.
  const expired = attention.expired || reagent.status === 'expired'
  const tabs: string[] = []
  if (reagent.status === 'quarantined') tabs.push('quarantine')
  else if (expired) tabs.push('expired')
  else tabs.push('instock')
  if (tabs.includes('instock') && attention.nearExpiry) tabs.push('expiring')
  return {
    uuid: reagent.id,
    id: reagent.identifier,
    name: reagent.title,
    supplier: reagent.supplier ?? '—',
    lot: reagent.lot ?? '—',
    stock:
      reagent.quantity != null
        ? `${reagent.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${reagent.unit ? ` ${reagent.unit}` : ''}`
        : '—',
    location: reagent.storage ?? '—',
    status,
    catalogNo: reagent.catalogNo,
    received: reagent.received ?? null,
    releasedBy: reagent.releasedBy ?? null,
    releasedAt: reagent.releasedAt ?? null,
    certificate: reagent.certificate ?? null,
    initialQuantity: reagent.initialQuantity ?? null,
    unit: reagent.unit,
    expiryNote: expiryNote(reagent, attention),
    attention:
      attention.kind === 'low_stock'
        ? { tone: 'warn', label: 'Low stock' }
        : attention.kind === 'near_expiry'
          ? { tone: 'warn', label: 'Near expiry' }
          : attention.kind === 'expired'
            ? { tone: 'bad', label: 'Expired' }
            : undefined,
    tabs,
    metadataVersion: reagent.metadataVersion,
  }
}

export const materialListQueryKeys = {
  page: ['ui-port', 'materials', 'page'] as const,
}

export function useReagentPage(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: materialListQueryKeys.page,
    queryFn: async () => {
      const [rows, total] = await Promise.all([
        fetchReagentsPage(client, EMPTY_QUERY),
        fetchReagentsCount(client, EMPTY_QUERY),
      ])
      return { rows, total }
    },
    staleTime: 15_000,
  })
}
