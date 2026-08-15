import { describe, expect, it, vi } from 'vitest'

import {
  applySheetInstanceDefinitionUpgrade,
  previewSheetInstanceDefinitionUpgrade,
} from '#/lib/sheet-instance-data'
import {
  parseSheetDefinitionUpgradeDecisions,
  parseSheetDefinitionUpgradePreview,
} from '#/lib/sheet-definition-upgrade'

const INSTANCE = '31000000-0000-4000-8000-000000000001'
const DEFINITION = '31000000-0000-4000-8000-000000000002'
const SOURCE = '31000000-0000-4000-8000-000000000003'
const TARGET = '31000000-0000-4000-8000-000000000004'
const COLUMN = '31000000-0000-4000-8000-000000000005'
const REPLACEMENT = '31000000-0000-4000-8000-000000000006'
const WORKSPACE = '31000000-0000-4000-8000-000000000007'

function preview() {
  return {
    source: {
      instanceId: INSTANCE,
      instanceRevision: 7,
      definitionId: DEFINITION,
      versionId: SOURCE,
      version: 1,
    },
    target: { definitionId: DEFINITION, versionId: TARGET, version: 2 },
    automaticChanges: [{ kind: 'column-added', objectId: REPLACEMENT }],
    conflicts: [
      {
        id: `column-removed:${COLUMN}`,
        kind: 'column-removed',
        sourceId: COLUMN,
        targetCandidates: [REPLACEMENT],
        allowedOutcomes: ['retain-local', 'map', 'defer'],
        instanceReferences: {
          localField: true,
          localValueCount: 2,
          calculationIds: [],
          calculationOverride: false,
          presentation: true,
        },
      },
    ],
    preserved: {
      localFieldIds: [COLUMN],
      localValueRowCount: 2,
      instanceCalculationIds: [],
      calculationOverrideIds: [],
      presentationOwnedByInstance: true,
      bindingProvenanceRevalidated: true,
      writeOwnershipFromTarget: true,
    },
  }
}

describe('Sheet Definition upgrade contract', () => {
  it('parses a bounded exact-ID impact model and rejects unmodelled payloads', () => {
    expect(
      parseSheetDefinitionUpgradePreview(preview()).conflicts[0],
    ).toMatchObject({ sourceId: COLUMN, targetCandidates: [REPLACEMENT] })
    expect(() =>
      parseSheetDefinitionUpgradePreview({ ...preview(), currentValues: {} }),
    ).toThrow()
    expect(() =>
      parseSheetDefinitionUpgradeDecisions([
        { conflictId: `column-removed:${COLUMN}`, outcome: 'defer' },
        { conflictId: `column-removed:${COLUMN}`, outcome: 'retain-local' },
      ]),
    ).toThrow()
  })

  it('uses separate preview/apply RPCs and returns defer without an Instance mutation', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce({ status: 'deferred', preview: preview() })
    const client: any = { rpc }
    await previewSheetInstanceDefinitionUpgrade(INSTANCE, 7, TARGET, client)
    const result = await applySheetInstanceDefinitionUpgrade(
      {
        instanceId: INSTANCE,
        expectedRevision: 7,
        targetDefinitionVersionId: TARGET,
        decisions: [
          { conflictId: `column-removed:${COLUMN}`, outcome: 'defer' },
        ],
      },
      client,
    )
    expect(result.status).toBe('deferred')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'preview_sheet_instance_definition_upgrade',
      'apply_sheet_instance_definition_upgrade',
    ])
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_expected_instance_revision: 7,
      p_target_definition_version_id: TARGET,
    })
  })

  it('parses an applied Instance and durable resulting-revision provenance', async () => {
    const now = '2026-08-15T12:00:00Z'
    const decisions = [
      {
        conflictId: `column-removed:${COLUMN}`,
        outcome: 'map' as const,
        targetId: REPLACEMENT,
      },
    ]
    const instance = {
      id: INSTANCE,
      workspace_id: WORKSPACE,
      project_id: null,
      notebook_record_id: null,
      source_definition_version_id: TARGET,
      name: 'Upgraded sheet',
      description: null,
      lifecycle: 'active',
      revision: 8,
      state: {
        bindings: [],
        parameterValues: [],
        localFields: [],
        localValues: {},
        calculationOverrides: {},
        presentation: {
          columnOrder: [],
          hiddenColumnIds: [],
          columnWidths: {},
          frozenColumnCount: 0,
          density: 'standard',
          filters: [],
          sorts: [],
        },
        provenance: { createdFrom: 'definition_version' },
      },
      duplicated_from_instance_id: null,
      created_at: now,
      updated_at: now,
      created_by_user_id: 'member',
      updated_by_user_id: 'member',
    }
    const rpc = vi.fn().mockResolvedValue({
      status: 'applied',
      preview: preview(),
      instance,
      provenance: {
        sourceDefinitionVersionId: SOURCE,
        targetDefinitionVersionId: TARGET,
        sourceInstanceRevision: 7,
        resultingInstanceRevision: 8,
        actorUserId: 'member',
        upgradedAt: now,
        decisions,
      },
    })
    const result = await applySheetInstanceDefinitionUpgrade(
      {
        instanceId: INSTANCE,
        expectedRevision: 7,
        targetDefinitionVersionId: TARGET,
        decisions,
      },
      { rpc } as any,
    )
    expect(result).toMatchObject({
      status: 'applied',
      instance: { revision: 8, sourceDefinitionVersionId: TARGET },
      provenance: {
        sourceDefinitionVersionId: SOURCE,
        targetDefinitionVersionId: TARGET,
        resultingInstanceRevision: 8,
      },
    })
  })
})
