import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CapabilityGap, RoadmapChip } from '#/components/v3/ui/capability-gap'

/**
 * The honest state for an area whose capability is not built in this deployment
 * yet. It is not an error and not an empty state: nothing is missing from
 * anyone's records, the area simply is not switched on. It says what the area
 * will do, what to use today instead, and — for admins only — the roadmap item
 * that tracks it.
 */
const meta = {
  title: 'v3 kit/Capability gap',
  component: CapabilityGap,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'Study scheduling',
    will: 'Studies will be planned as a sequence of runs with their own timing, dependencies and approval points.',
  },
} satisfies Meta<typeof CapabilityGap>
export default meta
type Story = StoryObj<typeof meta>

const INSTEAD = [
  {
    label: 'Experiments',
    link: { to: '/experiments' as const },
    note: 'Every run, with its design and its record.',
  },
  {
    label: 'Datasets',
    link: { to: '/datasets' as const },
    note: 'The readings themselves, with their snapshots.',
  },
]

/** The page form, with the alternatives it can offer today. */
export const Page: Story = {
  args: {
    title: 'Study scheduling',
    will: 'Studies will be planned as a sequence of runs with their own timing, dependencies and approval points.',
    instead: INSTEAD,
    icon: 'calendar',
  },
}

/** The inline form, for a panel or inspector that has one thing missing. */
export const Inline: Story = {
  args: {
    title: 'Plate maps',
    will: 'A plate map will show the layout of a plate and which well each reading came from.',
    instead: [
      {
        label: 'Open the dataset',
        link: { to: '/datasets' as const },
      },
    ],
    icon: 'box',
    variant: 'inline',
  },
}

/** An admin sees the roadmap item; a client never does. */
export const AdminWithRoadmap: Story = {
  args: {
    title: 'Study scheduling',
    will: 'Studies will be planned as a sequence of runs with their own timing, dependencies and approval points.',
    instead: INSTEAD,
    icon: 'calendar',
    roadmap: 'RM-112',
    admin: true,
  },
}

/** With no alternative destination, the gap still explains itself. */
export const NoAlternatives: Story = {
  args: {
    title: 'Automated review assignment',
    will: 'Reviewers will be assigned from the group that owns the area, with an escalation path when nobody claims it.',
    icon: 'user',
  },
}

/** The roadmap chip on its own, for a footnote or a release note. */
export const Chip: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <RoadmapChip id="RM-112" />
      <RoadmapChip id="RM-207" className="opacity-60" />
    </div>
  ),
}
