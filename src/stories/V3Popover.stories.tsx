import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/v3/ui/popover'

/**
 * A small panel anchored to its trigger, dismissed by Esc or an outside click.
 * It is for a setting you change in place; a decision that needs a footer and a
 * title is a Dialog, and a list of commands is a DropdownMenu.
 *
 * The legacy `UI/Popover` story covers `src/components/ui/popover.tsx`.
 */
const meta = {
  title: 'v3 kit/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Popover>
export default meta
type Story = StoryObj<typeof meta>

/** Aligned to the end of its trigger, the default for a toolbar control. */
export const Default: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button />}>Columns</PopoverTrigger>
      <PopoverContent>
        <div className="flex w-[240px] flex-col gap-1.5 p-3">
          <PopoverTitle className="font-heading text-title">
            Visible columns
          </PopoverTitle>
          {['Identifier', 'Load', 'Step yield', 'r²'].map((column, index) => (
            <label
              key={column}
              className="flex cursor-pointer items-center gap-2 text-body"
            >
              <input type="checkbox" defaultChecked={index < 3} />
              {column}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  ),
}

/** Opened below and aligned to the start, for a control at the left of a row. */
export const SideAndAlign: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button icon="settings" />} />
      <PopoverContent align="start" sideOffset={8}>
        <div className="w-[260px] p-3">
          <PopoverTitle className="font-heading text-title">
            Chart settings
          </PopoverTitle>
          <p className="mb-0 mt-1 text-caption text-fg-muted">
            Applies to this block only. The dataset keeps its own units.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

/** Closed, as the toolbar renders it until the control is used. */
export const ClosedByDefault: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button />}>Filters</PopoverTrigger>
      <PopoverContent>
        <div className="w-[240px] p-3 text-body">Nothing picked yet</div>
      </PopoverContent>
    </Popover>
  ),
}
