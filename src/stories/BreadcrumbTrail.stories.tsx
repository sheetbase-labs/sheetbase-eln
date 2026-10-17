import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Breadcrumb } from '#/components/v3/ui/breadcrumb'

/**
 * The trail at the top of a page, which `PageHeader` renders for its `trail`
 * prop and the help articles render in their own header.
 *
 * Before this, the trail was markup each screen composed: 12 screens spelled
 * their own `/` separator, so the accessibility tree read the crumb line as one
 * run of text with the separator as content, and no screen marked the crumb it
 * was standing on. The stories below are the shapes that exist in the app — one
 * crumb, a section and an identifier, three levels with two links — because the
 * semantics are the point and they are visible in the roles, the separator and
 * the `aria-current`.
 */
const meta = {
  title: 'v3 kit/Breadcrumb trail',
  component: Breadcrumb,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Breadcrumb>
export default meta
type Story = StoryObj<typeof meta>

/** A one-crumb trail, as the loading and not-found states of a page pass. */
export const OneCrumb: Story = {
  args: { trail: [{ label: 'Models' }] },
}

/** A section and the record inside it — the shape 12 screens hand-spelled. */
export const SectionAndIdentifier: Story = {
  args: {
    trail: [
      { label: 'Projects', link: { to: '/projects' } },
      { label: 'PROJ-0007', mono: true },
    ],
  },
}

/** Three levels, two of them links, as the model draft editor passes. */
export const ThreeLevels: Story = {
  args: {
    trail: [
      { label: 'Models', link: { to: '/models' } },
      {
        label: 'Clarification run',
        link: { to: '/models/$modelId', params: { modelId: 'clarification' } },
      },
      { label: 'Draft' },
    ],
  },
}
