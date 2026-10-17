import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Kbd } from '#/components/v3/ui/kbd'

/**
 * The forward kit's key cap. It sets a key's name in mono at caption size; the
 * surrounding sentence carries the meaning, so the element stays a plain
 * `<kbd>` with no role of its own.
 *
 * The legacy `UI/Kbd` story in `Kbd.stories.tsx` covers
 * `src/components/ui/kbd.tsx`, a same-named Radix-era file with zero call
 * sites. This is the one screens compose.
 */
const meta = {
  title: 'v3 kit/Kbd',
  component: Kbd,
  tags: ['autodocs'],
} satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: '⌘K' } }

/** Modifier combinations, written as the prompt line writes them. */
export const Combinations: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      <p>
        Open search <Kbd>⌘K</Kbd>
      </p>
      <p>
        Insert a block <Kbd>/</Kbd>
      </p>
      <p>
        Save the block <Kbd>⌘</Kbd> <Kbd>↵</Kbd>
      </p>
      <p>
        Show shortcuts <Kbd>?</Kbd>
      </p>
    </div>
  ),
}

/** The one-word form used inside a menu row. */
export const InAMenuRow: Story = {
  render: () => (
    <div className="w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-overlay">
      <div className="flex h-[30px] items-center gap-2 rounded-sm px-2 text-body">
        <span className="flex-1">Duplicate block</span>
        <Kbd>⌘D</Kbd>
      </div>
      <div className="flex h-[30px] items-center gap-2 rounded-sm px-2 text-body">
        <span className="flex-1">Delete block</span>
        <Kbd>⌫</Kbd>
      </div>
    </div>
  ),
}
