import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PlannerTimeline } from '#/components/planner/planner-timeline'

const workstreams: any[] = [
  { id: 'ws1', name: 'Assay development', color: 'var(--primary)', status: 'active' },
  { id: 'ws2', name: 'Stability', color: 'var(--success)', status: 'active' },
]
const task = (
  id: string,
  title: string,
  workstreamId: string | null,
  status: string,
  start: string,
  end: string,
  progressPercent: number,
  taskType = 'task',
) => ({
  id,
  title,
  workstreamId,
  status,
  startsAt: start,
  endsAt: end,
  dueAt: end,
  progressPercent,
  taskType,
  assignments: [{ role: 'assignee', displayName: 'Ava Chen' }],
  deliverables: [],
  priority: 'medium',
  tags: [],
  resources: [],
})
const tasks: any[] = [
  task(
    '1',
    'Optimize primer panel',
    'ws1',
    'in_progress',
    '2026-07-20',
    '2026-08-07',
    65,
  ),
  task(
    '2',
    'Qualification run',
    'ws1',
    'review',
    '2026-08-03',
    '2026-08-14',
    85,
  ),
  task(
    '3',
    '28-day stability readout',
    'ws2',
    'not_started',
    '2026-08-10',
    '2026-09-04',
    0,
  ),
  task(
    '4',
    'Method locked',
    null,
    'completed',
    '2026-08-21',
    '2026-08-21',
    100,
    'milestone',
  ),
]
const meta = {
  title: 'Planner/Planner timeline',
  component: PlannerTimeline,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    tasks,
    workstreams,
    dependencies: [{ id: 'd1', predecessorId: '1', successorId: '2' }] as any,
    selectedTaskId: '2',
    onSelectTask: () => {},
  },
} satisfies Meta<typeof PlannerTimeline>
export default meta
type Story = StoryObj<typeof meta>
export const StudyPlan: Story = {}
export const Empty: Story = {
  args: { tasks: [], workstreams: [], dependencies: [] },
}
