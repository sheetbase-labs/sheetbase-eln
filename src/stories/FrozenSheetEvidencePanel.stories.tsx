import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FrozenSheetEvidencePanel } from '#/components/notebook/notebook-sheet-block'
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'

/**
 * The frozen Sheet a submitted revision renders: the grid is rebuilt from the
 * revision's stored instance state and bindings, never re-read live. The
 * evidence below carries one local column and one value, the shape
 * `frozenSheetGridFromEvidence` consumes.
 */
const evidence: FrozenSheetEvidence = {
  blockId: '0198d970-e266-4000-8000-0000000000b9',
  instanceId: '0198d970-e266-4000-8000-000000000030',
  instanceRevision: 7,
  sourceDefinitionVersionId: null,
  instanceState: {
    localFields: [
      {
        fieldId: '0198d970-e266-4000-8000-00000000f001',
        key: 'observation',
        label: 'Observation',
        logicalType: 'text',
        cardinality: 'one',
        lifecycle: 'active',
      },
    ],
    localValues: {
      '0198d970-e266-4000-8000-0000000a0001': {
        '0198d970-e266-4000-8000-00000000f001': 'Dilute 1:10 before reading',
      },
    },
    presentation: {
      columnWidths: {},
      density: 'standard',
    },
  },
  datasetBindings: [],
}

const meta = {
  title: 'Notebook/Frozen sheet evidence panel',
  component: FrozenSheetEvidencePanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { evidence },
} satisfies Meta<typeof FrozenSheetEvidencePanel>
export default meta
type Story = StoryObj<typeof meta>

/** The frozen values, with the comment affordance for a cell selection. */
export const Default: Story = {}

/** Without a comment handler the evidence stays read-only. */
export const WithoutCommenting: Story = { args: { onCommentTarget: undefined } }

/** Evidence carrying no local values still renders its column headers. */
export const NoValues: Story = {
  args: {
    evidence: {
      ...evidence,
      instanceState: { ...evidence.instanceState, localValues: {} },
    },
  },
}
