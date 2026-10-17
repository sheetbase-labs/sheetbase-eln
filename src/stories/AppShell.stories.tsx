import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { AppShell } from '#/components/v3/shell/app-shell'
import { Button } from '#/components/v3/ui/button'
import { Muted, PageHeader } from '#/components/v3/ui/layout'
import type { Notification } from '#/components/v3/types'
import type { ShellCounts } from '#/lib/shell-counts.server'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * The application shell (`app-shell.tsx`): the top bar, the workspace switcher,
 * the notification bell, the New menu, the nav and the ⌘K palette.
 *
 * Every fact the shell renders arrives as the `data` prop — the root route
 * resolves it server-side — so the stories hand it a fixture and the shell
 * needs no read of its own to draw. Two reads do happen outside React Query and
 * are answered by `withApiReads`: the stored sidebar preference, and the ⌘K
 * palette's search, which only runs once the palette is opened.
 *
 * The main area is where the routed page renders; a story has no route behind
 * it, so these fill it with a page header and say so rather than claiming a
 * screen.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

/**
 * Every destination the shell links to: the nav, the New menu, the account
 * menu, the notification rows' own targets and the pinned projects. A missing
 * route here renders "Route not found" the moment a link is followed, and a
 * *flat* section/record pair leaves the record path unresolved — the pinned
 * project would link to `/projects/$projectId` with the placeholder still in it
 * — so each record route is nested under its section. `/` is the mount, so it
 * comes first: `screenRoutes` takes the story's own path and then its links.
 */
const SHELL_ROUTES = screenRoutes('/', [
  ['/projects', '$projectId'],
  ['/datasets', '$datasetId'],
  ['/samples', '$sampleId'],
  ['/sheets', 'new', '$sheetId'],
  ['/records', '$recordId'],
  ['/pipelines', 'runs/$runId'],
  ['/experiments', 'new'],
  '/inbox',
  '/schedule',
  '/protocols',
  '/templates',
  '/materials',
  '/instruments',
  '/analysis',
  '/models',
  '/settings',
  '/help',
  '/search',
  '/import',
])

const notifications: Notification[] = [
  {
    id: 'note-1',
    to: { kind: 'review', id: '0198d970-e266-4000-8000-0000000000r1' },
    unread: true,
    html: '<b>Ava Chen</b> asked you to review <b>Ambr run 12</b>',
    when: '20 min ago',
  },
  {
    id: 'note-2',
    to: { kind: 'dataset', id: '0198d970-e266-4000-8000-000000000d01' },
    unread: true,
    html: 'Plate reader import committed <b>96 rows</b> to TB-02 plate readings',
    when: '2 h ago',
  },
  {
    id: 'note-3',
    to: { kind: 'pipeline-run', id: 'run-7' },
    unread: true,
    html: 'Pipeline <b>Stability QC</b> finished with 2 flagged rows',
    when: 'yesterday',
  },
  {
    id: 'note-4',
    to: { kind: 'sheet', id: 'sheet-3' },
    unread: false,
    html: 'Your working sheet <b>Dilution maths</b> was updated by Mo Analyst',
    when: '2 days ago',
  },
]

const counts: ShellCounts = {
  inbox: '4',
  datasets: '12',
  pipelines: '3',
}

const pinned = [
  {
    id: '0198d970-e266-4000-8000-0000000000p1',
    name: 'TB-02 stability',
    tone: 'progress' as const,
  },
  {
    id: '0198d970-e266-4000-8000-0000000000p2',
    name: 'Ambr screening',
    tone: 'review' as const,
  },
]

const shellData = {
  me: {
    id: 'user-1',
    name: 'Ada Scientist',
    initials: 'AS',
    role: 'owner',
  },
  notifications,
  pinned,
  counts,
  workspace: { id: WORKSPACE_ID, name: 'TB-02 programme' },
  workspaces: [
    { id: WORKSPACE_ID, name: 'TB-02 programme' },
    { id: '0198d970-e266-4000-8000-0000000000w2', name: 'Ambr screening' },
  ],
}

/**
 * The shell mounts the ⌘K palette and the shortcuts dialog beside it, and both
 * read React Query's client from context, so the stories supply one.
 *
 * The palette also resolves the workspace's project names on mount — before it
 * is opened — so that read is seeded here. It carries a 60s `staleTime` of its
 * own, so the seed is stamped ahead: the static map is then the only answer it
 * can give while the story is open. The shell's own preference read resolves
 * `fetch` when it runs and is answered by `withApiReads`.
 */
const client = screenQueryClient()
client.setQueryData(
  ['ui-port', 'experiments', 'projects'],
  new Map([
    ['0198d970-e266-4000-8000-0000000000p1', 'TB-02 stability'],
    ['0198d970-e266-4000-8000-0000000000p2', 'Ambr screening'],
  ]),
  { updatedAt: Date.now() + 60 * 60 * 1000 },
)

const meta = {
  title: 'Shell/App shell',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: { route: SHELL_ROUTES, path: '/' },
    },
  },
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** What a story puts where the routed page renders. */
function RoutedPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: 'Projects', link: { to: '/projects' } }]}
        title="TB-02 stability"
        meta={<span>4 experiments · 2 datasets</span>}
        actions={
          <Button variant="primary" icon="plus">
            New experiment
          </Button>
        }
      />
      <div className="flex flex-col gap-2 p-4 md:p-6">
        <Muted>
          The routed page renders here. This story fills the shell&rsquo;s main
          area so the chrome around it is what is being shown.
        </Muted>
      </div>
    </>
  )
}

/**
 * The whole shell: the active workspace and the memberships the switcher
 * offers, the notification bell with unread rows, the pinned projects, live
 * counts on Inbox, Datasets and Pipelines, and the account menu.
 */
export const Shell: Story = {
  render: () => (
    <AppShell data={shellData}>
      <RoutedPage />
    </AppShell>
  ),
}

/**
 * The bell open, reached through its own trigger. Each unread row carries its
 * dot and opens the record its target names; "Mark all read" is the write, and
 * a story does not press it.
 */
export const NotificationsOpen: Story = {
  render: () => (
    <AppShell data={shellData}>
      <RoutedPage />
    </AppShell>
  ),
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Notifications, 3 unread' }),
    )
    await expect(await screen.findByText('Mark all read')).toBeInTheDocument()
    await expect(screen.getAllByLabelText('Unread')).toHaveLength(3)
  },
}

/**
 * Nothing to report: the bell has no dot, its label claims no number, and the
 * panel says so rather than rendering an empty list.
 */
export const NotificationsEmpty: Story = {
  render: () => (
    <AppShell data={{ ...shellData, notifications: [] }}>
      <RoutedPage />
    </AppShell>
  ),
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Notifications' }),
    )
    await expect(
      await screen.findByText('Nothing new right now.'),
    ).toBeInTheDocument()
  },
}

/**
 * One count the server could not read. An unknown count is not a zero: the
 * Inbox entry states no number while the counts that did read still show, so
 * the sidebar never claims a number it cannot back.
 */
export const UnknownInboxCount: Story = {
  render: () => (
    <AppShell data={{ ...shellData, counts: { ...counts, inbox: null } }}>
      <RoutedPage />
    </AppShell>
  ),
}
