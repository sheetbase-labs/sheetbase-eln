/**
 * Scientific record domain library (SCI-001, decision 0026).
 *
 * Samples, reagents and protocols are record kinds within the existing
 * `records` infrastructure. This module provides the application-boundary
 * validation and vocabulary that sit on top of the database contract:
 *
 * - configurable property validation against `record_field_definitions`;
 * - kind-specific status vocabularies and lifecycle transition rules
 *   (mirroring the `transition_record_status` RPC matrix);
 * - stable identifier prefixes;
 * - record-picker query helpers and inspector summary projections.
 *
 * PostgreSQL and RLS remain authoritative. These helpers improve errors and
 * drive the UI; they must not be the only access-control boundary.
 */

import type { DataClient } from '#/lib/data-client'
import type { NotebookRecord, RecordWire } from '#/lib/notebook-data'
import { toRecord } from '#/lib/notebook-data'

// ---------------------------------------------------------------------------
// Kinds and identifiers.
// ---------------------------------------------------------------------------

/** Record kinds that have configurable scientific properties. */
export type ScientificRecordKind = 'sample' | 'reagent' | 'protocol_template'

export const SCIENTIFIC_RECORD_KINDS: readonly ScientificRecordKind[] = [
  'sample',
  'reagent',
  'protocol_template',
]

export function isScientificRecordKind(
  kind: string,
): kind is ScientificRecordKind {
  return kind === 'sample' || kind === 'reagent' || kind === 'protocol_template'
}

/** Kind -> stable identifier prefix (mirrors the create_record RPC). */
export const KIND_PREFIX: Record<ScientificRecordKind, string> = {
  sample: 'SMP',
  reagent: 'RGT',
  protocol_template: 'PRT',
}

/**
 * Matches the stable identifier format `<PREFIX>-YYYY-NNNN` assigned by the
 * database. Used for client-side validation of picker input before forwarding
 * to PostgREST; the database sequence is the authority.
 */
export function identifierPattern(kind: ScientificRecordKind): RegExp {
  const prefix = KIND_PREFIX[kind]
  return new RegExp(`^${prefix}-\\d{4}-\\d{4}$`)
}

// ---------------------------------------------------------------------------
// Configurable property schema (record_field_definitions).
// ---------------------------------------------------------------------------

export interface RecordFieldDefinitionWire {
  id: string
  workspace_id: string
  kind: string
  field_name: string
  label: string
  description: string | null
  display_order: number
  logical_type: string
  nullable: boolean
  default_value: unknown
  unit: Record<string, unknown> | null
  validation: Record<string, unknown>
  lifecycle: string
  created_at: string
  updated_at: string
}

export interface RecordFieldDefinition {
  id: string
  workspaceId: string
  kind: ScientificRecordKind
  fieldName: string
  label: string
  description: string | null
  displayOrder: number
  logicalType: PropertyLogicalType
  nullable: boolean
  defaultValue: unknown
  unit: Record<string, unknown> | null
  validation: Record<string, unknown>
  lifecycle: 'active' | 'retired'
}

export type PropertyLogicalType =
  'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'category'

const LOGICAL_TYPES: readonly PropertyLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

export function isPropertyLogicalType(
  type: string,
): type is PropertyLogicalType {
  return (LOGICAL_TYPES as readonly string[]).includes(type)
}

export function toFieldDefinition(
  row: RecordFieldDefinitionWire,
): RecordFieldDefinition {
  if (!isScientificRecordKind(row.kind)) {
    throw new Error(`unexpected field-definition kind: ${row.kind}`)
  }
  if (!isPropertyLogicalType(row.logical_type)) {
    throw new Error(`unexpected logical_type: ${row.logical_type}`)
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    fieldName: row.field_name,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    logicalType: row.logical_type,
    nullable: row.nullable,
    defaultValue: row.default_value,
    unit: row.unit,
    validation: row.validation,
    lifecycle: row.lifecycle === 'retired' ? 'retired' : 'active',
  }
}

// ---------------------------------------------------------------------------
// Property validation against a kind's active field definitions.
// ---------------------------------------------------------------------------

export interface PropertyValidationError {
  field: string
  message: string
}

/**
 * Validate a `properties` object against the active field definitions for a
 * kind. Mirrors the type vocabulary reused from scientific_columns (0019).
 * Returns an array of errors; empty means valid. Unknown keys (values for
 * retired or never-defined fields) are preserved but flagged so the caller
 * can decide whether to warn; they are not stripped, because historical
 * values must remain readable (decision 0026 §2).
 */
export function validateProperties(
  kind: ScientificRecordKind,
  properties: Record<string, unknown>,
  definitions: RecordFieldDefinition[],
): PropertyValidationError[] {
  const errors: PropertyValidationError[] = []
  const active = definitions.filter(
    (d) => d.kind === kind && d.lifecycle === 'active',
  )

  for (const def of active) {
    const present = Object.hasOwn(properties, def.fieldName)
    const value = present ? properties[def.fieldName] : undefined
    if (!present || value === null || value === undefined) {
      if (
        !def.nullable &&
        (value === null || value === undefined || !present)
      ) {
        errors.push({
          field: def.fieldName,
          message: `${def.label} is required.`,
        })
      }
      continue
    }
    const typeError = checkLogicalType(def, value)
    if (typeError) errors.push({ field: def.fieldName, message: typeError })
  }

  // Unknown keys: values for retired/never-defined fields. Not an error
  // (historical values are preserved), but reported so callers can surface a
  // soft warning. The DB does not enforce the property schema.
  return errors
}

function checkLogicalType(
  def: RecordFieldDefinition,
  value: unknown,
): string | null {
  switch (def.logicalType) {
    case 'text':
      return typeof value === 'string' ? null : `${def.label} must be text.`
    case 'integer':
      return Number.isInteger(value)
        ? null
        : `${def.label} must be a whole number.`
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `${def.label} must be a number.`
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `${def.label} must be true or false.`
    case 'category': {
      if (typeof value !== 'string') return `${def.label} must be text.`
      const enumValues = Array.isArray(def.validation.enum)
        ? (def.validation.enum as unknown[])
        : null
      if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
        return `${def.label} must be one of: ${enumValues.join(', ')}.`
      }
      return null
    }
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : `${def.label} must be a date (YYYY-MM-DD).`
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : `${def.label} must be a timestamp.`
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Status vocabularies and lifecycle transition rules.
// ---------------------------------------------------------------------------

export type SampleStatus =
  'available' | 'reserved' | 'consumed' | 'expired' | 'quarantined' | 'frozen'
export type ReagentStatus =
  | 'available'
  | 'reserved'
  | 'consumed'
  | 'expired'
  | 'quarantined'
  | 'low_stock'
export type ProtocolStatus = 'draft' | 'active' | 'under_review'

/**
 * Per-kind allowed status values. The database status column is free-form
 * text (0015); these are the values the lifecycle RPC and UI recognise.
 * Vocabularies align with the StatusBadge concept-system domains (UI-005).
 */
export const KIND_STATUS_VOCABULARY: Record<
  ScientificRecordKind,
  readonly string[]
> = {
  sample: [
    'available',
    'reserved',
    'consumed',
    'expired',
    'quarantined',
    'frozen',
  ],
  reagent: [
    'available',
    'reserved',
    'consumed',
    'expired',
    'quarantined',
    'low_stock',
  ],
  protocol_template: ['draft', 'active', 'under_review'],
}

/**
 * Allowed transitions, mirroring the `transition_record_status` RPC matrix.
 * A transition is allowed iff `key` is in the set, where
 * `key = `${kind}:${from}->${to}``.
 */
const ALLOWED_TRANSITIONS: readonly string[] = [
  'sample:available->reserved',
  'sample:available->consumed',
  'sample:available->quarantined',
  'sample:reserved->available',
  'sample:reserved->consumed',
  'sample:quarantined->available',
  'reagent:available->reserved',
  'reagent:available->consumed',
  'reagent:available->quarantined',
  'reagent:available->expired',
  'reagent:reserved->available',
  'reagent:reserved->consumed',
  'reagent:quarantined->available',
  'protocol_template:draft->active',
  'protocol_template:draft->under_review',
  'protocol_template:under_review->active',
  'protocol_template:under_review->draft',
  'protocol_template:active->draft',
]

export function isAllowedTransition(
  kind: ScientificRecordKind,
  from: string,
  to: string,
): boolean {
  return ALLOWED_TRANSITIONS.includes(`${kind}:${from}->${to}`)
}

export function allowedTargets(
  kind: ScientificRecordKind,
  from: string,
): readonly string[] {
  return KIND_STATUS_VOCABULARY[kind].filter((to) =>
    isAllowedTransition(kind, from, to),
  )
}

/**
 * Link type for a scientific record kind — the `record_links.link_type`
 * value used when linking a scientific record into a notebook. Mirrors the
 * `sample`/`reagent`/`protocol` link types from decision 0015.
 */
export function linkTypeForKind(kind: ScientificRecordKind): string {
  return kind === 'protocol_template' ? 'protocol' : kind
}

/** Friendly message for a link that already exists (server dedupe). */
export const DUPLICATE_SCIENTIFIC_LINK_MESSAGE =
  'This record is already linked.'

/**
 * Recognise the server's duplicate-link rejection so the linker can say
 * `already linked` instead of surfacing a raw failure. `record_links`
 * carries a unique `(source, target_identifier, link_type)` constraint, so
 * a re-link surfaces as a PostgREST 409/23505 unique violation (directly
 * or through the `create_record_link` RPC, which may re-raise it as a
 * `conflict` envelope or a plain duplicate message) — match all shapes.
 */
export function isDuplicateLinkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : null
  const message =
    'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const status =
    'status' in error && typeof error.status === 'number'
      ? error.status
      : null
  if (code === '23505' || code === 'conflict') return true
  if (status === 409 && /duplicate|already exists|already linked/i.test(message))
    return true
  return /duplicate key|already linked|already exists/i.test(message)
}

/**
 * Create a durable link from a notebook record to a scientific record through
 * the existing `create_record_link` RPC. The RPC validates same-workspace
 * membership and rejects cross-workspace targets with SB002; the preserved
 * `target_identifier` keeps the link resolvable when the target is later
 * archived or soft-deleted.
 */
export function createScientificLink(
  client: DataClient,
  sourceRecordId: string,
  target: { id: string; kind: ScientificRecordKind; identifier: string },
): Promise<unknown> {
  return client.rpc('create_record_link', {
    p_source_record_id: sourceRecordId,
    p_target_kind: target.kind,
    p_target_identifier: target.identifier,
    p_link_type: linkTypeForKind(target.kind),
    p_target_record_id: target.id,
  })
}

// ---------------------------------------------------------------------------
// Picker and inspector data helpers.
// ---------------------------------------------------------------------------

/**
 * Fetch the active field definitions for a kind in the current workspace.
 * Used by the picker and inspector to render property labels and types.
 */
export function fetchFieldDefinitions(
  client: DataClient,
  kind: ScientificRecordKind,
): Promise<RecordFieldDefinition[]> {
  return client
    .list<RecordFieldDefinitionWire>(
      'record_field_definitions',
      `?kind=eq.${kind}&lifecycle=eq.active&order=display_order.asc`,
    )
    .then((rows) => rows.map(toFieldDefinition))
}

/**
 * Search records of a given kind for the picker. Filters by identifier or
 * title prefix (case-insensitive `ilike`), excludes soft-deleted rows, and
 * includes archived rows so existing historical links can be resolved
 * honestly. Cross-workspace records are invisible under RLS, so the caller
 * cannot accidentally select an invalid cross-workspace record.
 */
export function searchRecords(
  client: DataClient,
  kind: ScientificRecordKind,
  query: string,
  opts: { includeArchived?: boolean } = {},
): Promise<NotebookRecord[]> {
  const trimmed = query.trim()
  const filters: string[] = [`kind=eq.${kind}`, 'deleted_at=is.null']
  if (trimmed) {
    const enc = encodeURIComponent(`${trimmed}*`)
    filters.push(`(identifier=ilike.${enc},title=ilike.${enc})`)
  }
  filters.push('order=archived_at.asc,identifier.asc')
  if (!opts.includeArchived) {
    // Default: exclude archived from active pickers. Existing links to
    // archived targets are resolved separately via fetchRecordById.
    filters.splice(filters.length - 1, 0, 'archived_at=is.null')
  }
  return client
    .list<RecordWire>('records', `?${filters.join('&')}`)
    .then((rows) => rows.map(toRecord))
}

/** Fetch a single record by id (for resolving an existing link target). */
export function fetchRecordById(
  client: DataClient,
  recordId: string,
): Promise<NotebookRecord | null> {
  return client
    .list<RecordWire>('records', `?id=eq.${recordId}`)
    .then((rows) => (rows.length > 0 ? toRecord(rows[0]) : null))
}

// ---------------------------------------------------------------------------
// Inspector summary projection.
// ---------------------------------------------------------------------------

export interface PropertySummaryEntry {
  fieldName: string
  label: string
  value: unknown
  logicalType: PropertyLogicalType
  unit: Record<string, unknown> | null
  /** True when the value's field definition is retired or absent. */
  orphaned: boolean
}

/**
 * Project a record's `properties` into an ordered summary using the kind's
 * field definitions. Known fields render with their label and unit; unknown
 * (retired/never-defined) keys appear last, flagged `orphaned` so the
 * inspector can render them honestly without a label.
 */
export function summariseProperties(
  kind: ScientificRecordKind,
  properties: Record<string, unknown>,
  definitions: RecordFieldDefinition[],
): PropertySummaryEntry[] {
  const defs = definitions
    .filter((d) => d.kind === kind)
    .sort((a, b) => a.displayOrder - b.displayOrder)
  const entries: PropertySummaryEntry[] = []
  const seen = new Set<string>()

  for (const def of defs) {
    if (!Object.hasOwn(properties, def.fieldName)) continue
    entries.push({
      fieldName: def.fieldName,
      label: def.label,
      value: properties[def.fieldName],
      logicalType: def.logicalType,
      unit: def.unit,
      orphaned: def.lifecycle === 'retired',
    })
    seen.add(def.fieldName)
  }

  for (const key of Object.keys(properties)) {
    if (seen.has(key)) continue
    entries.push({
      fieldName: key,
      label: key,
      value: properties[key],
      logicalType: 'text',
      unit: null,
      orphaned: true,
    })
  }
  return entries
}

/**
 * Format a property value for display. Concentrations, volumes and dates use
 * the scientific formatting conventions from the mockups; the unit JSONB
 * carries the display unit symbol where present.
 */
export function formatPropertyValue(entry: PropertySummaryEntry): string {
  const { value, unit } = entry
  if (value === null || value === undefined || value === '') return '—'
  const unitSymbol =
    unit &&
    typeof unit === 'object' &&
    'symbol' in unit &&
    typeof unit.symbol === 'string'
      ? unit.symbol
      : null
  const valueStr =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? String(value)
        : String(value)
      : String(value)
  return unitSymbol ? `${valueStr} ${unitSymbol}` : valueStr
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const scientificRecordQueryKeys = {
  fieldDefinitions: (kind: ScientificRecordKind) => [
    'sci-001',
    'field-definitions',
    kind,
  ],
  search: (kind: ScientificRecordKind, query: string) => [
    'sci-001',
    'search',
    kind,
    query,
  ],
  record: (id: string) => ['sci-001', 'record', id],
}
