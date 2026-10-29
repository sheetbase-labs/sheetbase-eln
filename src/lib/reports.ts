import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import type { RevisionWire } from '#/lib/notebook-data'
import { t } from '#/copy'

/**
 * The report builder's data layer: a report is a record of kind `report` with
 * a definition (title, subtitle, status) and ordered sections. A section is
 * either text someone wrote, or a block of evidence frozen from a submitted
 * revision of another record. The database owns every rule (who may edit,
 * what a locked report refuses); this module only shapes the calls.
 */

export const REPORT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export type SectionValidation =
  'pending' | 'valid' | 'missing_source' | 'stale' | 'locked'

export interface ReportListRow {
  /** The report's record id: what the page address carries. */
  recordId: string
  definitionId: string
  identifier: string
  title: string
  subtitle: string | null
  status: ReportStatus
  version: number
  projectId: string | null
  projectTitle: string | null
  sectionCount: number
  lastGeneratedAt: string | null
  createdByUserId: string
  updatedAt: string
}

export interface ReportSection {
  id: string
  position: number
  title: string
  description: string | null
  sectionType: string
  sourceType: string
  sourceRevisionId: string | null
  sourceRef: Record<string, unknown>
  frozenPayload: Record<string, unknown>
  validationStatus: SectionValidation
  validationDetail: Record<string, unknown>
}

export interface ReportDetail {
  definitionId: string
  recordId: string
  workspaceId: string
  projectId: string | null
  projectTitle: string | null
  identifier: string
  title: string
  subtitle: string | null
  status: ReportStatus
  version: number
  createdByUserId: string
  createdAt: string
  updatedAt: string
  /** Set once the report was submitted for review: its sections stop changing. */
  lockedAt: string | null
  sections: ReportSection[]
}

export interface ReportGeneration {
  id: string
  reportVersion: number
  outputFormat: string
  /** The checksum of the inputs: the same sections always give the same one. */
  checksum: string
  sizeBytes: number
  actorUserId: string
  generatedAt: string
}

export interface ReportReadiness {
  sections: number
  valid: number
  missingSource: number
  stale: number
  locked: number
  ready: boolean
}

export const reportKeys = {
  all: ['ui-port', 'reports'] as const,
  list: ['ui-port', 'reports', 'list'] as const,
  detail: (recordId: string) =>
    ['ui-port', 'reports', 'detail', recordId] as const,
  generations: (definitionId: string) =>
    ['ui-port', 'reports', 'generations', definitionId] as const,
  evidenceRevisions: (recordId: string) =>
    ['ui-port', 'reports', 'evidence', recordId] as const,
}

export function reportStatus(status: string): {
  tone: 'ok' | 'review' | 'draft' | 'stored' | 'none'
  label: string
} {
  switch (status) {
    case 'approved':
    case 'published':
      return { tone: 'ok', label: t('projects.reports.status.approved') }
    case 'in_review':
      return { tone: 'review', label: t('projects.reports.status.inReview') }
    case 'draft':
      return { tone: 'draft', label: t('projects.reports.status.draft') }
    case 'archived':
      return { tone: 'stored', label: t('projects.reports.status.archived') }
    default:
      return { tone: 'none', label: status }
  }
}

interface ListWire {
  id: string
  record_id: string
  project_id: string | null
  title: string
  subtitle: string | null
  document_identifier: string
  status: ReportStatus
  version: number
  created_by_user_id: string
  updated_at: string
  projects: { title: string } | null
  report_sections: Array<{ count: number }>
  report_generations: Array<{ generated_at: string }>
}

export async function fetchReports(
  client: DataClient,
): Promise<ReportListRow[]> {
  const rows = await client.list<ListWire>(
    'report_definitions',
    '?select=id,record_id,project_id,title,subtitle,document_identifier,status,version,created_by_user_id,updated_at,projects(title),report_sections(count),report_generations(generated_at)&report_generations.order=generated_at.desc&report_generations.limit=1&order=updated_at.desc',
  )
  return rows.map((r) => ({
    recordId: r.record_id,
    definitionId: r.id,
    identifier: r.document_identifier,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    version: r.version,
    projectId: r.project_id,
    projectTitle: r.projects?.title ?? null,
    sectionCount: r.report_sections.at(0)?.count ?? 0,
    lastGeneratedAt: r.report_generations.at(0)?.generated_at ?? null,
    createdByUserId: r.created_by_user_id,
    updatedAt: r.updated_at,
  }))
}

interface DetailWire {
  id: string
  workspace_id: string
  record_id: string
  project_id: string | null
  title: string
  subtitle: string | null
  document_identifier: string
  status: ReportStatus
  version: number
  created_by_user_id: string
  created_at: string
  updated_at: string
  projects: { title: string } | null
  report_sections: Array<{
    id: string
    position: number
    title: string
    description: string | null
    section_type: string
    source_type: string
    source_revision_id: string | null
    source_ref: Record<string, unknown>
    frozen_payload: Record<string, unknown>
    validation_status: SectionValidation
    validation_detail: Record<string, unknown>
  }>
}

/** A report by its record id, with its sections in order. */
export async function fetchReport(
  client: DataClient,
  recordId: string,
): Promise<ReportDetail | null> {
  const id = z.uuid().parse(recordId)
  const rows = await client.list<DetailWire>(
    'report_definitions',
    `?record_id=eq.${id}&select=id,workspace_id,record_id,project_id,title,subtitle,document_identifier,status,version,created_by_user_id,created_at,updated_at,projects(title),report_sections(id,position,title,description,section_type,source_type,source_revision_id,source_ref,frozen_payload,validation_status,validation_detail)&report_sections.order=position.asc,id.asc&limit=1`,
  )
  const r = rows.at(0)
  if (!r) return null
  const locks = await client.list<{ locked_at: string | null }>(
    'records',
    `?id=eq.${id}&select=locked_at&limit=1`,
  )
  return {
    lockedAt: locks.at(0)?.locked_at ?? null,
    definitionId: r.id,
    recordId: r.record_id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    projectTitle: r.projects?.title ?? null,
    identifier: r.document_identifier,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    version: r.version,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sections: r.report_sections.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      description: s.description,
      sectionType: s.section_type,
      sourceType: s.source_type,
      sourceRevisionId: s.source_revision_id,
      sourceRef: s.source_ref,
      frozenPayload: s.frozen_payload,
      validationStatus: s.validation_status,
      validationDetail: s.validation_detail,
    })),
  }
}

export async function createReport(
  client: DataClient,
  input: {
    workspaceId: string
    title: string
    subtitle?: string
    projectId?: string | null
  },
): Promise<{ recordId: string; definitionId: string }> {
  const row = await client.rpc<{ id: string; record_id: string }>(
    'create_report_definition',
    {
      p_workspace_id: input.workspaceId,
      p_title: input.title.trim(),
      p_subtitle: input.subtitle?.trim() || null,
      p_project_id: input.projectId || null,
    },
  )
  return { recordId: row.record_id, definitionId: row.id }
}

export async function updateReport(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    title?: string
    subtitle?: string
    status?: ReportStatus
  },
): Promise<void> {
  await client.rpc('update_report_definition', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
    p_title: input.title ?? null,
    p_subtitle: input.subtitle ?? null,
    p_status: input.status ?? null,
  })
}

/** What kind of section a block of evidence becomes. */
export function sectionKindForBlock(blockType: string): {
  sectionType: string
  sourceType: string
} {
  switch (blockType) {
    case 'chart':
    case 'analysis':
      return { sectionType: 'chart', sourceType: 'chart_block' }
    case 'table':
    case 'sheet':
      return { sectionType: 'table', sourceType: 'table_block' }
    case 'file':
      return { sectionType: 'file', sourceType: 'revision_block' }
    default:
      return { sectionType: 'text', sourceType: 'revision_block' }
  }
}

export async function addTextSection(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    title: string
    body?: string
  },
): Promise<{ id: string }> {
  return client.rpc<{ id: string }>('add_report_section', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
    p_title: input.title.trim(),
    p_description: input.body?.trim() || null,
    p_section_type: 'text',
    p_source_type: 'free_text',
  })
}

export interface EvidenceChoice {
  revisionId: string
  blockId: string
  blockType: string
  recordIdentifier: string
  recordId: string
  revisionVersion: number
}

/** Add a section whose content is a block frozen from a submitted revision. */
export async function addEvidenceSection(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    title: string
    evidence: EvidenceChoice
  },
): Promise<void> {
  const kind = sectionKindForBlock(input.evidence.blockType)
  const section = await client.rpc<{ id: string }>('add_report_section', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
    p_title: input.title.trim(),
    p_description: null,
    p_section_type: kind.sectionType,
    p_source_type: kind.sourceType,
  })
  await bindEvidence(client, {
    workspaceId: input.workspaceId,
    sectionId: section.id,
    evidence: input.evidence,
  })
}

export async function bindEvidence(
  client: DataClient,
  input: { workspaceId: string; sectionId: string; evidence: EvidenceChoice },
): Promise<void> {
  await client.rpc('bind_report_section_source', {
    p_workspace_id: input.workspaceId,
    p_section_id: input.sectionId,
    p_source_revision_id: input.evidence.revisionId,
    p_source_ref: {
      blockId: input.evidence.blockId,
      recordId: input.evidence.recordId,
      recordIdentifier: input.evidence.recordIdentifier,
      revisionVersion: input.evidence.revisionVersion,
    },
  })
}

export async function updateSection(
  client: DataClient,
  input: {
    workspaceId: string
    sectionId: string
    title?: string
    /** An empty string clears the text. */
    body?: string
  },
): Promise<void> {
  await client.rpc('update_report_section', {
    p_workspace_id: input.workspaceId,
    p_section_id: input.sectionId,
    p_title: input.title ?? null,
    p_description: input.body ?? null,
  })
}

export async function removeSection(
  client: DataClient,
  input: { workspaceId: string; sectionId: string },
): Promise<void> {
  await client.rpc('remove_report_section', {
    p_workspace_id: input.workspaceId,
    p_section_id: input.sectionId,
  })
}

export async function reorderSections(
  client: DataClient,
  input: { workspaceId: string; definitionId: string; sectionIds: string[] },
): Promise<void> {
  await client.rpc('reorder_report_sections', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
    p_section_ids: input.sectionIds,
  })
}

/** The ids in the order they would have after moving one up or down. */
export function moveId(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const from = ids.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

const readinessSchema = z.object({
  sections: z.number(),
  valid: z.number(),
  missingSource: z.number(),
  stale: z.number(),
  locked: z.number(),
  ready: z.boolean(),
})

/** Check every section against its source; also refreshes each one's status. */
export async function validateReport(
  client: DataClient,
  input: { workspaceId: string; definitionId: string },
): Promise<ReportReadiness> {
  const raw = await client.rpc<unknown>('validate_report', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
  })
  return readinessSchema.parse(raw)
}

interface GenerationWire {
  id: string
  report_version: number
  output_format: string
  output_checksum: string
  output_size_bytes: number | string
  actor_user_id: string
  generated_at: string
}

function mapGeneration(g: GenerationWire): ReportGeneration {
  return {
    id: g.id,
    reportVersion: g.report_version,
    outputFormat: g.output_format,
    checksum: g.output_checksum,
    sizeBytes: Number(g.output_size_bytes),
    actorUserId: g.actor_user_id,
    generatedAt: g.generated_at,
  }
}

export async function generateReport(
  client: DataClient,
  input: { workspaceId: string; definitionId: string },
): Promise<ReportGeneration> {
  const row = await client.rpc<GenerationWire>('generate_report', {
    p_workspace_id: input.workspaceId,
    p_report_id: input.definitionId,
    p_output_format: 'html',
  })
  return mapGeneration(row)
}

export async function fetchGenerations(
  client: DataClient,
  definitionId: string,
): Promise<ReportGeneration[]> {
  const id = z.uuid().parse(definitionId)
  const rows = await client.list<GenerationWire>(
    'report_generations',
    `?report_id=eq.${id}&select=id,report_version,output_format,output_checksum,output_size_bytes,actor_user_id,generated_at&order=generated_at.desc&limit=50`,
  )
  return rows.map(mapGeneration)
}

/** The stored document of one generated report. */
export async function fetchGenerationHtml(
  client: DataClient,
  generationId: string,
): Promise<string> {
  const id = z.uuid().parse(generationId)
  const rows = await client.list<{ output_html: string | null }>(
    'report_generations',
    `?id=eq.${id}&select=output_html&limit=1`,
  )
  return rows.at(0)?.output_html ?? ''
}

/** The short form of a checksum a person can read out or compare. */
export function fingerprint(checksum: string): string {
  const head = checksum.slice(0, 8).toUpperCase()
  return `${head.slice(0, 4)}-${head.slice(4)}`
}

// ---------------------------------------------------------------------------
// Evidence: the submitted revisions of a record and the blocks inside them.
// ---------------------------------------------------------------------------

export interface EvidenceRevision {
  id: string
  version: number
  reason: string
  createdAt: string
}

export async function fetchEvidenceRevisions(
  client: DataClient,
  recordId: string,
): Promise<EvidenceRevision[]> {
  const id = z.uuid().parse(recordId)
  const rows = await client.list<
    Pick<RevisionWire, 'id' | 'structure_version' | 'reason' | 'created_at'>
  >(
    'revisions',
    `?record_id=eq.${id}&select=id,structure_version,reason,created_at&order=created_at.desc,id.desc&limit=20`,
  )
  return rows.map((r) => ({
    id: r.id,
    version: r.structure_version,
    reason: r.reason,
    createdAt: r.created_at,
  }))
}

export interface EvidenceBlock {
  id: string
  type: string
  /** The words in the block, or an empty string when it has none. */
  text: string
}

/** Every `text` value in a block's payload, in order, as one line. */
export function payloadText(payload: unknown): string {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text' && typeof value === 'string') out.push(value)
      else walk(value)
    }
  }
  walk(payload)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export async function fetchRevisionBlocks(
  client: DataClient,
  revisionId: string,
): Promise<EvidenceBlock[]> {
  const id = z.uuid().parse(revisionId)
  const rows = await client.list<Pick<RevisionWire, 'block_snapshot'>>(
    'revisions',
    `?id=eq.${id}&select=block_snapshot&limit=1`,
  )
  const blocks = rows.at(0)?.block_snapshot ?? []
  return blocks.map((b) => ({
    id: b.id,
    type: b.type,
    text: payloadText(b.payload),
  }))
}

/** The block a section froze, in the shape the notebook's preview takes. */
export function frozenBlockOf(section: ReportSection): {
  id: string
  recordId: string
  type: string
  payload: Record<string, unknown>
  payloadSchemaVersion: number
  order: number
  version: number
} | null {
  const block = section.frozenPayload.block as
    | {
        id?: string
        type?: string
        payload?: Record<string, unknown>
        payload_schema_version?: number
        order?: number
        version?: number
      }
    | undefined
  if (!block?.id || !block.type) return null
  return {
    id: block.id,
    recordId: String(section.sourceRef.recordId ?? ''),
    type: block.type,
    payload: block.payload ?? {},
    payloadSchemaVersion: block.payload_schema_version ?? 1,
    order: block.order ?? 0,
    version: block.version ?? 1,
  }
}

/** Plain-language label for a section's check result. */
export function validationLabel(status: SectionValidation): {
  tone: 'ok' | 'warn' | 'bad' | 'none'
  label: string
} {
  switch (status) {
    case 'valid':
      return { tone: 'ok', label: t('projects.reports.check.valid') }
    case 'locked':
      return { tone: 'ok', label: t('projects.reports.check.locked') }
    case 'stale':
      return { tone: 'warn', label: t('projects.reports.check.stale') }
    case 'missing_source':
      return { tone: 'bad', label: t('projects.reports.check.missing') }
    default:
      return { tone: 'none', label: t('projects.reports.check.pending') }
  }
}
