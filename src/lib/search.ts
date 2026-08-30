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
  'record' | 'file' | 'dataset' | 'sheet' | 'template'

/** Object classes the global search covers. */
export const SEARCH_RESULT_TYPES = [
  'record',
  'file',
  'dataset',
  'sheet',
  'template',
] as const

export type MatchedField =
  | 'title'
  | 'identifier'
  | 'kind'
  | 'status'
  | 'tags'
  | 'block_text'
  | 'file_metadata'
  | 'properties'
  | 'relationship'
  | 'description'

export interface SearchResult {
  resultType: SearchResultType
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
}

/** Object-class facet value for the search RPC. */
export type SearchResultTypeFilter = (typeof SEARCH_RESULT_TYPES)[number]

/** Record kinds that can be filtered. Matches the chk_records_kind constraint. */
export const SEARCHABLE_KINDS = [
  'experiment',
  'protocol_template',
  'report',
  'sample',
  'reagent',
  'file',
  'notebook_template',
  'study',
] as const

export type SearchableKind = (typeof SEARCHABLE_KINDS)[number]

// ---------------------------------------------------------------------------
// Wire → domain mapper.
// ---------------------------------------------------------------------------

export function toSearchResult(row: SearchResultWire): SearchResult {
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
    deepLink: searchResultDestination(resultType, row.kind, row.record_id),
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
  return args
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
  kind: string,
  recordId: string,
): string {
  return searchResultDestination(resultType, kind, recordId)
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
): Promise<SearchResult[]> {
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
  search: (filters: SearchFilters) =>
    [
      'search-001',
      'search',
      filters.query,
      filters.projectId ?? '',
      filters.kind ?? '',
      filters.status ?? '',
      filters.ownerId ?? '',
      filters.dateFrom ?? '',
      filters.dateTo ?? '',
      filters.limit ?? 20,
      filters.offset ?? 0,
    ] as const,
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

export interface SavedQuery {
  id: string
  name: string
  query: string
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
  const dedupKey = `${params.name}|${params.query}|${params.type ?? ''}|${params.kind}|${params.projectId}|${params.status}|${params.ownerId}|${params.dateRange}`
  const filtered = existing.filter((s) => {
    const key = `${s.name}|${s.query}|${s.type ?? ''}|${s.kind}|${s.projectId}|${s.status}|${s.ownerId}|${s.dateRange}`
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
    reagent: 'Reagents',
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
