import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import AssistantChat from '#/components/assist/assistant-chat'
import type { AiReadiness } from '#/lib/ai-settings'
import { ASSISTANT_CHAT_PATH } from '#/lib/assistant-chat'
import { AI_WORKSPACE_ID } from './assist-fixtures'
import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The assistant as a chat: streamed answers, the whole conversation sent with
 * each question, and sources under every answer. A story has no model, so the
 * chat endpoint is answered at the fetch boundary with a short recorded stream
 * (a lookup, then the answer and its sources) or a refusal; the chat itself,
 * the streaming and the states around it are the real component.
 *
 * The conversation lives in a store keyed by workspace so it survives closing
 * the panel; each answered story therefore uses its own workspace id.
 */
const READY: AiReadiness = {
  ready: true,
  mode: 'provider',
  profileId: 'workspace-model',
  dataClass: 'cloud',
}

/** A settled readiness, or the query held in its pending or error state. */
type ReadinessState = AiReadiness | 'pending' | 'error'

function client(readiness: ReadinessState, workspaceId: string) {
  const instance = screenQueryClient()
  const key = ['ai-settings', workspaceId]

  if (readiness === 'pending' || readiness === 'error') {
    holdRead(instance, key, readiness === 'pending' ? 'pending' : 'error')
  } else {
    instance.setQueryData(key, { readiness })
  }

  return instance
}

function sse(chunks: unknown[]): Response {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
    'data: [DONE]\n\n'

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  })
}

const ANSWER = [
  { type: 'start' },
  { type: 'start-step' },
  {
    type: 'tool-input-available',
    toolCallId: 'call-1',
    toolName: 'sheetbase.canonical.read',
    input: { resource: 'dataset_rows' },
    dynamic: true,
  },
  {
    type: 'tool-output-available',
    toolCallId: 'call-1',
    output: {},
    dynamic: true,
  },
  { type: 'text-start', id: 'text-1' },
  {
    type: 'text-delta',
    id: 'text-1',
    delta:
      'Two of the three runs are within range.\n\n- **Run 1** 4.1e6 PFU/mL\n- **Run 2** 3.9e6 PFU/mL\n- **Run 3** 2.2e6 PFU/mL, below the 3e6 limit',
  },
  { type: 'text-end', id: 'text-1' },
  {
    type: 'message-metadata',
    messageMetadata: {
      sources: [
        {
          kind: 'dataset',
          id: '0198d970-e266-4000-8000-000000000d01',
          title: 'HPLC purity series',
          deepLink: '/datasets/0198d970-e266-4000-8000-000000000d01',
          freshness: 'live',
          pins: [],
        },
      ],
    },
  },
  { type: 'finish-step' },
  { type: 'finish' },
]

/** Answers the chat endpoint for the story's lifetime, then puts `fetch` back. */
function ChatEndpoint({
  respond,
  children,
}: {
  respond: () => Response
  children: React.ReactNode
}) {
  const original = window.fetch
  useEffect(() => {
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input.toString()

      if (url.startsWith(ASSISTANT_CHAT_PATH)) return Promise.resolve(respond())

      return original.call(window, input, init)
    }

    return () => {
      window.fetch = original
    }
  }, [original, respond])

  return <>{children}</>
}

function frame(
  workspaceId: string,
  readiness: ReadinessState,
  respond: () => Response = () => sse(ANSWER),
) {
  const instance = client(readiness, workspaceId)

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={instance}>
      <ChatEndpoint respond={respond}>
        <div className="h-[560px] w-[440px] border border-border">
          <Story />
        </div>
      </ChatEndpoint>
    </QueryClientProvider>
  )
}

const WS = (suffix: string) => AI_WORKSPACE_ID.slice(0, -2) + suffix

const meta = {
  title: 'Assistant/Chat',
  component: AssistantChat,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/', ['/settings/workspace/ai']),
        path: '/',
      },
    },
  },
  args: {
    workspaceId: WS('c1'),
    role: 'owner',
    context: { kind: 'dataset', id: '0198d970-e266-4000-8000-000000000d01' },
  },
} satisfies Meta<typeof AssistantChat>

export default meta

type Story = StoryObj<typeof meta>

/** Ready on a dataset page: suggested questions that name what the page is. */
export const Empty: Story = { decorators: [frame(WS('c1'), READY)] }

/** A page with no stable object behind it: no suggestions to offer. */
export const EmptyNoContext: Story = {
  args: { workspaceId: WS('c2'), context: null },
  decorators: [frame(WS('c2'), READY)],
}

/** Asks a suggested question and shows the streamed answer, its lookup and its sources. */
export const Answered: Story = {
  args: { workspaceId: WS('c3') },
  decorators: [frame(WS('c3'), READY)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      await canvas.findByTestId('assistant-question'),
      'Which runs are out of range?{Enter}',
    )
    await expect(
      await canvas.findByTestId('assistant-answer'),
    ).toBeInTheDocument()
  },
}

/** The server refused the question: the error shows with a way to try again. */
export const Refused: Story = {
  args: { workspaceId: WS('c4') },
  decorators: [
    frame(
      WS('c4'),
      READY,
      () =>
        new Response(
          JSON.stringify({
            message: 'The assistant is busy. Try again in a minute.',
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      await canvas.findByTestId('assistant-question'),
      'Summarise this dataset{Enter}',
    )
  },
}

/** AI is off for the workspace; an owner is pointed at the setting. */
export const Unavailable: Story = {
  args: { workspaceId: WS('c5') },
  decorators: [frame(WS('c5'), { ready: false, reason: 'disabled' })],
}

/** The same screen for a member, who cannot change the setting. */
export const UnavailableForMember: Story = {
  args: { workspaceId: WS('c6'), role: 'scientist' },
  decorators: [frame(WS('c6'), { ready: false, reason: 'disabled' })],
}

/** The provider needs a key the workspace has not set. */
export const NeedsConfiguration: Story = {
  args: { workspaceId: WS('c7') },
  decorators: [frame(WS('c7'), { ready: false, reason: 'key_missing' })],
}

export const LoadingPolicy: Story = {
  args: { workspaceId: WS('c8') },
  decorators: [frame(WS('c8'), 'pending')],
}

export const PolicyFailed: Story = {
  args: { workspaceId: WS('c9') },
  decorators: [frame(WS('c9'), 'error')],
}

export const NoWorkspace: Story = {
  args: { workspaceId: null },
  decorators: [frame(WS('c0'), READY)],
}
