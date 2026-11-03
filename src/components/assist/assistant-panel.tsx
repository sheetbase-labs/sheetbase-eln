import { t } from '#/copy'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { useKeyboardInset } from '#/lib/use-keyboard-inset'
import { Icon } from '#/components/icons'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Sheet, SheetContent } from '#/components/v3/ui/sheet'
import {
  OPEN_ASSISTANT_EVENT,
  contextFromPathname,
} from '#/lib/assistant-context'

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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const context = useMemo(() => contextFromPathname(pathname), [pathname])
  useKeyboardInset(open)

  useEffect(() => {
    const onOpen = () => setOpen(true)
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
      {/* Phones have no room for it in the top bar, so it floats in the bottom-left
          corner, clear of the Details button on the right. It hides while the panel is open. */}
      {open || workspaceId === null ? null : (
        <button
          type="button"
          aria-label={t('notebook.askAiButton.ariaLabel')}
          data-testid="assistant-fab"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-4 z-40 inline-flex size-12 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-primary shadow-overlay hover:bg-surface-hover md:hidden"
        >
          <Icon name="spark" size={20} />
        </button>
      )}
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
              />
            </Suspense>
          </SheetContent>
        ) : null}
      </Sheet>
    </>
  )
}
