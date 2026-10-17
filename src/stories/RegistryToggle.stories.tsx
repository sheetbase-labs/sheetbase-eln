import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Toggle } from '#/components/reui/toggle'
import { Icon } from '#/components/v3/icons'

/**
 * The stock shadcn `toggle` item. It is here as `toggle-group`'s registry
 * dependency and as the pressed-state candidate for comparison pair
 * `pressed-chips`; it is not a ReUI item.
 *
 * Row 17 of `docs/knowledge/design/component-comparison-record.md` declined the
 * pair: the shipped chip row already passes all eight applicable checklist
 * items, and the item's single tab stop on a `role="toolbar"` container is a
 * role change we would have to reason about. The story stays so the declined
 * candidate is reviewable in the repository.
 */
const meta = {
  title: 'UI/Registry toggle',
  component: Toggle,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline'] },
    size: { control: 'inline-radio', options: ['sm', 'default', 'lg'] },
  },
} satisfies Meta<typeof Toggle>
export default meta
type Story = StoryObj<typeof meta>

/** Unpressed and pressed, which is the whole of the item's state model. */
export const Default: Story = {
  args: { children: 'Bold' },
}

export const Pressed: Story = {
  args: { children: 'Bold', defaultPressed: true },
}

/** The two variants the item publishes, at the three sizes. */
export const VariantsAndSizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      {(['sm', 'default', 'lg'] as const).map((size) => (
        <div key={size} className="flex items-center gap-2">
          <Toggle size={size}>Default</Toggle>
          <Toggle size={size} variant="outline">
            Outline
          </Toggle>
          <Toggle size={size} defaultPressed>
            Pressed
          </Toggle>
        </div>
      ))}
    </div>
  ),
}

/** With an icon, which is the shape a toolbar would use. */
export const WithIcon: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Toggle size="sm" aria-label="Bold">
        <Icon name="edit" size={14} />
      </Toggle>
      <Toggle size="sm" variant="outline" defaultPressed aria-label="Comment">
        <Icon name="comment" size={14} />
      </Toggle>
      <Toggle size="sm" disabled aria-label="Lock">
        <Icon name="lock" size={14} />
      </Toggle>
    </div>
  ),
}
