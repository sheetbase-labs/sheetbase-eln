import { useEffect, useMemo, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Muted } from '#/components/v3/ui/layout'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Sheet, SheetContent } from '#/components/v3/ui/sheet'
import {
  OPEN_ASSISTANT_EVENT,
  contextFromPathname,
  contextKindLabel,
} from '#/lib/assistant-context'
import type { AssistantPageContext } from '#/lib/assistant-context'
import type { AskAssistantResult } from '#/lib/assistant'
import { aiReadinessMessage } from '#/lib/ai-settings'

/**
 * ASSIST-04 — the global assistant surface.
 *
 * One panel, available on every page. It sends only the question and the
 * current page's stable id; canonical reads and RLS happen server-side. The
 * answer is explicitly labelled as generated, carries its sources, and offers
 * no write action: a draft is copied or applied through the ordinary product
 * operation, never by the assistant.
 *
 * The query/mutation body mounts only while the panel is open. The shell
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
    <Sheet open={open} onOpenChange={setOpen}>
      {open ? (
        <SheetContent
          side="auto"
          title="Assistant"
          className="lg:w-[420px]"
          data-testid="assistant-panel"
        >
          <AssistantPanelContent
            workspaceId={workspaceId}
            role={role}
            context={context}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  )
}

function AssistantPanelContent({
  workspaceId,
  role,
  context,
}: {
  workspaceId: string | null
  role: string | null
  context: AssistantPageContext | null
}) {
  const [question, setQuestion] = useState('')
  const [copied, setCopied] = useState(false)

  const settingsQuery = useQuery({
    queryKey: ['ai-settings', workspaceId],
    queryFn: async () => {
      // Loaded on open, not at module scope: the shell renders this panel on
      // every page, and a top-level server-function import would make every
      // shell test (and the initial bundle) carry it.
      const { getAiSettingsFn } = await import('#/lib/ai-settings-actions')
      return getAiSettingsFn({
        data: { workspaceId: workspaceId ?? '' },
      })
    },
    enabled: Boolean(workspaceId),
  })
  const ask = useMutation({
    mutationFn: async (input: {
      question: string
      context: AssistantPageContext | null
    }) => {
      const { askAssistantFn } = await import('#/lib/assistant-actions')
      return askAssistantFn({
        data: {
          workspaceId: workspaceId ?? '',
          question: input.question,
          objectRefs: input.context
            ? [{ kind: input.context.kind, id: input.context.id }]
            : [],
        },
      })
    },
  })

  const readiness = settingsQuery.data?.readiness
  const ready = readiness?.ready ?? false
  const result: AskAssistantResult | undefined = ask.data
  const canAsk =
    Boolean(workspaceId) &&
    ready &&
    question.trim().length > 0 &&
    !ask.isPending

  function submit() {
    if (!canAsk) return
    ask.mutate({ question: question.trim(), context })
  }

  async function copyAnswer() {
    if (result?.status !== 'ok') return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      // Clipboard permission is not guaranteed; the answer stays selectable.
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2">
        <span className="mt-0.5 rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
          Page context
        </span>
        <span className="min-w-0 text-label text-fg">
          {context ? (
            <>
              {contextKindLabel(context.kind)}{' '}
              <span className="num text-fg-muted">
                {context.id.slice(0, 8)}…{context.id.slice(-4)}
              </span>
            </>
          ) : (
            'No stable object on this page.'
          )}
        </span>
      </div>

      {!workspaceId ? (
        <Notice tone="warn" title="No active workspace">
          Choose a workspace before asking the assistant.
        </Notice>
      ) : settingsQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : settingsQuery.isError ? (
        <Notice tone="bad" title="AI policy could not be loaded">
          Reload the page and try again.
        </Notice>
      ) : readiness && !readiness.ready ? (
        <Notice
          tone={readiness.reason === 'disabled' ? 'info' : 'warn'}
          title="Assistant unavailable"
          data-testid="assistant-disabled"
        >
          {aiReadinessMessage(readiness)}
          {readiness.reason === 'disabled' && role === 'owner' ? (
            <>
              {' '}
              <Link
                to="/settings/ai"
                className="font-medium text-fg underline underline-offset-2"
              >
                Open AI settings
              </Link>
              .
            </>
          ) : null}
        </Notice>
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="flex flex-col gap-1 text-label">
          <span className="font-medium text-fg">Ask about this page</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit()
              }
            }}
            rows={3}
            maxLength={2_000}
            placeholder="What should I check before submitting this notebook?"
            disabled={!ready || ask.isPending}
            data-testid="assistant-question"
            className="min-h-[84px] w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:bg-surface-disabled disabled:text-fg-muted"
          />
        </label>
        <div className="flex items-center gap-2">
          <Muted className="flex-1">
            {context
              ? `Uses the ${contextKindLabel(context.kind).toLowerCase()} id only; no page text is scraped.`
              : 'Adds no object context.'}
          </Muted>
          <Button
            type="submit"
            variant="primary"
            disabled={!canAsk}
            data-testid="assistant-ask"
          >
            {ask.isPending ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
      </form>

      {ask.isError ? (
        <Notice tone="bad" title="The request failed">
          {ask.error instanceof Error
            ? ask.error.message
            : 'Try again, or ask a workspace owner to check the AI policy.'}
        </Notice>
      ) : null}

      {result?.status === 'unavailable' ? (
        <Notice tone="warn" title="Assistant unavailable">
          {result.message}
        </Notice>
      ) : null}

      {result?.status === 'error' ? (
        <Notice tone="bad" title="The assistant could not answer">
          {result.message}
        </Notice>
      ) : null}

      {result?.status === 'ok' ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
          aria-live="polite"
          data-testid="assistant-answer"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg">
              AI-generated
            </span>
            <span className="text-label text-fg-muted">
              {result.mode === 'built-in'
                ? 'Built-in deterministic model · no external provider'
                : `Provider · ${result.providerProfile}`}
            </span>
          </div>

          <p className="m-0 whitespace-pre-wrap text-body leading-6 text-fg">
            {result.text}
          </p>

          {result.sources.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="m-0 text-label font-medium text-fg">Sources</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {result.sources.map((source) => (
                  <li
                    key={`${source.kind}:${source.id}`}
                    className="flex flex-col gap-0.5 border-l-2 border-border-subtle pl-2"
                    data-testid="assistant-source"
                  >
                    <a
                      href={source.deepLink ?? '#'}
                      className="truncate text-label font-medium text-fg"
                      title={source.id}
                    >
                      {source.title || source.id}
                    </a>
                    <span className="text-[11px] text-fg-muted">
                      {contextKindLabel(source.kind)} · {source.freshness}
                      {source.pins.length > 0
                        ? ` · ${source.pins.map((pin) => pin.detail).join(' · ')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Muted>No Sheetbase object was cited for this answer.</Muted>
          )}

          <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
            <Muted className="flex-1">
              {result.usage.tokensUsed.toLocaleString('en-GB')} tokens · $
              {(result.usage.costMicrousd / 1_000_000).toFixed(4)} estimated
            </Muted>
            <Button size="sm" variant="secondary" onClick={copyAnswer}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}

      <Muted>
        AI output is assistive. Verify it against the cited sources. It is not a
        signature, approval or authoritative scientific result.
      </Muted>
    </div>
  )
}
