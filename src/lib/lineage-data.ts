/**
 * LINEAGE-001 — Lineage Explorer data layer.
 *
 * Typed wrappers over the existing PostgREST resources that derive a lineage
 * graph from real record links, dataset transformations, reviews, approvals
 * and signatures. Every read goes through the same `/api/db` boundary and RLS
 * as the rest of the application; PostgreSQL remains authoritative
 * (decisions 0019/0029/0034).
 *
 * The graph is built client-side from RLS-filtered queries so permission
 * boundaries are preserved automatically: records, links, reviews and
 * signatures the caller cannot see are simply absent from the result.
 * Inaccessible targets of links (deleted, purged, or permission-restricted)
 * are rendered as honest "restricted" nodes rather than silently dropped.
 */
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { recordDestination } from './navigation'
import { IN_LIST_OR_CHUNK_SIZE, listInIdChunks } from './postgrest-in-list'

// ---------------------------------------------------------------------------
// Safe limits
// ---------------------------------------------------------------------------

export const LINEAGE_MAX_DEPTH = 4
export const LINEAGE_MAX_NODES = 300
export const LINEAGE_MAX_EVENTS = 200

/**
 * KNOW-02 — depth bound for the per-object miniature. The full explorer
 * traverses to LINEAGE_MAX_DEPTH; embedded sections stay at 2 hops so they
 * remain a scoped preview with a deep-link to the full graph.
 */
export const LINEAGE_MINI_DEPTH = 2

// ---------------------------------------------------------------------------
// Wire types (PostgREST snake_case)
// ---------------------------------------------------------------------------

export interface RecordWire {
  id: string
  workspace_id: string
  project_id: string | null
  kind: string
  identifier: string
  title: string
  status: string
  properties: Record<string, unknown>
  tags: string[]
  structure_version: number
  metadata_version: number
  created_at: string
  updated_at: string
  archived_at: string | null
  deleted_at: string | null
  created_by_user_id: string
  updated_by_user_id: string | null
}

export interface RecordLinkWire {
  id: string
  source_record_id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
  link_metadata: Record<string, unknown>
  created_at: string
  created_by_user_id: string
}

export interface ReviewSubmissionWire {
  id: string
  workspace_id: string
  record_id: string
  revision_id: string
  state: string
  workflow_definition_key: string
  workflow_definition_version: number
  assigned_reviewer_user_ids: string[]
  submitted_by_user_id: string
  submitted_at: string
  created_at: string
  updated_at: string
}

export interface ReviewDecisionWire {
  id: string
  workspace_id: string
  submission_id: string
  revision_id: string
  record_id: string
  decision: string
  note: string | null
  actor_user_id: string
  created_at: string
}

export interface SignatureWire {
  id: string
  workspace_id: string
  record_id: string
  revision_id: string
  signer_user_id: string
  signature_meaning: string
  assurance_level: string
  created_at: string
}

export interface ChangeEventWire {
  id: string
  workspace_id: string
  sequence: string
  entity_type: string
  entity_uuid: string
  operation: string
  record_id: string | null
  project_id: string | null
  actor_user_id: string | null
  actor_credential_id: string | null
  client_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LineageEntityType =
  | 'experiment'
  | 'sample'
  | 'reagent'
  | 'protocol'
  | 'dataset'
  | 'figure'
  | 'report'
  | 'file'
  | 'review'
  | 'approval'
  | 'rejection'
  | 'signature'
  | 'unknown'

export type LineageDirection =
  'upstream' | 'downstream' | 'seed' | 'bidirectional'

export type LineageViewMode = 'upstream' | 'downstream' | 'both'

export interface LineageNode {
  id: string
  recordId: string | null
  /**
   * KNOW-02 — pinned revision for submitted/frozen evidence nodes
   * (review, approval/rejection, signature). Null for live record nodes.
   * Carries the `revision_id` from the review/decision/signature wire so
   * lineage nodes can deep-link to the frozen evidence workspace.
   */
  revisionId?: string | null
  kind: string
  entityType: LineageEntityType
  identifier: string
  title: string
  status: string
  depth: number
  direction: LineageDirection
  accessible: boolean
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
  archivedAt: string | null
  deletedAt: string | null
}

export interface LineageEdge {
  id: string
  sourceId: string
  targetId: string
  sourceRecordId: string | null
  targetRecordId: string | null
  relationshipType: string
  label: string
  direction: LineageDirection
  targetKind: string | null
  targetIdentifier: string | null
  createdAt: string
}

export interface LineageEvent {
  id: string
  recordId: string | null
  entityType: string
  operation: string
  actorUserId: string | null
  createdAt: string
  payload: Record<string, unknown>
}

export interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdge[]
  events: LineageEvent[]
  seedRecordId: string | null
  truncated: boolean
}

export interface LineageFilters {
  entityTypes: LineageEntityType[]
  relationshipTypes: string[]
  direction: LineageViewMode
  showExternal: boolean
}

export const DEFAULT_FILTERS: LineageFilters = {
  entityTypes: [],
  relationshipTypes: [],
  direction: 'both',
  showExternal: false,
}

// ---------------------------------------------------------------------------
// Entity type and label mapping
// ---------------------------------------------------------------------------

const KIND_TO_ENTITY_TYPE: Record<string, LineageEntityType> = {
  experiment: 'experiment',
  sample: 'sample',
  reagent: 'reagent',
  protocol_template: 'protocol',
  report: 'report',
  file: 'file',
  notebook_template: 'unknown',
}

const LINK_TYPE_TO_ENTITY_TYPE: Record<string, LineageEntityType> = {
  sample: 'sample',
  reagent: 'reagent',
  protocol: 'protocol',
  dataset: 'dataset',
  analysis: 'dataset',
  file: 'file',
  general: 'unknown',
  template: 'unknown',
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  sample: 'uses',
  reagent: 'uses',
  protocol: 'defined by',
  dataset: 'generates',
  analysis: 'analyzed by',
  file: 'has file',
  general: 'related to',
  template: 'created from',
  reviewed_by: 'reviewed by',
  approved_by: 'approved by',
  rejected_by: 'rejected by',
  signed_by: 'signed by',
  derived_from: 'derived from',
}

export const ENTITY_TYPE_LABELS: Record<LineageEntityType, string> = {
  experiment: 'Experiment',
  sample: 'Sample',
  reagent: 'Reagent',
  protocol: 'Protocol',
  dataset: 'Dataset',
  figure: 'Figure',
  report: 'Report',
  file: 'File',
  review: 'Review',
  approval: 'Approval',
  rejection: 'Rejection',
  signature: 'Signature',
  unknown: 'Other',
}

export const ENTITY_TYPE_COLORS: Record<LineageEntityType, string> = {
  experiment: '#3b82f6',
  sample: '#10b981',
  reagent: '#10b981',
  protocol: '#3b82f6',
  dataset: '#3b82f6',
  figure: '#8b5cf6',
  report: '#6b7280',
  file: '#f59e0b',
  review: '#ef4444',
  approval: '#10b981',
  rejection: '#ef4444',
  signature: '#8b5cf6',
  unknown: '#6b7280',
}

export const ALL_ENTITY_TYPES: LineageEntityType[] = [
  'experiment',
  'sample',
  'reagent',
  'protocol',
  'dataset',
  'figure',
  'report',
  'file',
  'review',
  'approval',
  'signature',
]

export const ALL_RELATIONSHIP_TYPES: string[] = [
  'sample',
  'reagent',
  'protocol',
  'dataset',
  'analysis',
  'file',
  'general',
  'template',
  'reviewed_by',
  'approved_by',
  'rejected_by',
  'signed_by',
]

export function kindToEntityType(kind: string): LineageEntityType {
  return KIND_TO_ENTITY_TYPE[kind] ?? 'unknown'
}

export function linkTypeToEntityType(linkType: string): LineageEntityType {
  return LINK_TYPE_TO_ENTITY_TYPE[linkType] ?? 'unknown'
}

export function relationshipLabel(relationshipType: string): string {
  return RELATIONSHIP_LABELS[relationshipType] ?? relationshipType
}

// ---------------------------------------------------------------------------
// Data client
// ---------------------------------------------------------------------------

export const lineageDataClient = createDataClient()

export const lineageQueryKeys = {
  graph: ['lineage-graph'] as const,
  graphFor: (seedRecordId: string | null, maxDepth: number) =>
    ['lineage-graph', seedRecordId ?? 'all', maxDepth] as const,
  records: ['lineage-records'] as const,
  events: (recordId: string | null) =>
    ['lineage-events', recordId ?? 'all'] as const,
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch all records visible to the caller (RLS-filtered). When a seed record
 * id is provided, fetches only that record plus the records referenced by
 * its links (and their links, up to maxDepth). Otherwise fetches all
 * non-deleted records, limited to LINEAGE_MAX_NODES.
 */
export async function fetchLineageRecords(
  client: DataClient = lineageDataClient,
  seedRecordId: string | null = null,
): Promise<RecordWire[]> {
  if (seedRecordId) {
    return client.list<RecordWire>(
      'records',
      `?id=eq.${encodeURIComponent(seedRecordId)}&select=id,workspace_id,project_id,kind,identifier,title,status,properties,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id`,
    )
  }
  return client.list<RecordWire>(
    'records',
    `?deleted_at=is.null&order=updated_at.desc&limit=${LINEAGE_MAX_NODES}&select=id,workspace_id,project_id,kind,identifier,title,status,properties,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id`,
  )
}

/**
 * Fetch record links visible to the caller (RLS-filtered). When a set of
 * record ids is provided, fetches only links whose source or target is in
 * that set.
 */
export async function fetchLineageLinks(
  client: DataClient = lineageDataClient,
  recordIds: string[] | null = null,
): Promise<RecordLinkWire[]> {
  if (recordIds && recordIds.length > 0) {
    // The or() filter repeats the id list, so it needs half-size chunks to
    // stay under the proxy's per-value cap. A link whose source is in one
    // chunk and target in another matches both requests — dedupe by id.
    const links = await listInIdChunks<RecordLinkWire>(
      client,
      'record_links',
      recordIds,
      (filter) =>
        `?or=(source_record_id.in.(${filter}),target_record_id.in.(${filter}))&order=created_at.desc&limit=${LINEAGE_MAX_NODES * 4}&select=id,source_record_id,target_record_id,target_kind,target_identifier,link_type,link_metadata,created_at,created_by_user_id`,
      { chunkSize: IN_LIST_OR_CHUNK_SIZE, dedupeBy: (link) => link.id },
    )
    return links.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return client.list<RecordLinkWire>(
    'record_links',
    `?order=created_at.desc&limit=${LINEAGE_MAX_NODES * 4}&select=id,source_record_id,target_record_id,target_kind,target_identifier,link_type,link_metadata,created_at,created_by_user_id`,
  )
}

/**
 * Fetch review submissions for the given records (RLS-filtered).
 */
export async function fetchLineageReviews(
  client: DataClient = lineageDataClient,
  recordIds: string[] | null = null,
): Promise<ReviewSubmissionWire[]> {
  if (recordIds && recordIds.length > 0) {
    const reviews = await listInIdChunks<ReviewSubmissionWire>(
      client,
      'review_submissions',
      recordIds,
      (filter) =>
        `?record_id=in.(${filter})&order=submitted_at.desc&select=id,workspace_id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_at,created_at,updated_at`,
    )
    return reviews.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
  }
  return client.list<ReviewSubmissionWire>(
    'review_submissions',
    `?order=submitted_at.desc&select=id,workspace_id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_at,created_at,updated_at`,
  )
}

/**
 * Fetch review decisions for the given records (RLS-filtered).
 */
export async function fetchLineageDecisions(
  client: DataClient = lineageDataClient,
  recordIds: string[] | null = null,
): Promise<ReviewDecisionWire[]> {
  if (recordIds && recordIds.length > 0) {
    const decisions = await listInIdChunks<ReviewDecisionWire>(
      client,
      'review_decisions',
      recordIds,
      (filter) =>
        `?record_id=in.(${filter})&order=created_at.desc&select=id,workspace_id,submission_id,revision_id,record_id,decision,note,actor_user_id,created_at`,
    )
    return decisions.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return client.list<ReviewDecisionWire>(
    'review_decisions',
    `?order=created_at.desc&select=id,workspace_id,submission_id,revision_id,record_id,decision,note,actor_user_id,created_at`,
  )
}

/**
 * Fetch signatures for the given records (RLS-filtered).
 */
export async function fetchLineageSignatures(
  client: DataClient = lineageDataClient,
  recordIds: string[] | null = null,
): Promise<SignatureWire[]> {
  if (recordIds && recordIds.length > 0) {
    const signatures = await listInIdChunks<SignatureWire>(
      client,
      'signatures',
      recordIds,
      (filter) =>
        `?record_id=in.(${filter})&order=created_at.desc&select=id,workspace_id,record_id,revision_id,signer_user_id,signature_meaning,assurance_level,created_at`,
    )
    return signatures.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return client.list<SignatureWire>(
    'signatures',
    `?order=created_at.desc&select=id,workspace_id,record_id,revision_id,signer_user_id,signature_meaning,assurance_level,created_at`,
  )
}

/**
 * Fetch change events for the timeline (RLS-filtered). When record ids are
 * provided, fetches only events for those records.
 */
export async function fetchLineageEvents(
  client: DataClient = lineageDataClient,
  recordIds: string[] | null = null,
): Promise<ChangeEventWire[]> {
  if (recordIds && recordIds.length > 0) {
    const events = await listInIdChunks<ChangeEventWire>(
      client,
      'change_events',
      recordIds,
      (filter) =>
        `?record_id=in.(${filter})&order=created_at.desc&limit=${LINEAGE_MAX_EVENTS}&select=id,workspace_id,sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,actor_credential_id,client_id,payload,created_at`,
    )
    return events.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return client.list<ChangeEventWire>(
    'change_events',
    `?order=created_at.desc&limit=${LINEAGE_MAX_EVENTS}&select=id,workspace_id,sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,actor_credential_id,client_id,payload,created_at`,
  )
}

/**
 * Search candidate seed records for the explorer's seed picker: identifier/
 * title contains-match over non-deleted records, most recently updated
 * first. Kind-agnostic — any record can seed a traversal. Cross-workspace
 * records are invisible under RLS, so the picker cannot offer one.
 */
export function searchLineageSeedRecords(
  client: DataClient = lineageDataClient,
  query: string,
  limit = 20,
): Promise<RecordWire[]> {
  const filters = ['deleted_at=is.null']
  const trimmed = query.trim()
  if (trimmed) {
    const enc = encodeURIComponent(`*${trimmed}*`)
    filters.push(`or=(identifier=ilike.${enc},title=ilike.${enc})`)
  }
  filters.push(
    'order=updated_at.desc',
    `limit=${limit}`,
    'select=id,workspace_id,project_id,kind,identifier,title,status,properties,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id',
  )
  return client.list<RecordWire>('records', `?${filters.join('&')}`)
}

// ---------------------------------------------------------------------------
// Graph building (pure functions)
// ---------------------------------------------------------------------------

interface BFSNode {
  recordId: string
  depth: number
  direction: LineageDirection
}

/**
 * Build a lineage graph from fetched records, links, reviews, decisions,
 * signatures and events. This is a pure function that performs BFS traversal
 * from the seed record (or all records if no seed) up to maxDepth, detects
 * cycles, handles missing/inaccessible targets, and adds review/approval/
 * signature nodes and edges.
 *
 * The graph respects permission boundaries because all input data is already
 * RLS-filtered: records and links the caller cannot see are absent. Links
 * whose target_record_id is null or points to a record not in the fetched
 * set are rendered as "restricted" nodes with the preserved target_kind and
 * target_identifier so the UI can show them honestly.
 */
export function buildLineageGraph(
  records: RecordWire[],
  links: RecordLinkWire[],
  reviews: ReviewSubmissionWire[],
  decisions: ReviewDecisionWire[],
  signatures: SignatureWire[],
  events: ChangeEventWire[],
  seedRecordId: string | null,
  maxDepth: number = LINEAGE_MAX_DEPTH,
  maxNodes: number = LINEAGE_MAX_NODES,
): LineageGraph {
  const recordMap = new Map<string, RecordWire>()
  for (const r of records) recordMap.set(r.id, r)

  // Build adjacency from links.
  const outgoing = new Map<string, RecordLinkWire[]>() // source → links
  const incoming = new Map<string, RecordLinkWire[]>() // target → links
  for (const link of links) {
    const out = outgoing.get(link.source_record_id) ?? []
    out.push(link)
    outgoing.set(link.source_record_id, out)
    if (link.target_record_id) {
      const inc = incoming.get(link.target_record_id) ?? []
      inc.push(link)
      incoming.set(link.target_record_id, inc)
    }
  }

  // BFS from seed (or all records if no seed).
  const visited = new Set<string>()
  const nodeQueue: BFSNode[] = []
  const nodeRecords = new Map<
    string,
    { record: RecordWire; depth: number; direction: LineageDirection }
  >()

  if (seedRecordId) {
    const seed = recordMap.get(seedRecordId)
    if (seed) {
      nodeRecords.set(seedRecordId, {
        record: seed,
        depth: 0,
        direction: 'seed',
      })
      nodeQueue.push({ recordId: seedRecordId, depth: 0, direction: 'seed' })
    }
  } else {
    // No seed: seed with all records, limited to maxNodes.
    for (const r of records.slice(0, maxNodes)) {
      nodeRecords.set(r.id, { record: r, depth: 0, direction: 'seed' })
      nodeQueue.push({ recordId: r.id, depth: 0, direction: 'seed' })
    }
  }

  // BFS traversal — follow links up to maxDepth, detecting cycles.
  while (nodeQueue.length > 0 && nodeRecords.size < maxNodes) {
    const current = nodeQueue.shift()!
    if (visited.has(current.recordId)) continue
    visited.add(current.recordId)

    if (current.depth >= maxDepth) continue

    // Downstream: follow outgoing links (source → target).
    const outLinks = outgoing.get(current.recordId) ?? []
    for (const link of outLinks) {
      if (nodeRecords.size >= maxNodes) break
      if (link.target_record_id) {
        const target = recordMap.get(link.target_record_id)
        if (target && !nodeRecords.has(link.target_record_id)) {
          nodeRecords.set(link.target_record_id, {
            record: target,
            depth: current.depth + 1,
            direction:
              current.direction === 'seed'
                ? 'downstream'
                : current.direction === 'upstream'
                  ? 'bidirectional'
                  : current.direction,
          })
          if (nodeRecords.size < maxNodes) {
            nodeQueue.push({
              recordId: link.target_record_id,
              depth: current.depth + 1,
              direction: 'downstream',
            })
          }
        }
      }
    }

    // Upstream: follow incoming links (target ← source).
    const inLinks = incoming.get(current.recordId) ?? []
    for (const link of inLinks) {
      if (nodeRecords.size >= maxNodes) break
      const source = recordMap.get(link.source_record_id)
      if (source && !nodeRecords.has(link.source_record_id)) {
        nodeRecords.set(link.source_record_id, {
          record: source,
          depth: current.depth + 1,
          direction:
            current.direction === 'seed'
              ? 'upstream'
              : current.direction === 'downstream'
                ? 'bidirectional'
                : current.direction,
        })
        if (nodeRecords.size < maxNodes) {
          nodeQueue.push({
            recordId: link.source_record_id,
            depth: current.depth + 1,
            direction: 'upstream',
          })
        }
      }
    }
  }

  const truncated = nodeRecords.size >= maxNodes

  // Build nodes.
  const nodes: LineageNode[] = []
  for (const [, { record, depth, direction }] of nodeRecords) {
    nodes.push({
      id: record.id,
      recordId: record.id,
      kind: record.kind,
      entityType: kindToEntityType(record.kind),
      identifier: record.identifier,
      title: record.title,
      status: record.status,
      depth,
      direction,
      accessible: true,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      createdByUserId: record.created_by_user_id,
      archivedAt: record.archived_at,
      deletedAt: record.deleted_at,
    })
  }

  // Build edges from links — only edges where at least one endpoint is a
  // node in the graph. Links whose target is missing/restricted create a
  // "restricted" node so the edge is visible.
  const edges: LineageEdge[] = []
  const restrictedNodes = new Map<string, LineageNode>()

  for (const link of links) {
    const sourceInGraph = nodeRecords.has(link.source_record_id)
    const targetInGraph = link.target_record_id
      ? nodeRecords.has(link.target_record_id)
      : false

    if (!sourceInGraph && !targetInGraph) continue

    const sourceId = link.source_record_id

    // Handle missing/restricted target.
    let targetId: string
    if (link.target_record_id && targetInGraph) {
      targetId = link.target_record_id
    } else if (link.target_record_id && !targetInGraph) {
      // Target record exists in DB but is not in our fetched set — could be
      // permission-restricted or beyond the node limit. Create a restricted node.
      const restrictedId = `restricted:${link.target_record_id}`
      if (!restrictedNodes.has(restrictedId)) {
        restrictedNodes.set(restrictedId, {
          id: restrictedId,
          recordId: link.target_record_id,
          kind: link.target_kind,
          entityType: linkTypeToEntityType(link.link_type),
          identifier: link.target_identifier,
          title: 'Restricted or inaccessible',
          status: 'restricted',
          depth: 0,
          direction: 'downstream',
          accessible: false,
          createdAt: link.created_at,
          updatedAt: link.created_at,
          createdByUserId: null,
          archivedAt: null,
          deletedAt: null,
        })
      }
      targetId = restrictedId
    } else {
      // target_record_id is null — target was hard-purged or never existed.
      const missingId = `missing:${link.target_identifier}`
      if (!restrictedNodes.has(missingId)) {
        restrictedNodes.set(missingId, {
          id: missingId,
          recordId: null,
          kind: link.target_kind,
          entityType: linkTypeToEntityType(link.link_type),
          identifier: link.target_identifier,
          title: 'Missing record',
          status: 'missing',
          depth: 0,
          direction: 'downstream',
          accessible: false,
          createdAt: link.created_at,
          updatedAt: link.created_at,
          createdByUserId: null,
          archivedAt: null,
          deletedAt: null,
        })
      }
      targetId = missingId
    }

    const sourceRecord = nodeRecords.get(link.source_record_id)
    const edgeDirection: LineageDirection = sourceRecord
      ? sourceRecord.direction === 'seed'
        ? 'downstream'
        : sourceRecord.direction
      : 'downstream'

    edges.push({
      id: link.id,
      sourceId,
      targetId,
      sourceRecordId: link.source_record_id,
      targetRecordId: link.target_record_id,
      relationshipType: link.link_type,
      label: relationshipLabel(link.link_type),
      direction: edgeDirection,
      targetKind: link.target_kind,
      targetIdentifier: link.target_identifier,
      createdAt: link.created_at,
    })
  }

  // Add restricted/missing nodes to the node list.
  for (const node of restrictedNodes.values()) {
    nodes.push(node)
  }

  // Add review nodes and edges.
  const graphRecordIds = new Set(nodeRecords.keys())
  for (const review of reviews) {
    if (!graphRecordIds.has(review.record_id)) continue
    const reviewNodeId = `review:${review.id}`
    nodes.push({
      id: reviewNodeId,
      recordId: review.record_id,
      revisionId: review.revision_id,
      kind: 'review',
      entityType: 'review',
      identifier: `REV-${review.id.slice(0, 8)}`,
      title: `Review — ${review.state}`,
      status: review.state,
      depth: 0,
      direction: 'downstream',
      accessible: true,
      createdAt: review.submitted_at,
      updatedAt: review.updated_at,
      createdByUserId: review.submitted_by_user_id,
      archivedAt: null,
      deletedAt: null,
    })
    edges.push({
      id: `edge:review:${review.id}`,
      sourceId: review.record_id,
      targetId: reviewNodeId,
      sourceRecordId: review.record_id,
      targetRecordId: null,
      relationshipType: 'reviewed_by',
      label: 'reviewed by',
      direction: 'downstream',
      targetKind: 'review',
      targetIdentifier: `REV-${review.id.slice(0, 8)}`,
      createdAt: review.submitted_at,
    })
  }

  // Add decision nodes and edges (approval/rejection).
  for (const decision of decisions) {
    if (!graphRecordIds.has(decision.record_id)) continue
    const isApproval = decision.decision === 'approve'
    const decisionNodeId = `decision:${decision.id}`
    const entityType: LineageEntityType = isApproval ? 'approval' : 'rejection'
    nodes.push({
      id: decisionNodeId,
      recordId: decision.record_id,
      revisionId: decision.revision_id,
      kind: 'decision',
      entityType,
      identifier: `${isApproval ? 'APP' : 'REJ'}-${decision.id.slice(0, 8)}`,
      title: `${isApproval ? 'Approved' : 'Rejected'}${decision.note ? ` — ${decision.note.slice(0, 60)}` : ''}`,
      status: decision.decision,
      depth: 0,
      direction: 'downstream',
      accessible: true,
      createdAt: decision.created_at,
      updatedAt: decision.created_at,
      createdByUserId: decision.actor_user_id,
      archivedAt: null,
      deletedAt: null,
    })
    edges.push({
      id: `edge:decision:${decision.id}`,
      sourceId: decision.record_id,
      targetId: decisionNodeId,
      sourceRecordId: decision.record_id,
      targetRecordId: null,
      relationshipType: isApproval ? 'approved_by' : 'rejected_by',
      label: isApproval ? 'approved by' : 'rejected by',
      direction: 'downstream',
      targetKind: 'decision',
      targetIdentifier: `${isApproval ? 'APP' : 'REJ'}-${decision.id.slice(0, 8)}`,
      createdAt: decision.created_at,
    })
  }

  // Add signature nodes and edges.
  for (const sig of signatures) {
    if (!graphRecordIds.has(sig.record_id)) continue
    const sigNodeId = `signature:${sig.id}`
    nodes.push({
      id: sigNodeId,
      recordId: sig.record_id,
      kind: 'signature',
      revisionId: sig.revision_id,
      entityType: 'signature',
      identifier: `SIG-${sig.id.slice(0, 8)}`,
      title: `Signature — ${sig.signature_meaning}`,
      status: 'signed',
      depth: 0,
      direction: 'downstream',
      accessible: true,
      createdAt: sig.created_at,
      updatedAt: sig.created_at,
      createdByUserId: sig.signer_user_id,
      archivedAt: null,
      deletedAt: null,
    })
    edges.push({
      id: `edge:signature:${sig.id}`,
      sourceId: sig.record_id,
      targetId: sigNodeId,
      sourceRecordId: sig.record_id,
      targetRecordId: null,
      relationshipType: 'signed_by',
      label: 'signed by',
      direction: 'downstream',
      targetKind: 'signature',
      targetIdentifier: `SIG-${sig.id.slice(0, 8)}`,
      createdAt: sig.created_at,
    })
  }

  // Filter events to those related to graph records.
  const graphNodeRecordIds = new Set<string>()
  for (const node of nodes) {
    if (node.recordId) graphNodeRecordIds.add(node.recordId)
  }
  const filteredEvents: LineageEvent[] = events
    .filter((e) => e.record_id !== null && graphNodeRecordIds.has(e.record_id))
    .map((e) => ({
      id: e.id,
      recordId: e.record_id,
      entityType: e.entity_type,
      operation: e.operation,
      actorUserId: e.actor_user_id,
      createdAt: e.created_at,
      payload: e.payload,
    }))
    .slice(0, LINEAGE_MAX_EVENTS)

  return {
    nodes,
    edges,
    events: filteredEvents,
    seedRecordId,
    truncated,
  }
}

// ---------------------------------------------------------------------------
// Graph filtering (pure)
// ---------------------------------------------------------------------------

/**
 * Filter a lineage graph by entity types, relationship types and direction.
 * Returns a new graph with only the matching nodes and edges. The seed node
 * is always retained when a seed is set.
 */
export function filterLineageGraph(
  graph: LineageGraph,
  filters: LineageFilters,
): LineageGraph {
  const entityTypeSet = new Set(filters.entityTypes)
  const relTypeSet = new Set(filters.relationshipTypes)

  // Determine which nodes to keep.
  const keepNode = (node: LineageNode): boolean => {
    // Always keep the seed node.
    if (graph.seedRecordId && node.id === graph.seedRecordId) return true
    // Entity type filter.
    if (entityTypeSet.size > 0 && !entityTypeSet.has(node.entityType))
      return false
    // External filter: hide restricted/missing nodes.
    if (!filters.showExternal && !node.accessible) return false
    return true
  }

  const keptNodes = graph.nodes.filter(keepNode)
  const keptNodeIds = new Set(keptNodes.map((n) => n.id))

  // Direction filter: determine which edges to keep based on direction
  // relative to the seed.
  const keepEdge = (edge: LineageEdge): boolean => {
    // Both endpoints must be in the kept node set.
    if (!keptNodeIds.has(edge.sourceId) || !keptNodeIds.has(edge.targetId))
      return false
    // Relationship type filter.
    if (relTypeSet.size > 0 && !relTypeSet.has(edge.relationshipType))
      return false
    // Direction filter.
    if (filters.direction === 'both') return true
    if (filters.direction === 'upstream') {
      // Keep edges where the source is upstream of the seed (incoming).
      return edge.direction === 'upstream' || edge.direction === 'bidirectional'
    }
    // filters.direction === 'downstream' (both already returned above).
    // Keep edges where the target is downstream of the seed (outgoing).
    return edge.direction !== 'upstream' && edge.direction !== 'seed'
  }

  const keptEdges = graph.edges.filter(keepEdge)

  // After edge filtering, some nodes may be orphaned (no edges). Remove
  // orphaned non-seed nodes when the graph is seed-centred.
  let finalNodes = keptNodes
  let finalEdges = keptEdges
  if (graph.seedRecordId) {
    const connectedNodeIds = new Set<string>([graph.seedRecordId])
    for (const edge of keptEdges) {
      connectedNodeIds.add(edge.sourceId)
      connectedNodeIds.add(edge.targetId)
    }
    finalNodes = keptNodes.filter(
      (n) => connectedNodeIds.has(n.id) || n.id === graph.seedRecordId,
    )
    finalEdges = keptEdges.filter(
      (e) =>
        connectedNodeIds.has(e.sourceId) && connectedNodeIds.has(e.targetId),
    )
  }

  return {
    nodes: finalNodes,
    edges: finalEdges,
    events: graph.events,
    seedRecordId: graph.seedRecordId,
    truncated: graph.truncated,
  }
}

// ---------------------------------------------------------------------------
// Cycle detection (pure)
// ---------------------------------------------------------------------------

/**
 * Detect cycles in a lineage graph using DFS. Returns the first cycle found
 * as an array of node ids, or null if the graph is acyclic.
 */
export function detectCycles(graph: LineageGraph): string[] | null {
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const neighbors = adjacency.get(edge.sourceId) ?? []
    neighbors.push(edge.targetId)
    adjacency.set(edge.sourceId, neighbors)
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  for (const node of graph.nodes) color.set(node.id, WHITE)

  let cycle: string[] | null = null

  function dfs(nodeId: string, path: string[]): boolean {
    color.set(nodeId, GRAY)
    path.push(nodeId)
    const neighbors = adjacency.get(nodeId) ?? []
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue
      const neighborColor = color.get(neighbor)
      if (neighborColor === GRAY) {
        // Found a cycle — extract it from the path.
        const cycleStart = path.indexOf(neighbor)
        cycle = path.slice(cycleStart)
        return true
      }
      if (neighborColor === WHITE) {
        if (dfs(neighbor, path)) return true
      }
    }
    path.pop()
    color.set(nodeId, BLACK)
    return false
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) {
      if (dfs(node.id, [])) break
    }
  }

  return cycle
}

// ---------------------------------------------------------------------------
// Timeline building (pure)
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  id: string
  recordId: string | null
  operation: string
  operationLabel: string
  actorUserId: string | null
  createdAt: string
  payload: Record<string, unknown>
}

const OPERATION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  move: 'Moved',
  delete: 'Deleted',
  archive: 'Archived',
  restore: 'Restored',
  link: 'Linked',
  unlink: 'Unlinked',
  quarantine: 'Quarantined',
  resolve: 'Resolved',
  reopen: 'Reopened',
  lock: 'Locked',
  amend: 'Amended',
}

export function buildTimeline(events: LineageEvent[]): TimelineEntry[] {
  return events
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => ({
      id: e.id,
      recordId: e.recordId,
      operation: e.operation,
      operationLabel: OPERATION_LABELS[e.operation] ?? e.operation,
      actorUserId: e.actorUserId,
      createdAt: e.createdAt,
      payload: e.payload,
    }))
}

// ---------------------------------------------------------------------------
// Table representation (pure)
// ---------------------------------------------------------------------------

export interface LineageTableRow {
  id: string
  identifier: string
  title: string
  entityType: LineageEntityType
  entityTypeLabel: string
  status: string
  direction: LineageDirection
  relationshipType: string
  relationshipLabel: string
  depth: number
  createdAt: string
  accessible: boolean
}

/**
 * Flatten the lineage graph into table rows for the accessible table
 * representation. Each row represents a node with its relationship context.
 * This is the keyboard-navigable alternative to the graph view.
 */
export function buildTableData(graph: LineageGraph): LineageTableRow[] {
  const rows: LineageTableRow[] = []
  const nodeEdges = new Map<string, LineageEdge[]>()

  for (const edge of graph.edges) {
    const sourceEdges = nodeEdges.get(edge.sourceId) ?? []
    sourceEdges.push(edge)
    nodeEdges.set(edge.sourceId, sourceEdges)
  }

  for (const node of graph.nodes) {
    const edges = nodeEdges.get(node.id) ?? []
    if (edges.length === 0) {
      rows.push({
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        entityType: node.entityType,
        entityTypeLabel: ENTITY_TYPE_LABELS[node.entityType],
        status: node.status,
        direction: node.direction,
        relationshipType: '—',
        relationshipLabel: '—',
        depth: node.depth,
        createdAt: node.createdAt,
        accessible: node.accessible,
      })
    } else {
      for (const edge of edges) {
        rows.push({
          id: `${node.id}:${edge.id}`,
          identifier: node.identifier,
          title: node.title,
          entityType: node.entityType,
          entityTypeLabel: ENTITY_TYPE_LABELS[node.entityType],
          status: node.status,
          direction: node.direction,
          relationshipType: edge.relationshipType,
          relationshipLabel: edge.label,
          depth: node.depth,
          createdAt: node.createdAt,
          accessible: node.accessible,
        })
      }
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// Inspector helpers (pure)
// ---------------------------------------------------------------------------

export interface LineageSummary {
  upstreamCount: number
  downstreamCount: number
  totalLinks: number
  externalLinks: number
}

/**
 * Compute a lineage summary for a given node — upstream count, downstream
 * count, total links and external (restricted/missing) links.
 */
export function getLineageSummary(
  graph: LineageGraph,
  nodeId: string,
): LineageSummary {
  let upstreamCount = 0
  let downstreamCount = 0
  let externalLinks = 0

  for (const edge of graph.edges) {
    if (edge.sourceId === nodeId) {
      downstreamCount++
      const targetNode = graph.nodes.find((n) => n.id === edge.targetId)
      if (targetNode && !targetNode.accessible) externalLinks++
    }
    if (edge.targetId === nodeId) {
      upstreamCount++
      const sourceNode = graph.nodes.find((n) => n.id === edge.sourceId)
      if (sourceNode && !sourceNode.accessible) externalLinks++
    }
  }

  return {
    upstreamCount,
    downstreamCount,
    totalLinks: upstreamCount + downstreamCount,
    externalLinks,
  }
}

export interface LinkedRecordGroup {
  entityType: LineageEntityType
  entityTypeLabel: string
  count: number
  records: { id: string; identifier: string; title: string }[]
}

/**
 * Group linked records by entity type for the inspector's "Linked Records"
 * section.
 */
export function getLinkedRecordsByType(
  graph: LineageGraph,
  nodeId: string,
): LinkedRecordGroup[] {
  const linkedNodeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.sourceId === nodeId) linkedNodeIds.add(edge.targetId)
    if (edge.targetId === nodeId) linkedNodeIds.add(edge.sourceId)
  }

  const groups = new Map<LineageEntityType, LinkedRecordGroup>()
  for (const node of graph.nodes) {
    if (!linkedNodeIds.has(node.id)) continue
    const group = groups.get(node.entityType) ?? {
      entityType: node.entityType,
      entityTypeLabel: ENTITY_TYPE_LABELS[node.entityType],
      count: 0,
      records: [],
    }
    group.count++
    group.records.push({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
    })
    groups.set(node.entityType, group)
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.entityTypeLabel.localeCompare(b.entityTypeLabel),
  )
}

/**
 * Build a transformation history chain for a node — the sequence of dataset
 * transformations (generated → processed → visualised) connected to the node.
 */
export function getTransformationHistory(
  graph: LineageGraph,
  nodeId: string,
): {
  id: string
  identifier: string
  title: string
  entityType: LineageEntityType
  relationshipLabel: string
}[] {
  const chain: {
    id: string
    identifier: string
    title: string
    entityType: LineageEntityType
    relationshipLabel: string
  }[] = []
  const visited = new Set<string>()

  function walk(currentId: string, label: string) {
    if (visited.has(currentId)) return
    visited.add(currentId)
    const node = graph.nodes.find((n) => n.id === currentId)
    if (!node) return
    chain.push({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      entityType: node.entityType,
      relationshipLabel: label,
    })
    for (const edge of graph.edges) {
      if (edge.sourceId === currentId && edge.relationshipType === 'dataset') {
        walk(edge.targetId, edge.label)
      }
    }
  }

  walk(nodeId, 'Source')
  return chain
}

// ---------------------------------------------------------------------------
// Top-level fetch — orchestrates all queries and builds the graph
// ---------------------------------------------------------------------------

/**
 * Fetch and build the complete lineage graph. When a seed record id is
 * provided, the graph is centred on that record; otherwise it shows the
 * full workspace lineage (limited to LINEAGE_MAX_NODES).
 *
 * All queries go through the same RLS-filtered /api/db boundary, so
 * permission boundaries are preserved automatically.
 */
export async function fetchLineageGraph(
  client: DataClient = lineageDataClient,
  seedRecordId: string | null = null,
  maxDepth: number = LINEAGE_MAX_DEPTH,
  maxNodes: number = LINEAGE_MAX_NODES,
): Promise<LineageGraph> {
  // Step 1+2: When seed-centred, fetch the seed record and its links in
  // parallel — we already know the seed id, so the link query doesn't need
  // to wait for the record fetch. This saves one serial round-trip.
  let records: RecordWire[]
  let links: RecordLinkWire[]

  if (seedRecordId) {
    const [seedRecords, seedLinks] = await Promise.all([
      fetchLineageRecords(client, seedRecordId),
      fetchLineageLinks(client, [seedRecordId]),
    ])
    records = seedRecords
    links = seedLinks
  } else {
    records = await fetchLineageRecords(client, null)
    const initialIds = records.map((r) => r.id)
    links = await fetchLineageLinks(
      client,
      initialIds.length > 0 ? initialIds : null,
    )
  }

  // Step 3: if seed-centred, iteratively expand the record set by following
  // links up to maxDepth. This discovers records referenced by links that
  // weren't in the initial fetch.
  if (seedRecordId && maxDepth > 0) {
    const knownIds = new Set<string>(records.map((r) => r.id))
    const allLinkRecordIds = new Set<string>(knownIds)
    for (const link of links) {
      if (link.target_record_id) allLinkRecordIds.add(link.target_record_id)
      allLinkRecordIds.add(link.source_record_id)
    }
    const newIds = Array.from(allLinkRecordIds).filter(
      (id) => !knownIds.has(id),
    )
    if (newIds.length > 0 && newIds.length <= maxNodes) {
      const newRecords = await listInIdChunks<RecordWire>(
        client,
        'records',
        newIds,
        (filter) => `?id=in.(${filter})`,
      )
      records = [...records, ...newRecords]
      // Re-fetch links including the expanded record set.
      const expandedIds = records.map((r) => r.id)
      links = await fetchLineageLinks(client, expandedIds)
    }
  }

  // Step 4: fetch reviews, decisions, signatures and events for all records.
  const allRecordIds = records.map((r) => r.id)
  const [reviews, decisions, signatures, events] = await Promise.all([
    fetchLineageReviews(client, allRecordIds),
    fetchLineageDecisions(client, allRecordIds),
    fetchLineageSignatures(client, allRecordIds),
    fetchLineageEvents(client, allRecordIds),
  ])

  // Step 5: build the graph.
  return buildLineageGraph(
    records,
    links,
    reviews,
    decisions,
    signatures,
    events,
    seedRecordId,
    maxDepth,
    maxNodes,
  )
}

// ---------------------------------------------------------------------------
// KNOW-02 — per-object lineage destinations + explorer seed param
// ---------------------------------------------------------------------------

/** Entity types that render frozen evidence instead of a live record page. */
const EVIDENCE_ENTITY_TYPES: Partial<Record<LineageEntityType, true>> = {
  review: true,
  approval: true,
  rejection: true,
  signature: true,
}

/**
 * Resolve a lineage node to its canonical destination.
 *
 * - Submitted/frozen evidence nodes (review, approval/rejection, signature
 *   carrying a `revisionId`) link to the frozen evidence workspace
 *   (`/reviews/<revisionId>`) — the existing evidence route, never a live
 *   page.
 * - Live record nodes link to their canonical surface via
 *   `recordDestination` (stable UUID, kind-aware).
 * - Restricted/missing nodes (inaccessible or no record id) return null:
 *   callers render the honest restricted/missing state instead of a link.
 */
export function lineageNodeDestination(node: LineageNode): string | null {
  if (!node.accessible || !node.recordId) return null
  if (node.revisionId && EVIDENCE_ENTITY_TYPES[node.entityType]) {
    return `/reviews/${encodeURIComponent(node.revisionId)}`
  }
  return recordDestination(node.kind, node.recordId)
}

/**
 * Parse the `/lineage?seed=<recordId>` search param. Accepts the TanStack
 * object form (`{ seed }`) or a raw query string. Returns the stable id or
 * null when absent/invalid — only plain ids are accepted, never paths or
 * URLs, so a crafted seed cannot escape the lineage route.
 */
export function parseLineageSeedParam(search: unknown): string | null {
  let raw: unknown
  if (typeof search === 'string') {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    )
    raw = params.get('seed')
  } else if (search && typeof search === 'object' && 'seed' in search) {
    const seedValue: unknown = search.seed
    raw = seedValue
  }
  if (typeof raw !== 'string') return null
  const seed = raw.trim()
  if (seed.length === 0) return null
  if (/[\s/?#]/.test(seed)) return null
  return seed
}
