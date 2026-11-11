import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProjectPeek } from '#/components/projects/project-peek'
import { projectListQueryKeys } from '#/components/projects/project-lists'
import type { ProjectRow } from '#/components/projects/types'
import { screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The Projects list's side panel: the selected project's details, its latest
 * experiments and what changed lately. Its reads (members, milestones,
 * experiments, activity) are seeded here, so each state is a still frame.
 */
const UUID = '0198d970-e266-4000-8000-000000000320'

const PROJECT: ProjectRow = {
  uuid: UUID,
  id: 'PRJ-0217',
  name: 'AAV9 process transfer',
  client: 'CL-017',
  modality: 'AAV9',
  stage: 'Tech transfer',
  lead: 'Ada S.',
  experiments: 2,
  status: { tone: 'progress', label: 'In progress' },
  started: '2026-08-03',
  updated: Date.parse('2026-11-01T09:00:00.000Z'),
}

const SEEDS: ReadSeed[] = [
  {
    key: ['project-members', UUID],
    value: [
      {
        user_id: 'u1',
        name: 'Ada S.',
        access_level: 'write',
        workspace_role: null,
        project_role: null,
        is_lead: true,
        added_at: '2026-08-03',
      },
      {
        user_id: 'u2',
        name: 'Priya S.',
        access_level: 'write',
        workspace_role: null,
        project_role: null,
        is_lead: false,
        added_at: '2026-08-04',
      },
    ],
  },
  { key: ['ui-port', 'project-milestones', UUID], value: [] },
  {
    key: projectListQueryKeys.experiments(UUID, 0),
    value: {
      page: 0,
      total: 2,
      rows: [
        {
          id: 'exp-1',
          project_id: UUID,
          identifier: 'EXP-0142',
          title: 'Harvest clarification',
          status: 'in_progress',
          created_by_user_id: 'u1',
          created_at: '2026-09-01T09:00:00Z',
          updated_at: '2026-09-02T09:00:00Z',
        },
        {
          id: 'exp-2',
          project_id: UUID,
          identifier: 'EXP-0138',
          title: 'Transfection ratio sweep',
          status: 'in_review',
          created_by_user_id: 'u2',
          created_at: '2026-08-20T09:00:00Z',
          updated_at: '2026-08-21T09:00:00Z',
        },
      ],
    },
  },
  { key: ['project-activity', UUID], value: [] },
]

function seeded(seeds: ReadSeed[]) {
  const client = screenQueryClient({ data: seeds })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="flex h-[640px] justify-end">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Projects/Project side panel',
  component: ProjectPeek,
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/projects', [
          '/projects/$projectId',
          '/experiments/$expId',
        ]),
        path: '/projects',
      },
    },
  },
  args: { project: PROJECT, onClose: () => {} },
  decorators: [seeded(SEEDS)],
} satisfies Meta<typeof ProjectPeek>

export default meta

type Story = StoryObj<typeof meta>

/** A project with members and two experiments. */
export const Default: Story = {}

/** Nothing made yet: the experiments list says so. */
export const NoExperiments: Story = {
  decorators: [
    seeded([
      ...SEEDS.filter(
        (seed) => seed.key[0] !== 'ui-port' || seed.key[1] !== 'project-lists',
      ),
      {
        key: projectListQueryKeys.experiments(UUID, 0),
        value: { page: 0, total: 0, rows: [] },
      },
    ]),
  ],
  args: { project: { ...PROJECT, experiments: 0 } },
}
