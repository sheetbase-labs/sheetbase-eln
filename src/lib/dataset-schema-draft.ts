/**
 * R5-CONFIG-03 — the Model editor's draft algebra (pure).
 *
 * The editor keeps a draft Dataset Schema Version as an ordered list of fields.
 * Order is positional: the persisted `display_order` is derived from the list
 * at save time, independently of semantic category metadata. Changes
 * against the published version, validation, and the three-way reconciliation
 * after a refused stale save live here so they can be tested without React.
 *
 * The conflict helpers mirror the server contract: the server refuses a save
 * whose `p_expected_revision` is stale (SB001), so the client must never
 * resolve a conflict by guessing. `detectDraftConflict` classifies it and
 * `mergeDraftRows` is the only automatic resolution, and it is only used when
 * the two sides changed different fields.
 */
import { DataClientError } from './data-client'
import { z } from 'zod'
import { FIELD_LOGICAL_TYPES } from './field-definition'
import type {
  CanonicalDatasetSchemaField,
  DatasetSchemaFieldInput,
} from './dataset-schema-definition-rpc'

/** The canonical logical-type vocabulary; the DB check uses the same list. */
export const DATASET_FIELD_TYPES = FIELD_LOGICAL_TYPES

export interface DraftField extends DatasetSchemaFieldInput {
  /** Stable React key and conflict identity; the persisted field id when known. */
  rowKey: string
}

export function toDraftField(field: CanonicalDatasetSchemaField): DraftField {
  return {
    rowKey: field.field_id,
    fieldId: field.field_id,
    key: field.key,
    label: field.label,
    description: field.description,
    logicalType: field.logical_type,
    nullable: field.nullable,
    defaultValue: field.default_value ?? null,
    relationship: field.relationship ?? null,
    quantity: field.quantity ?? null,
    validation: field.validation ?? {},
    category: field.category ?? null,
    cardinality: field.cardinality === 'many' ? 'many' : 'one',
    lifecycle: field.lifecycle === 'retired' ? 'retired' : 'active',
    displayOrder: field.display_order,
  }
}

export function newDraftField(displayOrder: number): DraftField {
  return {
    rowKey: `new-${crypto.randomUUID()}`,
    key: '',
    label: 'New field',
    logicalType: 'text',
    nullable: true,
    displayOrder,
  }
}

/** Swap a field with its adjacent row, without changing any field metadata. */
export function moveField(
  rows: readonly DraftField[],
  rowKey: string,
  delta: -1 | 1,
): DraftField[] {
  const from = rows.findIndex((row) => row.rowKey === rowKey)
  const to = from + delta
  if (from < 0 || to < 0 || to >= rows.length) return [...rows]
  const next = [...rows]
  next[from] = rows[to]
  next[to] = rows[from]
  return next
}

/**
 * Normalise the list for the wire: `display_order` follows list position, so
 * reading the version back in `display_order` order returns the same list.
 */
export function orderedForSave(
  rows: readonly DraftField[],
): DatasetSchemaFieldInput[] {
  return rows.map((row, index) => ({
    fieldId: row.fieldId,
    key: row.key.trim(),
    label: row.label.trim(),
    description: row.description ?? null,
    logicalType: row.logicalType,
    nullable: row.nullable ?? true,
    defaultValue: row.defaultValue ?? null,
    quantity: row.quantity ?? null,
    validation: row.validation ?? {},
    category: row.category ?? null,
    relationship: row.relationship ?? null,
    cardinality: row.cardinality ?? 'one',
    lifecycle: row.lifecycle ?? 'active',
    displayOrder: index + 1,
  }))
}

export interface ChangeSummary {
  total: number
  byKey: Map<string, 'Added' | 'Changed'>
  removed: CanonicalDatasetSchemaField[]
}

/** Diff the draft rows against the published fields by key. */
export function computeChanges(
  rows: readonly DatasetSchemaFieldInput[],
  published: readonly CanonicalDatasetSchemaField[],
): ChangeSummary {
  const byKey = new Map<string, 'Added' | 'Changed'>()
  const publishedByKey = new Map(published.map((f) => [f.key, f]))
  for (const row of rows) {
    const before = publishedByKey.get(row.key)
    if (!before) {
      byKey.set(row.key, 'Added')
    } else if (fieldContract(toDraftField(before)) !== fieldContract(row)) {
      byKey.set(row.key, 'Changed')
    }
  }
  const draftKeys = new Set(rows.map((r) => r.key))
  const removed = published.filter((f) => !draftKeys.has(f.key))
  return { total: byKey.size + removed.length, byKey, removed }
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/
const relationshipSchema = z.object({
  target: z.object({
    kind: z.literal('model'),
    modelKey: z.string().trim().min(1),
  }),
  cardinality: z.enum(['one', 'many']),
})

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The editor's own validation, mirroring the server's field checks
 * (`internal.replace_dataset_schema_version_fields` and the text/numeric
 * validation used when a value is written). The server stays authoritative;
 * this only stops a save that would be refused.
 */
export function validateDraft(
  rows: readonly DraftField[],
): Map<string, string> {
  const issues = new Map<string, string>()
  const firstByKey = new Map<string, string>()
  for (const row of rows) {
    const label = row.label.trim()
    const key = row.key.trim()
    if (!label) issues.set(row.rowKey, 'Name is required.')
    if (!key) {
      if (!issues.has(row.rowKey)) issues.set(row.rowKey, 'Key is required.')
    } else if (!KEY_PATTERN.test(key)) {
      issues.set(
        row.rowKey,
        'Use lower-case letters, numbers and _, starting with a letter.',
      )
    } else if (firstByKey.has(key)) {
      issues.set(
        row.rowKey,
        `Key ${key} is already used by ${firstByKey.get(key)}. Keys must be unique: records store values by key.`,
      )
    } else {
      firstByKey.set(key, label || key)
    }
    const validation = row.validation ?? {}
    const min = numberValue(validation.min)
    const max = numberValue(validation.max)
    if (min !== null && max !== null && min > max) {
      issues.set(row.rowKey, 'Minimum is more than maximum.')
    }
    const minLength = numberValue(validation.minLength)
    const maxLength = numberValue(validation.maxLength)
    if (minLength !== null && maxLength !== null && minLength > maxLength) {
      issues.set(row.rowKey, 'Minimum length is more than maximum length.')
    }
    const relationship = relationshipSchema.safeParse(row.relationship)
    if (row.logicalType === 'reference' && !relationship.success) {
      issues.set(
        row.rowKey,
        'A link field needs a target. Enter its target model key in Configuration.',
      )
    }
    if (
      row.logicalType === 'reference' &&
      relationship.success &&
      relationship.data.cardinality !== (row.cardinality ?? 'one')
    ) {
      issues.set(row.rowKey, 'Field and reference cardinality must agree.')
    }
    if (row.cardinality === 'many' && row.defaultValue != null) {
      issues.set(
        row.rowKey,
        'Many-valued fields cannot have a default. Clear the default first.',
      )
    }
  }
  return issues
}

/** Deterministic JSON so jsonb key reordering never reads as a change. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

/**
 * The contract signature of one field. `display_order` is deliberately absent:
 * ordering is positional, so a reorder is not a field change. Everything a
 * reader of the field would act on is present.
 */
export function fieldContract(field: DatasetSchemaFieldInput): string {
  return stableJson([
    field.key,
    field.label,
    field.description ?? null,
    field.logicalType,
    field.nullable ?? true,
    field.defaultValue ?? null,
    field.quantity ?? null,
    field.validation ?? {},
    field.category ?? null,
    field.cardinality ?? 'one',
    field.lifecycle ?? 'active',
    field.relationship ?? null,
  ])
}

export function fieldSnapshot(
  rows: readonly DraftField[],
): Map<string, string> {
  return new Map(rows.map((row) => [row.rowKey, fieldContract(row)]))
}

/** Keys whose contract differs between two snapshots, additions and removals included. */
export function changedKeys(
  base: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): Set<string> {
  const changed = new Set<string>()
  for (const [key, signature] of next) {
    if (base.get(key) !== signature) changed.add(key)
  }
  for (const key of base.keys()) {
    if (!next.has(key)) changed.add(key)
  }
  return changed
}

export interface DraftConflict {
  /** The server's rows at the moment the save was refused. */
  serverRows: DraftField[]
  /** The server's revision then; the new baseline once the conflict is resolved. */
  serverRevision: number
  /** Field keys changed on the server since this editor loaded the draft. */
  theirs: Set<string>
  /** Field keys changed by this editor since it loaded the draft. */
  mine: Set<string>
  /** True when the two sides changed the same field. */
  overlap: boolean
}

/**
 * Classify a refused stale save. `base` is the snapshot the editor's rows were
 * loaded from, `mine` the rows it tried to save, `serverRows` the server's
 * current fields.
 */
export function detectDraftConflict(input: {
  base: ReadonlyMap<string, string>
  mine: readonly DraftField[]
  serverRows: readonly DraftField[]
  serverRevision: number
}): DraftConflict {
  const theirs = changedKeys(input.base, fieldSnapshot(input.serverRows))
  const mine = changedKeys(input.base, fieldSnapshot(input.mine))
  const overlap = [...mine].some((key) => theirs.has(key))
  return {
    serverRows: [...input.serverRows],
    serverRevision: input.serverRevision,
    theirs,
    mine,
    overlap,
  }
}

/**
 * Keep both sides when they changed different fields: start from the server's
 * rows (so its ordering and its changes stand), re-apply this editor's field
 * changes, drop what this editor removed and append what it added. Only called
 * for a non-overlapping conflict; an overlapping one is resolved explicitly.
 */
export function mergeDraftRows(input: {
  base: ReadonlyMap<string, string>
  mine: readonly DraftField[]
  theirs: ReadonlySet<string>
  serverRows: readonly DraftField[]
}): DraftField[] {
  const mineChanged = changedKeys(input.base, fieldSnapshot(input.mine))
  const myByKey = new Map(input.mine.map((row) => [row.rowKey, row]))
  const myKeys = new Set(input.mine.map((row) => row.rowKey))
  const myRemoved = new Set(
    [...input.base.keys()].filter((key) => !myKeys.has(key)),
  )
  const merged = input.serverRows
    .filter((row) => !myRemoved.has(row.rowKey))
    .map((row) =>
      mineChanged.has(row.rowKey) ? (myByKey.get(row.rowKey) ?? row) : row,
    )
  const present = new Set(merged.map((row) => row.rowKey))
  for (const row of input.mine) {
    if (!input.base.has(row.rowKey) && !present.has(row.rowKey)) {
      merged.push(row)
    }
  }
  return merged
}

/** True when the refusal is the stale-revision conflict (SB001). */
export function isStaleRevision(error: unknown): boolean {
  if (error instanceof DataClientError) return error.code === 'SB001'
  const message = error instanceof Error ? error.message : String(error)
  return /stale dataset schema version revision/i.test(message)
}

/** True when the draft is locked because an approval request is open (SB085). */
export function isApprovalLock(error: unknown): boolean {
  if (error instanceof DataClientError) return error.code === 'SB085'
  const message = error instanceof Error ? error.message : String(error)
  return /locked while approval is pending/i.test(message)
}
