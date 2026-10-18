import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'

/**
 * The one empty state (DESIGN.md, Application states: say what is absent and
 * offer one relevant next action).
 *
 * The variants the product meets: the standard form with an icon, a title, a
 * description and one action; the compact form the Home panels use; the
 * nothing-matching form, whose action clears the search; the not-allowed form,
 * which says who to ask instead of offering an action; and the rare custom
 * leading visual, passed through `media`.
 */
const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: {
    icon: 'flask',
    title: 'No experiments yet',
    description: 'Create your first experiment to begin recording results.',
    action: <Button variant="primary">New experiment</Button>,
  },
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithoutIcon: Story = {
  args: {
    icon: undefined,
    title: 'Nothing worked on recently',
    description: 'Records you edit appear here.',
  },
}

/** Nothing matching: the action clears the filter rather than creating data. */
export const NothingMatching: Story = {
  args: {
    icon: 'search',
    title: 'No samples match “HL-0943”',
    description:
      'Search looks at ID, material, supplier, lot and location. Archived projects are not searched.',
    action: <Button>Clear search</Button>,
  },
}

/** Not allowed: no action — say who to ask, and offer what is still possible. */
export const NotAllowed: Story = {
  args: {
    icon: 'lock',
    title: 'You don’t have access to the instrument registry',
    description:
      'The registry is open to members of this workspace. Ask a workspace admin to add you.',
    action: (
      <Button nativeButton={false} render={<a href="#schedule" />}>
        Book an instrument instead
      </Button>
    ),
  },
}

/**
 * The custom leading visual, for the rare case an icon does not fit: a 28px
 * success mark, as the design's cleared-work empty state uses.
 */
export const WithMedia: Story = {
  args: {
    icon: undefined,
    media: <Icon name="check" size={28} className="text-success" />,
    title: 'Nothing needs you right now',
    description:
      'Reviews, signature requests, data issues and runs assigned to you will appear here.',
    action: <Button>See what you did today</Button>,
  },
}

/** The Home panels' density: no vertical padding, because the panel supplies it. */
export const Compact: Story = {
  args: {
    className: 'py-2',
    icon: undefined,
    title: 'Nothing awaiting your review',
    description: 'Submitted records assigned to you appear here.',
    action: undefined,
  },
}

/** A long scientific description wraps inside 440px and stays readable. */
export const LongDescription: Story = {
  args: {
    icon: 'box',
    title: 'No lots in quarantine',
    description:
      'Lots land here when a release check fails or a parent lot is quarantined, with the check that failed, the quantity held back and the person who quarantined it.',
    action: <Button>Review release checks</Button>,
  },
}

/** Every variant on one page, in light and dark. */
export const Variants: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <EmptyState
        icon="flask"
        title="No experiments yet"
        description="Create your first experiment to begin recording results."
        action={<Button variant="primary">New experiment</Button>}
      />
      <EmptyState
        icon="search"
        title="No samples match “HL-0943”"
        description="Search looks at ID, material, supplier, lot and location."
        action={<Button>Clear search</Button>}
      />
      <EmptyState
        icon="lock"
        title="Only workspace admins can see diagnostics"
        description="Ask a workspace admin for the failure counts and the recent error log."
      />
      <EmptyState
        className="py-2"
        title="Nothing worked on recently"
        description="Records you edit appear here."
      />
      <EmptyState
        media={<Icon name="check" size={28} className="text-success" />}
        title="Nothing needs you right now"
        description="Reviews and runs assigned to you appear here."
        action={<Button>See what you did today</Button>}
      />
      <EmptyState
        icon="box"
        title="No lots in quarantine"
        description="Lots land here when a release check fails or a parent lot is quarantined, with the check that failed and the quantity held back."
        action={<Button>Review release checks</Button>}
      />
    </div>
  ),
}
