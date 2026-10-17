import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  SettingsSessions,
  mySessionsQueryKey,
} from '#/components/v3/settings/settings-sessions'
import type { MySession } from '#/components/v3/settings/settings-sessions-data'
import { holdRead, screenQueryClient } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * My sessions (`src/components/v3/settings/settings-sessions.tsx`).
 *
 * The caller's own signed-in devices, with sign-out per session. The read is
 * resolved server-side (`listMySessionsFn`) so a deployment without sign-in
 * still shows its one session rather than a permanent 401 — which is why the
 * list is seeded by its query key here and never runs that function.
 *
 * Ending a session goes through Better Auth, so no story clicks it; the refused
 * answer is the component's own error branch.
 */
const meta = {
  title: 'Settings/My sessions',
  component: SettingsSessions,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsSessions>
export default meta
type Story = StoryObj<typeof meta>

/** A story's client: the sessions read either seeded, or held in a state. */
function provider(read: 'loading' | 'error' | ReadSeed) {
  const seeded = typeof read === 'object' && 'key' in read
  const client = screenQueryClient({ data: seeded ? [read] : [] })
  if (!seeded)
    holdRead(
      client,
      mySessionsQueryKey,
      read === 'loading' ? 'pending' : 'error',
    )
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

function session(overrides: Partial<MySession> = {}): MySession {
  return {
    id: 'sess-1',
    token: 'tok-1',
    ipAddress: '82.14.31.7',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
    createdAt: '2026-10-15T08:12:00.000Z',
    expiresAt: '2026-11-14T08:12:00.000Z',
    current: false,
    ...overrides,
  }
}

const sessions: MySession[] = [
  session({
    id: 'sess-now',
    token: 'tok-now',
    current: true,
    ipAddress: '82.14.31.7',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0',
    createdAt: '2026-10-17T07:40:00.000Z',
  }),
  session({
    id: 'sess-2',
    ipAddress: '82.14.31.22',
    userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/141.0',
    createdAt: '2026-10-14T17:05:00.000Z',
  }),
  // A deployment identity: no token, so it cannot be ended from this list.
  session({
    id: 'sess-3',
    token: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-09-02T00:00:00.000Z',
  }),
]

/** This device plus two others, one of which is a deployment identity. */
export const Sessions: Story = {
  decorators: [provider({ key: mySessionsQueryKey, value: sessions })],
}

/** Only this device: the healthy case, with no action to offer. */
export const OnlyThisDevice: Story = {
  decorators: [provider({ key: mySessionsQueryKey, value: [sessions[0]] })],
}

export const Loading: Story = {
  decorators: [provider('loading')],
}

/** The read failed: the notice, and the retry the component holds. */
export const Failed: Story = {
  decorators: [provider('error')],
}
