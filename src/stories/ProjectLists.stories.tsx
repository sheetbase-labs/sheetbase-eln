import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { MobileList } from '#/components/v3/projects/mobile-list'
import type { MobileRow } from '#/components/v3/projects/mobile-list'
import {
  ProjectList,
  ProjectListFailure,
  ProjectListOutOfRange,
} from '#/components/v3/projects/project-list'
import { DataClientError } from '#/lib/data-client'
import { screenRoutes } from './screen-stories'

/**
 * A project tab's list and its phone form (`src/components/v3/projects/`).
 *
 * `project-list.tsx` renders one kind of a project's own records — desktop
 * table, phone rows — and owns the three honest states around it: nothing yet,
 * a page past the end of the list, and a read that failed or was refused.
 * `mobile-list.tsx` is the phone row itself, used here and by the project
 * Overview lists.
 */
const meta = {
  title: 'Projects/Project lists',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        // Project rows link to their record; the out-of-range notice links back.
        route: screenRoutes('/projects/$projectId', ['/records/$recordId']),
        path: '/projects/$projectId',
        params: { projectId: 'prj-1' },
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[900px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

type ExperimentRow = {
  key: string
  id: string
  title: string
  status: string
  owner: string
}

const rows: ExperimentRow[] = [
  {
    key: 'e1',
    id: 'EXP-2026-0041',
    title: 'Week-12 readout',
    status: 'In progress',
    owner: 'Ada Scientist',
  },
  {
    key: 'e2',
    id: 'EXP-2026-0038',
    title: 'Freeze–thaw stability',
    status: 'In review',
    owner: 'Marco Silva',
  },
]

const cols = [
  { key: 'id', label: 'ID', cell: (row: ExperimentRow) => row.id },
  { key: 'title', label: 'Title', cell: (row: ExperimentRow) => row.title },
  { key: 'status', label: 'Status', cell: (row: ExperimentRow) => row.status },
  { key: 'owner', label: 'Owner', cell: (row: ExperimentRow) => row.owner },
]

const mobile: MobileRow[] = [
  {
    key: 'e1',
    title: 'Week-12 readout',
    meta: 'EXP-2026-0041 · Ada Scientist',
    status: { tone: 'progress', label: 'In progress' },
  },
  {
    key: 'e2',
    title: 'Freeze–thaw stability',
    meta: 'EXP-2026-0038 · Marco Silva',
    status: { tone: 'review', label: 'In review' },
  },
]

/** Both forms of the same list: the table above md, the stacked rows below. */
export const WithRows: Story = {
  render: () => (
    <ProjectList
      title="Experiments"
      count={rows.length}
      cols={cols}
      rows={rows}
      mobile={mobile}
      empty={{ title: 'No experiments yet', body: 'Create one to begin.' }}
    />
  ),
}

/** Nothing yet, with the one action the tab's reason implies. */
export const Empty: Story = {
  render: () => (
    <ProjectList
      title="Experiments"
      count={0}
      cols={cols}
      rows={[]}
      mobile={[]}
      empty={{
        icon: 'flask',
        title: 'No experiments yet',
        body: 'An experiment records the work; its results and samples hang off it.',
        action: <Button variant="primary">New experiment</Button>,
      }}
    />
  ),
}

/** A `?page=` past the end of the list: not an empty project, a bad address. */
export const PageOutOfRange: Story = {
  render: () => (
    <ProjectListOutOfRange
      total={41}
      label="experiments"
      link={{ to: '/projects/$projectId', params: { projectId: 'prj-1' } }}
    />
  ),
}

/** A read the workspace refuses: who to ask, with no retry that could not work. */
export const Denied: Story = {
  render: () => (
    <ProjectListFailure
      error={new DataClientError('permission_denied', 'Permission denied', 403)}
      onRetry={() => {}}
      what="this project's experiments"
    />
  ),
}

/** Any other failure: the retry, and the fact that nothing was substituted. */
export const Failed: Story = {
  render: () => (
    <ProjectListFailure
      error={new Error('The workspace connection failed.')}
      onRetry={() => {}}
      what="this project's experiments"
    />
  ),
}

/** The phone row on its own: selected, linked, and with no status at all. */
export const MobileRows: Story = {
  render: () => (
    <div className="w-[390px] border-y border-border">
      <MobileList
        label="Experiments"
        rows={[
          mobile[0],
          mobile[1],
          {
            key: 'e3',
            title: 'Buffer screening',
            meta: 'EXP-2026-0030',
            status: { tone: 'stored', label: 'Archived' },
          },
          { key: 'e4', title: 'No status recorded yet' },
        ]}
      />
    </div>
  ),
}

/** Several rows marked selected, as a bulk action shows them. */
export const MobileRowsSelected: Story = {
  render: () => (
    <div className="w-[390px] border-y border-border">
      <MobileList
        label="Experiments"
        rows={[
          { ...mobile[0], selected: true },
          { ...mobile[1], selected: true, status: undefined },
        ]}
      />
    </div>
  ),
}
