import type { AuditEventsFilter } from '#/lib/audit-history'

/** The audit log's filters that live in the URL, so a link can carry them. */
export interface AuditSearch {
  /** Only entries about this record (its id). */
  record?: string
  /** First day (yyyy-mm-dd), inclusive. */
  from?: string
  /** Last day (yyyy-mm-dd), inclusive. */
  to?: string
}

/** The RPC filter for the URL's record and day range. */
export function auditFilterFromSearch(
  search: AuditSearch,
): Pick<AuditEventsFilter, 'object' | 'from' | 'to'> {
  const filter: Pick<AuditEventsFilter, 'object' | 'from' | 'to'> = {}

  if (search.record) filter.object = search.record

  if (search.from) filter.from = `${search.from}T00:00:00.000Z`

  if (search.to) filter.to = `${search.to}T23:59:59.999Z`

  return filter
}
