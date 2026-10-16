import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CorrectiveActionsPreview } from '#/components/notebook/action-block-previews'

/**
 * R5-NOTE-02 corrective-and-preventive-actions block. Each item carries its
 * own status, so the preview's job is to state an overdue or unowned action
 * as it stands.
 */
const items = [
  {
    id: 'CAPA-1',
    action: 'Repeat the reading at 1:5 dilution',
    ownerUserId: 'u-1',
    ownerName: 'Gareth P.',
    due: '2026-10-03',
    status: 'complete',
  },
  {
    id: 'CAPA-2',
    action: 'Re-calibrate the plate reader before the next run',
    ownerUserId: 'u-2',
    ownerName: 'Priya Raman',
    due: '2026-10-18',
    status: 'in-progress',
  },
  {
    id: 'CAPA-3',
    action: 'Brief the team on the revised dilution step',
    ownerUserId: null,
    ownerName: null,
    due: null,
    status: 'open',
  },
]

const meta = {
  title: 'Notebook/Corrective actions preview',
  component: CorrectiveActionsPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { payload: { items } },
} satisfies Meta<typeof CorrectiveActionsPreview>
export default meta
type Story = StoryObj<typeof meta>

/** Complete, in progress and open actions in one block. */
export const Default: Story = {}

/** The block a picker insertion leaves: no actions yet. */
export const Empty: Story = { args: { payload: { items: [] } } }

/** An action without an owner or a due date states both as absent. */
export const Unowned: Story = {
  args: { payload: { items: items.slice(2) } },
}

/** A long action description wraps rather than truncating the row. */
export const LongAction: Story = {
  args: {
    payload: {
      items: [
        {
          id: 'CAPA-4',
          action:
            'Repeat the titration with a freshly prepared standard curve and record the instrument calibration status in the notebook before the next stability withdrawal',
          ownerUserId: 'u-3',
          ownerName: 'Marco Silva',
          due: '2026-11-02',
          status: 'in-progress',
        },
      ],
    },
  },
}
