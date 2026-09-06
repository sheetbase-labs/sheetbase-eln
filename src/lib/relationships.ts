/**
 * KNOW-01 — Bidirectional relationship exploration.
 *
 * A dedicated traversal layer over the canonical `record_links` table. There
 * is no second graph here: every read goes through the same PostgREST
 * boundary (and RLS) as the rest of the app via the existing DataClient.
 *
 * - Outgoing links reuse `fetchLinksForRecord` (source_record_id).
 * - Incoming links use a first-class `target_record_id` reader in the same
 *   style as `fetchTemplateUsage` in templates.ts, plus the by-identifier
 *   fallback for reagent-style links that address their target by stable
 *   identifier instead of id (the same fallback fetchRelatedForRecord uses).
 * - Typed per-link labels come from `relationshipLabel` in lineage-data.
 * - Destinations resolve through `navigation.ts` stable-ID paths only.
 *
 * Unlike FIND-03's Related Work (a ranked, capped discovery list that drops
 * anything unresolvable), this panel is complete traversal: archived,
 * deleted, missing and permission-restricted counterparties render as honest
 * non-interactive rows. Invisible counterparties render the restricted state
 * with a generic title — never a label beyond what RLS already permits.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from './data-client'
import { relationshipLabel } from './lineage-data'
import { recordDestination } from './navigation'
import {
  fetchLinksForRecord,
  fetchRecord,
  notebookDataClient,
  toLink,
} from './notebook-data'
import type { NotebookLink, RecordLinkWire } from './notebook-data'

/** Per-source bound so one chatty record cannot dominate the panel. */
export const RELATIONSHIP_SOURCE_LIMIT = 50

export const relationshipQueryKeys = {
  links: (recordId: string) => ['relationships', 'links', recordId] as const,
  endpoints: (idsKey: string) =>
    ['relationships', 'endpoints', idsKey] as const,
}

export type RelationshipDirection = 'outgoing' | 'incoming'

/**
 * Lifecycle state of the counterparty. Mirrors the honest `RecordLink`
 * states plus `archived` — FIND-03 drops these rows, this panel shows them.
 */
export type RelationshipRowState =
  | 'available'
  | 'archived'
  | 'deleted'
  | 'missing'
  | 'permission-restricted'

/** RLS-filtered counterparty record: lifecycle fields kept, never dropped. */
export interface RelationshipEndpoint {
  id: string
  kind: string
  identifier: string
  title: string
  archivedAt: string | null
  deletedAt: string | null
}

/** One traversable (or honestly untraversable) edge. */
export interface RelationshipRow {
  linkId: string
  direction: RelationshipDirection
  linkType: string
  /** Typed human label, e.g. `uses`, `created from`. */
  label: string
  otherRecordId: string | null
  state: RelationshipRowState
  /**
   * Counterparty title. Generic (`Restricted record`) when the counterparty
   * is invisible — the title is not readable under RLS so it is never shown.
   */
  title: string
  /** Stable identifier as row meta (null for restricted rows: no leak). */
  identifier: string | null
  /** Canonical stable-ID destination; present only when `available`. */
  destination: string | null
  /** Link creation time, carried from the already-fetched link row. */
  createdAt: string
  /** Link creator; null when the reader used a narrow projection. */
  createdByUserId: string | null
  /**
   * Collapsed identical edges (same counterparty + link type). 1 is a
   * unique edge; >1 means the server returned duplicate rows that were
   * folded into this one (the unique constraint prevents new dupes, but
   * older rows can predate it).
   */
  duplicateCount: number
}

async function quiet<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Readers — RLS-filtered, no new tables or RPCs.
// ---------------------------------------------------------------------------

/**
 * First-class incoming-link reader: links whose `target_record_id` is this
 * record. Same query shape as `fetchTemplateUsage` in templates.ts
 * (`target_record_id=eq`, bounded, oldest-first so traversal order is
 * stable). Maps through the shared `toLink` so rows stay NotebookLinks.
 */
export function fetchIncomingLinksForRecord(
  client: DataClient,
  recordId: string,
  limit = RELATIONSHIP_SOURCE_LIMIT,
): Promise<NotebookLink[]> {
  return client
    .list<RecordLinkWire>(
      'record_links',
      `?target_record_id=eq.${encodeURIComponent(recordId)}&order=created_at.asc&limit=${limit}`,
    )
    .then((rows) => rows.map(toLink))
}

/**
 * Identifier-addressed incoming links (reagent-style): rows that name this
 * record's stable identifier but carry no `target_record_id`. Only rows with
 * a null `target_record_id` count — rows pointing at another record id are
 * that record's incoming edge, not ours.
 */
export function fetchIncomingLinksByIdentifier(
  client: DataClient,
  identifier: string,
  limit = RELATIONSHIP_SOURCE_LIMIT,
): Promise<NotebookLink[]> {
  return client
    .list<RecordLinkWire>(
      'record_links',
      `?target_identifier=eq.${encodeURIComponent(identifier)}&order=created_at.asc&limit=${limit}`,
    )
    .then((rows) =>
      rows
        .filter((row) => row.target_record_id === null)
        .map(toLink),
    )
}

export interface RelationshipLinks {
  outgoing: NotebookLink[]
  incoming: NotebookLink[]
}

/**
 * Bidirectional link fan-out for one record: outgoing via the canonical
 * `fetchLinksForRecord`, incoming via `fetchIncomingLinksForRecord` plus the
 * by-identifier fallback (needs the seed's stable identifier). Never throws
 * — each source degrades to empty independently. Dedupes by link id and
 * drops self-loops from the incoming side (they already read as outgoing).
 */
export async function fetchRelationshipLinks(
  client: DataClient,
  recordId: string,
): Promise<RelationshipLinks> {
  const [outgoing, incomingById, seed] = await Promise.all([
    quiet(fetchLinksForRecord(client, recordId), []),
    quiet(fetchIncomingLinksForRecord(client, recordId), []),
    quiet(fetchRecord(client, recordId), null),
  ])
  const seen = new Set(outgoing.map((link) => link.id))
  const incoming: NotebookLink[] = []
  const takeIncoming = (link: NotebookLink) => {
    if (link.sourceRecordId === recordId) return
    if (seen.has(link.id)) return
    seen.add(link.id)
    incoming.push(link)
  }
  for (const link of incomingById) takeIncoming(link)
  if (seed?.identifier) {
    const byIdentifier = await quiet(
      fetchIncomingLinksByIdentifier(client, seed.identifier),
      [],
    )
    for (const link of byIdentifier) takeIncoming(link)
  }
  return { outgoing, incoming }
}

interface RelationshipEndpointWire {
  id: string
  kind: string
  identifier: string
  title: string
  archived_at: string | null
  deleted_at: string | null
}

/**
 * Batch-resolve counterparty ids to endpoint info. RLS-filtered: ids the
 * caller cannot see come back absent and the caller renders them restricted.
 * Archived/deleted rows are KEPT (with lifecycle fields) — dropping them is
 * FIND-03's discovery behaviour, not traversal behaviour.
 */
export async function fetchRelationshipEndpoints(
  client: DataClient,
  ids: readonly string[],
): Promise<Map<string, RelationshipEndpoint>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const rows = await quiet(
    client.list<RelationshipEndpointWire>(
      'records',
      `?id=in.(${unique.map((id) => encodeURIComponent(id)).join(',')})&select=id,kind,identifier,title,archived_at,deleted_at`,
    ),
    [],
  )
  const byId = new Map<string, RelationshipEndpoint>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      kind: row.kind,
      identifier: row.identifier,
      title: row.title,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
    })
  }
  return byId
}

// ---------------------------------------------------------------------------
// Aggregation — pure, unit-tested.
// ---------------------------------------------------------------------------

/**
 * Map counterparty lifecycle to a row state. `hasCounterparty` false means
 * the edge carries no stable target id (dangling / name-only target).
 * A null endpoint with a target id means RLS hid the record: restricted,
 * never a guessed label.
 */
export function lifecycleToRowState(
  endpoint: Pick<RelationshipEndpoint, 'archivedAt' | 'deletedAt'> | null,
  hasCounterparty: boolean,
): RelationshipRowState {
  if (!hasCounterparty) return 'missing'
  if (!endpoint) return 'permission-restricted'
  if (endpoint.deletedAt !== null) return 'deleted'
  if (endpoint.archivedAt !== null) return 'archived'
  return 'available'
}
function toRelationshipRow(
  link: NotebookLink,
  direction: RelationshipDirection,
  recordId: string,
  endpoints: Map<string, RelationshipEndpoint>,
  typeLabels?: Record<string, string>,
): RelationshipRow | null {
  const otherRecordId =
    direction === 'outgoing' ? link.targetRecordId : link.sourceRecordId
  if (otherRecordId !== null && otherRecordId === recordId) return null
  const endpoint = otherRecordId ? (endpoints.get(otherRecordId) ?? null) : null
  const state = lifecycleToRowState(endpoint, otherRecordId !== null)
  const label = typeLabels?.[link.linkType] ?? relationshipLabel(link.linkType)
  const available = state === 'available' && endpoint !== null
  return {
    linkId: link.id,
    direction,
    linkType: link.linkType,
    label,
    otherRecordId,
    state,
    title:
      state === 'permission-restricted'
        ? 'Restricted record'
        : (endpoint?.title ?? link.targetIdentifier),
    identifier:
      state === 'permission-restricted'
        ? null
        : (endpoint?.identifier ?? link.targetIdentifier),
    destination: available
      ? recordDestination(endpoint.kind, endpoint.id)
      : null,
    createdAt: link.createdAt,
    createdByUserId: link.createdByUserId,
    duplicateCount: 1,
  }
}

export interface AggregatedRelationships {
  outgoing: RelationshipRow[]
  incoming: RelationshipRow[]
}

/**
 * Split links into outgoing/incoming rows with typed labels, lifecycle
 * states and gated destinations. Self-loops are dropped (traversal to self
 * is noise). Only `available` rows carry a destination — every other state
 * renders as an honest non-interactive row.
 *
 * Exact duplicates (same counterparty + link type, distinct link ids) are
 * collapsed defensively with a count: the fetch layer dedupes by link id,
 * but the server can still return semantic dupes, so the panel never shows
 * the same edge twice.
 */
export function buildRelationshipRows(
  recordId: string,
  links: RelationshipLinks,
  endpoints: Map<string, RelationshipEndpoint>,
  typeLabels?: Record<string, string>,
): AggregatedRelationships {
  return {
    outgoing: collectRows('outgoing', recordId, links.outgoing, endpoints, typeLabels),
    incoming: collectRows('incoming', recordId, links.incoming, endpoints, typeLabels),
  }
}

/**
 * Collapse key for one link: link type plus the counterparty address.
 * Outgoing edges without a target id still collapse on the preserved
 * stable identifier; incoming edges address their source by id.
 */
function collapseKey(
  direction: RelationshipDirection,
  link: NotebookLink,
): string {
  const counterparty =
    direction === 'outgoing'
      ? (link.targetRecordId ?? `identifier:${link.targetIdentifier}`)
      : link.sourceRecordId
  return `${link.linkType}|${counterparty}`
}

/**
 * Map links to rows, folding exact duplicates into the first row. Link
 * order is oldest-first from the readers, so the surviving row is the
 * earliest edge and `duplicateCount` counts the folded dupes.
 */
function collectRows(
  direction: RelationshipDirection,
  recordId: string,
  links: NotebookLink[],
  endpoints: Map<string, RelationshipEndpoint>,
  typeLabels?: Record<string, string>,
): RelationshipRow[] {
  const rows: RelationshipRow[] = []
  const seen = new Map<string, RelationshipRow>()
  for (const link of links) {
    const row = toRelationshipRow(link, direction, recordId, endpoints, typeLabels)
    if (!row) continue
    const key = collapseKey(direction, link)
    const existing = seen.get(key)
    if (existing) {
      existing.duplicateCount += 1
    } else {
      seen.set(key, row)
      rows.push(row)
    }
  }
  return rows
}
/** Counterparty ids needing endpoint resolution for a link set. */
export function relationshipCounterpartyIds(
  recordId: string,
  links: RelationshipLinks,
): string[] {
  const ids = new Set<string>()
  for (const link of links.outgoing) {
    if (link.targetRecordId && link.targetRecordId !== recordId) {
      ids.add(link.targetRecordId)
    }
  }
  for (const link of links.incoming) {
    if (link.sourceRecordId !== recordId) ids.add(link.sourceRecordId)
  }
  return [...ids]
}

// ---------------------------------------------------------------------------
// Hook — the same declarative shape as useRelatedWork.
// ---------------------------------------------------------------------------

export interface RelationshipsResult {
  outgoing: RelationshipRow[]
  incoming: RelationshipRow[]
  isLoading: boolean
}

/**
 * Reactive bidirectional relationships for the panel; silent while id-less.
 * `typeLabels` overrides the canonical label vocabulary per link type —
 * MODEL-03 feeds model-declared relationship names here; omitted keeps
 * current behaviour.
 */
export function useRelationships(
  recordId: string | null,
  enabled = true,
  typeLabels?: Record<string, string>,
): RelationshipsResult {
  const linksQuery = useQuery({
    queryKey: relationshipQueryKeys.links(recordId ?? 'none'),
    queryFn: () => fetchRelationshipLinks(notebookDataClient, recordId!),
    enabled: enabled && Boolean(recordId),
    staleTime: 10_000,
  })
  const counterpartyIds = useMemo(
    () =>
      linksQuery.data
        ? relationshipCounterpartyIds(recordId ?? '', linksQuery.data)
        : [],
    [linksQuery.data, recordId],
  )
  const endpointsQuery = useQuery({
    queryKey: relationshipQueryKeys.endpoints(counterpartyIds.join(',')),
    queryFn: () =>
      fetchRelationshipEndpoints(notebookDataClient, counterpartyIds),
    enabled: enabled && Boolean(recordId) && counterpartyIds.length > 0,
    staleTime: 10_000,
  })
  const rows = useMemo(
    () =>
      buildRelationshipRows(
        recordId ?? '',
        linksQuery.data ?? { outgoing: [], incoming: [] },
        endpointsQuery.data ?? new Map(),
        typeLabels,
      ),
    [recordId, linksQuery.data, endpointsQuery.data, typeLabels],
  )
  return {
    outgoing: rows.outgoing,
    incoming: rows.incoming,
    isLoading: linksQuery.isLoading || endpointsQuery.isLoading,
  }
}
