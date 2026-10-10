/**
 * SHEET-04.4 — per-notebook template update view.
 *
 * Proves the preview's automatic changes and conflicts render with their
 * allowed outcomes, that choosing outcomes produces exactly the decision
 * payload the apply RPC validates, and that a rejected apply is surfaced
 * rather than reported as success.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookTemplateUpdateView } from './template-update-view'
import type { NotebookUpgradeDecision, NotebookUpgradePreview } from '#/lib/notebook-template-upgrade'

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const RECORD = uuid(1)
const SOURCE_VERSION = uuid(2)
const TARGET_VERSION = uuid(3)
const KEEP_PLACEMENT = uuid(4)
const RETARGET_PLACEMENT = uuid(5)
const BLOCK = uuid(6)
const INSTANCE = uuid(7)
const DEF_SOURCE = uuid(8)
const DEF_TARGET = uuid(9)
const REMOVED_COLUMN = uuid(10)
const REPLACEMENT_COLUMN = uuid(11)
const ADDED_PLACEMENT = uuid(12)

const preview: NotebookUpgradePreview = {
  recordId: RECORD,
  sourceVersionId: SOURCE_VERSION,
  targetVersionId: TARGET_VERSION,
  automatic: [
    { kind: 'placement-added', placementId: ADDED_PLACEMENT },
    {
      kind: 'sheet-definition-compatible',
      placementId: KEEP_PLACEMENT,
      blockId: BLOCK,
      instanceId: INSTANCE,
      targetDefinitionVersionId: DEF_TARGET,
    },
  ],
  conflicts: [
    {
      id: `placement:${KEEP_PLACEMENT}`,
      kind: 'sheet-placement-unresolved',
      placementId: KEEP_PLACEMENT,
      allowedOutcomes: ['keep'],
    },
    {
      id: `placement:${RETARGET_PLACEMENT}`,
      kind: 'sheet-definition-conflict',
      placementId: RETARGET_PLACEMENT,
      blockId: BLOCK,
      instanceId: INSTANCE,
      allowedOutcomes: ['keep', 'retarget'],
      instancePreview: {
        source: {
          definitionId: DEF_SOURCE,
          versionId: SOURCE_VERSION,
          version: 1,
          instanceId: INSTANCE,
          instanceRevision: 3,
        },
        target: { definitionId: DEF_TARGET, versionId: TARGET_VERSION, version: 2 },
        automaticChanges: [{ kind: 'column-added', objectId: uuid(13) }],
        conflicts: [
          {
            id: `column:${REMOVED_COLUMN}`,
            kind: 'column-removed',
            sourceId: REMOVED_COLUMN,
            targetCandidates: [REPLACEMENT_COLUMN],
            allowedOutcomes: ['map', 'defer'],
            instanceReferences: {
              localField: false,
              localValueCount: 0,
              calculationIds: [],
              calculationOverride: false,
              presentation: false,
            },
          },
        ],
        preserved: {
          localFieldIds: [],
          localValueRowCount: 0,
          instanceCalculationIds: [],
          calculationOverrideIds: [],
          presentationOwnedByInstance: true,
          bindingProvenanceRevalidated: true,
          writeOwnershipFromTarget: true,
        },
      },
    },
  ],
}

function renderView(
  onApply: (decisions: NotebookUpgradeDecision[]) => Promise<void>,
) {
  return render(
    <NotebookTemplateUpdateView
      targetVersion={4}
      sourceVersion={3}
      templateName="Depth-filter clarification screen"
      notebookLabel="EXP-0142"
      preview={preview}
      isLoading={false}
      onApply={onApply}
      backLink={<a href="/experiments/EXP-0142">Back to notebook</a>}
    />,
  )
}

afterEach(cleanup)

describe('NotebookTemplateUpdateView', () => {
  it('lists the automatic changes and each conflict with its allowed outcomes', () => {
    renderView(vi.fn(async () => {}))

    expect(screen.getByText('Section added')).toBeDefined()
    expect(
      screen.getByText('Sheet re-pinned to a newer definition version'),
    ).toBeDefined()
    expect(
      screen.getByText('No matching sheet in this notebook'),
    ).toBeDefined()
    expect(
      screen.getByText('Sheet definition changed incompatibly'),
    ).toBeDefined()
    // Both conflicts state their permitted outcomes.
    expect(screen.getAllByText('Keep as it is')).toHaveLength(2)
    expect(screen.getByText('Take the new definition')).toBeDefined()
  })

  it('produces the decision payload the apply RPC expects', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(async () => {})
    renderView(onApply)

    // Take the new definition: the nested column map conflict keeps its
    // default mapping to the replacement column.
    await user.click(screen.getByText('Take the new definition'))
    await user.click(screen.getByRole('button', { name: 'Apply v4' }))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply).toHaveBeenCalledWith([
      { conflictId: `placement:${KEEP_PLACEMENT}`, outcome: 'keep' },
      {
        conflictId: `placement:${RETARGET_PLACEMENT}`,
        outcome: 'retarget',
        instanceDecisions: [
          {
            conflictId: `column:${REMOVED_COLUMN}`,
            outcome: 'map',
            targetId: REPLACEMENT_COLUMN,
          },
        ],
      },
    ])
  })

  it('surfaces a rejected apply instead of reporting success', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(async () => {
      throw new Error('structure version mismatch: expected 3, got 4')
    })
    renderView(onApply)

    await user.click(screen.getByRole('button', { name: 'Apply v4' }))

    expect(
      await screen.findByText('structure version mismatch: expected 3, got 4'),
    ).toBeDefined()
    expect(screen.getByText('Could not update the notebook')).toBeDefined()
    expect(screen.queryByText(/Notebook updated to v4/)).toBeNull()
  })
})
