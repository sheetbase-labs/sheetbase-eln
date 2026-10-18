import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { WorkspaceGroups } from '#/components/v3/settings/workspace-groups'
import type { WorkspaceGroup } from '#/lib/workspace-access'
import { withApiReads } from './screen-stories'

/**
 * Workspace groups (`src/routes/settings/members.tsx`): create a group, then
 * choose its explicit members. The host passes the groups and the people in, so
 * the dialog itself reads nothing; its three writes (create, delete, member)
 * run through the workspace-access RPCs, which no story presses.
 *
 * The dialog is portalled, so the stories drive it through `screen`.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const groups: WorkspaceGroup[] = [
  {
    id: '0198d970-e266-4000-8000-0000000a0001',
    name: 'QA reviewers',
    member_ids: ['user-2'],
  },
  {
    id: '0198d970-e266-4000-8000-0000000a0002',
    name: 'Stability team',
    member_ids: [],
  },
]

const people = [
  { id: 'user-1', name: 'Ada Scientist' },
  { id: 'user-2', name: 'Ravi QA' },
  { id: 'user-3', name: 'Mo Analyst' },
]

const meta = {
  title: 'Settings/Workspace groups',
  component: WorkspaceGroups,
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    groups,
    people,
    onClose: () => {},
  },
} satisfies Meta<typeof WorkspaceGroups>
export default meta
type Story = StoryObj<typeof meta>

/**
 * A group with one explicit member: membership is per person and applies
 * immediately, which the confirmation line states. Membership is the one control
 * the hosts' own lists cannot express.
 */
export const GroupWithMembers: Story = {}

/** A group nobody belongs to yet: the same field, with nothing chosen. */
export const EmptyGroup: Story = {
  args: {
    groups: [{ ...groups[0], name: 'Stability team', member_ids: [] }],
  },
}

/** No group exists in this workspace: creating one is the only action offered. */
export const NoGroupsYet: Story = {
  args: { groups: [] },
}

/**
 * The removal confirmation, reached through the dialog's own Remove group
 * button. It states what the removal revokes before anything is written; the
 * write itself is the button a story does not press.
 */
export const ConfirmRemoval: Story = {
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove group' }),
    )
    await expect(
      await screen.findByText(
        /Remove QA reviewers\? Every project grant naming this group will be revoked immediately\./,
      ),
    ).toBeInTheDocument()
    await expect(
      screen.getByRole('button', { name: 'Confirm removal' }),
    ).toBeInTheDocument()
  },
}
