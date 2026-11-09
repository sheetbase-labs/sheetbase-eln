import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DraftProposalPanel } from '#/components/assist/draft-proposal-panel'
import {
  buildTextDraftProposal,
  proposeChartSpec,
  suggestMappingProposal,
} from '#/lib/assist-drafts'
import type { AssistDraftProposal } from '#/lib/assist-drafts'
import type { AiCitation } from '#/lib/ai-retrieval'

/**
 * Preview before commit (ASSIST-02), for every kind of draft the assistant can
 * propose: a banner marking it as generated, a deterministic preview, the cited
 * sources and Accept or Discard. The panel never changes anything itself:
 * Accept hands over to the host's ordinary operation and Discard leaves no
 * state behind.
 */
const TEXT = buildTextDraftProposal({
  recordTitle: 'Virus stability at 25 °C',
  focus: 'Summary of week 2',
  citations: [
    {
      kind: 'record',
      stableId: '0198d970-e266-4000-8000-000000000e14',
      identifier: 'EXP-2026-0042',
      recordKind: 'experiment',
      title: 'Virus stability at 25 °C',
      deepLink: '/experiments/0198d970-e266-4000-8000-000000000e14',
      matchedField: 'title',
    } as unknown as AiCitation,
  ],
  keyPoints: ['Titre fell by 0.3 log between day 7 and day 14.'],
}) as AssistDraftProposal

const MAPPING = suggestMappingProposal(
  ['Sample ID', 'Titre (PFU/mL)', 'Operator initials'],
  [
    {
      id: 'f1',
      label: 'Sample ID',
      logicalType: 'text',
      nullable: false,
      kind: 'dataset-field',
    },
    {
      id: 'f2',
      label: 'Titre',
      logicalType: 'decimal',
      nullable: true,
      kind: 'dataset-field',
    },
  ],
)

const CHART = proposeChartSpec({
  datasetId: '0198d970-e266-4000-8000-000000000d01',
  fields: [
    {
      fieldId: '0198d970-e266-4000-8000-0000000f0001',
      label: 'Day',
      logicalType: 'integer',
    },
    {
      fieldId: '0198d970-e266-4000-8000-0000000f0002',
      label: 'Titre',
      logicalType: 'decimal',
    },
  ],
}) as AssistDraftProposal

const meta = {
  title: 'Assistant/Draft proposal panel',
  component: DraftProposalPanel,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { proposal: TEXT, onAccept: () => {}, onDiscard: () => {} },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DraftProposalPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A notebook text draft, inserted as an ordinary text block on Accept. */
export const NotebookText: Story = {}

/** Import column mapping suggestions with a confidence and a reason each. */
export const ImportMapping: Story = { args: { proposal: MAPPING } }

/** A chart configuration, loaded into the configurator on Accept. */
export const ChartConfig: Story = { args: { proposal: CHART } }

export const WithPhrasing: Story = {
  args: {
    phrasing: {
      model: 'workspace-model',
      assistance: true,
      text: 'Titre dropped slightly over the second week.',
    },
  },
}

export const Accepting: Story = { args: { accepting: true } }

export const CustomAcceptLabel: Story = {
  args: { acceptLabel: 'Add to notebook' },
}
