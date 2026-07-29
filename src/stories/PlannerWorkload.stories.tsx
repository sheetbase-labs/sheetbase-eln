import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PlannerWorkload } from '#/components/planner/planner-workload'
import type { StudyTask } from '#/lib/planner'

const task = (
  id: string,
  title: string,
  assignee: string,
  startsAt: string,
  endsAt: string,
  status: StudyTask['status'],
): StudyTask => ({
  id,
  title,
  startsAt,
  endsAt,
  status,
  workspaceId: 'workspace',
  workstreamId: null,
  projectId: null,
  description: null,
  taskType: 'task',
  priority: 'medium',
  dueAt: endsAt,
  timezone: 'UTC',
  position: 0,
  color: null,
  progressPercent: status === 'completed' ? 100 : 40,
  linkedExperimentRecordId: null,
  linkedExperimentIdentifier: null,
  linkedExperimentTitle: null,
  linkedProtocolRecordId: null,
  linkedProtocolIdentifier: null,
  approvalRequired: false,
  approvalStatus: 'not_required',
  tags: [],
  metadataVersion: 1,
  createdAt: startsAt,
  updatedAt: startsAt,
  assignments: [
    {
      id: `${id}-assignment`,
      taskId: id,
      userId: assignee.toLowerCase().replace(' ', '-'),
      displayName: assignee,
      role: 'assignee',
      effortPercent: 80,
      createdAt: startsAt,
    },
  ],
  resources: [],
  deliverables: [],
})
const tasks = [
  task(
    'task-1',
    'Prepare samples',
    'Alex Morgan',
    '2026-07-27T00:00:00Z',
    '2026-07-30T00:00:00Z',
    'completed',
  ),
  task(
    'task-2',
    'Run assay',
    'Jordan Kim',
    '2026-07-31T00:00:00Z',
    '2026-08-05T00:00:00Z',
    'in_progress',
  ),
  task(
    'task-3',
    'Analyse results',
    'Priya Shah',
    '2026-08-03T00:00:00Z',
    '2026-08-10T00:00:00Z',
    'not_started',
  ),
]
const meta = {
  title: 'Features/PlannerWorkload',
  component: PlannerWorkload,
  tags: ['autodocs'],
  args: {
    tasks,
    timeZone: 'UTC',
    weekStart: new Date('2026-07-27T00:00:00Z'),
    weekCount: 3,
    selectedTaskId: null,
    onSelectTask: () => undefined,
  },
} satisfies Meta<typeof PlannerWorkload>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Selected: Story = { args: { selectedTaskId: 'task-2' } }
export const Empty: Story = { args: { tasks: [] } }
