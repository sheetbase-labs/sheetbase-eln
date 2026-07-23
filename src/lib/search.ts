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
  project_id: string
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

export type SearchResultType = 'record' | 'file'

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

export interface SearchResult {
  resultType: SearchResultType
  recordId: string
  kind: string
  identifier: string
  title: string
  status: string
  projectId: string
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
}

/** Record kinds that can be filtered. Matches the chk_records_kind constraint. */
export const SEARCHABLE_KINDS = [
  'experiment',
  'protocol_template',
  'report',
  'sample',
  'reagent',
  'file',
  'notebook_template',
] as const

export type SearchableKind = (typeof SEARCHABLE_KINDS)[number]

// ---------------------------------------------------------------------------
// Wire → domain mapper.
// ---------------------------------------------------------------------------

export function toSearchResult(row: SearchResultWire): SearchResult {
  return {
    resultType: row.result_type === 'file' ? 'file' : 'record',
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
    deepLink: row.deep_link,
    totalCount: Number(row.total_count),
  }
}

// ---------------------------------------------------------------------------
// RPC argument builder.
// ---------------------------------------------------------------------------

/**
 * Build the arguments object for the `api.search` RPC from UI filters.
 * Strips empty/undefined values so the RPC defaults apply. Validates that
 * kind is a known record kind if provided.
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
  kind: string,
  projectId: string,
  recordId: string,
): string {
  if (kind === 'notebook_template') return '/templates'
  return `/projects/${projectId}/experiments/${recordId}`
}

// ---------------------------------------------------------------------------
// Matched context rendering.
// ---------------------------------------------------------------------------

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
}

export function matchedFieldLabel(field: string): string {
  return MATCHED_FIELD_LABELS[field as MatchedField] ?? 'Matched'
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
            ? row.map((cell) => (typeof cell === 'string' ? cell : '')).join(' ')
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
        .map((k) => (typeof obj[k] === 'string' ? (obj[k] as string) : ''))
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
    return Object.values(value)
      .map(extractAllStrings)
      .filter(Boolean)
      .join(' ')
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
  search: (filters: SearchFilters) => [
    'sci-008',
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
