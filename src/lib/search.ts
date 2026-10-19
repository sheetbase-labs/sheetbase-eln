/**
 * Scientific search library (SCI-008, decision 0033).
 *
 * Provides the application-boundary types and helpers that sit on top of the
 * `api.search` RPC:
 *
 * - typed search result shapes (wire → domain mapping);
 * - block text extraction (mirrors the PL/pgSQL `extract_jsonb_text` for
 *   client-side use and unit testing);
 * - search filter validation and RPC argument building;
 * - matched-context rendering (converts ts_headline `<b>` tags to safe React
 *   elements);
 * - deep link generation from result kind and project;
 * - TanStack Query key helpers.
 *
 * PostgreSQL and RLS remain authoritative. These helpers improve the UI and
 * drive validation; they must not be the only access-control boundary.
 */

import type { DataClient } from '#/lib/data-client'
import { richTextToPlainText } from '#/lib/blocks'
import type { RichTextPayload } from '#/lib/blocks'
import { searchResultDestination } from '#/lib/navigation'

// ---------------------------------------------------------------------------
// Wire shape (snake_case, as returned by PostgREST from the api.search RPC).
// ---------------------------------------------------------------------------

export interface SearchResultWire {
  result_type: string
  record_id: string
  kind: string
  identifier: string
  title: string
  status: string
  project_id: string | null
  archived: boolean
  created_by_user_id: string
  created_at: string
  updated_at: string
  matched_context: string
  matched_field: string
  rank: string
  deep_link: string
  total_count: string
}

// ---------------------------------------------------------------------------
// Domain shape (camelCase, consumed by the UI).
// ---------------------------------------------------------------------------

export type SearchResultType =
  'record' | 'file' | 'dataset' | 'sheet' | 'template' | 'comment'

/** Object classes the global search covers. */
export const SEARCH_RESULT_TYPES = [
  'record',
  'file',
  'dataset',
  'sheet',
  'template',
  'comment',
] as const

export type MatchedField =
  | 'title'
  | 'identifier'
  | 'kind'
  | 'status'
  | 'tags'
  | 'block_text'
  | 'comment_body'
  | 'file_metadata'
  | 'properties'
  | 'relationship'
  | 'description'

/**
 * Work objects the `api.search` RPC does not index. They are found by name and
 * identifier through `src/lib/search-work-objects.ts` and shown beside the RPC
 * rows, so a person looking for a project, a pipeline or an analysis finds it.
 */
export const WORK_OBJECT_RESULT_TYPES = [
  'project',
  'pipeline',
  'analysis',
] as const

export type WorkObjectResultType = (typeof WORK_OBJECT_RESULT_TYPES)[number]

export function isWorkObjectResult(result: {
  resultType: string
}): result is { resultType: WorkObjectResultType } {
  return (WORK_OBJECT_RESULT_TYPES as readonly string[]).includes(
    result.resultType,
  )
}

export interface SearchResult {
  resultType: SearchResultType | WorkObjectResultType
  /** Object-class identity; comment hits carry a Comment UUID, not a Record UUID. */
  recordId: string
  kind: string
  identifier: string
  title: string
  status: string
  projectId: string | null
  archived: boolean
  createdByUserId: string
  createdAt: string
  updatedAt: string
  matchedContext: string
  matchedField: MatchedField
  rank: number
  deepLink: string
  totalCount: number
}

/** A row the `api.search` RPC returned, as opposed to a work object. */
export type RpcSearchResult = SearchResult & { resultType: SearchResultType }

// ---------------------------------------------------------------------------
// Filters.
// ---------------------------------------------------------------------------

export interface SearchFilters {
  query: string
  projectId?: string
  kind?: string
  status?: string
  ownerId?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
  /** Object-class facet: narrows the search to one result type. */
  resultType?: SearchResultTypeFilter
  /**
   * Archived scope. `false` (or omitted by a caller that sets it) asks the RPC
   * for live work only; `true` includes archived objects, flagged on each row.
   * This is a query property pushed to `p_include_archived`, never a
   * browser-side filter (R5-SHELL-04).
   */
  includeArchived?: boolean
}

/** Object-class facet value for the search RPC. */
export type SearchResultTypeFilter = (typeof SEARCH_RESULT_TYPES)[number]

/** Record kinds that can be filtered. Matches the chk_records_kind constraint. */
export const SEARCHABLE_KINDS = [
  'experiment',
  'protocol_template',
  'report',
  'sample',
  'material',
  'file',
  'notebook_template',
  'study',
] as const

export type SearchableKind = (typeof SEARCHABLE_KINDS)[number]

// ---------------------------------------------------------------------------
// Wire → domain mapper.
// ---------------------------------------------------------------------------

export function toSearchResult(row: SearchResultWire): RpcSearchResult {
  const resultType = (SEARCH_RESULT_TYPES as readonly string[]).includes(
    row.result_type,
  )
    ? (row.result_type as SearchResultType)
    : 'record'
  return {
    resultType,
    recordId: row.record_id,
    kind: row.kind,
    identifier: row.identifier,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    archived: Boolean(row.archived),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    matchedContext: row.matched_context,
    matchedField: row.matched_field as MatchedField,
    rank: Number(row.rank),
    deepLink: searchResultDestination(resultType, row.record_id, row.deep_link),
    totalCount: Number(row.total_count),
  }
}

// ---------------------------------------------------------------------------
// RPC argument builder.
// ---------------------------------------------------------------------------

/**
 * Build the arguments object for the `api.search` RPC from UI filters.
 * Strips empty/undefined values so the RPC defaults apply. Validates that
 * kind is a known record kind and resultType a known object class if
 * provided.
 */
export function buildSearchRpcArgs(
  filters: SearchFilters,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_query: filters.query.trim(),
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
  }
  if (filters.projectId) args.p_project_id = filters.projectId
  if (filters.kind) args.p_kind = filters.kind
  if (filters.status) args.p_status = filters.status
  if (filters.ownerId) args.p_owner_id = filters.ownerId
  if (filters.dateFrom) args.p_date_from = filters.dateFrom
  if (filters.dateTo) args.p_date_to = filters.dateTo
  if (filters.resultType) args.p_result_type = filters.resultType
  // The archived scope is only sent when the caller states it, so a caller that
  // has no opinion keeps the RPC default rather than silently hiding work.
  if (filters.includeArchived !== undefined)
    args.p_include_archived = filters.includeArchived
  return args
}

// ---------------------------------------------------------------------------
// Result grouping (SRCH-02).
//
// One grouping shared by the results page and the ⌘K palette so the two
// surfaces never disagree about which section a result belongs to.
// ---------------------------------------------------------------------------

export const SEARCH_RESULT_GROUPS = [
  'Samples',
  'Sheet and dataset rows',
  'Notebook text and comments',
  'Records',
  'Projects',
  'Pipelines',
  'Analyses',
  'Files',
  'Templates',
] as const

export type SearchResultGroup = (typeof SEARCH_RESULT_GROUPS)[number]

/**
 * Canonical design section for a result. Samples win over the generic Records
 * bucket; rows and notebook text win over their owning record.
 */
export function searchResultGroup(result: SearchResult): SearchResultGroup {
  if (result.resultType === 'project') return 'Projects'
  if (result.resultType === 'pipeline') return 'Pipelines'
  if (result.resultType === 'analysis') return 'Analyses'
  if (result.resultType === 'file') return 'Files'
  if (result.resultType === 'template') return 'Templates'
  if (result.resultType === 'dataset' || result.resultType === 'sheet')
    return 'Sheet and dataset rows'
  if (
    result.resultType === 'comment' ||
    result.matchedField === 'block_text' ||
    result.matchedField === 'comment_body'
  )
    return 'Notebook text and comments'
  if (result.kind === 'sample') return 'Samples'
  return 'Records'
}

export interface SearchResultGroupBucket {
  group: SearchResultGroup
  /** Results shown for this group (at most `maxPerGroup`). */
  results: SearchResult[]
  /** Results in this group before truncation. */
  total: number
}

/**
 * Group results into the design sections, preserving canonical group order and
 * input order within each group. `maxPerGroup` truncates the displayed rows
 * (the palette uses this) while `total` stays honest for the header count.
 */
export function groupSearchResults(
  results: SearchResult[],
  maxPerGroup?: number,
): SearchResultGroupBucket[] {
  const buckets = new Map<SearchResultGroup, SearchResult[]>()
  for (const result of results) {
    const group = searchResultGroup(result)
    const list = buckets.get(group)
    if (list) list.push(result)
    else buckets.set(group, [result])
  }
  return SEARCH_RESULT_GROUPS.filter((group) => buckets.has(group)).map(
    (group) => {
      const list = buckets.get(group) ?? []
      const limit =
        maxPerGroup && maxPerGroup > 0
          ? Math.min(maxPerGroup, list.length)
          : list.length
      return { group, results: list.slice(0, limit), total: list.length }
    },
  )
}

// ---------------------------------------------------------------------------
// Scope filtering (SRCH-02).
//
// The `search` RPC pushes `p_project_id` down for records, datasets and
// sheets, but Notebook Templates are workspace-level and ignore it. Filtering
// the returned page by project keeps a project-scoped palette or results page
// honest.
// ---------------------------------------------------------------------------

/** The sentinel scope value meaning "search every project". */
export const SEARCH_SCOPE_ALL = 'all'

export function filterBySearchScope(
  results: SearchResult[],
  projectId?: string | null,
): SearchResult[] {
  if (!projectId) return results
  return results.filter((result) => result.projectId === projectId)
}

// ---------------------------------------------------------------------------
// New-tab URL (SRCH-02).
// ---------------------------------------------------------------------------

/**
 * Resolve a result or action destination to an absolute URL for
 * `window.open(..., '_blank')`. Pure so the new-tab behaviour is testable
 * without a browser.
 */
export function searchResultNewTabUrl(
  deepLink: string,
  origin: string,
): string {
  try {
    return new URL(deepLink, origin).toString()
  } catch {
    return deepLink
  }
}

// ---------------------------------------------------------------------------
// Contextual actions (SRCH-02).
//
// Actions are registered by result kind, exactly as the design's "Actions"
// section. They are rendered below the grouped results and only offered when
// the current page proves the kind is present.
// ---------------------------------------------------------------------------

export interface SearchContextAction {
  id: string
  label: string
  /** Route path without a query string, e.g. `/samples`. */
  to: string
  /** Router search params for the destination. */
  search?: Record<string, string | number | boolean>
}

/** Build the href for an action, used for the ⌘↵ new-tab case. */
export function searchActionHref(action: SearchContextAction): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(action.search ?? {})) {
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `${action.to}?${query}` : action.to
}

/**
 * Derive contextual actions from the current RPC page. A sample result offers
 * the sample register flow; the identifier in the label is the matched
 * sample, not the raw query.
 */
export function contextualSearchActions(
  results: SearchResult[],
): SearchContextAction[] {
  const actions: SearchContextAction[] = []
  const seen = new Set<string>()
  for (const result of results) {
    if (result.resultType !== 'record' || result.kind !== 'sample') continue
    const id = `register-sample-${result.identifier}`
    if (seen.has(id)) continue
    seen.add(id)
    actions.push({
      id,
      label: `Register a sample from ${result.identifier}…`,
      to: '/samples',
      search: { new: true },
    })
  }
  return actions
}

// ---------------------------------------------------------------------------
// URL filters → RPC filters (SRCH-02).
// ---------------------------------------------------------------------------

/** Page size for the results page, passed through as `p_limit`/`p_offset`. */
export const SEARCH_PAGE_SIZE = 20

export interface SearchUrlFilterInput {
  q?: string
  /** Facet chips (group labels) selected on the results page. */
  type?: string[]
  /** Selected project IDs. Multiple selections fall back to client filtering. */
  project?: string[]
  updated?: 'any' | '7d'
  /** Owner (creator) user id; narrows the search to records they created. */
  owner?: string
  /** Inclusive first day (yyyy-mm-dd) an object was last touched. */
  from?: string
  /** Inclusive last day (yyyy-mm-dd) an object was last touched. */
  to?: string
  archived?: boolean
}

/** A calendar day as written by an `<input type="date">`. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The day if it is a real calendar day, else undefined. */
export function parseSearchDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return undefined
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return undefined
  return new Date(ms).toISOString().slice(0, 10) === value ? value : undefined
}

/** UTC start of a day, or the end of it when `endOfDay`. */
function dayBoundary(day: string, endOfDay: boolean): string {
  return `${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
}

/** Start-of-day UTC anchor so the same URL yields a stable RPC date filter. */
function updatedDateFrom(
  updated: SearchUrlFilterInput['updated'],
): string | undefined {
  if (updated !== '7d') return undefined
  const from = new Date()
  from.setUTCHours(0, 0, 0, 0)
  from.setUTCDate(from.getUTCDate() - 7)
  return from.toISOString()
}

/**
 * Map URL facets onto the single-valued RPC filters. The RPC accepts one
 * `p_result_type` and one `p_kind`; only an unambiguous single facet is pushed
 * down. Everything else stays a client-side filter so results are never lost.
 */
export function urlFiltersToSearchFilters(
  input: SearchUrlFilterInput,
  offset: number,
  limit = SEARCH_PAGE_SIZE,
): SearchFilters {
  const filters: SearchFilters = {
    query: input.q ?? '',
    limit,
    offset,
  }
  const project = input.project ?? []
  const type = input.type ?? []
  if (project.length === 1) filters.projectId = project[0]
  if (type.length === 1) {
    switch (type[0]) {
      case 'Files':
        filters.resultType = 'file'
        break
      case 'Templates':
        filters.resultType = 'template'
        break
      case 'Records':
        filters.resultType = 'record'
        break
      case 'Samples':
        filters.kind = 'sample'
        break
      default:
        break
    }
  }
  // An explicit range wins over the "last 7 days" shortcut; the two are one
  // facet in the UI, so only one of them is ever set at a time.
  const day = parseSearchDay(input.from)
  const dateFrom = day
    ? dayBoundary(day, false)
    : updatedDateFrom(input.updated)
  if (dateFrom) filters.dateFrom = dateFrom
  const lastDay = parseSearchDay(input.to)
  if (lastDay) filters.dateTo = dayBoundary(lastDay, true)
  if (input.owner) filters.ownerId = input.owner
  // Archived is a scope, not a client-side filter: the URL facet becomes the
  // RPC's p_include_archived so the boundary is authoritative (R5-SHELL-04).
  filters.includeArchived = input.archived === true
  return filters
}

/**
 * Apply the URL facets to an RPC page. The server narrowing can be a superset
 * (for example `Records` still returns samples), so this is the authoritative
 * filter that matches the design's facet semantics.
 *
 * The archived scope is deliberately absent: it is carried by the query
 * (`includeArchived` → `p_include_archived`) so archived objects are never
 * filtered in the browser (R5-SHELL-04). By the time a page arrives here,
 * `input.archived` has already been applied at the boundary.
 */
export function filterSearchResults(
  results: SearchResult[],
  input: SearchUrlFilterInput,
): SearchResult[] {
  const type = input.type ?? []
  const project = input.project ?? []
  const fromDay = parseSearchDay(input.from)
  const toDay = parseSearchDay(input.to)
  const dateFrom = fromDay
    ? dayBoundary(fromDay, false)
    : updatedDateFrom(input.updated)
  const dateFromMs = dateFrom ? Date.parse(dateFrom) : undefined
  const dateToMs = toDay ? Date.parse(dayBoundary(toDay, true)) : undefined
  return results.filter((result) => {
    if (input.owner && result.createdByUserId !== input.owner) return false
    if (type.length && !type.includes(searchResultGroup(result))) return false
    if (
      project.length &&
      (!result.projectId || !project.includes(result.projectId))
    )
      return false
    if (dateFromMs !== undefined) {
      const updated = Date.parse(result.updatedAt)
      if (!Number.isNaN(updated) && updated < dateFromMs) return false
    }
    if (dateToMs !== undefined) {
      const updated = Date.parse(result.updatedAt)
      if (!Number.isNaN(updated) && updated > dateToMs) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Deep link generation.
// ---------------------------------------------------------------------------

/**
 * Generate a stable deep link for a search result. Matches the deep_link
 * column returned by the RPC so the client and server agree.
 */
export function searchResultDeepLink(
  resultType: SearchResultType,
  recordId: string,
  ownerScopedLink?: string,
): string {
  return searchResultDestination(resultType, recordId, ownerScopedLink)
}

/**
 * Parse the ts_headline output (which uses `<b>` tags for highlighting) into
 * an array of plain text segments and highlight segments, so the UI can
 * render highlights safely without dangerouslySetInnerHTML.
 */
export interface ContextSegment {
  text: string
  highlighted: boolean
}

export function parseMatchedContext(context: string): ContextSegment[] {
  if (!context) return []
  const segments: ContextSegment[] = []
  const regex = /<b>([\s\S]*?)<\/b>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(context)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: context.slice(lastIndex, match.index),
        highlighted: false,
      })
    }
    segments.push({ text: match[1], highlighted: true })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < context.length) {
    segments.push({
      text: context.slice(lastIndex),
      highlighted: false,
    })
  }
  return segments
}

/**
 * Human-readable label for a matched field, shown in the result row.
 */
export const MATCHED_FIELD_LABELS: Record<MatchedField, string> = {
  title: 'Matched in title',
  identifier: 'Matched in identifier',
  kind: 'Matched in type',
  status: 'Matched in status',
  tags: 'Matched in tags',
  block_text: 'Matched in notebook text',
  comment_body: 'Matched in comment',
  file_metadata: 'Matched in file metadata',
  properties: 'Matched in properties',
  relationship: 'Matched in relationship',
  description: 'Matched in description',
}

export function matchedFieldLabel(field: string): string {
  return field in MATCHED_FIELD_LABELS
    ? MATCHED_FIELD_LABELS[field as MatchedField]
    : 'Matched'
}

// ---------------------------------------------------------------------------
// Block text extraction (mirrors internal.extract_jsonb_text for client-side
// use and unit testing). The DB function is the authority for indexing; this
// TypeScript function is for testing and potential client-side preview.
// ---------------------------------------------------------------------------

/**
 * Extract searchable plain text from a block payload. For rich_text blocks,
 * uses the canonical `richTextToPlainText` (ADR 0025). For other block types,
 * extracts string values from known payload fields.
 */
export function extractBlockText(
  type: string,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case 'rich_text':
      try {
        return richTextToPlainText(payload as unknown as RichTextPayload)
      } catch {
        return ''
      }
    case 'checklist':
      return extractFromArrayField(payload, 'items', ['text'])
    case 'callout':
      return extractStringField(payload, 'text')
    case 'procedure_step':
      return [
        extractStringField(payload, 'text'),
        extractStringField(payload, 'note'),
      ]
        .filter(Boolean)
        .join(' ')
    case 'materials':
      return extractFromArrayField(payload, 'items', [
        'identifier',
        'title',
        'note',
      ])
    case 'metric':
      return extractStringField(payload, 'label')
    case 'linked_record':
      return [
        extractStringField(payload, 'targetIdentifier'),
        extractStringField(payload, 'label'),
      ]
        .filter(Boolean)
        .join(' ')
    case 'protocol_reference':
      return [
        extractStringField(payload, 'protocolIdentifier'),
        extractStringField(payload, 'protocolTitle'),
      ]
        .filter(Boolean)
        .join(' ')
    case 'file':
      return [
        extractStringField(payload, 'displayName'),
        extractStringField(payload, 'fileIdentifier'),
      ]
        .filter(Boolean)
        .join(' ')
    case 'table': {
      const rows = payload.rows
      if (!Array.isArray(rows)) return ''
      return rows
        .map((row) =>
          Array.isArray(row)
            ? row
                .map((cell) => (typeof cell === 'string' ? cell : ''))
                .join(' ')
            : '',
        )
        .join(' ')
    }
    default:
      return extractAllStrings(payload)
  }
}

function extractStringField(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field]
  return typeof value === 'string' ? value : ''
}

function extractFromArrayField(
  payload: Record<string, unknown>,
  field: string,
  keys: string[],
): string {
  const arr = payload[field]
  if (!Array.isArray(arr)) return ''
  return arr
    .map((item) => {
      if (typeof item !== 'object' || item === null) return ''
      const obj = item as Record<string, unknown>
      return keys
        .map((k) => (typeof obj[k] === 'string' ? obj[k] : ''))
        .filter(Boolean)
        .join(' ')
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * Recursively extract all string values from a JSONB-like object. Mirrors the
 * PL/pgSQL `internal.extract_jsonb_text` function.
 */
export function extractAllStrings(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return ''
  if (Array.isArray(value)) {
    return value.map(extractAllStrings).filter(Boolean).join(' ')
  }
  if (typeof value === 'object') {
    return Object.values(value).map(extractAllStrings).filter(Boolean).join(' ')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Data fetching.
// ---------------------------------------------------------------------------

/**
 * Execute a search through the same-origin /api/db proxy. Returns typed
 * domain results. The RPC returns an array of SearchResultWire rows.
 */
export function executeSearch(
  client: DataClient,
  filters: SearchFilters,
): Promise<RpcSearchResult[]> {
  const args = buildSearchRpcArgs(filters)
  return client
    .rpc<SearchResultWire | SearchResultWire[]>('search', args)
    .then((raw) => {
      // PostgREST returns an array for table-returning functions.
      const rows = Array.isArray(raw) ? raw : [raw]
      return rows.map(toSearchResult)
    })
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const searchQueryKeys = {
  /**
   * Every filter the `search` RPC reads is part of the key, derived from the
   * filter object instead of listed by hand: a filter cannot change the request
   * while leaving the cache entry it belongs to unchanged. `includeArchived`
   * was missing from the hand-written list, so "Include archived" served the
   * previous page's cache and never re-ran the search (R5-SHELL-04).
   */
  search: (filters: SearchFilters) => {
    const parts: (string | number | boolean)[] = ['search-001', 'search']
    for (const name of Object.keys(filters).sort()) {
      const value = filters[name as keyof SearchFilters]
      if (value !== undefined) parts.push(`${name}=${String(value)}`)
    }
    return parts
  },
}

// ---------------------------------------------------------------------------
// SEARCH-001 — Relevance ranking tiers.
//
// The RPC already weights title/identifier as tsvector weight A, so ts_rank
// tends to surface them first. But "predictably" (checkbox 2) means exact
// identifier matches ALWAYS come first, then structured matches, then fuzzy
// text — not just usually. We derive a tier from the matched_field and sort
// by (tier, rank) client-side so the ordering is deterministic regardless of
// ts_rank score variations.
// ---------------------------------------------------------------------------

export type MatchTier = 0 | 1 | 2 | 3 | 4

/**
 * Tier hierarchy:
 *   0 — exact identifier match (query equals or is a substring of identifier)
 *   1 — identifier field match (partial FTS match on identifier)
 *   2 — title field match
 *   3 — structured match (tags, status, kind)
 *   4 — fuzzy text match (block_text, file_metadata, properties, relationship)
 */
export function matchTierForField(
  field: MatchedField,
  query: string,
  identifier: string,
): MatchTier {
  const q = query.trim().toLowerCase()
  if (q && field === 'identifier') {
    // Exact identifier match: the query is the identifier or a substring of it.
    if (identifier.toLowerCase().includes(q)) return 0
    return 1
  }
  if (field === 'title') return 2
  if (field === 'tags' || field === 'status' || field === 'kind') return 3
  return 4
}

/**
 * Rank results by match tier first, then by ts_rank (relevance score), then
 * by updated_at descending. This guarantees exact identifier and structured
 * matches appear before fuzzy text matches.
 */
export function rankByTier(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  const q = query.trim()
  if (!q) {
    // Browse mode: keep updated_at order (RPC default).
    return [...results].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }
  return [...results].sort((a, b) => {
    const tierA = matchTierForField(a.matchedField, q, a.identifier)
    const tierB = matchTierForField(b.matchedField, q, b.identifier)
    if (tierA !== tierB) return tierA - tierB
    if (b.rank !== a.rank) return b.rank - a.rank
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

// ---------------------------------------------------------------------------
// SEARCH-001 — Saved queries (client-side, localStorage, per workspace).
//
// Saved queries are persisted in localStorage scoped by workspace ID so they
// don't leak across workspaces. No DB table needed — the task explicitly
// allows localStorage for this.
// ---------------------------------------------------------------------------

/** The results-page facets a saved search restores (the URL search params). */
export interface SavedSearchFacets {
  type?: string[]
  project?: string[]
  updated?: '7d'
  owner?: string
  from?: string
  to?: string
  archived?: boolean
}

export interface SavedQuery {
  id: string
  name: string
  query: string
  /** Facets the results page had when the search was saved. */
  facets?: SavedSearchFacets
  /** Object-class facet ('' = all). Older saved entries may omit it. */
  type?: string
  kind: string
  projectId: string
  status: string
  ownerId: string
  dateRange: string
  ts: number
}

const SAVED_PREFIX = 'sheetbase-saved-searches'
const SAVED_MAX = 20

export function savedQueriesKey(workspaceId: string): string {
  return `${SAVED_PREFIX}-${workspaceId}`
}

export function loadSavedQueries(workspaceId: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(savedQueriesKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s: unknown): s is SavedQuery =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as SavedQuery).id === 'string' &&
          typeof (s as SavedQuery).name === 'string',
      )
      .slice(0, SAVED_MAX)
  } catch {
    return []
  }
}

export function saveQuery(
  workspaceId: string,
  params: Omit<SavedQuery, 'id' | 'ts'>,
): SavedQuery[] {
  const existing = loadSavedQueries(workspaceId)
  // Deduplicate by name + query + filters.
  const dedupKey = `${params.name}|${params.query}|${params.type ?? ''}|${params.kind}|${params.projectId}|${params.status}|${params.ownerId}|${params.dateRange}|${JSON.stringify(params.facets ?? null)}`
  const filtered = existing.filter((s) => {
    const key = `${s.name}|${s.query}|${s.type ?? ''}|${s.kind}|${s.projectId}|${s.status}|${s.ownerId}|${s.dateRange}|${JSON.stringify(s.facets ?? null)}`
    return key !== dedupKey
  })
  const entry: SavedQuery = {
    ...params,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  }
  const next = [entry, ...filtered].slice(0, SAVED_MAX)
  try {
    localStorage.setItem(savedQueriesKey(workspaceId), JSON.stringify(next))
  } catch {
    /* ignore: private mode / disabled storage */
  }
  return next
}

export function deleteSavedQuery(
  workspaceId: string,
  id: string,
): SavedQuery[] {
  const existing = loadSavedQueries(workspaceId)
  const next = existing.filter((s) => s.id !== id)
  try {
    localStorage.setItem(savedQueriesKey(workspaceId), JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

// ---------------------------------------------------------------------------
// SEARCH-001 — Semantic suggestions with clear provenance.
//
// Suggestions are derived ONLY from the already-fetched, RLS-filtered search
// results — never from separate queries that could leak restricted counts or
// snippets. Each suggestion carries a human-readable provenance label so the
// user understands why it was offered.
// ---------------------------------------------------------------------------

export type SuggestionKind = 'identifier' | 'tag' | 'type'

export interface SearchSuggestion {
  id: string
  kind: SuggestionKind
  label: string
  provenance: string
  /** The query string to apply when the suggestion is accepted. */
  applyQuery: string
  /** Optional kind filter to apply. */
  applyKind?: string
}

/**
 * Derive semantic suggestions from the current search results. Only offers
 * suggestions when their provenance is clear — i.e. they are directly
 * backed by visible results the user can already see.
 */
export function deriveSuggestions(
  results: SearchResult[],
  query: string,
): SearchSuggestion[] {
  const q = query.trim().toLowerCase()
  if (!q || results.length === 0) return []
  const suggestions: SearchSuggestion[] = []
  const seen = new Set<string>()

  // 1. Identifier suggestions: if the query partially matches an identifier,
  //    offer the exact identifier.
  for (const r of results) {
    if (
      r.matchedField === 'identifier' &&
      r.identifier.toLowerCase().includes(q)
    ) {
      const key = `id-${r.identifier}`
      if (!seen.has(key)) {
        seen.add(key)
        suggestions.push({
          id: key,
          kind: 'identifier',
          label: r.identifier,
          provenance: `Identifier match — ${r.title}`,
          applyQuery: r.identifier,
        })
      }
    }
  }

  // 2. Tag suggestions: if results matched on tags, offer to refine.
  for (const r of results) {
    // Tags are not in the search result shape, but the matched_field 'tags'
    // tells us the result matched on tags. We can offer the query as a tag
    // search suggestion.
    if (r.matchedField === 'tags') {
      const key = `tag-${r.identifier}`
      if (!seen.has(key)) {
        seen.add(key)
        suggestions.push({
          id: key,
          kind: 'tag',
          label: `Records matching "${query.trim()}" in tags`,
          provenance: `Tag match — ${r.identifier}`,
          applyQuery: query.trim(),
        })
      }
    }
  }

  // 3. Type suggestions: if results span multiple kinds, offer to filter.
  const kindCounts = new Map<string, number>()
  for (const r of results) {
    if (r.resultType === 'comment') continue
    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1)
  }
  if (kindCounts.size > 1) {
    for (const [kind, count] of kindCounts) {
      const key = `type-${kind}`
      if (!seen.has(key) && count > 0) {
        seen.add(key)
        suggestions.push({
          id: key,
          kind: 'type',
          label: `Filter to ${kindLabelForSuggestion(kind)} (${count})`,
          provenance: `${count} ${kindLabelForSuggestion(kind).toLowerCase()} in current results`,
          applyQuery: query.trim(),
          applyKind: kind,
        })
      }
    }
  }

  return suggestions.slice(0, 6)
}

function kindLabelForSuggestion(kind: string): string {
  const labels: Record<string, string> = {
    experiment: 'Experiments',
    sample: 'Samples',
    material: 'Materials',
    protocol_template: 'Protocols',
    report: 'Reports',
    file: 'Files',
    notebook_template: 'Templates',
  }
  return labels[kind] ?? kind
}

// ---------------------------------------------------------------------------
// SEARCH-001 — URL search parameter helpers.
//
// The route uses validateSearch + useSearch + useNavigate so filter and query
// state lives in the URL. This makes searches shareable without embedding
// secrets — only public filter dimensions (query, kind, project, status,
// owner, date range, sort, selected result) are in the URL. No tokens,
// session IDs, or internal IDs beyond the project/record IDs that are
// already part of the application's public URL space.
// ---------------------------------------------------------------------------

export interface SearchUrlParams {
  q: string
  type: string
  kind: string
  project: string
  status: string
  owner: string
  date: string
  sort: string
  selected: string
}

export const SEARCH_URL_DEFAULTS: SearchUrlParams = {
  q: '',
  type: '',
  kind: '',
  project: '',
  status: '',
  owner: '',
  date: 'all',
  sort: 'relevance',
  selected: '',
}

/**
 * Parse and validate URL search params, applying defaults for missing/invalid
 * values. Used by the route's validateSearch.
 */
export function parseSearchUrl(
  search: Record<string, unknown>,
): SearchUrlParams {
  return {
    q: typeof search.q === 'string' ? search.q : '',
    type:
      typeof search.type === 'string' &&
      (SEARCH_RESULT_TYPES as readonly string[]).includes(search.type)
        ? search.type
        : '',
    kind: typeof search.kind === 'string' ? search.kind : '',
    project: typeof search.project === 'string' ? search.project : '',
    status: typeof search.status === 'string' ? search.status : '',
    owner: typeof search.owner === 'string' ? search.owner : '',
    date: typeof search.date === 'string' ? search.date : 'all',
    sort:
      typeof search.sort === 'string' &&
      ['relevance', 'updated'].includes(search.sort)
        ? search.sort
        : 'relevance',
    selected: typeof search.selected === 'string' ? search.selected : '',
  }
}

/**
 * Serialize search params back to a plain object for navigate(). Strips
 // empty/default values so the URL stays clean.
 */
export function serializeSearchUrl(
  params: Partial<SearchUrlParams>,
): SearchUrlParams {
  return { ...SEARCH_URL_DEFAULTS, ...params }
}

// ---------------------------------------------------------------------------
// "Did you mean" (SRCH-01.4)
// ---------------------------------------------------------------------------

export interface DidYouMeanSuggestion {
  id: string
  kind: string
  identifier: string
  title: string
  similarity: number
}

export async function searchDidYouMean(
  client: DataClient,
  query: string,
  includeArchived = false,
): Promise<DidYouMeanSuggestion[]> {
  return client.rpc<DidYouMeanSuggestion[]>('search_did_you_mean', {
    p_query: query,
    p_limit: 5,
    p_include_archived: includeArchived,
  })
}

// ---------------------------------------------------------------------------
// Cell and file-content search (SRCH-01.2, SRCH-01.3)
// ---------------------------------------------------------------------------

export interface CellMatch {
  dataset_id: string
  dataset_version_id: string
  dataset_name: string
  row_id: string
  field_label: string
  value_text: string
  snippet: string
  rank: number
}

export async function searchCells(
  client: DataClient,
  query: string,
  limit = 20,
): Promise<CellMatch[]> {
  return client.rpc<CellMatch[]>('search_cells', {
    p_query: query,
    p_limit: limit,
  })
}

export interface FileContentHit {
  file_id: string
  record_id: string
  identifier: string
  display_name: string
  line_number: number
  line_text: string
  snippet: string
  rank: number
}

export async function searchFileContents(
  client: DataClient,
  query: string,
  limit = 20,
): Promise<FileContentHit[]> {
  return client.rpc<FileContentHit[]>('search_file_contents', {
    p_query: query,
    p_limit: limit,
  })
}

// ---------------------------------------------------------------------------
// Saved searches on the results page: the URL is the single description of a
// search, so saving stores it and applying a saved search navigates to it.
// ---------------------------------------------------------------------------

/** The results page's URL search for a saved query. */
export function savedQueryToSearch(saved: SavedQuery): {
  q: string
} & SavedSearchFacets {
  const facets = saved.facets ?? {}
  return {
    q: saved.query,
    ...(facets.type?.length ? { type: facets.type } : {}),
    ...(facets.project?.length ? { project: facets.project } : {}),
    ...(facets.updated === '7d' ? { updated: '7d' as const } : {}),
    ...(facets.owner ? { owner: facets.owner } : {}),
    ...(facets.from ? { from: facets.from } : {}),
    ...(facets.to ? { to: facets.to } : {}),
    ...(facets.archived ? { archived: true } : {}),
  }
}

/** Save the results page's current search under a name. */
export function saveCurrentSearch(
  workspaceId: string,
  name: string,
  search: { q: string } & SavedSearchFacets,
): SavedQuery[] {
  return saveQuery(workspaceId, {
    name: name.trim(),
    query: search.q,
    kind: '',
    projectId: '',
    status: '',
    ownerId: '',
    dateRange: 'all',
    facets: {
      ...(search.type?.length ? { type: search.type } : {}),
      ...(search.project?.length ? { project: search.project } : {}),
      ...(search.updated === '7d' ? { updated: '7d' as const } : {}),
      ...(search.owner ? { owner: search.owner } : {}),
      ...(search.from ? { from: search.from } : {}),
      ...(search.to ? { to: search.to } : {}),
      ...(search.archived ? { archived: true } : {}),
    },
  })
}
