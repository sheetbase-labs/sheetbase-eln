/**
 * OPS-007 — Report Builder domain model and persistence boundary.
 *
 * Wire mappers, typed wrappers around the report builder RPCs (migration
 * 0053), deterministic preview/checksum helpers, and accessible HTML
 * rendering. PostgreSQL and RLS remain the authoritative access-control
 * boundary; these helpers drive the UI, normalise wire shapes and map RPC
 * error codes to actionable messages.
 *
 * Report sections reference frozen revision evidence (REV-003/REV-005/
 * REV-008). The frozen payload captured at bind time is the only content the
 * preview and export paths read — live data is never substituted for frozen
 * evidence. Generation is deterministic: identical inputs produce an
 * identical output checksum, which is verified by the regenerate path.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'

export type JsonObject = Record<string, unknown>

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export type ReportStatus =
  'draft' | 'in_review' | 'approved' | 'published' | 'archived'

export type SectionType =
  'text' | 'table' | 'chart' | 'file' | 'record_metadata' | 'composite'

export type SourceType =
  | 'free_text'
  | 'revision_block'
  | 'chart_block'
  | 'table_block'
  | 'file_object'
  | 'record_metadata'

export type ValidationStatus =
  'pending' | 'valid' | 'missing_source' | 'stale' | 'locked'

export type OutputFormat = 'html' | 'pdf'

// ---------------------------------------------------------------------------
// Wire shapes (PostgREST snake_case).
// ---------------------------------------------------------------------------

export interface ReportDefinitionWire {
  id: string
  workspace_id: string
  project_id: string | null
  record_id: string | null
  template_record_id: string | null
  review_submission_id: string | null
  title: string
  subtitle: string | null
  document_identifier: string
  status: ReportStatus
  version: number
  last_saved_at: string
  created_at: string
  updated_at: string
  created_by_user_id: string
  updated_by_user_id: string | null
}

export interface ReportSectionWire {
  id: string
  workspace_id: string
  report_id: string
  position: number
  title: string
  description: string | null
  section_type: SectionType
  source_type: SourceType
  source_revision_id: string | null
  source_ref: JsonObject
  frozen_payload: JsonObject
  validation_status: ValidationStatus
  validation_detail: JsonObject
  created_at: string
  updated_at: string
  created_by_user_id: string
  updated_by_user_id: string | null
}

export interface ReportGenerationWire {
  id: string
  workspace_id: string
  report_id: string
  report_version: number
  generation_inputs: JsonObject
  output_format: OutputFormat
  output_checksum: string
  output_size_bytes: number
  output_html: string | null
  actor_user_id: string
  generated_at: string
  created_at: string
}

export interface ValidationSummaryWire {
  reportId: string
  sections: number
  valid: number
  missingSource: number
  stale: number
  locked: number
  ready: boolean
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the UI).
// ---------------------------------------------------------------------------

export interface ReportDefinition {
  id: string
  workspaceId: string
  projectId: string | null
  recordId: string | null
  templateRecordId: string | null
  reviewSubmissionId: string | null
  title: string
  subtitle: string | null
  documentIdentifier: string
  status: ReportStatus
  version: number
  lastSavedAt: string
  createdAt: string
  updatedAt: string
  createdByUserId: string
  updatedByUserId: string | null
}

export interface ReportSection {
  id: string
  workspaceId: string
  reportId: string
  position: number
  title: string
  description: string | null
  sectionType: SectionType
  sourceType: SourceType
  sourceRevisionId: string | null
  sourceRef: JsonObject
  frozenPayload: JsonObject
  validationStatus: ValidationStatus
  validationDetail: JsonObject
  createdAt: string
  updatedAt: string
  createdByUserId: string
  updatedByUserId: string | null
}

export interface ReportGeneration {
  id: string
  workspaceId: string
  reportId: string
  reportVersion: number
  generationInputs: JsonObject
  outputFormat: OutputFormat
  outputChecksum: string
  outputSizeBytes: number
  outputHtml: string | null
  actorUserId: string
  generatedAt: string
  createdAt: string
}

export interface ValidationSummary {
  reportId: string
  sections: number
  valid: number
  missingSource: number
  stale: number
  locked: number
  ready: boolean
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export const toReportDefinition = (
  w: ReportDefinitionWire,
): ReportDefinition => ({
  id: w.id,
  workspaceId: w.workspace_id,
  projectId: w.project_id,
  recordId: w.record_id,
  templateRecordId: w.template_record_id,
  reviewSubmissionId: w.review_submission_id,
  title: w.title,
  subtitle: w.subtitle,
  documentIdentifier: w.document_identifier,
  status: w.status,
  version: w.version,
  lastSavedAt: w.last_saved_at,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
  createdByUserId: w.created_by_user_id,
  updatedByUserId: w.updated_by_user_id,
})

export const toReportSection = (w: ReportSectionWire): ReportSection => ({
  id: w.id,
  workspaceId: w.workspace_id,
  reportId: w.report_id,
  position: w.position,
  title: w.title,
  description: w.description,
  sectionType: w.section_type,
  sourceType: w.source_type,
  sourceRevisionId: w.source_revision_id,
  sourceRef: w.source_ref,
  frozenPayload: w.frozen_payload,
  validationStatus: w.validation_status,
  validationDetail: w.validation_detail,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
  createdByUserId: w.created_by_user_id,
  updatedByUserId: w.updated_by_user_id,
})

export const toReportGeneration = (
  w: ReportGenerationWire,
): ReportGeneration => ({
  id: w.id,
  workspaceId: w.workspace_id,
  reportId: w.report_id,
  reportVersion: w.report_version,
  generationInputs: w.generation_inputs,
  outputFormat: w.output_format,
  outputChecksum: w.output_checksum,
  outputSizeBytes: w.output_size_bytes,
  outputHtml: w.output_html,
  actorUserId: w.actor_user_id,
  generatedAt: w.generated_at,
  createdAt: w.created_at,
})

export const toValidationSummary = (
  w: ValidationSummaryWire,
): ValidationSummary => ({
  reportId: w.reportId,
  sections: w.sections,
  valid: w.valid,
  missingSource: w.missingSource,
  stale: w.stale,
  locked: w.locked,
  ready: w.ready,
})

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const reportBuilderQueryKeys = {
  reports: (id: string) => ['ops-007', 'reports', id] as const,
  sections: (id: string) => ['ops-007', 'sections', id] as const,
  generations: (id: string) => ['ops-007', 'generations', id] as const,
  validation: (id: string) => ['ops-007', 'validation', id] as const,
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

const filter = (column: string, id: string, order: string) =>
  `?${column}=eq.${encodeURIComponent(id)}&order=${order}`

export async function fetchReports(c: DataClient, workspaceId: string) {
  return (
    await c.list<ReportDefinitionWire>(
      'report_definitions',
      filter('workspace_id', workspaceId, 'updated_at.desc'),
    )
  ).map(toReportDefinition)
}

export async function fetchReportSections(c: DataClient, reportId: string) {
  return (
    await c.list<ReportSectionWire>(
      'report_sections',
      filter('report_id', reportId, 'position'),
    )
  ).map(toReportSection)
}

export async function fetchReportGenerations(c: DataClient, reportId: string) {
  return (
    await c.list<ReportGenerationWire>(
      'report_generations',
      filter('report_id', reportId, 'generated_at.desc'),
    )
  ).map(toReportGeneration)
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

export async function createReportDefinition(
  c: DataClient,
  i: {
    workspaceId: string
    title: string
    subtitle?: string | null
    projectId?: string | null
    templateRecordId?: string | null
  },
): Promise<ReportDefinitionWire> {
  return c.rpc('create_report_definition', {
    p_workspace_id: i.workspaceId,
    p_title: i.title,
    p_subtitle: i.subtitle ?? null,
    p_project_id: i.projectId ?? null,
    p_template_record_id: i.templateRecordId ?? null,
  })
}

export async function updateReportDefinition(
  c: DataClient,
  i: {
    workspaceId: string
    reportId: string
    title?: string | null
    subtitle?: string | null
    status?: ReportStatus | null
    templateRecordId?: string | null
    reviewSubmissionId?: string | null
  },
): Promise<ReportDefinitionWire> {
  return c.rpc('update_report_definition', {
    p_workspace_id: i.workspaceId,
    p_report_id: i.reportId,
    p_title: i.title ?? null,
    p_subtitle: i.subtitle ?? null,
    p_status: i.status ?? null,
    p_template_record_id: i.templateRecordId ?? null,
    p_review_submission_id: i.reviewSubmissionId ?? null,
  })
}

export async function addReportSection(
  c: DataClient,
  i: {
    workspaceId: string
    reportId: string
    title: string
    description?: string | null
    sectionType?: SectionType
    sourceType?: SourceType
  },
): Promise<ReportSectionWire> {
  return c.rpc('add_report_section', {
    p_workspace_id: i.workspaceId,
    p_report_id: i.reportId,
    p_title: i.title,
    p_description: i.description ?? null,
    p_section_type: i.sectionType ?? 'text',
    p_source_type: i.sourceType ?? 'free_text',
  })
}

export async function updateReportSection(
  c: DataClient,
  i: {
    workspaceId: string
    sectionId: string
    title?: string | null
    description?: string | null
    sectionType?: SectionType | null
    position?: number | null
  },
): Promise<ReportSectionWire> {
  return c.rpc('update_report_section', {
    p_workspace_id: i.workspaceId,
    p_section_id: i.sectionId,
    p_title: i.title ?? null,
    p_description: i.description ?? null,
    p_section_type: i.sectionType ?? null,
    p_position: i.position ?? null,
  })
}

export async function reorderReportSections(
  c: DataClient,
  i: {
    workspaceId: string
    reportId: string
    sectionIds: string[]
  },
): Promise<void> {
  await c.rpc('reorder_report_sections', {
    p_workspace_id: i.workspaceId,
    p_report_id: i.reportId,
    p_section_ids: i.sectionIds,
  })
}

export async function bindReportSectionSource(
  c: DataClient,
  i: {
    workspaceId: string
    sectionId: string
    sourceRevisionId: string
    sourceRef?: JsonObject
  },
): Promise<ReportSectionWire> {
  return c.rpc('bind_report_section_source', {
    p_workspace_id: i.workspaceId,
    p_section_id: i.sectionId,
    p_source_revision_id: i.sourceRevisionId,
    p_source_ref: i.sourceRef ?? {},
  })
}

export async function validateReport(
  c: DataClient,
  i: { workspaceId: string; reportId: string },
): Promise<ValidationSummaryWire> {
  return c.rpc('validate_report', {
    p_workspace_id: i.workspaceId,
    p_report_id: i.reportId,
  })
}

export async function generateReport(
  c: DataClient,
  i: {
    workspaceId: string
    reportId: string
    outputFormat?: OutputFormat
  },
): Promise<ReportGenerationWire> {
  return c.rpc('generate_report', {
    p_workspace_id: i.workspaceId,
    p_report_id: i.reportId,
    p_output_format: i.outputFormat ?? 'html',
  })
}

// ---------------------------------------------------------------------------
// Deterministic preview / checksum helpers (client-side mirror of generate_report)
// ---------------------------------------------------------------------------

/**
 * Build the deterministic generation inputs envelope. The shape is identical
 * to the server-side `generate_report` envelope so a client preview checksum
 * matches a server generation checksum for the same frozen evidence.
 */
export function buildGenerationInputs(
  report: Pick<
    ReportDefinition,
    'id' | 'version' | 'documentIdentifier' | 'title' | 'subtitle'
  >,
  sections: ReportSection[],
  outputFormat: OutputFormat,
): JsonObject {
  return {
    reportId: report.id,
    reportVersion: report.version,
    documentIdentifier: report.documentIdentifier,
    title: report.title,
    subtitle: report.subtitle ?? null,
    outputFormat,
    sections: sections
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s, index) => ({
        position: index,
        sectionId: s.id,
        title: s.title,
        sectionType: s.sectionType,
        sourceType: s.sourceType,
        sourceRevisionId: s.sourceRevisionId,
        sourceRef: s.sourceRef,
        frozenPayload: s.frozenPayload,
      })),
  }
}

/**
 * Stable JSON serialisation: keys sorted, no incidental whitespace, so the
 * checksum is reproducible across runs and runtimes.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key])
        return acc
      }, {})
  }
  return value
}

/**
 * SHA-256 checksum of the deterministic generation inputs. Uses the Web
 * Crypto subtle digest when available; falls back to a synchronous
 * hex-encoding of the stable string for environments without SubtleCrypto
 * (tests). The server remains the authority; this mirrors it for preview.
 */
export async function computeChecksum(inputs: JsonObject): Promise<string> {
  const data = stableStringify(inputs)
  try {
    const bytes = new TextEncoder().encode(data)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    // SubtleCrypto unavailable (e.g. some test runtimes) — use the
    // deterministic non-cryptographic stand-in. The server checksum is
    // always authoritative; this only mirrors it for preview parity.
    return fakeSha256(data)
  }
}

/**
 * Deterministic, non-cryptographic stand-in used only when SubtleCrypto is
 * unavailable (e.g. jsdom unit tests). It is stable for identical input
 * strings, which is all the preview parity check requires in those
 * environments. The server checksum is always authoritative.
 */
export function fakeSha256(data: string): string {
  // FNV-1a 64-bit-ish folded into 64 hex chars. Deterministic and collision
  // resistant enough for preview parity in tests.
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < data.length; i++) {
    h1 ^= data.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= data.charCodeAt(i) + i
    h2 = Math.imul(h2, 0x1000193)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  // Repeat the 16-hex digest four times to fill 64 chars deterministically.
  const block = hex(h1) + hex(h2)
  return (block + block + block + block).slice(0, 64)
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render an accessible, PDF-ready HTML document from frozen evidence only.
 * The output is deterministic for identical inputs (no timestamps, sorted
 * sections). Section content is rendered from `frozenPayload`, never from
 * live data.
 */
export function renderReportHtml(
  report: Pick<
    ReportDefinition,
    'title' | 'subtitle' | 'documentIdentifier' | 'version'
  >,
  sections: ReportSection[],
): string {
  const ordered = sections.slice().sort((a, b) => a.position - b.position)
  const body = ordered
    .map((s, index) => {
      const heading = `${index + 1}. ${escapeHtml(s.title)}`
      const desc = s.description ? `<p>${escapeHtml(s.description)}</p>\n` : ''
      const sourceLine = `Source: ${escapeHtml(s.sourceType)}${
        s.sourceRevisionId
          ? ` · revision ${escapeHtml(s.sourceRevisionId.slice(0, 8))}`
          : ''
      } · status ${escapeHtml(s.validationStatus)}`
      const frozen =
        Object.keys(s.frozenPayload).length > 0
          ? `<pre>${escapeHtml(stableStringify(s.frozenPayload))}</pre>\n`
          : ''
      return `      <section>\n        <h2>${heading}</h2>\n        ${desc}        <p class="meta">${sourceLine}</p>\n        ${frozen}      </section>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(report.title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#111;line-height:1.5}
h1{font-size:1.6rem;margin:0 0 .25rem}
.subtitle{color:#555;font-style:italic;margin:0 0 .5rem}
.meta{font-size:.8rem;color:#666}
section{margin:1.5rem 0;padding-bottom:1rem;border-bottom:1px solid #eee}
section h2{font-size:1.15rem;margin:0 0 .5rem}
pre{background:#f6f6f6;padding:.75rem;border-radius:4px;overflow:auto;font-size:.8rem}
@media print{body{max-width:none;margin:0}}
</style>
</head>
<body>
<h1>${escapeHtml(report.title)}</h1>
${report.subtitle ? `<p class="subtitle">${escapeHtml(report.subtitle)}</p>` : ''}
<p class="meta">${escapeHtml(report.documentIdentifier)} · v${report.version}</p>
${body}
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Labels / tokens for the UI
// ---------------------------------------------------------------------------

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
}

export const REPORT_STATUS_TOKENS: Record<ReportStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  in_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  published: 'bg-blue-100 text-blue-700',
  archived: 'bg-zinc-100 text-zinc-600',
}

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  text: 'Text',
  table: 'Table',
  chart: 'Chart',
  file: 'File',
  record_metadata: 'Record metadata',
  composite: 'Composite',
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  free_text: 'Free text',
  revision_block: 'Revision block',
  chart_block: 'Chart block',
  table_block: 'Table block',
  file_object: 'File object',
  record_metadata: 'Record metadata',
}

export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  pending: 'Pending',
  valid: 'Valid',
  missing_source: 'Missing source',
  stale: 'Stale live ref',
  locked: 'Locked revision',
}

export const VALIDATION_STATUS_TOKENS: Record<ValidationStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  valid: 'bg-emerald-100 text-emerald-700',
  missing_source: 'bg-red-100 text-red-700',
  stale: 'bg-amber-100 text-amber-700',
  locked: 'bg-blue-100 text-blue-700',
}

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  html: 'HTML',
  pdf: 'PDF',
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export function describeReportBuilderError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the report builder operation. Try again.'
  const messages: Record<string, string> = {
    SB033: 'The selected report belongs to a different workspace.',
    SB044: 'The title is missing or too long.',
    SB045: 'That report status is not valid.',
    SB046: 'The report was not found.',
    SB047: 'The section type or source type is invalid.',
    SB048: 'The section was not found.',
    SB049: 'The source revision was not found.',
    '42501': 'You do not have access to this report.',
  }
  return messages[error.code] ?? error.message
}
