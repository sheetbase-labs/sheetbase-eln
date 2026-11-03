import { t } from '#/copy'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Chat, useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Check, Copy, RotateCcw, SquarePen } from 'lucide-react'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { Muted } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { contextKindLabel } from '#/lib/assistant-context'
import type { AssistantPageContext } from '#/lib/assistant-context'
import { aiReadinessMessage } from '#/lib/ai-settings'
import {
  ASSISTANT_CHAT_PATH,
  messageText,
  toChatTurns,
} from '#/lib/assistant-chat'
import type { AssistantUIMessage } from '#/lib/assistant-chat'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './chat/conversation'
import {
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from './chat/message'
import { PromptBox } from './chat/prompt-box'

/**
 * The assistant as a chat: streamed answers, the whole conversation sent with
 * each question, sources under every answer. Loaded only when the panel opens,
 * so the chat library stays out of the initial bundle.
 *
 * The conversation lives in a small store keyed by workspace rather than in the
 * component, so closing the panel (or navigating) does not lose it. "New chat"
 * clears it.
 */

const chats = new Map<string, Chat<AssistantUIMessage>>()

/** What the next request should carry; set on every render of the open panel. */
const next: {
  workspaceId: string
  objectRefs: Array<{ kind: string; id: string }>
} = { workspaceId: '', objectRefs: [] }

function chatFor(workspaceId: string): Chat<AssistantUIMessage> {
  let chat = chats.get(workspaceId)
  if (!chat) {
    chat = new Chat<AssistantUIMessage>({
      id: `assistant:${workspaceId}`,
      transport: new DefaultChatTransport<AssistantUIMessage>({
        api: ASSISTANT_CHAT_PATH,
        credentials: 'same-origin',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            workspaceId: next.workspaceId,
            objectRefs: next.objectRefs,
            messages: toChatTurns(messages),
          },
        }),
      }),
    })
    chats.set(workspaceId, chat)
  }
  return chat
}

/** The server answers refusals with `{ message }`; a stream error is plain text. */
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { message?: unknown }
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // Not JSON: the text is already the message.
  }
  return error.message || t('notebook.assistantPanel.tryAgainOrAsk')
}

export default function AssistantChat({
  workspaceId,
  role,
  context,
}: {
  workspaceId: string | null
  role: string | null
  context: AssistantPageContext | null
}) {
  const settingsQuery = useQuery({
    queryKey: ['ai-settings', workspaceId],
    queryFn: async () => {
      // Loaded on open, not at module scope: a top-level server-function
      // import would make every shell test carry it.
      const { getAiSettingsFn } = await import('#/lib/ai-settings-actions')
      return getAiSettingsFn({ data: { workspaceId: workspaceId ?? '' } })
    },
    enabled: Boolean(workspaceId),
  })
  const readiness = settingsQuery.data?.readiness
  const ready = readiness?.ready ?? false

  if (!workspaceId) {
    return (
      <div className="p-4">
        <Notice
          tone="warn"
          title={t('notebook.assistantPanel.titleNoActiveWorkspace')}
        >
          {t('notebook.assistantPanel.chooseAWorkspaceBefore')}
        </Notice>
      </div>
    )
  }
  if (settingsQuery.isPending) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (settingsQuery.isError) {
    return (
      <div className="p-4">
        <Notice
          tone="bad"
          title={t('notebook.assistantPanel.titleAiPolicyCouldNot')}
        >
          {t('notebook.assistantPanel.reloadThePageAnd')}
        </Notice>
      </div>
    )
  }
  if (readiness && !readiness.ready) {
    return (
      <div className="p-4">
        <Notice
          tone={
            readiness.reason === 'disabled' ||
            readiness.reason === 'feature_disabled'
              ? 'info'
              : 'warn'
          }
          title={t('notebook.assistantPanel.titleAssistantUnavailable')}
          data-testid="assistant-disabled"
        >
          {aiReadinessMessage(readiness)}
          {['disabled', 'feature_disabled'].includes(readiness.reason) &&
          role === 'owner' ? (
            <>
              {' '}
              <Link
                to="/settings/ai"
                className="font-medium text-fg underline underline-offset-2"
              >
                {t('notebook.assistantPanel.openAiSettings')}
              </Link>
              .
            </>
          ) : null}
        </Notice>
      </div>
    )
  }

  return <ChatBody workspaceId={workspaceId} context={context} ready={ready} />
}

function ChatBody({
  workspaceId,
  context,
  ready,
}: {
  workspaceId: string
  context: AssistantPageContext | null
  ready: boolean
}) {
  next.workspaceId = workspaceId
  next.objectRefs = context ? [{ kind: context.kind, id: context.id }] : []

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
    setMessages,
    clearError,
  } = useChat<AssistantUIMessage>({ chat: chatFor(workspaceId) })
  const [draft, setDraft] = useState('')

  const busy = status === 'submitted' || status === 'streaming'
  const kind = context ? contextKindLabel(context.kind).toLowerCase() : null
  const last = messages.at(-1)
  // Waiting for the first words of an answer.
  const waiting =
    status === 'submitted' ||
    (status === 'streaming' &&
      last?.role === 'assistant' &&
      messageText(last).trim() === '')

  function send(text: string) {
    const question = text.trim()
    if (!question || busy || !ready) return
    clearError()
    setDraft('')
    void sendMessage({ text: question })
  }

  function newChat() {
    stop()
    setMessages([])
    clearError()
    setDraft('')
  }

  const suggestions = context
    ? [
        t('notebook.assistantPanel.suggestSummarise', { kind: kind ?? '' }),
        t('notebook.assistantPanel.suggestMissing'),
        t('notebook.assistantPanel.suggestReview'),
      ]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-muted px-2.5 py-0.5 text-label text-fg-muted">
          <Icon name="spark" size={12} />
          <span className="truncate">
            {kind
              ? t('notebook.assistantPanel.usingThis', { kind })
              : t('notebook.assistantPanel.noStableObjectOn')}
          </span>
        </span>
        <span className="flex-1" />
        {messages.length > 0 ? (
          <Button size="sm" variant="quiet" onClick={newChat}>
            <SquarePen size={12} />
            {t('notebook.assistantPanel.newChat')}
          </Button>
        ) : null}
      </div>

      <Conversation>
        <ConversationContent className="min-h-full">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
              <span className="inline-flex size-10 items-center justify-center rounded-full border border-border-subtle bg-surface-muted text-fg-muted">
                <Icon name="spark" size={18} />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="m-0 font-heading text-[15px] font-semibold text-fg">
                  {t('notebook.assistantPanel.emptyTitle')}
                </h3>
                <Muted className="max-w-[300px]">
                  {context
                    ? t('notebook.assistantPanel.emptyWithContext', {
                        kind: kind ?? '',
                      })
                    : t('notebook.assistantPanel.emptyNoContext')}
                </Muted>
              </div>
              {suggestions.length > 0 ? (
                <div className="flex flex-col items-stretch gap-2 self-stretch">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2 text-left text-body text-fg hover:bg-surface-hover"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                streaming={
                  busy &&
                  index === messages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            ))
          )}

          {waiting ? (
            <div
              className="flex items-center gap-2 text-label text-fg-muted"
              role="status"
            >
              <span className="flex gap-1" aria-hidden="true">
                <span className="size-1.5 animate-bounce rounded-full bg-fg-faint [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-fg-faint [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-fg-faint" />
              </span>
              {t('notebook.assistantPanel.thinking')}
            </div>
          ) : null}

          {error ? (
            <Notice
              tone="bad"
              title={t('notebook.assistantPanel.titleTheAssistantCouldNot')}
            >
              <span>{errorText(error)}</span>{' '}
              <button
                type="button"
                onClick={() => void regenerate()}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-medium text-fg underline underline-offset-2"
              >
                <RotateCcw size={12} />
                {t('notebook.assistantPanel.tryAgain')}
              </button>
            </Notice>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-2 border-t border-border-subtle px-4 pt-3 pb-3">
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSubmit={() => send(draft)}
          onStop={stop}
          busy={busy}
          disabled={!ready}
          placeholder={
            messages.length === 0
              ? t('notebook.assistantPanel.placeholder')
              : t('notebook.assistantPanel.placeholderFollowUp')
          }
        />
        <Muted className="text-center text-[11px]">
          {t('notebook.assistantPanel.aiOutputIsAssistive')}
        </Muted>
      </div>
    </div>
  )
}

function ChatMessage({
  message,
  streaming,
}: {
  message: AssistantUIMessage
  streaming: boolean
}) {
  const [copied, setCopied] = useState(false)
  const text = messageText(message)

  if (message.role === 'user') {
    return (
      <Message from="user">
        <MessageContent>{text}</MessageContent>
      </Message>
    )
  }
  // Nothing yet: the "thinking" row stands in until the first words arrive.
  if (text.trim() === '') return null

  const meta = message.metadata
  const sources = meta?.sources ?? []

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      // Clipboard permission is not guaranteed; the answer stays selectable.
    }
  }

  return (
    <Message from="assistant" data-testid="assistant-answer" aria-live="polite">
      <MessageContent>
        <MessageResponse isAnimating={streaming}>{text}</MessageResponse>
      </MessageContent>

      {!streaming ? (
        <>
          {sources.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {sources.map((source) => (
                <li
                  key={`${source.kind}:${source.id}`}
                  data-testid="assistant-source"
                >
                  <a
                    href={source.deepLink ?? '#'}
                    title={`${contextKindLabel(source.kind)} · ${source.freshness}${
                      source.pins.length > 0
                        ? ` · ${source.pins.map((pin) => pin.detail).join(' · ')}`
                        : ''
                    }`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-surface-muted px-2.5 py-0.5 text-label font-medium text-fg no-underline hover:bg-surface-hover"
                  >
                    <span className="truncate">
                      {source.title || source.id}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Muted className="text-[11px]">
              {t('notebook.assistantPanel.noSheetbaseObjectWas')}
            </Muted>
          )}
          <MessageActions className="text-fg-muted">
            {meta?.mode === 'built-in' ? (
              <span className="text-[11px]">
                {t('notebook.assistantPanel.builtInDeterministicModel')}
              </span>
            ) : null}
            <span className="flex-1" />
            <button
              type="button"
              onClick={copy}
              aria-label={t('common.actions.copy')}
              title={
                copied ? t('common.states.copied') : t('common.actions.copy')
              }
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </MessageActions>
        </>
      ) : null}
    </Message>
  )
}
