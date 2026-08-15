import { describe, expect, it } from 'vitest'

import {
  RECORD_REFERENCE_CELL_FORMAT,
  RecordReferenceCellError,
  clearRecordReference,
  formatRecordReferenceLabel,
  parsePersistedRecordReference,
  recordReferenceWriteTargetFromColumnSource,
  resolveRecordReferenceState,
  selectRecordReference,
  snapshotFromRecord,
} from './record-reference-cell'

const SAMPLE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

const contract = {
  format: RECORD_REFERENCE_CELL_FORMAT,
  targetModelKey: 'sample',
  nullable: true,
  cardinality: 'one' as const,
  readOnly: false,
  writeTarget: { kind: 'dataset' as const },
}

const sampleRecord = {
  id: SAMPLE_ID,
  kind: 'sample',
  identifier: 'SMP-2026-0001',
  title: 'LV harvest',
  archivedAt: null as string | null,
  deletedAt: null as string | null,
}

describe('Record-reference cell contract', () => {
  it('persists the Record UUID and rejects Record ID or Name as identity', () => {
    expect(parsePersistedRecordReference(SAMPLE_ID, { nullable: false })).toBe(
      SAMPLE_ID,
    )
    expect(parsePersistedRecordReference(null, { nullable: true })).toBeNull()
    expect(() =>
      parsePersistedRecordReference('SMP-2026-0001', { nullable: true }),
    ).toThrow(RecordReferenceCellError)
    try {
      parsePersistedRecordReference('SMP-2026-0001', { nullable: true })
    } catch (error) {
      expect(error).toMatchObject({ code: 'label-identity' })
    }
    try {
      parsePersistedRecordReference('LV harvest', { nullable: true })
    } catch (error) {
      expect(error).toMatchObject({ code: 'not-uuid' })
    }
    expect(() =>
      parsePersistedRecordReference(null, { nullable: false }),
    ).toThrowError(/required/)
  })

  it('writes the UUID only to the column write-back target', () => {
    expect(recordReferenceWriteTargetFromColumnSource('bound-dataset')).toEqual(
      { kind: 'dataset' },
    )
    expect(recordReferenceWriteTargetFromColumnSource('declared')).toEqual({
      kind: 'local',
    })
    expect(recordReferenceWriteTargetFromColumnSource('bound-record')).toEqual({
      kind: 'model',
    })
    expect(
      selectRecordReference({
        contract: { ...contract, writeTarget: { kind: 'local' } },
        record: {
          recordId: SAMPLE_ID,
          modelKey: 'sample',
          archived: false,
          deleted: false,
        },
      }),
    ).toBe(SAMPLE_ID)
  })

  it('displays identifier and name while reload keeps the same UUID after rename', () => {
    const snapshot = snapshotFromRecord(sampleRecord, 'sample')
    expect(formatRecordReferenceLabel(snapshot)).toBe(
      'SMP-2026-0001 · LV harvest',
    )
    const renamed = snapshotFromRecord(
      { ...sampleRecord, title: 'LV harvest renamed' },
      'sample',
    )
    const before = resolveRecordReferenceState({
      persistedId: SAMPLE_ID,
      snapshot,
      targetModelKey: 'sample',
    })
    const after = resolveRecordReferenceState({
      persistedId: SAMPLE_ID,
      snapshot: renamed,
      targetModelKey: 'sample',
    })
    expect(before).toMatchObject({ kind: 'present', recordId: SAMPLE_ID })
    expect(after).toMatchObject({ kind: 'present', recordId: SAMPLE_ID })
    expect(formatRecordReferenceLabel(renamed)).toBe(
      'SMP-2026-0001 · LV harvest renamed',
    )
  })

  it('selects a matching Model Record and refuses a different Model', () => {
    expect(
      selectRecordReference({
        contract,
        record: {
          recordId: SAMPLE_ID,
          modelKey: 'sample',
          archived: false,
          deleted: false,
        },
      }),
    ).toBe(SAMPLE_ID)
    expect(() =>
      selectRecordReference({
        contract,
        record: {
          recordId: OTHER_ID,
          modelKey: 'reagent',
          archived: false,
          deleted: false,
        },
      }),
    ).toThrowError(/Model sample/)
  })

  it('surfaces missing and archived targets without changing persisted identity', () => {
    expect(
      resolveRecordReferenceState({
        persistedId: SAMPLE_ID,
        snapshot: null,
        targetModelKey: 'sample',
      }),
    ).toEqual({ kind: 'missing', recordId: SAMPLE_ID })
    const live = snapshotFromRecord(sampleRecord, 'sample')
    const archived = snapshotFromRecord(
      { ...sampleRecord, archivedAt: '2026-08-15T00:00:00.000Z' },
      'sample',
    )
    expect(
      resolveRecordReferenceState({
        persistedId: SAMPLE_ID,
        snapshot: live,
        targetModelKey: 'sample',
      }).kind,
    ).toBe('present')
    expect(
      resolveRecordReferenceState({
        persistedId: SAMPLE_ID,
        snapshot: archived,
        targetModelKey: 'sample',
      }),
    ).toMatchObject({ kind: 'archived', recordId: SAMPLE_ID })
    expect(clearRecordReference(contract)).toBeNull()
    expect(() =>
      clearRecordReference({ ...contract, readOnly: true }),
    ).toThrowError(/read-only/)
  })
})
