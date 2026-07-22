/**
 * SCI-006: reusable template domain library. Template types, status
 * vocabularies, lifecycle rules, instantiation helpers, and query keys.
 *
 * Templates are records (kind `protocol_template` or `notebook_template`).
 * This module provides the application-boundary validation and DataClient
 * helpers; PostgreSQL/RLS remain the authoritative access-control boundary.
 */
import type { DataClient } from './data-client'
import type { NotebookRecord } from './notebook-data'

// ---------------------------------------------------------------------------
// Template kinds and identifiers
// ---------------------------------------------------------------------------

export type TemplateKind = 'protocol_template' | 'notebook_template'

export const TEMPLATE_KINDS: readonly TemplateKind[] = [
  'protocol_template',
  'notebook_template',
] as const

export function isTemplateKind(kind: string): kind is TemplateKind {
  return kind === 'protocol_template' || kind === 'notebook_template'
}

export const TEMPLATE_KIND_PREFIX: Record<TemplateKind, string> = {
  protocol_template: 'PRT',
  notebook_template: 'NBK',
}

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  protocol_template: 'Protocol',
  notebook_template: 'Notebook',
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
  notebook_template: ['validated'],
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
  notebook_template: {
    draft: ['validated'],
    validated: ['draft'],
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
  notebook_template: ['experiment'],
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
    'kind=in.(protocol_template,notebook_template)',
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
  return client.list<NotebookRecord>('records', `?${parts.join('&')}`)
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
}
