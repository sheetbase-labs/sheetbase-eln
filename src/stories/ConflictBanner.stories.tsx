import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ConflictBanner } from '#/components/notebook/conflict-banner'

/**
 * Shown when a block's save lost a race: the reader's edits are preserved and
 * the canonical server value is stated, with both resolutions offered.
 */
const meta = {
  title: 'Notebook/Conflict banner',
  component: ConflictBanner,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    message:
      'This block was updated elsewhere while you were editing. Your version has not been saved.',
    serverPreview:
      'Cells were incubated at 37 °C for 24 hours, then harvested at 72 h.',
    onUseServer: () => {},
    onKeepLocal: () => {},
  },
} satisfies Meta<typeof ConflictBanner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** While the retry save is in flight both actions are held. */
export const Retrying: Story = { args: { retrying: true } }

/** A long server preview scrolls inside the banner instead of growing it. */
export const LongServerPreview: Story = {
  args: {
    serverPreview: Array.from(
      { length: 12 },
      (_, index) => `Row ${index + 1}: 0.0${index} OD₆₀₀ at ${index * 2} h`,
    ).join('\n'),
  },
}
