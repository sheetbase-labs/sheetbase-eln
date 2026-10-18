import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { MilestoneTimeline } from '#/components/v3/projects/milestone-timeline'
import type {
  PlanDependency,
  PlanMilestone,
  PlanPhase,
} from '#/components/v3/projects/milestone-timeline'

/**
 * The project plan timeline (`src/components/v3/projects/milestone-timeline.tsx`).
 *
 * It draws real milestone dates and real dependency edges: phase bands, a today
 * marker, client-visible rings, and risk colours that follow the risk read
 * model. The stories fix `now` so the today marker and the window are the same
 * on every render; a milestone with no date, and a plan with no dated milestone
 * at all, are the two states the component itself declines to draw.
 */
const meta = {
  title: 'Projects/Milestone timeline',
  component: MilestoneTimeline,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MilestoneTimeline>
export default meta
type Story = StoryObj<typeof meta>

const NOW = Date.parse('2026-10-17T09:00:00.000Z')

const weeks = (count: number) => NOW + count * 7 * 24 * 60 * 60 * 1000

const phases: PlanPhase[] = [
  { id: 'ph-1', name: 'Analytical development' },
  { id: 'ph-2', name: 'In vivo' },
]

function milestone(
  overrides: Partial<PlanMilestone> & { id: string },
): PlanMilestone {
  return {
    title: 'Milestone',
    dueAt: new Date(weeks(2)).toISOString(),
    status: 'in_progress',
    risk: 'on_track',
    clientVisible: false,
    workstreamId: 'ph-1',
    ...overrides,
  }
}

const milestones: PlanMilestone[] = [
  milestone({
    id: 'm-1',
    title: 'Method transferred',
    dueAt: new Date(weeks(-6)).toISOString(),
    status: 'completed',
    risk: 'done',
    clientVisible: true,
  }),
  milestone({
    id: 'm-2',
    title: 'Week-12 readout',
    dueAt: new Date(weeks(1)).toISOString(),
    status: 'in_progress',
    risk: 'at_risk',
  }),
  milestone({
    id: 'm-3',
    title: 'Stability report',
    dueAt: new Date(weeks(-1)).toISOString(),
    status: 'in_progress',
    risk: 'late',
    workstreamId: 'ph-2',
    clientVisible: true,
  }),
  milestone({
    id: 'm-4',
    title: 'Dose selection',
    dueAt: new Date(weeks(5)).toISOString(),
    status: 'not_started',
    risk: 'unknown',
    workstreamId: 'ph-2',
  }),
  // No due date: the timeline draws only dated milestones.
  milestone({ id: 'm-5', title: 'Not scheduled yet', dueAt: null }),
]

const dependencies: PlanDependency[] = [
  { id: 'dep-1', predecessorId: 'm-1', successorId: 'm-2' },
  { id: 'dep-2', predecessorId: 'm-2', successorId: 'm-4' },
]

const noop = () => {}

const baseArgs = {
  milestones,
  phases,
  dependencies,
  scale: 'month' as const,
  onScaleChange: noop,
  selectedId: null,
  onSelect: noop,
  now: NOW,
}

/** Month scale: phase bands, today marker, client-visible rings and elbows. */
export const MonthScale: Story = {
  decorators: [
    (Story) => (
      <div className="w-[900px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: baseArgs,
}

/** Week scale, with one milestone selected as a click leaves it. */
export const WeekScaleSelected: Story = {
  decorators: [
    (Story) => (
      <div className="w-[900px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { ...baseArgs, scale: 'week', selectedId: 'm-2' },
}

/** No milestone has a date yet, so there is nothing to draw: the contract is silence. */
export const NothingDated: Story = {
  args: {
    ...baseArgs,
    milestones: [milestone({ id: 'm-9', title: 'Unscheduled', dueAt: null })],
    dependencies: [],
  },
}
