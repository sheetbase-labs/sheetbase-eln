import { t } from '#/copy'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { useKeyboardInset } from '#/lib/use-keyboard-inset'
import { Skeleton } from '#/components/ui/skeleton'
import { Sheet, SheetContent } from '#/components/ui/sheet'
import {
  OPEN_ASSISTANT_EVENT,
  contextFromPathname,
} from '#/lib/assistant-context'
import type { OpenAssistantDetail } from '#/lib/assistant-context'
import { pageFromPathname } from './assistant-page'

// The chat library loads when the panel first opens, not with the shell.
const AssistantChat = lazy(() => import('./assistant-chat'))

/**
 * ASSIST-04 — the global assistant surface.
 *
 * One panel, available on every page: a chat. It sends the conversation and
 * the current page's stable id, never page text; canonical reads and RLS
 * happen server-side. Answers stream in, are explicitly labelled as generated,
 * carry their sources, and offer no write action: a draft is copied or applied
 * through the ordinary product operation, never by the assistant.
 *
 * The chat body mounts only while the panel is open. The shell
 * renders this component on every page, including tests that intentionally
 * have no QueryClient, so closed must stay inert.
 */
export function AssistantPanel({
  workspaceId,
  role,
}: {
  workspaceId: string | null
  role: string | null
}) {
  const [open, setOpen] = useState(false)
  // A question the opener asked for, sent once the chat is ready.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const searchStr = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const context = useMemo(() => contextFromPathname(pathname), [pathname])
  const page = useMemo(
    () => pageFromPathname(pathname, searchStr),
    [pathname, searchStr],
  )
  useKeyboardInset(open)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenAssistantDetail | undefined>)
        .detail
      if (detail?.prompt) setPendingPrompt(detail.prompt)
      setOpen(true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        {open ? (
          <SheetContent
            side="auto"
            title={t('notebook.assistantPanel.title')}
            className="h-[85dvh] max-lg:bottom-[var(--kb-inset,0px)] max-lg:h-[min(85dvh,var(--vv-height,85dvh))] lg:h-dvh lg:w-[440px]"
            data-testid="assistant-panel"
          >
            <Suspense
              fallback={
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-16 w-full" />
                </div>
              }
            >
              <AssistantChat
                workspaceId={workspaceId}
                role={role}
                context={context}
                page={page}
                initialPrompt={pendingPrompt}
                onInitialPromptSent={() => setPendingPrompt(null)}
              />
            </Suspense>
          </SheetContent>
        ) : null}
      </Sheet>
    </>
  )
}
