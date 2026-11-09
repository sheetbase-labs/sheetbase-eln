import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { JoinedWelcome } from '#/components/shell/joined-welcome'
import { joinDomainKeys } from '#/lib/join-domains'
import { screenQueryClient } from './screen-stories'

/**
 * Tells a colleague who got in through their email domain what happened and who
 * can change it. Shown on Home for people the lab's domain list covers; owners
 * and admins, who set the list up, never see it. The domain list is seeded in
 * the query cache.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000e1'

function withDomains(domains: Array<{ domain: string; role: string }>) {
  const client = screenQueryClient({
    data: [{ key: joinDomainKeys.list(WORKSPACE_ID), value: domains }],
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="w-[640px]">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Shell/Joined welcome',
  component: JoinedWelcome,
  tags: ['autodocs'],
  args: {
    workspaceId: WORKSPACE_ID,
    workspaceName: 'Acme Bio',
    userId: 'user-welcome-story',
    email: 'dana@acme-bio.com',
    role: 'scientist',
  },
  decorators: [withDomains([{ domain: 'acme-bio.com', role: 'scientist' }])],
} satisfies Meta<typeof JoinedWelcome>

export default meta

type Story = StoryObj<typeof meta>

export const Scientist: Story = {}

export const Reviewer: Story = { args: { role: 'reviewer' } }

/** Owners and admins set the list up, so they are never welcomed by it. */
export const SilentForAdmins: Story = { args: { role: 'admin' } }

/** An address the lab's domain list does not cover: nothing to explain. */
export const SilentWhenNotCovered: Story = {
  args: { email: 'dana@elsewhere.org' },
}
