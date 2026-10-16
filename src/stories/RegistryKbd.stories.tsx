import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Kbd, KbdGroup } from '#/components/reui/kbd'

/**
 * The vendored stock-shadcn `kbd` copy (ADR-0055; `src/components/reui/`).
 *
 * It is a candidate, not an adoption: the comparison record
 * (`docs/knowledge/design/component-comparison-record.md`, row 4) declines it in
 * favour of the v3 `Kbd`, and the story stays because the code is in the tree
 * and the harness pair (`src/components/component-compare/pairs/shortcut-keys.tsx`)
 * renders it.
 */
const meta = {
  title: 'UI/RegistryKbd',
  component: Kbd,
  tags: ['autodocs'],
  args: { children: 'K' },
} satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Chord: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>⇧</Kbd>
      <Kbd>P</Kbd>
    </KbdGroup>
  ),
}
