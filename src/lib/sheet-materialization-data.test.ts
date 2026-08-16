import { describe, expect, it, vi } from 'vitest'

import {
  materializeSheetInstance,
  previewSheetMaterialization,
} from './sheet-materialization-data'

const instanceId = '10000000-0000-4000-8000-000000000001'
const definitionVersionId = '10000000-0000-4000-8000-000000000002'
const schemaVersionId = '10000000-0000-4000-8000-000000000003'
const datasetId = '10000000-0000-4000-8000-000000000004'
const datasetVersionId = '10000000-0000-4000-8000-000000000005'
const materializationId = '10000000-0000-4000-8000-000000000006'
const retry = '10000000-0000-4000-8000-000000000007'
const digest = 'a'.repeat(64)
const field = {
  fieldId: '10000000-0000-4000-8000-000000000008',
  key: 'sample',
  label: 'Sample',
  description: null,
  logicalType: 'reference',
  nullable: false,
  defaultValue: null,
  cardinality: 'one',
  quantity: null,
  validation: {},
  category: null,
  relationship: {
    target: { kind: 'model', modelKey: 'sample' },
    cardinality: 'one',
  },
  computation: { mode: 'stored' },
  lifecycle: 'active',
}
const sourceVersion = {
  bindingId: '10000000-0000-4000-8000-000000000009',
  datasetId,
  datasetRevision: 1,
  schemaVersionId,
  pinKind: 'live-snapshot' as const,
  datasetVersionId: null,
  policy: { mode: 'live' as const },
}

describe('Sheet materialization data contract', () => {
  it('requires an explicit preview and passes its immutable digest to the server action', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        instanceId,
        instanceRevision: 2,
        definitionVersionId,
        outputSchemaVersionId: null,
        derivedOutputFields: [
          {
            id: field.fieldId,
            kind: 'definition-column',
            field,
            source: {
              kind: 'bound',
              bindingId: sourceVersion.bindingId,
              sourceFieldId: field.fieldId,
            },
          },
        ],
        sourceVersions: [sourceVersion],
        previewDigest: digest,
      })
      .mockResolvedValueOnce({
        materializationId,
        datasetId,
        datasetVersionId,
        schemaVersionId,
        sourceVersions: [sourceVersion],
        idempotent: false,
      })
    const client = { rpc } as never

    const preview = await previewSheetMaterialization(
      { instanceId, expectedRevision: 2 },
      client,
    )
    const result = await materializeSheetInstance(
      {
        instanceId,
        expectedRevision: 2,
        outputName: 'Purification output',
        previewDigest: preview.previewDigest,
        idempotencyKey: retry,
      },
      client,
    )

    expect(result).toMatchObject({ datasetId, idempotent: false })
    expect(rpc).toHaveBeenNthCalledWith(2, 'materialize_sheet_instance', {
      p_instance_id: instanceId,
      p_expected_instance_revision: 2,
      p_output_name: 'Purification output',
      p_output_schema_version_id: null,
      p_preview_digest: digest,
      p_idempotency_key: retry,
    })
  })

  it('rejects untyped output manifests and incomplete source-version provenance', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        instanceId,
        instanceRevision: 2,
        definitionVersionId,
        outputSchemaVersionId: null,
        derivedOutputFields: [{}],
        sourceVersions: [{ bindingId: sourceVersion.bindingId, datasetId }],
        previewDigest: digest,
      }),
    } as never
    await expect(
      previewSheetMaterialization({ instanceId, expectedRevision: 2 }, client),
    ).rejects.toThrow()
  })
})
