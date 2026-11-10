import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  applySheetInstanceCompositionAdoption,
  previewSheetInstanceCompositionAdoption,
} from './sheet-composition-adoption'

const INSTANCE = '20000000-0000-4000-8000-000000000001'
const VERSION = '20000000-0000-4000-8000-000000000002'
const RETRY = '20000000-0000-4000-8000-000000000003'

const preview = {
  instanceId: INSTANCE,
  instanceRevision: 2,
  notebookRecordId: null,
  compatible: true,
  unmatchedLocalRowKeys: [],
  preserved: {
    instanceId: INSTANCE,
    notebookRecordId: null,
    localFieldIds: [],
    localValueRowCount: 0,
    instanceCalculationIds: [],
  },
  target: {
    definitionId: '20000000-0000-4000-8000-000000000004',
    versionId: VERSION,
    version: 1,
    workspaceId: '20000000-0000-4000-8000-000000000005',
  },
}

/** A transport that answers only the RPC a case asserts on. */
function rpcClient(rpc: DataClient['rpc']): DataClient {
  // SAFETY: both adoption helpers read only `rpc` from their client, so the other transport methods are never reached.
  return { rpc } as DataClient
}

describe('sheet composition adoption client', () => {
  it('previews H2 adoption through the existing RPC', async () => {
    const rpc = vi.fn().mockResolvedValue(preview)

    const result = await previewSheetInstanceCompositionAdoption(
      {
        instanceId: INSTANCE,
        expectedRevision: 2,
        targetDefinitionVersionId: VERSION,
      },
      rpcClient(rpc),
    )

    expect(rpc).toHaveBeenCalledWith(
      'preview_sheet_instance_composition_adoption',
      expect.objectContaining({
        p_instance_id: INSTANCE,
        p_expected_instance_revision: 2,
        p_target_definition_version_id: VERSION,
      }),
    )
    expect(result.compatible).toBe(true)
  })

  it('does not apply when the preview is incompatible', async () => {
    const rpc = vi.fn().mockResolvedValue({ ...preview, compatible: false })

    const result = await applySheetInstanceCompositionAdoption(
      {
        instanceId: INSTANCE,
        expectedRevision: 2,
        targetDefinitionVersionId: VERSION,
        retryToken: RETRY,
      },
      rpcClient(rpc),
    )

    expect(result.status).toBe('incompatible')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
