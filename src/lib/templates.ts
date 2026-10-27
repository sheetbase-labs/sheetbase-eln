/**
 * SCI-006 / TPL-001: reusable template domain library. Template types,
 * status vocabularies, lifecycle rules, instantiation helpers, archive /
 * duplicate / export helpers, favourites persistence, and query keys.
 *
 * Templates are protocol records (`protocol_template`). Notebook Templates
 * use the CORE-06 `notebook_templates` catalogue, not record kinds.
 */
import type { DataClient } from './data-client'
import type { NotebookBlock, NotebookRecord, RecordWire } from './notebook-data'
import { toRecord } from './notebook-data'
import { now as appNow } from '#/lib/clock'

// ---------------------------------------------------------------------------
// Template kinds and identifiers
// ---------------------------------------------------------------------------

export type TemplateKind = 'protocol_template'

export const TEMPLATE_KINDS: readonly TemplateKind[] = [
  'protocol_template',
] as const

export function isTemplateKind(kind: string): kind is TemplateKind {
  return kind === 'protocol_template'
}

export const TEMPLATE_KIND_PREFIX: Record<TemplateKind, string> = {
  protocol_template: 'PRT',
}

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  protocol_template: 'Protocol',
}

// ---------------------------------------------------------------------------
// Template status vocabularies
// ---------------------------------------------------------------------------

export type ProtocolTemplateStatus = 'draft' | 'under_review' | 'active'

export type NotebookTemplateStatus = 'draft' | 'validated'

export type TemplateStatus = ProtocolTemplateStatus | NotebookTemplateStatus

/** Statuses from which instantiation is allowed. */
export const INSTANTIABLE_STATUSES: Record<TemplateKind, readonly string[]> = {
  protocol_template: ['active'],
}

export function isInstantiable(
  kind: TemplateKind,
  status: string,
  archivedAt: string | null,
): boolean {
  if (archivedAt !== null) return false
  return INSTANTIABLE_STATUSES[kind].includes(status)
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export const TEMPLATE_TRANSITIONS: Record<
  TemplateKind,
  Record<string, readonly string[]>
> = {
  protocol_template: {
    draft: ['active', 'under_review'],
    under_review: ['active', 'draft'],
    active: ['draft'],
  },
}

export function allowedTemplateTransitions(
  kind: TemplateKind,
  from: string,
): readonly string[] {
  const fromMap = TEMPLATE_TRANSITIONS[kind]
  return from in fromMap ? fromMap[from] : []
}

export function isAllowedTemplateTransition(
  kind: TemplateKind,
  from: string,
  to: string,
): boolean {
  return allowedTemplateTransitions(kind, from).includes(to)
}

// ---------------------------------------------------------------------------
// Target kinds (what a template can be instantiated as)
// ---------------------------------------------------------------------------

export type TargetKind = 'experiment' | 'protocol_template'

export const INSTANTIABLE_TARGET_KINDS: Record<
  TemplateKind,
  readonly TargetKind[]
> = {
  protocol_template: ['experiment', 'protocol_template'],
}

// ---------------------------------------------------------------------------
// DataClient helpers
// ---------------------------------------------------------------------------

export interface TemplateRecord extends NotebookRecord {
  kind: TemplateKind
}

/** Wire shape from PostgREST for record_links with link_metadata. */
export interface TemplateLinkWire {
  id: string
  source_record_id: string
  target_record_id: string | null
  target_kind: string
  target_identifier: string
  link_type: string
  link_metadata: Record<string, unknown> | null
  created_at: string
}

export interface TemplateLink {
  id: string
  sourceRecordId: string
  targetRecordId: string | null
  targetKind: string
  targetIdentifier: string
  linkType: string
  linkMetadata: Record<string, unknown>
  createdAt: string
}

export function toTemplateLink(row: TemplateLinkWire): TemplateLink {
  return {
    id: row.id,
    sourceRecordId: row.source_record_id,
    targetRecordId: row.target_record_id,
    targetKind: row.target_kind,
    targetIdentifier: row.target_identifier,
    linkType: row.link_type,
    linkMetadata: row.link_metadata ?? {},
    createdAt: row.created_at,
  }
}

/**
 * Fetch templates of all kinds, optionally filtered. Returns records sorted
 * by archived status then identifier.
 */
export function fetchTemplates(
  client: DataClient,
  opts: {
    kind?: TemplateKind
    status?: string
    includeArchived?: boolean
    search?: string
  } = {},
): Promise<NotebookRecord[]> {
  const parts: string[] = [
    'kind=eq.protocol_template',
    'deleted_at=is.null',
    'order=archived_at.asc,identifier.asc',
  ]
  if (opts.kind) {
    parts[0] = `kind=eq.${opts.kind}`
  }
  if (opts.status) {
    parts.push(`status=eq.${opts.status}`)
  }
  if (!opts.includeArchived) {
    parts.push('archived_at=is.null')
  }
  if (opts.search && opts.search.trim()) {
    const q = encodeURIComponent(opts.search.trim().replace(/[,*]/g, ''))
    parts.push(`(identifier=ilike.${q}*,title=ilike.${q}*)`)
  }
  return client
    .list<RecordWire>(
      'records',
      `?${parts.join('&')}&select=id,workspace_id,project_id,folder_id,kind,identifier,title,status,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id,locked_at,locked_by_revision_id`,
    )
    .then((rows) => rows.map(toRecord))
}

/**
 * Fetch template links (outgoing source-template links from a record).
 */
export function fetchTemplateLinks(
  client: DataClient,
  recordId: string,
): Promise<TemplateLink[]> {
  return client
    .list<TemplateLinkWire>(
      'record_links',
      `?source_record_id=eq.${recordId}&link_type=eq.template&order=created_at.asc`,
    )
    .then((rows) => rows.map(toTemplateLink))
}

/**
 * Instantiate a template via the instantiate_template RPC.
 */
export function instantiateTemplate(
  client: DataClient,
  params: {
    templateRecordId: string
    targetProjectId: string
    targetKind: TargetKind
    title?: string
  },
): Promise<{
  record: NotebookRecord
  blocks: unknown[]
  revision: { id: string; reason: string }
  link: TemplateLink
}> {
  return client.rpc('instantiate_template', {
    p_template_record_id: params.templateRecordId,
    p_target_project_id: params.targetProjectId,
    p_target_kind: params.targetKind,
    p_title: params.title ?? null,
  })
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const templateQueryKeys = {
  list: (filters?: {
    kind?: string
    status?: string
    search?: string
    includeArchived?: boolean
  }) => ['sci-006', 'templates', filters ?? {}] as const,

  links: (recordId: string) => ['sci-006', 'template-links', recordId] as const,

  // TPL-001: incoming usage links (records instantiated from a template) and
  // the source records they point from, scoped by template id.
  usage: (recordId: string) => ['tpl-001', 'template-usage', recordId] as const,
}

// ---------------------------------------------------------------------------
// TPL-001: Archive, duplicate and export helpers
// ---------------------------------------------------------------------------

/**
 * Archive a template through the `archive_record` RPC. Requires the
 * `metadata_version` the client last saw so a stale view cannot clobber a
 * newer edit (SB001). RLS enforces workspace membership; the caller still
 * receives `DataClientError` for permission/stale-version failures.
 */
export function archiveTemplate(
  client: DataClient,
  recordId: string,
  expectedMetadataVersion: number,
): Promise<NotebookRecord> {
  return client.rpc('archive_record', {
    p_record_id: recordId,
    p_expected_metadata_version: expectedMetadataVersion,
  })
}

/** Wire shape returned by `create_record_with_blocks`. */
export interface DuplicateTemplateResult {
  record: NotebookRecord
  blocks: NotebookBlock[]
}

/**
 * Duplicate a template into a new draft template in the same project (or a
 * chosen target project) via the transactional `create_record_with_blocks`
 * RPC. The copy starts at `draft` regardless of the source lifecycle state so
 * it must be validated/activated independently before it can be instantiated.
 * Block ids are minted by the database; the copy shares no mutable content
 * with the source.
 */
export function duplicateTemplate(
  client: DataClient,
  params: {
    template: NotebookRecord
    blocks: NotebookBlock[]
    targetProjectId: string
    title: string
  },
): Promise<DuplicateTemplateResult> {
  if (params.template.kind === 'notebook_template') {
    throw new Error(
      'Legacy notebook template records cannot be duplicated. Use createNotebookTemplate.',
    )
  }
  const blocks = params.blocks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((block) => ({
      type: block.type,
      payload: block.payload,
      payload_schema_version: block.payloadSchemaVersion,
      order: block.order,
    }))
  return client.rpc('create_record_with_blocks', {
    p_project_id: params.targetProjectId,
    p_kind: params.template.kind,
    p_title: params.title,
    p_status: 'draft',
    p_tags: params.template.tags,
    p_blocks: blocks,
    p_properties: params.template.properties,
  })
}

/**
 * Build a portable, deterministic JSON export of a template and its blocks
 * for download. Pure and testable: the route turns this into a Blob. The
 * shape records the kind, identifier, lifecycle version, status and ordered
 * block payloads so an export can be reviewed or re-imported later without
 * the live database.
 */
export interface TemplateExport {
  schema: 'sheetbase-template-export'
  schemaVersion: 1
  exportedAt: string
  template: {
    identifier: string
    kind: string
    title: string
    status: string
    tags: string[]
    structureVersion: number
    metadataVersion: number
    properties: Record<string, unknown>
  }
  blocks: Array<{
    type: string
    payload: Record<string, unknown>
    payloadSchemaVersion: number
    order: number
  }>
}

export function buildTemplateExport(
  template: NotebookRecord,
  blocks: NotebookBlock[],
  now: number = appNow().getTime(),
): TemplateExport {
  return {
    schema: 'sheetbase-template-export',
    schemaVersion: 1,
    exportedAt: new Date(now).toISOString(),
    template: {
      identifier: template.identifier,
      kind: template.kind,
      title: template.title,
      status: template.status,
      tags: template.tags,
      structureVersion: template.structureVersion,
      metadataVersion: template.metadataVersion,
      properties: template.properties,
    },
    blocks: blocks
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((block) => ({
        type: block.type,
        payload: block.payload,
        payloadSchemaVersion: block.payloadSchemaVersion,
        order: block.order,
      })),
  }
}

// ---------------------------------------------------------------------------
// TPL-001: Usage links — records instantiated from a template
// ---------------------------------------------------------------------------

/** Wire shape for an incoming template usage link. */
export interface TemplateUsageLinkWire {
  id: string
  source_record_id: string
  link_metadata: Record<string, unknown> | null
  created_at: string
}

export interface TemplateUsageItem {
  id: string
  recordId: string
  templateRevisionId: string | null
  createdAt: string
}

export function toTemplateUsageItem(
  row: TemplateUsageLinkWire,
): TemplateUsageItem {
  const meta = row.link_metadata ?? {}
  const revisionId = meta.template_revision_id
  return {
    id: row.id,
    recordId: row.source_record_id,
    templateRevisionId: typeof revisionId === 'string' ? revisionId : null,
    createdAt: row.created_at,
  }
}

/**
 * Fetch the bounded list of records instantiated from a template (incoming
 * `template` links), newest-first. The route pairs each link with its source
 * record in a second request so the inspector can show titles without an N+1.
 */
export function fetchTemplateUsage(
  client: DataClient,
  templateId: string,
  limit = 25,
): Promise<TemplateUsageItem[]> {
  return client
    .list<TemplateUsageLinkWire>(
      'record_links',
      `?target_record_id=eq.${templateId}&link_type=eq.template&order=created_at.desc&limit=${limit}&select=id,source_record_id,link_metadata,created_at`,
    )
    .then((rows) => rows.map(toTemplateUsageItem))
}

// ---------------------------------------------------------------------------
// TPL-001: Permission and dependency checks for template actions
// ---------------------------------------------------------------------------

/**
 * Workspace roles that may manage (archive/duplicate) any template in the
 * workspace. Authorship always grants management rights; RLS remains the
 * authoritative boundary so this is a UI affordance, not a security check.
 */
const MANAGING_ROLES = new Set(['owner', 'admin'])

export function canManageTemplate(
  template: NotebookRecord,
  currentUserId: string | null,
  role: string | null,
): boolean {
  if (!currentUserId) return false
  if (template.createdByUserId === currentUserId) return true
  return Boolean(role && MANAGING_ROLES.has(role))
}

/**
 * Dependency check for archiving: archiving does not break already-
 * instantiated records (they hold their own block copy + an immutable
 * revision), but a non-zero usage count is surfaced as a confirmation
 * prompt so an owner does not archive a template that is actively in use.
 */
export function archiveDependencyWarning(usageCount: number): string | null {
  if (usageCount <= 0) return null
  return `This template has been used ${usageCount} ${
    usageCount === 1 ? 'time' : 'times'
  }. Existing records keep their own copy and are unaffected, but the template will no longer be available for new instantiations.`
}

// ---------------------------------------------------------------------------
// TPL-001: Favourites — per-user, per-workspace localStorage persistence
// ---------------------------------------------------------------------------

export interface TemplateFavouritesStore {
  list: () => string[]
  has: (id: string) => boolean
  toggle: (id: string) => boolean
  set: (ids: string[]) => void
}

export function templateFavouritesStorageKey(
  workspaceId: string,
  userId: string,
): string {
  return ['sheetbase-template-favourites-v1', workspaceId, userId]
    .map(encodeURIComponent)
    .join(':')
}

export function createTemplateFavouritesStore({
  workspaceId,
  userId,
  storage,
}: {
  workspaceId: string
  userId: string
  storage?: Storage
}): TemplateFavouritesStore {
  const key = templateFavouritesStorageKey(workspaceId, userId)
  let resolvedStorage: Storage | null = storage ?? null
  if (!resolvedStorage && typeof window !== 'undefined') {
    try {
      resolvedStorage = window.localStorage
    } catch {
      resolvedStorage = null
    }
  }

  function read(): string[] {
    if (!resolvedStorage) return []
    try {
      const parsed: unknown = JSON.parse(resolvedStorage.getItem(key) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.filter((id): id is string => typeof id === 'string')
    } catch {
      return []
    }
  }

  function write(ids: string[]) {
    try {
      resolvedStorage?.setItem(key, JSON.stringify(ids))
    } catch {
      // Storage may be unavailable (private browsing / quota). Favourites
      // still work in-memory for the session; they just cannot persist.
    }
  }

  return {
    list: read,
    has(id) {
      return read().includes(id)
    },
    toggle(id) {
      const ids = read()
      const next = ids.includes(id)
        ? ids.filter((existing) => existing !== id)
        : [...ids, id]
      write(next)
      return next.includes(id)
    },
    set(ids) {
      write(ids)
    },
  }
}
