import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PageHeader } from '#/components/v3/ui/layout'

/**
 * The page header and the trail it renders.
 *
 * `PageHeader` takes the trail as data now (`trail`), not as markup: 24 files
 * passed a `crumbs` node, 12 of them hand-spelling the separator, and none of
 * them produced `ol`/`li` or an `aria-current` on the crumb it was standing on.
 * The trail is `Breadcrumb`'s job; these stories are the header around it —
 * with actions, with metadata, with a tab strip, and at the nested heading
 * level the client portal uses.
 */
const meta = {
  title: 'v3 kit/Page header',
  component: PageHeader,
  parameters: { layout: 'fullscreen' },
  args: {
    trail: [
      { label: 'Projects', link: { to: '/projects' } },
      { label: 'LVV stability, 2–8 °C hold', mono: true },
    ],
    title: 'Experiments',
  },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

/** The trail, the title and the page's own controls. */
export const Default: Story = {}

/** Metadata under the title: status, counts, identifiers. */
export const WithMeta: Story = {
  args: {
    meta: (
      <>
        <span>18 experiments</span>
        <span>Updated 2 hours ago</span>
      </>
    ),
  },
}

/** A nested header, one heading level down, as the client portal renders it. */
export const NestedLevel: Story = {
  args: {
    title: 'ACME-01',
    titleLevel: 2,
    trail: [
      { label: 'Client portal', link: { to: '/' } },
      { label: 'ACME-01' },
    ],
  },
}

/** No trail at all: a screen whose location the header does not state. */
export const WithoutTrail: Story = {
  args: { trail: undefined, title: 'Foundations' },
}
