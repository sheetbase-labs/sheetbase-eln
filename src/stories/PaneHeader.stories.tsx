import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModeBadge, PaneHeader } from '#/components/workspace/pane-header'
import { paneKind } from '#/lib/workspace-state'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The header of one workspace pane: its number, kind, mode, the page's own
 * breadcrumb, history controls and the menu of things to do with the pane.
 * Link-group membership shows as a coloured chip, and a pane whose record has a
 * newer revision names it.
 */
const client = screenQueryClient()
const href = '/experiments/exp-1'

const meta = {
  title: 'Workspace/Pane header',
  component: PaneHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="mx-pane w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    pane: {
      id: 'pane-1',
      href,
      title: 'Virus stability at 25 °C',
      identifier: 'EXP-2026-0042',
      trail: [{ href: '/experiments', title: 'Experiments' }],
      forward: [],
    },
    number: 1,
    focused: true,
    primary: true,
    mode: { kind: 'editing' },
    kind: paneKind(href),
    crumbs: [
      { label: 'Projects', href: '/projects' },
      { label: 'TB-02 stability', href: '/projects/p1' },
    ],
    onCrumb: () => {},
    onShelf: false,
    maximized: false,
    canClose: true,
    canLink: true,
    onFocus: () => {},
    onBack: () => {},
    onForward: () => {},
    onPin: () => {},
    onMakePrimary: () => {},
    onMaximize: () => {},
    onClose: () => {},
    onSplit: () => {},
    onToggleLink: () => {},
    onMakeDriver: () => {},
    onCompareNewer: () => {},
    onCopyLink: () => {},
    onSaveTrail: () => {},
  },
} satisfies Meta<typeof PaneHeader>

export default meta

type Story = StoryObj<typeof meta>

export const Editing: Story = {}

/** A pane that is not the primary one is read-only and offers to take over. */
export const ReadOnlyCopy: Story = {
  args: {
    primary: false,
    focused: false,
    number: 2,
    mode: { kind: 'read-only', revision: 'S-15' },
    newer: 'S-16',
  },
}

export const InLinkGroup: Story = {
  args: { link: { letter: 'a', role: 'drives' } },
}

export const Signed: Story = {
  args: { mode: { kind: 'signed', revision: 'S-15' } },
}

export const OnShelf: Story = { args: { onShelf: true, maximized: true } }

/** Every mode badge the header can show. */
export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <ModeBadge mode={{ kind: 'editing' }} />
      <ModeBadge mode={{ kind: 'reviewing' }} />
      <ModeBadge mode={{ kind: 'signed', revision: 'S-15' }} />
      <ModeBadge mode={{ kind: 'read-only', revision: 'S-15' }} />
      <ModeBadge mode={{ kind: 'plain' }} />
    </div>
  ),
}
