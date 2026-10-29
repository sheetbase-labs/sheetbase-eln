import { describe, expect, it } from 'vitest'

import { toDatasetImportRow } from './dataset-imports-tab'
import type { DatasetImportRecord } from '#/lib/import/types'

function receipt(outcome: Record<string, unknown>): DatasetImportRecord {
  return {
    id: 'imp-1',
    dataset_id: 'ds-1',
    experiment_record_id: null,
    parser_id: null,
    parser_version_id: null,
    file_id: 'file-1',
    connector_run_id: null,
    imported_row_ids: [],
    parser_provenance: {},
    source_provenance: { filename: 'readings.csv' },
    outcome,
    snapshot_version_id: 'snap-1',
    status: 'committed',
    error_detail: null,
    created_at: '2026-10-29T10:00:00Z',
  }
}

describe('toDatasetImportRow instrument flags', () => {
  it('carries what was wrong with the instrument when the data arrived', () => {
    expect(
      toDatasetImportRow(
        receipt({ added: 4, instrumentWarnings: ['calibration_overdue'] }),
      ).instrumentFlags,
    ).toEqual(['calibration_overdue'])
  })

  it('has no flags for an import from a ready instrument', () => {
    expect(toDatasetImportRow(receipt({ added: 4 })).instrumentFlags).toEqual(
      [],
    )
  })
})
