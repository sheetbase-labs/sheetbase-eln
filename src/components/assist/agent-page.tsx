import { useCallback, useEffect, useRef, useState } from 'react'
import { Chat, useChat } from '@ai-sdk/react'
import { useFailureFeed } from '#/lib/assistant-failure-feed'
import { DefaultChatTransport } from 'ai'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Sheet, SheetContent } from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { aiReadinessMessage } from '#/lib/ai-settings'
import type { AiReadiness } from '#/lib/ai-settings'
import { ASSISTANT_CHAT_PATH, toChatTurns } from '#/lib/assistant-chat'
import type { AssistantUIMessage } from '#/lib/assistant-chat'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { notebookDataClient } from '#/lib/notebook-data'
import { openPanesForRequest } from '#/lib/assistant-open-panes'
import {
  hydrateCardOutcomes,
  subscribeCardOutcomes,
} from '#/lib/assistant-card-outcomes'
import {
  conversationKeys,
  fetchConversation,
  messagesToSave,
  saveConversation,
  titleFromMessages,
} from '#/lib/agent-conversations'
import { AgentHistory } from './agent-history'
import { ChatMessage, ThinkingRow } from './assistant-chat'
import { errorText, isWaitingForAnswer } from './chat/chat-status'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './chat/conversation'
import { PromptBox } from './chat/prompt-box'
import {
  filesForRequest,
  markChatFilesSent,
  useChatFiles,
} from './chat/attachments'
import { attachmentRef } from '#/lib/assistant-attachments'

/**
 * The Agent page: the assistant as a page of its own. A list of the person's
 * chats on the left, the conversation in the middle, the message box under it.
 *
 * It is the same assistant as the side panel: the same endpoint, tools, confirm
 * cards, budget and agent permissions. Messages render through the panel's own
 * `ChatMessage`, so whatever card the assistant sends shows up here too.
 */

const chats = new Map<string, Chat<AssistantUIMessage>>()

function viewerTimeZone(): string | undefined {
  return (
    getDisplayTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  )
}

function chatFor(
  workspaceId: string,
  id: string,
  messages: AssistantUIMessage[],
): Chat<AssistantUIMessage> {
  const key = `${workspaceId}:${id}`
  let chat = chats.get(key)

  if (!chat) {
    hydrateCardOutcomes(messages)
    chat = new Chat<AssistantUIMessage>({
      id: key,
      messages,
      transport: new DefaultChatTransport<AssistantUIMessage>({
        api: ASSISTANT_CHAT_PATH,
        credentials: 'same-origin',
        prepareSendMessagesRequest: ({ messages: all }) => {
          const attachments = filesForRequest(key)

          markChatFilesSent(key)

          return {
            body: {
              workspaceId,
              objectRefs: [],
              messages: toChatTurns(all),
              timeZone: viewerTimeZone(),
              attachments,
              panes: openPanesForRequest(),
            },
          }
        },
      }),
    })
    chats.set(key, chat)
  }

  return chat
}

export default function AgentPage({
  workspaceId,
  role,
  chatId,
  onOpenChat,
  onNewChat,
}: {
  workspaceId: string | null
  role: string | null
  /** The chat in the address, or null for a fresh one. */
  chatId: string | null
  onOpenChat: (id: string) => void
  onNewChat: () => void
}) {
  // The chat list sheet (phone and tablet) is open for one chat: picking another
  // chat changes the address, which closes it without a handler on every row.
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  // A fresh chat gets its id up front, so it can be saved as it goes.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())

  const activeId = chatId ?? draftId
  const historyOpen = historyFor === activeId

  const setHistoryOpen = (open: boolean) =>
    setHistoryFor(open ? activeId : null)

  const newChat = useCallback(() => {
    setDraftId(crypto.randomUUID())
    setHistoryFor(null)
    onNewChat()
  }, [onNewChat])

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Notice
          tone="warn"
          title={t('notebook.assistantPanel.titleNoActiveWorkspace')}
        >
          {t('notebook.assistantPanel.chooseAWorkspaceBefore')}
        </Notice>
      </div>
    )
  }

  const history = () => (
    <AgentHistory
      workspaceId={workspaceId}
      activeId={activeId}
      onNewChat={newChat}
      onDeleted={(id) => {
        chats.delete(`${workspaceId}:${id}`)

        if (id === activeId) newChat()
      }}
    />
  )

  return (
    <div className="flex h-full min-h-0" data-testid="agent-page">
      <aside className="hidden w-[272px] shrink-0 border-r border-border-subtle bg-surface-muted lg:block">
        {history()}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 lg:hidden">
          <Button
            variant="quiet"
            size="icon"
            icon="history"
            aria-label={t('features.assistantConversations.page.historyOpen')}
            onClick={() => setHistoryOpen(true)}
          />
          <h1 className="m-0 flex-1 truncate font-heading text-[15px] font-semibold text-fg">
            {t('features.assistantConversations.page.title')}
          </h1>
          <Button variant="quiet" onClick={newChat}>
            <Icon name="squarePen" size={14} />
            {t('features.assistantConversations.page.newChat')}
          </Button>
        </header>

        <AgentChat
          key={activeId}
          workspaceId={workspaceId}
          role={role}
          id={activeId}
          saved={chatId !== null}
          onSaved={onOpenChat}
        />
      </section>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        {historyOpen ? (
          <SheetContent
            side="left"
            title={t('features.assistantConversations.page.history')}
            data-testid="agent-history-sheet"
          >
            {history()}
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  )
}

/** One chat: loads it if it was saved, then runs it. */
function AgentChat({
  workspaceId,
  role,
  id,
  saved,
  onSaved,
}: {
  workspaceId: string
  role: string | null
  id: string
  saved: boolean
  onSaved: (id: string) => void
}) {
  const settingsQuery = useQuery({
    queryKey: ['ai-settings', workspaceId],
    queryFn: async () => {
      const { getAiSettingsFn } = await import('#/lib/ai-settings-actions')

      return getAiSettingsFn({ data: { workspaceId } })
    },
  })

  const cached = chats.has(`${workspaceId}:${id}`)

  const loadQuery = useQuery({
    queryKey: conversationKeys.one(workspaceId, id),
    queryFn: () => fetchConversation(notebookDataClient, id),
    enabled: saved && !cached,
    staleTime: Infinity,
    gcTime: 0,
  })

  const loading =
    settingsQuery.isPending || (saved && !cached && loadQuery.isPending)

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (settingsQuery.isError || (saved && !cached && loadQuery.isError)) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Notice
          tone="bad"
          title={t('features.assistantConversations.page.openFailed')}
        >
          {t('notebook.assistantPanel.reloadThePageAnd')}
        </Notice>
      </div>
    )
  }

  const readiness = settingsQuery.data.readiness

  if (!readiness.ready) {
    return <AgentUnavailable readiness={readiness} role={role} />
  }

  return (
    <ChatBody
      workspaceId={workspaceId}
      id={id}
      saved={saved}
      initialMessages={loadQuery.data?.messages ?? []}
      onSaved={onSaved}
    />
  )
}

/** The assistant is off or not set up: say why, and where an owner can fix it. */
function AgentUnavailable({
  readiness,
  role,
}: {
  readiness: Extract<AiReadiness, { ready: false }>
  role: string | null
}) {
  const switchable =
    readiness.reason === 'disabled' || readiness.reason === 'feature_disabled'

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Notice
        tone={switchable ? 'info' : 'warn'}
        title={t('notebook.assistantPanel.titleAssistantUnavailable')}
        data-testid="assistant-disabled"
      >
        {aiReadinessMessage(readiness)}
        {switchable && role === 'owner' ? (
          <>
            {' '}
            <Link
              to="/settings/workspace/ai"
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

function ChatBody({
  workspaceId,
  id,
  saved,
  initialMessages,
  onSaved,
}: {
  workspaceId: string
  id: string
  saved: boolean
  initialMessages: AssistantUIMessage[]
  onSaved: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const chat = chatFor(workspaceId, id, initialMessages)

  const { messages, sendMessage, status, stop, error, regenerate, clearError } =
    useChat<AssistantUIMessage>({ chat })

  const [draft, setDraft] = useState('')
  const filesKey = `${workspaceId}:${id}`
  const attached = useChatFiles(filesKey, workspaceId)

  const unsentIds = new Set(attached.unsent)
  const unsentFiles = attached.files.filter((file) => unsentIds.has(file.id))

  const busy = status === 'submitted' || status === 'streaming'
  const waiting = isWaitingForAnswer(status, messages.at(-1))

  // Save the chat each time an answer finishes (or fails), so a reload or a
  // trip to another page finds it where it was left. The first save puts the
  // chat's id in the address.
  const wasBusy = useRef(false)
  const savedOnce = useRef(saved)

  useEffect(() => {
    if (busy) {
      wasBusy.current = true

      return
    }

    if (!wasBusy.current || messagesToSave(messages).length === 0) return
    wasBusy.current = false

    saveConversation(notebookDataClient, {
      id,
      messages,
      title: savedOnce.current ? undefined : titleFromMessages(messages),
    })
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.all(workspaceId),
        })

        if (!savedOnce.current) {
          savedOnce.current = true
          onSaved(id)
        }
      })
      .catch(() => {
        toast.error(t('features.assistantConversations.page.saveFailed'))
      })
  }, [busy, messages, id, workspaceId, queryClient, onSaved])

  // A card applied or dismissed after the answer was saved is saved too, so a
  // later chat knows what the assistant made.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const unsubscribe = subscribeCardOutcomes(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!savedOnce.current) return

        saveConversation(notebookDataClient, {
          id,
          messages: chat.messages,
        }).catch(() => {
          toast.error(t('features.assistantConversations.page.saveFailed'))
        })
      }, 1500)
    })

    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [id, chat])

  useFailureFeed(
    useCallback((text: string) => void sendMessage({ text }), [sendMessage]),
  )

  const send = useCallback(
    (text: string) => {
      const question =
        text.trim() ||
        (unsentFiles.length > 0
          ? t('features.labFiles.attach.defaultQuestion')
          : '')

      if (!question || busy || attached.reading.length > 0) return
      clearError()
      setDraft('')

      void sendMessage({
        text: question,
        metadata:
          unsentFiles.length > 0
            ? { attachments: unsentFiles.map(attachmentRef) }
            : undefined,
      })
    },
    [busy, clearError, sendMessage, unsentFiles, attached.reading.length],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent className="mx-auto min-h-full w-full max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <AgentEmpty onAsk={send} />
          ) : (
            messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                workspaceId={workspaceId}
                streaming={
                  busy &&
                  index === messages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            ))
          )}

          {waiting ? <ThinkingRow /> : null}

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
                <Icon name="rotateCcw" size={12} />
                {t('notebook.assistantPanel.tryAgain')}
              </button>
            </Notice>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-2 pb-[calc(0.75rem+var(--kb-accessory,0px))]">
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSubmit={() => send(draft)}
          onStop={stop}
          busy={busy}
          disabled={false}
          files={{
            waiting: unsentFiles,
            reading: attached.reading,
            error: attached.error,
            onAdd: attached.add,
            onRemove: attached.remove,
          }}
          placeholder={
            messages.length === 0
              ? t('features.assistantConversations.page.placeholder')
              : t('features.assistantConversations.page.placeholderFollowUp')
          }
        />
        <Muted className="text-center text-[11px]">
          {t('notebook.assistantPanel.aiOutputIsAssistive')}
        </Muted>
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'suggestSchedule',
  'suggestReagents',
  'suggestInbox',
  'suggestInstruments',
] as const

/** The empty chat: what the agent is for, and a few things to start with. */
function AgentEmpty({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full border border-border-subtle bg-surface-muted text-fg-muted">
        <Icon name="spark" size={22} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 font-heading text-[20px] font-semibold text-fg">
          {t('features.assistantConversations.page.emptyTitle')}
        </h2>
        <Muted className="mx-auto max-w-[420px]">
          {t('features.assistantConversations.page.emptyBody')}
        </Muted>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((key) => {
          const text = t(`features.assistantConversations.page.${key}`)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onAsk(text)}
              className="cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-body text-fg hover:bg-surface-hover"
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
