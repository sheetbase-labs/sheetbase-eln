import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  StepTimerControl,
  StepTimersHost,
} from '#/components/notebook/step-timer'

import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Step timers. The control sits under a step with a duration; the host is the
 * tray in the app shell. Both read the caller's timers through one query, which
 * a story seeds, with end times set relative to when the story loads.
 */
const KEY = ['step-timers'] as const
const now = Date.now()

function timer(id: string, blockId: string, label: string, endsInMs: number) {
  return {
    id,
    recordId: 'record-1',
    blockId,
    label,
    durationSeconds: 1800,
    endsAtMs: now + endsInMs,
    clockOffsetMs: 0,
  }
}

const idle = screenQueryClient({ data: [{ key: KEY, value: [] }] })

const running = screenQueryClient({
  data: [
    {
      key: KEY,
      value: [timer('t1', 'block-1', 'Incubate cells', 25 * 60_000)],
    },
  ],
})

const finished = screenQueryClient({
  data: [
    { key: KEY, value: [timer('t1', 'block-1', 'Incubate cells', -1000)] },
  ],
})

const tray = screenQueryClient({
  data: [
    {
      key: KEY,
      value: [
        timer('t1', 'block-1', 'Incubate cells', 25 * 60_000),
        timer('t2', 'block-2', 'Spin down pellet', 4 * 60_000),
        timer('t3', 'block-3', 'Stain for 30 minutes', -1000),
      ],
    },
  ],
})

const meta = {
  title: 'Notebook/Step timers',
  component: StepTimerControl,
  tags: ['autodocs'],
  args: { blockId: 'block-1', durationSeconds: 1800 },
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/records/$recordId', []),
        path: '/records/record-1',
        params: { recordId: 'record-1' },
      },
    },
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          // SAFETY: this file's `parameters.client` is the query client a screen's own test suite made; Storybook types every parameter as `any`.
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof StepTimerControl>

export default meta

type Story = StoryObj<typeof meta>

/** No timer on this step: it offers to start one for its duration. */
export const NotStarted: Story = { parameters: { client: idle } }

/** A running timer counts down. */
export const Running: Story = { parameters: { client: running } }

/** A timer that has ended. */
export const Finished: Story = { parameters: { client: finished } }

/** The shell's tray with running and finished timers. */
export const Tray: Story = {
  parameters: { client: tray, layout: 'fullscreen' },
  render: () => (
    <div className="h-[360px]">
      <StepTimersHost />
    </div>
  ),
}
