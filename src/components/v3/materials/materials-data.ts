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
  if (reagent.status === 'quarantined' || reagent.status === 'expired') {
    return STATUS[reagent.status]
  }
  if (attention.expired) return { tone: 'bad', label: 'Expired' }
  const expiry = reagent.expiry ? new Date(reagent.expiry) : null
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
      label: `Released · ${expiry.toLocaleDateString('en-GB', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })}`,
    }
  }
  return STATUS[reagent.status] ?? {
    tone: 'none',
    label: reagent.status.replace(/_/g, ' '),
  }
}

export function toMaterialListRow(reagent: Reagent): MaterialListRow {
  const attention = reagentAttention(reagent)
  const status = lotStatus(reagent, attention)
  const tabs = ['instock']
  if (reagent.status === 'quarantined') tabs.push('quarantine')
  if (attention.nearExpiry) tabs.push('expiring')
  if (attention.expired || reagent.status === 'expired') tabs.push('expired')
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
