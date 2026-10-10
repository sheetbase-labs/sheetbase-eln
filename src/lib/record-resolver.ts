/**
 * LAB-05.3 — resolve a printed identifier to its record.
 *
 * A label's QR code encodes `https://<host>/r/<identifier>`, so the resolver route
 * turns that identifier back into the record it names. Identifiers are prefixed by
 * kind (`EXP-`, `SMP-`, `TB-`), so an exact match names one object; the query is
 * ordered for determinism rather than relying on the server's default order.
 */
import type { DataClient } from './data-client'

export interface ResolvedRecord {
  id: string
  identifier: string
  kind: string
  title: string
}

export async function resolveRecordByIdentifier(
  client: DataClient,
  identifier: string,
): Promise<ResolvedRecord | null> {
  const trimmed = identifier.trim()
  if (!trimmed) return null
  const rows = await client.list<ResolvedRecord>(
    'records',
    `?identifier=eq.${encodeURIComponent(trimmed)}&deleted_at=is.null` +
      `&order=created_at.desc&limit=1&select=id,identifier,kind,title`,
  )
  return rows[0] ?? null
}
