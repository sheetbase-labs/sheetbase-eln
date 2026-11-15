import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PlanCard } from '#/components/assist/chat/plan-card'
import type { PlanAction } from '#/features/plans/plan'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * A plan from the assistant: several changes approved once and run in order.
 * Nothing has happened until a button is pressed. A step that removes or ends
 * something waits for its own OK unless the workspace lets this person run
 * everything. A story never reaches the server, so pressing Approve here shows
 * the first step's failed state and the plan stopping there.
 */
const WORKSPACE = '0198d970-e266-4000-8000-0000000000a1'

const ACTION: PlanAction = {
  kind: 'plan.run',
  workspaceId: WORKSPACE,
  pauseDestructive: true,
  runAllAllowed: false,
  steps: [
    {
      key: 'step-1',
      title: 'Create the PicoGreen project',
      tool: 'sheetbase.project.create',
      arguments: {},
      destructive: false,
    },
    {
      key: 'step-2',
      title: 'Log samples 1 to 10',
      tool: 'sheetbase.sample.log',
      arguments: {},
      destructive: false,
    },
    {
      key: 'step-3',
      title: 'End the recurring run',
      tool: 'sheetbase.recurring.end',
      arguments: {},
      destructive: true,
    },
  ],
}

const PROPOSAL: AssistantProposal = {
  tool: 'sheetbase.plan.propose',
  title: 'Set up the PicoGreen assay',
  summary: 'Create the PicoGreen project, then log samples 1 to 10 into it.',
  target: '3 steps',
  deepLink: null,
  changes: [],
  action: ACTION,
}

const client = screenQueryClient()

const meta = {
  title: 'Assistant/Plan card',
  component: PlanCard,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: { route: screenRoutes('/', []), path: '/' },
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
    callId: 'story-plan-1',
    proposal: PROPOSAL,
    action: ACTION,
    applyBuilt: () => Promise.resolve({ ok: true }),
  },
} satisfies Meta<typeof PlanCard>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A role the workspace allows to run everything also gets Run all. */
export const WithRunAll: Story = {
  args: {
    callId: 'story-plan-2',
    action: { ...ACTION, runAllAllowed: true },
  },
}
