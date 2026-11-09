import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StepDeviation } from '#/components/notebook/step-deviation'

import { screenQueryClient } from './screen-stories'

/**
 * Recording that a step copied from a protocol was done differently. The saved
 * deviations are one read, which a story seeds; saving would write, so the save
 * a story passes only resolves.
 */
const BLOCK_ID = '0198d970-e266-4000-8000-0000000000b1'
const key = ['ui-port', 'step-deviations', BLOCK_ID] as const

const pinnedPayload = {
  text: 'Incubate for 45 minutes at 30 °C.',
  sourceProtocolRevisionId: 'rev-1',
  sourceStepBlockId: 'step-1',
}

const deviation = {
  id: '0198d970-e266-4000-8000-0000000000b2',
  record_id: '0198d970-e266-4000-8000-0000000000b3',
  block_id: BLOCK_ID,
  protocol_version_id: null,
  frozen_text: 'Incubate for 60 minutes at 37 °C.',
  recorded_text: 'Incubate for 45 minutes at 30 °C.',
  reason: null,
  reason_by_user_id: null,
  reason_at: null,
  created_by_user_id: 'user-1',
  created_at: '2026-10-21T09:00:00Z',
}

const none = screenQueryClient({ data: [{ key, value: [] }] })
const needsReason = screenQueryClient({ data: [{ key, value: [deviation] }] })

const explained = screenQueryClient({
  data: [
    {
      key,
      value: [
        {
          ...deviation,
          reason: 'The incubator ran cool, so the time was shortened.',
          reason_by_user_id: 'user-1',
          reason_at: '2026-10-21T09:05:00Z',
        },
      ],
    },
    { key: ['user-names', ['user-1']], value: { 'user-1': 'Ava Chen' } },
  ],
})

const meta = {
  title: 'Notebook/Step deviation',
  component: StepDeviation,
  tags: ['autodocs'],
  args: {
    block: { id: BLOCK_ID, payload: pinnedPayload },
    save: async () => ({ ok: true }),
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[560px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof StepDeviation>

export default meta

type Story = StoryObj<typeof meta>

/** A pinned step run as written: the action to record a deviation is offered. */
export const AsWritten: Story = { parameters: { client: none } }

/** The text was changed but no reason is on record yet. */
export const ReasonNeeded: Story = { parameters: { client: needsReason } }

/** A deviation with its reason and who gave it. */
export const Explained: Story = { parameters: { client: explained } }

/** A step that is not pinned to a protocol has nothing to deviate from. */
export const NotPinned: Story = {
  parameters: { client: none },
  args: { block: { id: BLOCK_ID, payload: { text: 'Free-text step' } } },
}
