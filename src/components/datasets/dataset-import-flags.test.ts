import { describe, expect, it } from 'vitest'

import { toDatasetImportRow } from './dataset-import-row'
import type { DatasetImportRecord } from '#/lib/import/types'

function receipt(outcome: DatasetImportRecord['outcome']): DatasetImportRecord {
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

  it('uses retained provenance and leaves the receipt unchanged', () => {
    const retained = receipt({ added: 0 })
    retained.parser_provenance = {
      name: 'Frozen parser',
      version: 2,
      key: 'frozen-key',
    }
    retained.experiment_record_id = 'experiment-1'
    const before = structuredClone(retained)
    Object.freeze(retained.parser_provenance)
    Object.freeze(retained.source_provenance)
    Object.freeze(retained.outcome)
    Object.freeze(retained)
    expect(toDatasetImportRow(retained)).toMatchObject({
      file: 'readings.csv',
      rows: 0,
      parser: 'Frozen parser v2',
      importFileId: 'file-1',
      resumeSearch: {
        step: 'map',
        dataset: 'ds-1',
        experiment: 'experiment-1',
        parser: 'frozen-key',
      },
    })
    expect(retained).toEqual(before)
  })

  it.each([NaN, Infinity, -Infinity, -2.5, 0])(
    'preserves native scientific numeric provenance %s',
    (value) => {
      const retained = receipt({ added: value })
      retained.parser_provenance = { name: 'Scientific parser', version: value }
      expect(toDatasetImportRow(retained).rows).toBe(value)
      expect(toDatasetImportRow(retained).parser).toBe(
        `Scientific parser v${value}`,
      )
    },
  )

  it('falls back for missing or malformed provenance without coercing it', () => {
    const retained = receipt({
      added: '4',
      instrumentWarnings: ['retired', 'unrecognised'],
    })

    retained.source_provenance = { filename: [] }
    retained.parser_provenance = { name: '', version: '2', key: 3 }
    retained.imported_row_ids = ['row-1']
    retained.status = 'future_status'
    expect(toDatasetImportRow(retained)).toMatchObject({
      file: '—',
      rows: 1,
      parser: '—',
      result: { tone: 'none', label: 'future_status' },
      resumeSearch: { parser: undefined },
    })
  })
})
