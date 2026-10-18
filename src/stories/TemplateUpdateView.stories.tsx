import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { screen, userEvent } from 'storybook/test'

import { NotebookTemplateUpdateView } from '#/components/v3/templates/template-update-view'
import type {
  NotebookUpgradeDecision,
  NotebookUpgradePreview,
} from '#/lib/notebook-template-upgrade'

/**
 * SHEET-04.4 — the per-notebook template update view
 * (`src/components/v3/templates/template-update-view.tsx`).
 *
 * The parent owns the preview read and the apply RPC, so these stories pass
 * the preview the parent would render and a stub `onApply`: the view's own
 * states (still checking, no preview, automatic changes, an unresolved
 * conflict, the nested per-sheet conflict, a rejected apply and the applied
 * confirmation) are all reachable from props. Nothing here reads.
 */
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
        target: {
          definitionId: DEF_TARGET,
          versionId: TARGET_VERSION,
          version: 2,
        },
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

const meta = {
  title: 'Templates/Template update',
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function View({
  preview: value,
  isLoading = false,
  onApply = async () => {},
}: {
  preview: NotebookUpgradePreview | undefined
  isLoading?: boolean
  onApply?: (decisions: NotebookUpgradeDecision[]) => Promise<void>
}) {
  return (
    <NotebookTemplateUpdateView
      targetVersion={4}
      sourceVersion={3}
      templateName="Depth-filter clarification screen"
      notebookLabel="EXP-0142"
      preview={value}
      isLoading={isLoading}
      onApply={onApply}
      backLink={<a href="/experiments/EXP-0142">Back to notebook</a>}
    />
  )
}

/** The preview read has not answered yet. */
export const Loading: Story = {
  render: () => <View preview={undefined} isLoading />,
}

/** The read settled without a preview: the view says so rather than pretending. */
export const NoPreview: Story = {
  render: () => <View preview={undefined} isLoading={false} />,
}

/** The whole preview: automatic changes and both conflicts with their outcomes. */
export const Preview: Story = {
  render: () => <View preview={preview} />,
}

/**
 * Taking the new definition expands the nested per-sheet conflict and its
 * target-column mapping.
 */
export const RetargetSelected: Story = {
  render: () => <View preview={preview} />,
  play: async () => {
    await userEvent.click(await screen.findByText('Take the new definition'))
    await screen.findByText('Map to a new column')
  },
}

/** A rejected apply is surfaced as the server's reason, never as success. */
export const ApplyFailed: Story = {
  render: () => (
    <View
      preview={preview}
      onApply={async () => {
        throw new Error('structure version mismatch: expected 3, got 4')
      }}
    />
  ),
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Apply v4' }),
    )
    await screen.findByText('structure version mismatch: expected 3, got 4')
  },
}

/** The applied state: a confirmation and the record's own link onward. */
export const Applied: Story = {
  render: () => <View preview={preview} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Apply v4' }),
    )
    await screen.findByText('Notebook updated to v4.')
  },
}
