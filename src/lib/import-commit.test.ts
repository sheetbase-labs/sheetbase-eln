import { describe, expect, it, vi } from 'vitest'

import {
  describeRejectedImport,
  validateAndCommitImport,
} from './import-commit'
import type { DataClient } from './data-client'
import type { MappedImport } from './import-mapping'

const mapped: MappedImport = {
  schemaVersionId: 'ver-1',
  errors: [],
  rows: [
    {
      rowId: '11111111-1111-4111-8111-111111111111',
      values: { '22222222-2222-4222-8222-222222222222': 7.4 },
    },
  ],
}

const provenance = {
  fileId: 'file-1',
  parserId: 'parser-1',
  parserVersionId: 'parser-version-1',
}

describe('import validate-before-commit', () => {
  it('validates then commits Dataset rows through canonical RPCs only', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'validate_dataset_row_batch') return { ok: true }
      if (name === 'commit_dataset_import') {
        return {
          ok: true,
          datasetRevision: 2,
          rows: [{ rowId: mapped.rows[0]?.rowId }],
        }
      }
      throw new Error(name)
    })
    const result = await validateAndCommitImport(
      { rpc } as unknown as DataClient,
      {
        kind: 'dataset',
        datasetId: 'ds-1',
        expectedRevision: 1,
        schemaVersionId: 'ver-1',
        ...provenance,
      },
      mapped,
      'import-1',
    )
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'validate_dataset_row_batch',
      'commit_dataset_import',
    ])
    expect(result).toMatchObject({
      ok: true,
      committed: 1,
      schemaVersionId: 'ver-1',
    })
  })

  it('does not commit when client-side coercion failed', async () => {
    const rpc = vi.fn()
    const result = await validateAndCommitImport(
      { rpc } as unknown as DataClient,
      {
        kind: 'dataset',
        datasetId: 'ds-1',
        expectedRevision: 1,
        schemaVersionId: 'ver-1',
        ...provenance,
      },
      {
        ...mapped,
        errors: [
          {
            row: 1,
            source: 'pH',
            code: 'coercion_failed',
            message: 'Invalid number: pH',
          },
        ],
      },
      'import-1',
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.committed).toBe(0)
  })

  it('does not commit when Dataset validation rejects the batch', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'validate_dataset_row_batch') {
        return {
          ok: false,
          errors: [{ rowIndex: 1, code: 'unknown_field' }],
        }
      }
      throw new Error(name)
    })
    const result = await validateAndCommitImport(
      { rpc } as unknown as DataClient,
      {
        kind: 'dataset',
        datasetId: 'ds-1',
        expectedRevision: 1,
        schemaVersionId: 'ver-1',
        ...provenance,
      },
      mapped,
      'import-1',
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('unknown_field')
  })

  it('validates Records then creates through create_model_record', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'validate_sheet_record_batch') {
        return { ok: true, rows: [{ classification: 'create' }] }
      }
      if (name === 'create_model_record') return { id: 'rec-1' }
      throw new Error(name)
    })
    const result = await validateAndCommitImport(
      { rpc } as unknown as DataClient,
      {
        kind: 'record',
        projectId: 'proj-1',
        modelKey: 'sample',
        recordKind: 'sample',
      },
      {
        schemaVersionId: null,
        errors: [],
        rows: [
          {
            rowId: 'row-1',
            title: 'LV harvest',
            values: { note: 'cold' },
          },
        ],
      },
      'unused',
    )
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'validate_sheet_record_batch',
      'create_model_record',
    ])
    expect(rpc).toHaveBeenCalledWith(
      'create_model_record',
      expect.objectContaining({
        p_kind: 'sample',
        p_title: 'LV harvest',
        p_custom_fields: { note: 'cold' },
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('refuses to commit when the Dataset Schema Version pin does not match', async () => {
    await expect(
      validateAndCommitImport(
        { rpc: vi.fn() } as unknown as DataClient,
        {
          kind: 'dataset',
          datasetId: 'ds-1',
          expectedRevision: 1,
          schemaVersionId: 'ver-2',
          ...provenance,
        },
        mapped,
        'import-1',
      ),
    ).rejects.toThrow(/Schema Version changed/)
  })
})

describe('describeRejectedImport', () => {
  const fieldId = 'dbb8bfe4-c420-4567-9b85-fcdfa1058dbb'
  const fields = [{ id: fieldId, label: 'Sample' }]

  it('names the problem and the field instead of showing the JSON', () => {
    const message = `Dataset import rejected: [{"code": "required_value", "rowId": "c80b", "fieldId": "${fieldId}", "rowIndex": 1}, {"code": "required_value", "rowId": "f812", "fieldId": "${fieldId}", "rowIndex": 2}, {"code": "requ`
    expect(describeRejectedImport(message, fields)).toBe(
      'Nothing was imported. A required field is missing. Check Sample.',
    )
  })

  it('leaves any other message alone', () => {
    expect(describeRejectedImport('The import failed.', fields)).toBe(
      'The import failed.',
    )
  })
})
