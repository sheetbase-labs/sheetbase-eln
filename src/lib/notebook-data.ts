/**
 * Notebook domain wire shapes, mappers and query helpers (ELN-004).
 *
 * The browser talks to PostgREST through the same-origin `/api/db` boundary
 * via `createDataClient`. PostgREST returns snake_case columns; the mappers
 * here translate to the camelCase domain shapes the routes render. Kept in
 * one place so the project overview, experiment notebook and inspector all
 * share one source of truth for what a record/block/link looks like.
 *
 * Decision 0015 fixes the vocabulary: workspace > project > folder >
 * record > block. "Notebook" is the record's ordered blocks.
 */

import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by PostgREST).
// ---------------------------------------------------------------------------

export interface ProjectWire {
  id: string
  workspace_id: string
  key: string
  title: string
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface RecordWire {
  id: string
  workspace_id: string
  project_id: string | null
  folder_id: string | null
  kind: string
  identifier: string
  title: string
  status: string
  tags: string[] | null
  structure_version: number
  metadata_version: number
  created_at: string
  updated_at: string
  archived_at: string | null
  deleted_at: string | null
  created_by_user_id: string
  updated_by_user_id: string | null
  properties: Record<string, unknown> | null
  // SIGN-002: lock state. locked_at is set when an approve-for-record
  // signature locks the record; locked_by_revision_id pins the approved
  // revision that caused the lock. Both null when the record is editable.
  locked_at: string | null
  locked_by_revision_id: string | null
}

export interface BlockWire {
  id: string
  record_id: string
  type: string
  payload: Record<string, unknown>
  payload_schema_version: number
  order: number
  version: number
  created_at: string
  updated_at: string
}

export interface RecordLinkWire {
  id: string
  source_record_id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
  created_at: string
}

// SCI-003: file storage metadata as returned by PostgREST. The file record
// itself is a normal `records` row (kind 'file'); this is the 1:1
// `file_objects` row whose status drives honest download/preview rendering.
export interface FileObjectWire {
  id: string
  workspace_id: string
  record_id: string
  storage_key: string
  display_name: string
  media_type: string
  byte_size: string
  checksum: string | null
  status: string
  status_reason: string | null
  version: number
}

export interface FileObjectSummary {
  recordId: string
  displayName: string
  mediaType: string
  byteSize: number
  status: 'active' | 'quarantined' | 'deleted' | 'missing'
  statusReason: string | null
  version: number
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the UI).
// ---------------------------------------------------------------------------

export interface Project {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
}

export interface NotebookRecord {
  id: string
  projectId: string | null
  kind: string
  identifier: string
  title: string
  status: string
  tags: string[]
  structureVersion: number
  metadataVersion: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
  createdByUserId: string
  updatedByUserId: string | null
  properties: Record<string, unknown>
  // SIGN-002: lock state. lockedAt is set when an approve-for-record
  // signature locks the record; lockedByRevisionId pins the approved
  // revision that caused the lock. Both null when the record is editable.
  lockedAt: string | null
  lockedByRevisionId: string | null
}

export interface NotebookBlock {
  id: string
  recordId: string
  type: string
  payload: Record<string, unknown>
  payloadSchemaVersion: number
  order: number
  version: number
}

export interface NotebookLink {
  id: string
  sourceRecordId: string
  targetRecordId: string | null
  targetKind: string
  targetIdentifier: string
  linkType: string
}

// ---------------------------------------------------------------------------
// Mappers.
// ---------------------------------------------------------------------------

export function toProject(row: ProjectWire): Project {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

export function toRecord(row: RecordWire): NotebookRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    identifier: row.identifier,
    title: row.title,
    status: row.status,
    tags: row.tags ?? [],
    structureVersion: row.structure_version,
    metadataVersion: row.metadata_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    properties: row.properties ?? {},
    lockedAt: row.locked_at ?? null,
    lockedByRevisionId: row.locked_by_revision_id ?? null,
  }
}

export function toBlock(row: BlockWire): NotebookBlock {
  return {
    id: row.id,
    recordId: row.record_id,
    type: row.type,
    payload: row.payload,
    payloadSchemaVersion: row.payload_schema_version,
    order: row.order,
    version: row.version,
  }
}

export function toLink(row: RecordLinkWire): NotebookLink {
  return {
    id: row.id,
    sourceRecordId: row.source_record_id,
    targetRecordId: row.target_record_id,
    targetKind: row.target_kind,
    targetIdentifier: row.target_identifier,
    linkType: row.link_type,
  }
}

export function toFileObjectSummary(row: FileObjectWire): FileObjectSummary {
  return {
    recordId: row.record_id,
    displayName: row.display_name,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    status: row.status as FileObjectSummary['status'],
    statusReason: row.status_reason,
    version: row.version,
  }
}

// ---------------------------------------------------------------------------
// Change events — the durable activity feed. `internal.emit_change_event`
// appends one row per mutation; RLS lets workspace members read them. The
// browser queries `change_events` filtered by `record_id` for the activity
// tab. Actor names live in `internal.user` (not exposed to PostgREST), so
// callers attribute the current user by id and fall back to a generic label
// for collaborators.
// ---------------------------------------------------------------------------

export interface ChangeEventRecordWire {
  id: string
  entity_type: string
  entity_uuid: string
  operation: string
  record_id: string | null
  actor_user_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface RecordActivityItem {
  id: string
  operation: string
  entityType: string
  actorUserId: string | null
  createdAt: string
  payload: Record<string, unknown>
}

export function toRecordActivityItem(
  row: ChangeEventRecordWire,
): RecordActivityItem {
  return {
    id: row.id,
    operation: row.operation,
    entityType: row.entity_type,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    payload: row.payload,
  }
}

// ---------------------------------------------------------------------------
// Route-aware query helpers. Each helper builds the PostgREST query string
// for one resource so the route useQuery hooks stay declarative. A shared
// client instance is fine: the helpers are stateless and the proxy adds the
// session cookie per request.
// ---------------------------------------------------------------------------

export const notebookDataClient: DataClient = createDataClient()

export function fetchProject(client: DataClient, projectId: string) {
  return client
    .list<ProjectWire>('projects', `?id=eq.${projectId}`)
    .then((rows) => (rows.length > 0 ? toProject(rows[0]) : null))
}

export function fetchRecordsForProject(client: DataClient, projectId: string) {
  return client
    .list<RecordWire>(
      'records',
      `?project_id=eq.${projectId}&order=created_at.desc&archived_at=is.null`,
    )
    .then((rows) => rows.map(toRecord))
}

export function fetchRecord(client: DataClient, recordId: string) {
  return client
    .list<RecordWire>('records', `?id=eq.${recordId}`)
    .then((rows) => (rows.length > 0 ? toRecord(rows[0]) : null))
}

export function fetchBlocksForRecord(client: DataClient, recordId: string) {
  return client
    .list<BlockWire>('blocks', `?record_id=eq.${recordId}&order=order.asc`)
    .then((rows) => rows.map(toBlock))
}

export function fetchLinksForRecord(client: DataClient, recordId: string) {
  return client
    .list<RecordLinkWire>(
      'record_links',
      `?source_record_id=eq.${recordId}&order=created_at.asc`,
    )
    .then((rows) => rows.map(toLink))
}

/**
 * Recent durable change events scoped to a record (the activity feed).
 * PostgREST exposes `change_events` under RLS; `record_id` is the scoping
 * hint written by the emit trigger for block/link/record events. Ordered
 * newest-first and bounded so the inspector stays compact.
 */
export function fetchChangeEventsForRecord(
  client: DataClient,
  recordId: string,
) {
  return client
    .list<ChangeEventRecordWire>(
      'change_events',
      `?record_id=eq.${recordId}&order=created_at.desc&limit=25&select=id,entity_type,entity_uuid,operation,record_id,actor_user_id,payload,created_at`,
    )
    .then((rows) => rows.map(toRecordActivityItem))
}

/** SCI-003: fetch the live `file_objects` metadata for a file record. */
export function fetchFileObjectByRecordId(
  client: DataClient,
  fileRecordId: string,
) {
  return client
    .list<FileObjectWire>(
      'file_objects',
      `?record_id=eq.${fileRecordId}&select=id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum,status,status_reason,version&limit=1`,
    )
    .then((rows) => (rows.length > 0 ? toFileObjectSummary(rows[0]) : null))
}

// Query keys are scoped by id so navigating between notebooks always refetches
// rather than serving a stale sibling's data.
export const notebookQueryKeys = {
  // LIVE-003: the projects list is a workspace-scoped collection too;
  // centralising its key here lets the live-event coordinator invalidate
  // it alongside the notebook-scoped keys when a project event arrives.
  projectsList: () => ['projects'] as const,
  project: (projectId: string) => ['notebook', 'project', projectId] as const,
  records: (projectId: string) => ['notebook', 'records', projectId] as const,
  record: (recordId: string) => ['notebook', 'record', recordId] as const,
  blocks: (recordId: string) => ['notebook', 'blocks', recordId] as const,
  links: (recordId: string) => ['notebook', 'links', recordId] as const,
  activity: (recordId: string) => ['notebook', 'activity', recordId] as const,
  fileObject: (fileRecordId: string) =>
    ['notebook', 'file-object', fileRecordId] as const,
  // SCI-007: overview revision snapshot — scoped by revision id so navigating
  // between revisions always refetches.
  revision: (revisionId: string) =>
    ['overview', 'revision', revisionId] as const,
}

/**
 * Human label for a record kind, used in breadcrumbs, headers and the
 * project overview. Kept here so the route, header and inspector agree.
 */
export const RECORD_KIND_LABELS: Record<string, string> = {
  experiment: 'Experiment',
  protocol_template: 'Protocol template',
  report: 'Report',
  notebook_template: 'Notebook template',
  sample: 'Sample',
  reagent: 'Reagent',
  file: 'File',
}

export function recordKindLabel(kind: string): string {
  return RECORD_KIND_LABELS[kind] ?? kind
}

/**
 * StatusBadge domain for a given record kind, so the project dashboard and
 * records table render each record with its own lifecycle vocabulary rather
 * than forcing every kind through the experiment vocabulary.
 */
export function statusDomainForKind(
  kind: string,
): 'experiment' | 'sample' | 'reagent' | 'protocol' | 'notebook_template' {
  switch (kind) {
    case 'sample':
      return 'sample'
    case 'reagent':
      return 'reagent'
    case 'protocol_template':
      return 'protocol'
    case 'notebook_template':
      return 'notebook_template'
    default:
      // experiment, report, file and any unknown kind use the experiment
      // lifecycle, which is the most general scientific state machine.
      return 'experiment'
  }
}

/**
 * Compact relative timestamp ("2h ago", "3d ago") for last-activity columns.
 * Falls back to a formatted date for anything older than a week so the value
 * stays unambiguous in dense tables. Returns an en-CA-style absolute date if
 * the input is missing.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return formatDate(iso)
}

/** Stable absolute date label for dense tables and metadata strips. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  return new Date(parsed).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Route path for a notebook-backed record. Experiments live under
 * `/projects/$projectId/experiments/$recordId`; protocol templates and
 * reports will get their own deep links in later tickets. For now every
 * kind links through the experiment route so the notebook is reachable —
 * the route renders the correct record-type label from the record's kind.
 */
export function recordPath(projectId: string, recordId: string): string {
  return `/projects/${projectId}/experiments/${recordId}`
}

// ---------------------------------------------------------------------------
// SCI-007: overview revision fetch and overview configuration update.
// ---------------------------------------------------------------------------

export interface RevisionWire {
  id: string
  workspace_id?: string
  record_id: string
  structure_version: number
  metadata_version: number
  metadata_snapshot: Record<string, unknown>
  block_snapshot: Array<{
    id: string
    type: string
    payload: Record<string, unknown>
    payload_schema_version: number
    order: number
    version: number
  }>
  canonical_snapshot?: Record<string, unknown>
  integrity_algorithm?: 'sha256'
  integrity_digest?: string
  reason: string
  superseded_by_revision_id: string | null
  created_at: string
  created_by_user_id: string
}

export interface SubmissionDigestPreview {
  recordId: string
  sourceDigest: string
  structureVersion: number
  metadataVersion: number
  calculationInputRevision: number
}

export interface SubmitRecordRevisionInput {
  recordId: string
  expectedSourceDigest: string
  workflowDefinitionKey: string
  workflowDefinitionVersion: number
  reviewerUserIds: string[]
  idempotencyKey: string
}

export interface SubmitRecordRevisionResult {
  revision: { id: string; integrityDigest: string }
  submission: { id: string; state: 'submitted' }
  idempotent: boolean
}

/** Read the digest of the complete live evidence set immediately before submit. */
export function previewSubmissionDigest(
  client: DataClient,
  recordId: string,
): Promise<SubmissionDigestPreview> {
  return client.rpc('preview_submission_digest', { p_record_id: recordId })
}

/** Create an immutable submitted revision after explicit user confirmation. */
export function submitRecordRevision(
  client: DataClient,
  input: SubmitRecordRevisionInput,
): Promise<SubmitRecordRevisionResult> {
  return client.rpc('submit_record_revision', {
    p_record_id: input.recordId,
    p_expected_source_digest: input.expectedSourceDigest,
    p_workflow_definition_key: input.workflowDefinitionKey,
    p_workflow_definition_version: input.workflowDefinitionVersion,
    p_reviewer_user_ids: input.reviewerUserIds,
    p_confirmed: true,
    p_idempotency_key: input.idempotencyKey,
  })
}

/** Fetch an immutable revision snapshot for historical overview rendering. */
export function fetchRevision(client: DataClient, revisionId: string) {
  return client
    .list<RevisionWire>('revisions', `?id=eq.${revisionId}&limit=1`)
    .then((rows) => (rows.length > 0 ? rows[0] : null))
}

/**
 * Update a record's `properties` JSONB through a direct PATCH. Used by the
 * overview to persist `properties.overview.excludedBlockIds`. The existing
 * records_update RLS policy enforces workspace membership; the AFTER UPDATE
 * trigger emits a durable change event with actor attribution.
 */
export function updateRecordProperties(
  client: DataClient,
  recordId: string,
  properties: Record<string, unknown>,
) {
  return client.patch<Pick<RecordWire, 'id' | 'properties'>>(
    'records',
    `?id=eq.${recordId}&select=id,properties`,
    { properties },
  )
}
