import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RolesAndPermissions } from '#/components/v3/settings/roles-and-permissions'
import { screenQueryClient } from './screen-stories'

/**
 * Settings → Members and roles → Roles and permissions: what each role is,
 * which settings sections each role opens, and which kinds of day-to-day work
 * each role may do. The stored choices are one read (`settings_access`); each
 * change is one write per role in the column.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const meta = {
  title: 'Settings/Roles and permissions',
  decorators: [
    (Story) => (
      <div className="w-[1300px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function provider(rows: Array<{ area: string; role: string; level: string }>) {
  const client = screenQueryClient({
    data: [{ key: ['settings-access', WORKSPACE_ID], value: rows }],
  })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

/** As a workspace starts: everyone who could write before still can. */
export const Defaults: Story = {
  decorators: [provider([])],
  render: () => <RolesAndPermissions workspaceId={WORKSPACE_ID} canEdit />,
}

/** A workspace that narrowed some work: analysts don't touch samples, reviewers don't plan. */
export const Narrowed: Story = {
  decorators: [
    provider([
      { area: 'work_samples', role: 'analyst', level: 'none' },
      { area: 'work_planning', role: 'reviewer', level: 'none' },
      { area: 'work_client_sharing', role: 'scientist', level: 'none' },
      { area: 'work_client_sharing', role: 'member', level: 'none' },
      { area: 'work_comments', role: 'viewer', level: 'manage' },
    ]),
  ],
  render: () => <RolesAndPermissions workspaceId={WORKSPACE_ID} canEdit />,
}

/** Someone who isn't the workspace admin sees the choices but can't change them. */
export const ReadOnly: Story = {
  decorators: [provider([])],
  render: () => (
    <RolesAndPermissions workspaceId={WORKSPACE_ID} canEdit={false} />
  ),
}
