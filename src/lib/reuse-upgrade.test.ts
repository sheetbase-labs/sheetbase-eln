/**
 * REUSE-03: upgrade availability, impact previews, and explicit adoption.
 * Availability never auto-applies and stays silent unless a newer published
 * version exists; impact summaries reuse the preview validators fail-closed;
 * adoption is preview-first with old/new version evidence.
 */
import { describe, expect, it } from 'vitest'

import {
  buildNotebookTemplateUpgradeAdoption,
  buildSheetDefinitionUpgradeAdoption,
  notebookTemplateUpgradeAvailability,
  sheetDefinitionUpgradeAvailability,
  summarizeNotebookTemplateUpgradeImpact,
  summarizeSheetDefinitionUpgradeImpact,
} from './reuse-upgrade'

const DEFINITION_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_VERSION_ID = '22222222-2222-4222-8222-222222222222'
const TARGET_VERSION_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'
const PARAMETER_ID = '55555555-5555-4555-8555-555555555555'
const COLUMN_ID = '66666666-6666-4666-8666-666666666666'
const RECORD_ID = '77777777-7777-4777-8777-777777777777'
const PLACEMENT_ID = '88888888-8888-4888-8888-888888888888'
const BLOCK_ID = '99999999-9999-4999-8999-999999999999'

const CONFLICT_ID =
  'parameter-removed:aaaaaaaa-bbbbbbbb-cccccccc-dddddddd-eeee'

function sheetPreview(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      definitionId: DEFINITION_ID,
      versionId: SOURCE_VERSION_ID,
      version: 1,
      instanceId: INSTANCE_ID,
      instanceRevision: 3,
    },
    target: {
      definitionId: DEFINITION_ID,
      versionId: TARGET_VERSION_ID,
      version: 2,
    },
    automaticChanges: [],
    conflicts: [],
    preserved: {
      localFieldIds: [],
      localValueRowCount: 0,
      instanceCalculationIds: [],
      calculationOverrideIds: [],
      presentationOwnedByInstance: true,
      bindingProvenanceRevalidated: true,
      writeOwnershipFromTarget: true,
    },
    ...overrides,
  }
}

function sheetConflict(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFLICT_ID,
    kind: 'parameter-removed',
    sourceId: PARAMETER_ID,
    targetCandidates: [],
    allowedOutcomes: ['defer'],
    instanceReferences: {
      localField: false,
      localValueCount: 0,
      calculationIds: [],
      calculationOverride: false,
      presentation: false,
    },
    ...overrides,
  }
}

function notebookPreview(overrides: Record<string, unknown> = {}) {
  return {
    recordId: RECORD_ID,
    sourceVersionId: SOURCE_VERSION_ID,
    targetVersionId: TARGET_VERSION_ID,
    automatic: [],
    conflicts: [],
    ...overrides,
  }
}

describe('notebookTemplateUpgradeAvailability', () => {
  it('reports upgrade-available only when a newer published version exists', () => {
    const result = notebookTemplateUpgradeAvailability(
      { id: SOURCE_VERSION_ID, version: 1 },
      [
        { id: SOURCE_VERSION_ID, version: 1, lifecycle: 'published' },
        { id: TARGET_VERSION_ID, version: 2, lifecycle: 'published' },
      ],
    )
    expect(result).toEqual({
      status: 'upgrade-available',
      latestVersion: { id: TARGET_VERSION_ID, version: 2 },
    })
  })

  it('stays silent when the pin matches the newest published version', () => {
    expect(
      notebookTemplateUpgradeAvailability(
        { id: TARGET_VERSION_ID, version: 2 },
        [
          { id: SOURCE_VERSION_ID, version: 1, lifecycle: 'published' },
          { id: TARGET_VERSION_ID, version: 2, lifecycle: 'published' },
        ],
      ),
    ).toEqual({ status: 'current', latestVersion: null })
  })

  it('ignores drafts and picks the newest published version, not list order', () => {
    const result = notebookTemplateUpgradeAvailability(
      { id: SOURCE_VERSION_ID, version: 1 },
      [
        { id: TARGET_VERSION_ID, version: 3, lifecycle: 'draft' },
        { id: 'retired-id', version: 5, lifecycle: 'retired' },
        { id: 'v2-id', version: 2, lifecycle: 'published' },
      ],
    )
    expect(result).toEqual({
      status: 'upgrade-available',
      latestVersion: { id: 'v2-id', version: 2 },
    })
  })

  it('fails closed to unknown without a pin or published lineage', () => {
    expect(notebookTemplateUpgradeAvailability(null, [])).toEqual({
      status: 'unknown',
      latestVersion: null,
    })
    expect(
      notebookTemplateUpgradeAvailability(undefined, [
        { id: TARGET_VERSION_ID, version: 2, lifecycle: 'published' },
      ]),
    ).toEqual({ status: 'unknown', latestVersion: null })
    expect(
      notebookTemplateUpgradeAvailability(
        { id: SOURCE_VERSION_ID, version: 1 },
        [{ id: TARGET_VERSION_ID, version: 2, lifecycle: 'draft' }],
      ),
    ).toEqual({ status: 'unknown', latestVersion: null })
  })
})

describe('sheetDefinitionUpgradeAvailability', () => {
  it('detects a newer published Definition version for a composition part pin', () => {
    const compositionPins = [
      { placementId: PLACEMENT_ID, definitionVersionId: SOURCE_VERSION_ID },
    ]
    const statuses = compositionPins.map((pin) =>
      sheetDefinitionUpgradeAvailability(
        { id: pin.definitionVersionId, version: 1 },
        [
          { id: SOURCE_VERSION_ID, version: 1, lifecycle: 'published' },
          { id: TARGET_VERSION_ID, version: 2, lifecycle: 'published' },
        ],
      ),
    )
    expect(statuses).toEqual([
      {
        status: 'upgrade-available',
        latestVersion: { id: TARGET_VERSION_ID, version: 2 },
      },
    ])
  })

  it('stays silent when the part pin is current', () => {
    expect(
      sheetDefinitionUpgradeAvailability(
        { id: TARGET_VERSION_ID, version: 2 },
        [{ id: TARGET_VERSION_ID, version: 2, lifecycle: 'published' }],
      ),
    ).toEqual({ status: 'current', latestVersion: null })
  })
})

describe('summarizeSheetDefinitionUpgradeImpact', () => {
  it('groups parameter, binding, and column changes with preserved local state', () => {
    const summary = summarizeSheetDefinitionUpgradeImpact(
      sheetPreview({
        automaticChanges: [
          { kind: 'parameter-added', objectId: PARAMETER_ID },
          { kind: 'column-added', objectId: COLUMN_ID },
          { kind: 'binding-added', objectId: COLUMN_ID },
        ],
        conflicts: [
          sheetConflict(),
          sheetConflict({
            id: 'column-removed:bbbbbbbb-cccccccc-dddddddd-eeeeeeee-ffff',
            kind: 'column-removed',
            sourceId: COLUMN_ID,
          }),
        ],
        preserved: {
          localFieldIds: [COLUMN_ID],
          localValueRowCount: 4,
          instanceCalculationIds: [],
          calculationOverrideIds: [COLUMN_ID],
          presentationOwnedByInstance: true,
          bindingProvenanceRevalidated: true,
          writeOwnershipFromTarget: true,
        },
      }),
    )
    expect(summary.title).toBe('Definition v1 → v2')
    expect(summary.lines).toContain('Parameters: 1 added, 1 removed')
    expect(summary.lines).toContain('Columns: 1 added, 1 removed')
    expect(summary.lines).toContain('Bindings: 1 added')
    expect(summary.localEffects).toContain('1 local field preserved')
    expect(summary.localEffects).toContain('4 local value rows preserved')
    expect(summary.localEffects).toContain('1 calculation override preserved')
    expect(summary.automaticCount).toBe(3)
    expect(summary.conflictCount).toBe(2)
  })

  it('names newly required parameters and local-state references', () => {
    const summary = summarizeSheetDefinitionUpgradeImpact(
      sheetPreview({
        conflicts: [
          sheetConflict({
            id: 'parameter-required:cccccccc-dddddddd-eeeeeeee-ffffffff-0000',
            kind: 'parameter-required',
            sourceId: PARAMETER_ID,
            instanceReferences: {
              localField: false,
              localValueCount: 2,
              calculationIds: [],
              calculationOverride: false,
              presentation: true,
            },
          }),
        ],
      }),
    )
    expect(summary.lines).toContain(
      'Parameters: 1 newly required parameter',
    )
    expect(summary.localEffects).toContain(
      '1 conflict references local state — check each decision.',
    )
  })

  it('fails closed on an unresolvable diff', () => {
    expect(() =>
      summarizeSheetDefinitionUpgradeImpact({ bogus: true }),
    ).toThrow()
    expect(() =>
      summarizeSheetDefinitionUpgradeImpact(
        sheetPreview({
          automaticChanges: [{ kind: 'wormhole-added', objectId: COLUMN_ID }],
        }),
      ),
    ).toThrow()
  })
})

describe('summarizeNotebookTemplateUpgradeImpact', () => {
  it('covers placements and nested per-part Definition impact', () => {
    const summary = summarizeNotebookTemplateUpgradeImpact(
      notebookPreview({
        automatic: [
          { kind: 'placement-added', placementId: PLACEMENT_ID },
          {
            kind: 'sheet-definition-compatible',
            placementId: PLACEMENT_ID,
            instanceId: INSTANCE_ID,
            blockId: BLOCK_ID,
            targetDefinitionVersionId: TARGET_VERSION_ID,
          },
        ],
        conflicts: [
          {
            id: `placement:${PLACEMENT_ID}`,
            kind: 'sheet-definition-conflict',
            placementId: PLACEMENT_ID,
            instanceId: INSTANCE_ID,
            blockId: BLOCK_ID,
            allowedOutcomes: ['keep', 'retarget'],
            instancePreview: sheetPreview({
              automaticChanges: [
                { kind: 'parameter-added', objectId: PARAMETER_ID },
              ],
            }),
          },
        ],
      }),
    )
    expect(summary.lines).toContain('Placements: 1 added')
    expect(summary.lines).toContain(
      '1 part re-pins cleanly to a newer Definition version',
    )
    expect(summary.lines).toContain(
      `Part ${PLACEMENT_ID}: Parameters: 1 added`,
    )
    expect(summary.conflictCount).toBe(1)
    expect(summary.automaticCount).toBe(2)
  })

  it('fails closed on an unresolvable diff', () => {
    expect(() =>
      summarizeNotebookTemplateUpgradeImpact({ bogus: true }),
    ).toThrow()
  })
})

describe('explicit adoption', () => {
  it('records old/new Definition versions for a Sheet adoption', () => {
    const preview = sheetPreview({ conflicts: [sheetConflict()] })
    const adoption = buildSheetDefinitionUpgradeAdoption({
      preview,
      targetVersionId: TARGET_VERSION_ID,
      decisions: [{ conflictId: CONFLICT_ID, outcome: 'defer' }],
    })
    expect(adoption).toEqual({
      sourceDefinitionVersionId: SOURCE_VERSION_ID,
      targetDefinitionVersionId: TARGET_VERSION_ID,
      decisions: [{ conflictId: CONFLICT_ID, outcome: 'defer' }],
    })
  })

  it('rejects stale previews and partial decisions for a Sheet adoption', () => {
    const preview = sheetPreview({ conflicts: [sheetConflict()] })
    expect(() =>
      buildSheetDefinitionUpgradeAdoption({
        preview,
        targetVersionId: SOURCE_VERSION_ID,
        decisions: [{ conflictId: CONFLICT_ID, outcome: 'defer' }],
      }),
    ).toThrow(/stale/)
    expect(() =>
      buildSheetDefinitionUpgradeAdoption({
        preview,
        targetVersionId: TARGET_VERSION_ID,
        decisions: [],
      }),
    ).toThrow(/exactly one decision/)
  })

  it('records old/new Template versions for a Notebook adoption', () => {
    const preview = notebookPreview()
    const adoption = buildNotebookTemplateUpgradeAdoption({
      preview,
      targetVersionId: TARGET_VERSION_ID,
      decisions: [],
    })
    expect(adoption).toEqual({
      sourceVersionId: SOURCE_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
      decisions: [],
    })
    expect(() =>
      buildNotebookTemplateUpgradeAdoption({
        preview,
        targetVersionId: SOURCE_VERSION_ID,
        decisions: [],
      }),
    ).toThrow(/stale/)
  })
})
