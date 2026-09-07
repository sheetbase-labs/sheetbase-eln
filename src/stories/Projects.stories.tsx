import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ProjectList } from '#/components/projects/project-list'

const projects = [
  {
    id: 'stability',
    key: 'vector-stability',
    title: 'Lentivector Stability Study',
    status: 'active',
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-07T10:00:00Z',
    lastActivityAt: '2026-09-07T10:00:00Z',
    experimentCount: 18,
  },
  {
    id: 'formulation',
    key: 'formulation-development',
    title: 'Formulation Development',
    status: 'active',
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-09-06T10:00:00Z',
    lastActivityAt: null,
    experimentCount: 0,
  },
]
const meta = {
  title: 'Projects/Project list',
  component: ProjectList,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    projects,
    isLoading: false,
    error: null,
    onRetry: () => {},
    recordCounts: { stability: 62, formulation: 0 },
  },
} satisfies Meta<typeof ProjectList>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Loading: Story = { args: { projects: [], isLoading: true } }
export const Empty: Story = { args: { projects: [] } }
export const Error: Story = {
  args: { error: new globalThis.Error('Unavailable') },
}
export const CountsUnavailable: Story = { args: { recordCounts: undefined } }
export const LongTitle: Story = {
  args: {
    projects: [
      {
        ...projects[0],
        title:
          'Lentivector formulation and long-term stability evaluation across refrigerated storage conditions and multiple manufacturing batches',
      },
    ],
  },
}
export const ManyProjects: Story = {
  args: {
    projects: Array.from({ length: 30 }, (_, i) => ({
      ...projects[i % 2],
      id: `project-${i}`,
      key: `study-${i + 1}`,
      title: `Stability programme — study ${i + 1}`,
    })),
  },
}

export const Archived: Story = {
  args: {
    projects: [
      ...projects,
      {
        ...projects[1],
        id: 'archived',
        key: 'completed-study',
        title: 'Completed stability study',
        status: 'archived',
      },
    ],
  },
}
