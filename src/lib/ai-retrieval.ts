/**
 * AI-02 — Knowledge Retrieval & Citation.
 *
 * Grounded retrieval over the permitted canonical objects. Retrieval runs
 * through the actor's own `DataClient` against the existing RLS search RPC
 * (`api.search`, SCI-008 / DATA-04) — no new search engine, no new index
 * tables, no model calls (AI-03's domain), no persistence.
 *
 * Permission model: retrieval never grants access beyond the requesting
 * actor. The RPC is SECURITY INVOKER and every source table enforces
 * workspace RLS, so an invisible object reads as absent. Counts and rows
 * derive from the same permission-filtered set, which means hidden results
 * are *unknowable* without leaking existence through totals: retrieval
 * therefore returns only visible rows and emits no hidden-result marker.
 * Silence about invisible objects is by design, not an omission to fix —
 * minting such a marker would require an unfiltered count that leaks.
 *
 * Lifecycle rule (mirrors docs/api/search-api.md "Archived-result
 * behaviour"):
 * - Soft-deleted records (`deleted_at IS NOT NULL`) are excluded by the RPC
 *   and never appear as citations — same silence as invisible objects.
 * - Archived records, archived Datasets / Sheet Instances, and retired
 *   Notebook Templates are INCLUDED and explicitly marked with
 *   `archived: true` on the citation, so a consumer can discount stale
 *   lifecycle state. Archival is lifecycle state, not an immutable version:
 *   `freshness` stays `'live'` and `versionPin` stays `null`.
 *
 * Freshness/pin model: search indexes live state only, so every citation is
 * `freshness: 'live'` with `versionPin: null`, stated explicitly rather than
 * left ambiguous. Immutable pins enter only when the caller asserts them as
 * `AiObjectRef.pinnedVersionId` while feeding citations into the envelope
 * (AI-01 states those verbatim and, for Datasets, withholds live rows).
 *
 * Envelope integration: `assembleGroundedContext` maps citations to AI-01
 * object refs and assembles them with `assembleAiContext`, so the full
 * section/budget machinery applies unchanged — per-section truncation
 * markers, `maxSectionsPerObject` cuts, and `budget_exceeded` omissions for
 * citations that do not fit. The quoted `matchedContext` travels on the
 * citation alongside its envelope object (correspondence by `stableId`).
 * Template citations have no envelope object kind, so they stay citable but
 * become explicit `unsupported_kind` omissions in the envelope.
 */

import { assembleAiContext } from './ai-context'
import type {
  AiContextActor,
  AiContextBudgets,
  AiContextEnvelope,
  AiContextOmission,
  AiFreshness,
  AiObjectRef,
  AiObjectRefKind,
} from './ai-context'
import type { DataClient } from './data-client'
import { executeSearch } from './search'
import type { RpcSearchResult, SearchResultType } from './search'

/** Object classes retrieval can cite. Matches the search RPC contract. */
export type AiCitationKind = SearchResultType

/** Default retrieval window: small enough to fit the envelope's maxObjects. */
export const DEFAULT_AI_RETRIEVAL_LIMIT = 10

/** Retrieval clamps to the RPC page range the search surface supports. */
export const MAX_AI_RETRIEVAL_LIMIT = 50

export interface AiCitation {
  /** Object class (`record`, `file`, `dataset`, `sheet`, `template`, `comment`). */
  kind: AiCitationKind
  /** Canonical stable UUID of the cited object. */
  stableId: string
  /** Stable public identifier (record identifier, dataset/sheet UUID, …). */
  identifier: string
  /** Fine-grained kind (record kind, `dataset`, `sheet_instance`, …). */
  recordKind: string
  title: string
  /** Canonical product deep link for the cited object. */
  deepLink: string
  /** Immutable version pin; always null from live search (see module doc). */
  versionPin: string | null
  /** Always `'live'` from search; archival is marked via `archived`. */
  freshness: AiFreshness
  /** True for archived records / datasets / sheets and retired templates. */
  archived: boolean
  /** `ts_headline` snippet with `<b>` highlights (never full content). */
  matchedContext: string
  /** Which indexed source matched (title, block_text, description, …). */
  matchedField: string
  /** PostgreSQL `ts_rank` relevance score (0 in browse mode). */
  rank: number
}

export interface AiRetrievalScope {
  workspaceId: string
  projectId?: string | null
  resultType?: SearchResultType
  kind?: string
  status?: string
  ownerId?: string
  /** Top-N window. Default 10, clamped to 1–50. No offset: retrieval takes
   * the top-ranked window; paging is a UI concern, not a grounding one. */
  limit?: number
}

export interface AiRetrievalResult {
  citations: AiCitation[]
  /** Total matching rows before the limit, from the permission-filtered
   * set — it never counts objects the actor cannot see. */
  totalCount: number
  hasMore: boolean
}

/**
 * Map one RLS-filtered search result to a citation. The deep link is the
 * client-canonical destination (see `searchResultDestination`); the stable
 * ID is the RPC's canonical object UUID, resolvable under normal
 * permissions through the same actor's reads.
 */
export function toAiCitation(result: RpcSearchResult): AiCitation {
  return {
    kind: result.resultType,
    stableId: result.recordId,
    identifier: result.identifier,
    recordKind: result.kind,
    title: result.title,
    deepLink: result.deepLink,
    versionPin: null,
    freshness: 'live',
    archived: result.archived,
    matchedContext: result.matchedContext,
    matchedField: result.matchedField,
    rank: result.rank,
  }
}

function resolveLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_AI_RETRIEVAL_LIMIT
  }
  return Math.min(MAX_AI_RETRIEVAL_LIMIT, Math.max(1, Math.floor(limit)))
}

/**
 * Retrieve grounded citations for a natural-language question. Reads only:
 * a single `search` RPC through the actor's `DataClient` — invisible and
 * deleted objects never surface, archived ones are explicitly marked.
 */
export async function retrieveForAi(
  client: DataClient,
  actor: AiContextActor | null | undefined,
  query: string,
  scope: AiRetrievalScope | null | undefined,
): Promise<AiRetrievalResult> {
  if (!actor || typeof actor.id !== 'string' || actor.id === '') {
    throw new Error('retrieveForAi: actor with a non-empty id is required')
  }
  if (
    !scope ||
    typeof scope.workspaceId !== 'string' ||
    scope.workspaceId === ''
  ) {
    throw new Error(
      'retrieveForAi: scope.workspaceId is required (fail closed)',
    )
  }
  if (typeof query !== 'string' || query.trim() === '') {
    throw new Error('retrieveForAi: a non-empty query is required')
  }
  const limit = resolveLimit(scope.limit)
  const results = await executeSearch(client, {
    query: query.trim(),
    projectId: scope.projectId ?? undefined,
    kind: scope.kind,
    status: scope.status,
    ownerId: scope.ownerId,
    resultType: scope.resultType,
    limit,
    offset: 0,
  })
  const citations = results.map(toAiCitation)
  const totalCount = results.length > 0 ? results[0].totalCount : 0
  return {
    citations,
    totalCount,
    hasMore: totalCount > citations.length,
  }
}

/**
 * Map a citation to the envelope object ref that resolves it. Returns null
 * for template/comment citations: neither has an envelope object kind, so
 * their actual identity and owner link stay citable without inventing a Record.
 */
export function citationToObjectRef(citation: AiCitation): AiObjectRef | null {
  const kind: AiObjectRefKind | null =
    citation.kind === 'record' || citation.kind === 'file'
      ? 'record'
      : citation.kind === 'dataset'
        ? 'dataset'
        : citation.kind === 'sheet'
          ? 'sheet'
          : null
  if (!kind) return null
  return { kind, id: citation.stableId }
}

function unsupportedCitationOmission(citation: AiCitation): AiContextOmission {
  return {
    kind: citation.kind,
    id: citation.stableId,
    reason: 'unsupported_kind',
    detail:
      `${citation.kind} ${citation.stableId} '${citation.title}' has no envelope object kind; ` +
      'cited with its deep link but not summarised (supported: record, notebook, sheet, dataset, analysis)',
  }
}

export interface AssembleGroundedContextInput {
  workspaceId: string
  projectId?: string | null
  /** The scientific question; forwarded verbatim to the search RPC. */
  query: string
  resultType?: SearchResultType
  kind?: string
  status?: string
  ownerId?: string
  limit?: number
  budgets?: Partial<AiContextBudgets>
}

export interface GroundedContext {
  /**
   * The permitted envelope: one object per resolvable citation under the
   * same budgets and truncation markers as AI-01. Template citations and
   * over-budget refs appear in `omissions`, never silently.
   */
  envelope: AiContextEnvelope
  /** The citations that fed the envelope, with quoted matched context.
   * Correspondence to `envelope.objects` is by `stableId` ↔ `id`. */
  citations: AiCitation[]
  totalCount: number
  hasMore: boolean
}

/**
 * Retrieve citations for a question and feed them into AI-01's envelope.
 * Every object is re-resolved through the actor's own reads, so freshness,
 * pins, workspace checks, and budgets all flow through the same machinery
 * as an explicit object request — retrieval only selects *which* canonical
 * objects to assemble.
 */
export async function assembleGroundedContext(
  client: DataClient,
  actor: AiContextActor,
  input: AssembleGroundedContextInput,
): Promise<GroundedContext> {
  const retrieved = await retrieveForAi(client, actor, input.query, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    resultType: input.resultType,
    kind: input.kind,
    status: input.status,
    ownerId: input.ownerId,
    limit: input.limit,
  })
  const refs: AiObjectRef[] = []
  const unsupportedOmissions: AiContextOmission[] = []
  for (const citation of retrieved.citations) {
    const ref = citationToObjectRef(citation)
    if (ref) refs.push(ref)
    else unsupportedOmissions.push(unsupportedCitationOmission(citation))
  }
  const envelope = await assembleAiContext(client, actor, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    objectRefs: refs,
    budgets: input.budgets,
  })
  envelope.omissions.push(...unsupportedOmissions)
  return {
    envelope,
    citations: retrieved.citations,
    totalCount: retrieved.totalCount,
    hasMore: retrieved.hasMore,
  }
}
