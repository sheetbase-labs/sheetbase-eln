/**
 * Typed interfaces for Sheetbase resources.
 *
 * These mirror the row schemas in docs/api/openapi/external-api-v0.json.
 * Factory functions (`fromXxx`) handle snake_case JSON → TypeScript mapping.
 * Optional/nullable fields are marked with `?`.
 */
import { StaleVersionError, ValidationError } from "./errors.js";

// ── helpers ────────────────────────────────────────────────────────────────

function parseUUID(v: string | null | undefined): string | null {
  return v ?? null;
}

function parseDate(v: string | null | undefined): string | null {
  return v ?? null;
}

// ── Project ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  workspaceId: string;
  key: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  customFields: Record<string, unknown>;
}

export function fromProject(d: Record<string, any>): Project {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    key: d.key,
    title: d.title,
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    archivedAt: parseDate(d.archived_at),
    customFields: d.custom_fields ?? {},
  };
}

// ── Record ─────────────────────────────────────────────────────────────────

export interface SheetbaseRecord {
  id: string;
  workspaceId: string;
  kind: string;
  identifier: string;
  title: string;
  status: string;
  tags: string[];
  structureVersion: number;
  metadataVersion: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  calculationInputRevision: number;
  properties: Record<string, unknown>;
  customFields: Record<string, unknown>;
  projectId?: string | null;
  folderId?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  updatedByUserId?: string | null;
  updatedByCredentialId?: string | null;
  lockedAt?: string | null;
  lockedByRevisionId?: string | null;
  sourceNotebookTemplateVersionId?: string | null;
}

export function fromRecord(d: Record<string, any>): SheetbaseRecord {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    kind: d.kind,
    identifier: d.identifier,
    title: d.title,
    status: d.status,
    tags: d.tags ?? [],
    structureVersion: d.structure_version,
    metadataVersion: d.metadata_version,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    createdByUserId: d.created_by_user_id,
    calculationInputRevision: d.calculation_input_revision,
    properties: d.properties ?? {},
    customFields: d.custom_fields ?? {},
    projectId: parseUUID(d.project_id),
    folderId: parseUUID(d.folder_id),
    archivedAt: parseDate(d.archived_at),
    deletedAt: parseDate(d.deleted_at),
    updatedByUserId: d.updated_by_user_id ?? null,
    updatedByCredentialId: parseUUID(d.updated_by_credential_id),
    lockedAt: parseDate(d.locked_at),
    lockedByRevisionId: parseUUID(d.locked_by_revision_id),
    sourceNotebookTemplateVersionId: parseUUID(d.source_notebook_template_version_id),
  };
}

// ── Dataset ────────────────────────────────────────────────────────────────

export interface Dataset {
  id: string;
  workspaceId: string;
  schemaVersionId: string;
  name: string;
  lifecycle: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  primaryProjectId?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  createdByCredentialId?: string | null;
}

export function fromDataset(d: Record<string, any>): Dataset {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    schemaVersionId: d.schema_version_id,
    name: d.name,
    lifecycle: d.lifecycle,
    revision: d.revision,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    primaryProjectId: parseUUID(d.primary_project_id),
    description: d.description ?? null,
    createdByUserId: d.created_by_user_id ?? null,
    createdByCredentialId: parseUUID(d.created_by_credential_id),
  };
}

// ── DatasetVersion ─────────────────────────────────────────────────────────

export interface DatasetVersion {
  id: string;
  workspaceId: string;
  datasetId: string;
  schemaVersionId: string;
  label: string;
  sourceDatasetRevision: number;
  createdAt: string;
  createdByUserId?: string | null;
  createdByCredentialId?: string | null;
}

export function fromDatasetVersion(d: Record<string, any>): DatasetVersion {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    datasetId: d.dataset_id,
    schemaVersionId: d.schema_version_id,
    label: d.label,
    sourceDatasetRevision: d.source_dataset_revision,
    createdAt: d.created_at,
    createdByUserId: d.created_by_user_id ?? null,
    createdByCredentialId: parseUUID(d.created_by_credential_id),
  };
}

// ── DatasetRow ─────────────────────────────────────────────────────────────

export interface SchemaField {
  id: string;
  schemaVersionId: string;
  fieldId: string;
  key: string;
  label: string;
  logicalType: string;
  nullable: boolean;
  cardinality: string;
  lifecycle: string;
  displayOrder: number;
  description?: string | null;
  defaultValue?: unknown;
  validation?: unknown;
  category?: unknown;
  relationship?: unknown;
}

export function fromSchemaField(d: Record<string, any>): SchemaField {
  return {
    id: d.id,
    schemaVersionId: d.schema_version_id,
    fieldId: d.field_id,
    key: d.key,
    label: d.label,
    logicalType: d.logical_type,
    nullable: d.nullable,
    cardinality: d.cardinality,
    lifecycle: d.lifecycle,
    displayOrder: d.display_order,
    description: d.description ?? null,
    defaultValue: d.default_value,
    validation: d.validation,
    category: d.category,
    relationship: d.relationship,
  };
}

// ── RecordRevision ─────────────────────────────────────────────────────────

export interface RecordRevision {
  id: string;
  recordId: string;
  workspaceId: string;
  structureVersion: number;
  metadataVersion: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  metadataSnapshot: Record<string, unknown>;
  blockSnapshot?: Record<string, unknown> | null;
  canonicalSnapshot?: Record<string, unknown> | null;
  integrityAlgorithm?: string | null;
  integrityDigest?: string | null;
  supersededByRevisionId?: string | null;
}

export function fromRecordRevision(d: Record<string, any>): RecordRevision {
  return {
    id: d.id,
    recordId: d.record_id,
    workspaceId: d.workspace_id,
    structureVersion: d.structure_version,
    metadataVersion: d.metadata_version,
    reason: d.reason,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    createdByUserId: d.created_by_user_id,
    metadataSnapshot: d.metadata_snapshot ?? {},
    blockSnapshot: d.block_snapshot ?? null,
    canonicalSnapshot: d.canonical_snapshot ?? null,
    integrityAlgorithm: d.integrity_algorithm ?? null,
    integrityDigest: d.integrity_digest ?? null,
    supersededByRevisionId: parseUUID(d.superseded_by_revision_id),
  };
}

// ── RecordModel ────────────────────────────────────────────────────────────

/**
 * A workspace-defined record model identity (ADR-0051). Built-in kinds stay
 * in the migration-owned model catalogue; these rows are workspace-owned and
 * GET-only for external credentials.
 */
export interface RecordModel {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  identifierPrefix: string;
  lifecycle: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
}

export function fromRecordModel(d: Record<string, any>): RecordModel {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    key: d.key,
    name: d.name,
    identifierPrefix: d.identifier_prefix,
    lifecycle: d.lifecycle,
    currentVersion: d.current_version,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    description: d.description ?? null,
    createdByUserId: d.created_by_user_id ?? null,
    updatedByUserId: d.updated_by_user_id ?? null,
  };
}

// ── DatasetRow ─────────────────────────────────────────────────────────────

export interface DatasetRow {
  rowId: string;
  revision: number;
  values: Record<string, unknown>;
}

export function fromDatasetRow(d: Record<string, any>): DatasetRow {
  return {
    rowId: d.rowId,
    revision: d.revision,
    values: d.values ?? {},
  };
}

// ── SheetInstance ──────────────────────────────────────────────────────────

export interface SheetInstance {
  id: string;
  workspaceId: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  notebookRecordId?: string | null;
  sheetDefinitionVersionId?: string | null;
}

export function fromSheetInstance(d: Record<string, any>): SheetInstance {
  return {
    id: d.id,
    workspaceId: d.workspace_id,
    name: d.name,
    revision: d.revision,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    notebookRecordId: parseUUID(d.notebook_record_id),
    sheetDefinitionVersionId: parseUUID(d.sheet_definition_version_id),
  };
}

// ── SearchResult ───────────────────────────────────────────────────────────

export interface SearchResult {
  resultType: string;
  recordId: string;
  kind: string;
  identifier: string;
  title: string;
  totalCount: number;
  status?: string | null;
  projectId?: string | null;
  archived?: boolean | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  matchedContext?: string | null;
  matchedField?: string | null;
  rank?: number | null;
  deepLink?: string | null;
}

export function fromSearchResult(d: Record<string, any>): SearchResult {
  return {
    resultType: d.result_type,
    recordId: d.record_id,
    kind: d.kind,
    identifier: d.identifier,
    title: d.title,
    totalCount: d.total_count,
    status: d.status ?? null,
    projectId: parseUUID(d.project_id),
    archived: d.archived ?? null,
    createdByUserId: d.created_by_user_id ?? null,
    createdAt: parseDate(d.created_at),
    updatedAt: parseDate(d.updated_at),
    matchedContext: d.matched_context ?? null,
    matchedField: d.matched_field ?? null,
    rank: d.rank ?? null,
    deepLink: d.deep_link ?? null,
  };
}

// ── CommitResult ───────────────────────────────────────────────────────────

export interface CommitResultRow {
  rowId: string;
  revision: number;
  operation: string;
}

export interface CommitResult {
  ok: boolean;
  datasetId: string;
  datasetRevision: number;
  rows: CommitResultRow[];
  idempotent: boolean;
}

export function fromCommitResult(d: Record<string, any>): CommitResult {
  // The canonical batch RPC returns validation refusals with HTTP 200.
  // Only a stale dataset revision can be repaired by rereading the dataset.
  if (d.ok === false) {
    const errors: unknown[] = Array.isArray(d.errors) ? d.errors : [];
    if (errors.some((error) => typeof error === "object" && error !== null && "code" in error && error.code === "stale_dataset_revision")) {
      throw new StaleVersionError("stale_version", JSON.stringify(errors));
    }
    throw new ValidationError("validation_error", JSON.stringify(errors));
  }
  return {
    ok: d.ok,
    datasetId: d.datasetId,
    datasetRevision: d.datasetRevision,
    rows: d.rows ?? [],
    idempotent: d.idempotent,
  };
}

// ── ValidationResult ───────────────────────────────────────────────────────

export interface ValidationFailure {
  rowIndex?: number | null;
  rowId?: string | null;
  fieldId?: string | null;
  code?: string | null;
  expectedRevision?: number | null;
  actualRevision?: number | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationFailure[];
}

export function fromValidationResult(d: Record<string, any>): ValidationResult {
  return {
    ok: d.ok ?? false,
    errors: (d.errors ?? []).map((e: Record<string, any>) => ({
      rowIndex: e.rowIndex ?? null,
      rowId: e.rowId ?? null,
      fieldId: e.fieldId ?? null,
      code: e.code ?? null,
      expectedRevision: e.expectedRevision ?? null,
      actualRevision: e.actualRevision ?? null,
    })),
  };
}

// ── Query result pages ─────────────────────────────────────────────────────

export interface DatasetRowPage {
  datasetId: string;
  datasetRevision: number;
  offset: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
  rows: DatasetRow[];
}

export function fromDatasetRowPage(d: Record<string, any>): DatasetRowPage {
  return {
    datasetId: d.datasetId,
    datasetRevision: d.datasetRevision,
    offset: d.offset,
    limit: d.limit,
    totalCount: d.totalCount,
    hasMore: d.hasMore,
    rows: (d.rows ?? []).map(fromDatasetRow),
  };
}

export interface DatasetVersionRowPage {
  datasetVersionId: string;
  datasetId: string;
  schemaVersionId: string;
  sourceDatasetRevision: number;
  offset: number;
  limit: number;
  totalCount: number;
  rows: DatasetRow[];
}

export function fromDatasetVersionRowPage(d: Record<string, any>): DatasetVersionRowPage {
  return {
    datasetVersionId: d.datasetVersionId,
    datasetId: d.datasetId,
    schemaVersionId: d.schemaVersionId,
    sourceDatasetRevision: d.sourceDatasetRevision,
    offset: d.offset,
    limit: d.limit,
    totalCount: d.totalCount,
    rows: (d.rows ?? []).map(fromDatasetRow),
  };
}

export interface SearchPage {
  results: SearchResult[];
  totalCount: number;
}

export function fromSearchPage(results: Record<string, any>[]): SearchPage {
  const total = results.length > 0 ? results[0].total_count : 0;
  return {
    results: results.map(fromSearchResult),
    totalCount: total,
  };
}
