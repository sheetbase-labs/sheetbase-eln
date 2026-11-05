import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProposalCard } from '#/components/assist/chat/proposal-card'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * A change the assistant suggests, as a card in the chat. Nothing has been
 * written: Apply runs the ordinary propose, approve and execute steps as the
 * signed-in person, so the version check and audit trail are the same as any
 * other change. A story never reaches the server, so pressing Apply here shows
 * the card's failed state.
 */
const PROPOSAL: AssistantProposal = {
  tool: 'propose_pipeline',
  title: 'Add a nightly titre export',
  summary: 'Creates a pipeline that exports titre results to the shared drive.',
  target: 'Pipelines',
  deepLink: '/pipelines',
  changes: [
    { label: 'Name', before: null, after: 'Nightly titre export' },
    {
      label: 'Schedule',
      before: 'Manual',
      after: 'Every night at 02:00',
    },
  ],
  operation: {
    kind: 'pipeline_definition.create',
    workspaceId: '0198d970-e266-4000-8000-0000000000a1',
    key: 'nightly-titre-export',
    name: 'Nightly titre export',
  },
} as unknown as AssistantProposal

const client = screenQueryClient()

const meta = {
  title: 'Assistant/Proposal card',
  component: ProposalCard,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/', ['/pipelines/agents']),
        path: '/',
      },
    },
  },
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="w-[420px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    callId: 'story-call-1',
    workspaceId: '0198d970-e266-4000-8000-0000000000a1',
    proposal: PROPOSAL,
  },
} satisfies Meta<typeof ProposalCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A change to something that exists shows what it replaces, struck through. */
export const NewRecordOnly: Story = {
  args: {
    callId: 'story-call-2',
    proposal: {
      ...PROPOSAL,
      changes: [{ label: 'Name', before: null, after: 'Nightly titre export' }],
    },
  },
}
