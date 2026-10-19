import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProjectsPage } from '#/components/v3/projects/projects-page'
import { projectAccessQueryKey } from '#/components/v3/projects/project-access'
import type { ProjectRow } from '#/components/v3/projects/types'
import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The Projects screen (`src/components/v3/projects/projects-page.tsx`), wired
 * to the props the route passes.
 *
 * The screen's own reads are the caller's role, whether the person can see any
 * project at all (`projectAccessQueryKey`), and the per-project counts behind
 * each row; the stories seed those so the loaded, loading, empty, denied and
 * failed states are all reachable. "No projects" and "no projects you can
 * access" are deliberately different screens, and both are here.
 */
const ME_ID = '0198d970-e266-4000-8000-00000000m001'

const noop = () => {}

const meta = {
  title: 'Projects/Projects screen',
  component: ProjectsPage,
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/projects', [
          '/projects/$projectId',
          '/records/$recordId',
          '/experiments/$expId',
        ]),
        path: '/projects',
      },
    },
  },
  args: {
    me: 'Ada Scientist',
    meId: ME_ID,
    search: {},
    setSearch: noop,
    onCreate: noop,
    onOpenProject: noop,
    onRetry: noop,
  },
} satisfies Meta<typeof ProjectsPage>

export default meta
type Story = StoryObj<typeof meta>

const roleKey = ['workspace', 'my-role', ME_ID] as const

/**
 * A story's client. Every read the screen performs has to be either seeded or
 * held: the screen supplies its own `queryFn` for both of them, so an unseeded
 * key runs that function and leaves the page — the static server answers 404,
 * which renders the failure state where the story asked for its own.
 */
function client(
  seeds: ReadSeed[],
  held?: { key: readonly unknown[]; read: 'pending' | 'error' },
) {
  const instance = screenQueryClient({ data: seeds })
  if (held) holdRead(instance, held.key, held.read)
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={instance}>
      <Story />
    </QueryClientProvider>
  )
}

const assigned = [{ projectId: 'prj-1', role: 'editor' }]

const projects: ProjectRow[] = [
  {
    uuid: '0198d970-e266-4000-8000-00000000p001',
    id: 'PRJ-0041',
    name: 'AAV9 stability programme',
    client: 'Internal',
    modality: 'Gene therapy',
    stage: 'In vivo',
    lead: 'Ada Scientist',
    leadUserId: ME_ID,
    revision: 'rev 12',
    experiments: 8,
    status: { tone: 'progress', label: 'In progress' },
    updated: Date.parse('2026-10-14T09:00:00.000Z'),
    milestone: 'Week-12 readout',
    memberSummary: '4 members',
  },
  {
    uuid: '0198d970-e266-4000-8000-00000000p002',
    id: 'PRJ-0042',
    name: 'Lentiviral titre comparability',
    client: 'Northwind Biologics',
    modality: 'Cell therapy',
    stage: 'Analytical',
    lead: 'Marco Silva',
    revision: 'rev 3',
    experiments: 2,
    status: { tone: 'review', label: 'In review' },
    updated: Date.parse('2026-10-11T14:20:00.000Z'),
    milestone: 'Method transfer',
    memberSummary: '3 members',
    clientAccess: 'Client-visible summary',
  },
  {
    uuid: '0198d970-e266-4000-8000-00000000p003',
    id: 'PRJ-0033',
    name: 'Buffer screening (closed)',
    client: 'Internal',
    modality: 'Small molecule',
    stage: 'Formulation',
    lead: 'Priya Raman',
    experiments: 11,
    status: { tone: 'stored', label: 'Archived' },
    archived: true,
    updated: Date.parse('2026-06-02T08:00:00.000Z'),
  },
]

/** The board with three projects, their stage, lead, counts and status. */
export const Loaded: Story = {
  decorators: [
    client([
      { key: projectAccessQueryKey, value: assigned },
      { key: roleKey, value: { role: 'owner' } },
    ]),
  ],
  args: { projects },
}

/** Reading the board: the loading line replaces the rows, not the chrome. */
export const Loading: Story = {
  decorators: [
    client([{ key: roleKey, value: { role: 'owner' } }], {
      key: projectAccessQueryKey,
      read: 'pending',
    }),
  ],
  args: { projects: [], loading: true },
}

/** The workspace holds no project this person can see: no create, no rows. */
export const Empty: Story = {
  decorators: [
    client([
      { key: projectAccessQueryKey, value: assigned },
      { key: roleKey, value: { role: 'owner' } },
    ]),
  ],
  args: { projects: [] },
}

/**
 * Access, not absence: the empty list says the person can see no project and
 * who manages that, rather than claiming the workspace has none.
 */
export const NoProjectAccess: Story = {
  decorators: [
    client([
      { key: projectAccessQueryKey, value: [] },
      { key: roleKey, value: { role: 'viewer' } },
    ]),
  ],
  args: { projects: [], canCreate: false },
}

/** A role that cannot create: the control is disabled and says why. */
export const CannotCreate: Story = {
  decorators: [
    client([
      { key: projectAccessQueryKey, value: assigned },
      { key: roleKey, value: { role: 'viewer' } },
    ]),
  ],
  args: { projects: projects.slice(0, 1), canCreate: false },
}

/** The read failed: the screen says so and offers the retry it was handed. */
export const Failed: Story = {
  decorators: [
    client([{ key: roleKey, value: { role: 'owner' } }], {
      key: projectAccessQueryKey,
      read: 'error',
    }),
  ],
  args: { projects: [], error: 'The workspace connection failed.' },
}
