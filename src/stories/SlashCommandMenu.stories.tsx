import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SlashCommandMenu } from '#/components/notebook/slash-command-menu'

/**
 * The “/” block picker inside the rich-text editor. It is fully controlled:
 * the editor owns the typed query and the highlighted index, and the menu
 * renders the filtered options for them.
 */
const meta = {
  title: 'Notebook/Slash command menu',
  component: SlashCommandMenu,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="relative h-[360px] w-[420px] rounded-md border border-dashed border-border p-4">
        <Story />
      </div>
    ),
  ],
  args: { query: '', selectedIndex: 0, onSelect: () => {} },
} satisfies Meta<typeof SlashCommandMenu>
export default meta
type Story = StoryObj<typeof meta>

/** Every block type, with the first option highlighted. */
export const AllOptions: Story = {}

/** A typed prefix narrows the list; the highlight follows it. */
export const Filtered: Story = { args: { query: 'tab', selectedIndex: 0 } }
