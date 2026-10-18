import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AddPropertyLink } from '#/components/record/inspector-sections'

/** The trailing action of a properties section; it never owns the write. */
const meta = {
  title: 'Record/Inspector sections/Add property link',
  component: AddPropertyLink,
  tags: ['autodocs'],
  args: { onClick: () => {} },
} satisfies Meta<typeof AddPropertyLink>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Without a handler it renders as a non-interactive affordance. */
export const NoHandler: Story = { args: { onClick: undefined } }

/** Under a real property list, which is where it appears in the product. */
export const UnderProperties: Story = {
  render: (args) => (
    <div className="w-72 space-y-2">
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">ID</dt>
          <dd>EXP-2026-0042</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Protocol</dt>
          <dd>PRT-2026-0012</dd>
        </div>
      </dl>
      <AddPropertyLink {...args} />
    </div>
  ),
}
