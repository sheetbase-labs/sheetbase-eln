/**
 * CORE-04.2 Record-reference cell contract.
 *
 * A Sheet Record-reference cell is the interaction/display type for a
 * structured Record relationship. The persisted value is always the Record
 * UUID. Human Record ID and Name are display/search only. The UUID is written
 * solely to the column's authoritative Sheet write-back target (Dataset
 * reference field, Instance-local field, or Model reference field). Notebook
 * `create_record_link` is a separate contextual link and is not created as a
 * side effect of this cell.
 */
import { z } from 'zod'

const uuid = z.string().uuid()

export const RECORD_REFERENCE_CELL_FORMAT = 'sb-record-ref-v1' as const

export type RecordReferenceWriteTargetKind = 'dataset' | 'local' | 'model'

export interface RecordReferenceWriteTarget {
  kind: RecordReferenceWriteTargetKind
}

export interface RecordReferenceSnapshot {
  recordId: string
  modelKey: string
  kind: string
  identifier: string
  title: string
  archived: boolean
  deleted: boolean
}

export type RecordReferenceCellState =
  | { kind: 'empty' }
  | { kind: 'present'; recordId: string; snapshot?: RecordReferenceSnapshot }
  | { kind: 'archived'; recordId: string; snapshot: RecordReferenceSnapshot }
  | { kind: 'missing'; recordId: string }
  | {
      kind: 'invalid-model'
      recordId: string
      snapshot: RecordReferenceSnapshot
    }

export interface RecordReferenceCellContract {
  format: typeof RECORD_REFERENCE_CELL_FORMAT
  targetModelKey: string
  nullable: boolean
  cardinality: 'one'
  readOnly: boolean
  writeTarget: RecordReferenceWriteTarget
}

export class RecordReferenceCellError extends Error {
  readonly code:
    | 'required'
    | 'not-uuid'
    | 'cardinality'
    | 'read-only'
    | 'invalid-model'
    | 'label-identity'

  constructor(code: RecordReferenceCellError['code'], message: string) {
    super(message)
    this.name = 'RecordReferenceCellError'
    this.code = code
  }
}

export function parsePersistedRecordReference(
  value: unknown,
  contract: Pick<RecordReferenceCellContract, 'nullable'>,
): string | null {
  if (value === null || value === undefined || value === '') {
    if (!contract.nullable) {
      throw new RecordReferenceCellError(
        'required',
        'Record reference is required.',
      )
    }
    return null
  }
  if (typeof value !== 'string') {
    throw new RecordReferenceCellError(
      'not-uuid',
      'Record reference must be a UUID string.',
    )
  }
  const parsed = uuid.safeParse(value)
  if (!parsed.success) {
    throw new RecordReferenceCellError(
      /^[A-Z]{2,4}-\d{4}-\d{4}$/.test(value) ? 'label-identity' : 'not-uuid',
      'Record reference identity is the Record UUID, not the Record ID or Name.',
    )
  }
  return parsed.data
}

export function resolveRecordReferenceState(input: {
  persistedId: string | null
  snapshot: RecordReferenceSnapshot | null
  targetModelKey: string
}): RecordReferenceCellState {
  if (input.persistedId === null) return { kind: 'empty' }
  if (!input.snapshot || input.snapshot.deleted) {
    return { kind: 'missing', recordId: input.persistedId }
  }
  if (input.snapshot.recordId !== input.persistedId) {
    return { kind: 'missing', recordId: input.persistedId }
  }
  if (input.snapshot.modelKey !== input.targetModelKey) {
    return {
      kind: 'invalid-model',
      recordId: input.persistedId,
      snapshot: input.snapshot,
    }
  }
  if (input.snapshot.archived) {
    return {
      kind: 'archived',
      recordId: input.persistedId,
      snapshot: input.snapshot,
    }
  }
  return {
    kind: 'present',
    recordId: input.persistedId,
    snapshot: input.snapshot,
  }
}

export function formatRecordReferenceLabel(
  snapshot: Pick<RecordReferenceSnapshot, 'identifier' | 'title'>,
): string {
  const title = snapshot.title.trim()
  if (!title || title === snapshot.identifier) return snapshot.identifier
  return `${snapshot.identifier} · ${title}`
}

export function selectRecordReference(input: {
  contract: RecordReferenceCellContract
  record: Pick<
    RecordReferenceSnapshot,
    'recordId' | 'modelKey' | 'archived' | 'deleted'
  >
}): string {
  if (input.contract.readOnly) {
    throw new RecordReferenceCellError(
      'read-only',
      'Record reference is read-only.',
    )
  }
  if (input.contract.cardinality !== 'one') {
    throw new RecordReferenceCellError(
      'cardinality',
      'Sheet Record-reference cells persist one Record UUID.',
    )
  }
  if (input.record.deleted) {
    throw new RecordReferenceCellError(
      'invalid-model',
      'Deleted Records cannot be selected.',
    )
  }
  if (input.record.modelKey !== input.contract.targetModelKey) {
    throw new RecordReferenceCellError(
      'invalid-model',
      `Record must belong to Model ${input.contract.targetModelKey}.`,
    )
  }
  return parsePersistedRecordReference(input.record.recordId, {
    nullable: false,
  }) as string
}

export function clearRecordReference(
  contract: RecordReferenceCellContract,
): null {
  if (contract.readOnly) {
    throw new RecordReferenceCellError(
      'read-only',
      'Record reference is read-only.',
    )
  }
  return parsePersistedRecordReference(null, contract)
}

export function recordReferenceWriteTargetFromColumnSource(
  sourceKind: 'bound-dataset' | 'bound-record' | 'declared',
): RecordReferenceWriteTarget {
  if (sourceKind === 'bound-dataset') return { kind: 'dataset' }
  if (sourceKind === 'bound-record') return { kind: 'model' }
  return { kind: 'local' }
}

export function snapshotFromRecord(
  record: {
    id: string
    kind: string
    identifier: string
    title: string
    archivedAt: string | null
    deletedAt: string | null
  },
  modelKey: string,
): RecordReferenceSnapshot {
  return {
    recordId: record.id,
    modelKey,
    kind: record.kind,
    identifier: record.identifier,
    title: record.title,
    archived: record.archivedAt !== null,
    deleted: record.deletedAt !== null,
  }
}
