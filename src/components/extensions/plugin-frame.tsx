/**
 * Hosts a plugin's UI bundle in a sandboxed frame.
 *
 * The frame has `sandbox="allow-scripts"` and no `allow-same-origin`, so it has
 * no cookies or storage and cannot read this page; the document is served with
 * a policy that allows no network (`ui-frame.ts`). Its only way out is the SDK's
 * `postMessage` channel, and this component is the only listener: it ignores any
 * message that does not come from its own frame window, checks the shape, and
 * answers only for the plugin the frame belongs to.
 *
 * - `call` runs one of the plugin's own operations as the person. A read runs
 *   straight away; an operation that changes something first asks the person,
 *   because the frame could press its own buttons.
 * - `state` is kept with the block (the caller decides how).
 * - `notify` shows a toast; `resize` sizes the frame.
 */
import * as React from 'react'

import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { toast } from '#/components/ui/sonner'
import { Spinner } from '#/components/ui/spinner'
import { runPluginHook } from '#/lib/extensions/run-client'
import { t } from '#/copy'

const TOKENS: Record<string, string> = {
  '--sb-bg': '--background',
  '--sb-surface': '--card',
  '--sb-fg': '--foreground',
  '--sb-muted': '--muted-foreground',
  '--sb-border': '--border',
  '--sb-primary': '--primary',
  '--sb-primary-fg': '--primary-foreground',
  '--sb-success': '--success',
  '--sb-warning': '--warning',
  '--sb-danger': '--destructive',
  '--sb-info': '--info',
}

function readTheme() {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const tokens: Record<string, string> = {}
  for (const [name, source] of Object.entries(TOKENS)) {
    const value = styles.getPropertyValue(source).trim()
    if (value) tokens[name] = value
  }
  return {
    theme: root.dataset.theme === 'dark' ? 'dark' : 'light',
    tokens,
  }
}

const MAX_STATE_BYTES = 64 * 1024
const NOTICE_TONES = ['neutral', 'success', 'warning', 'danger', 'info']

export interface PluginFrameProps {
  extensionKey: string
  pluginName: string
  point: 'blocks' | 'panels'
  itemId: string
  title: string
  context: Record<string, unknown>
  state?: unknown
  /** Access of each operation the plugin declares, so a write can be confirmed. */
  operations: Record<string, 'read' | 'write'>
  onState?: (state: unknown) => void
  className?: string
}

export function PluginFrame(props: PluginFrameProps) {
  const {
    extensionKey,
    pluginName,
    point,
    itemId,
    title,
    context,
    state,
    operations,
    onState,
    className,
  } = props
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(160)
  const [ready, setReady] = React.useState(false)
  const [asking, setAsking] = React.useState<{
    operation: string
    decide: (run: boolean) => void
  } | null>(null)
  const latest = React.useRef({ context, state })
  latest.current = { context, state }

  const sendContext = React.useCallback(() => {
    const target = frame.current?.contentWindow
    if (!target) return
    target.postMessage(
      {
        sb: 1,
        type: 'context',
        context: latest.current.context,
        state: latest.current.state ?? null,
        ...readTheme(),
      },
      '*',
    )
  }, [])

  // New context or state: tell the frame, once it has said it is ready. What
  // the frame itself just kept comes back as `state` when the block is saved;
  // sending that back would only undo a click made since, so it is skipped.
  const contextKey = JSON.stringify(context)
  const stateKey = JSON.stringify(state ?? null)
  const sent = React.useRef<{ context: string; state: string } | null>(null)
  const echo = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!ready) return
    const before = sent.current
    sent.current = { context: contextKey, state: stateKey }
    if (
      before &&
      before.context === contextKey &&
      (before.state === stateKey || echo.current === stateKey)
    )
      return
    sendContext()
  }, [ready, contextKey, stateKey, sendContext])

  // The theme can change while the frame is open.
  React.useEffect(() => {
    if (!ready) return
    const observer = new MutationObserver(sendContext)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [ready, sendContext])

  React.useEffect(() => {
    const reply = (id: string, body: Record<string, unknown>) =>
      frame.current?.contentWindow?.postMessage(
        { sb: 1, type: 'result', id, ...body },
        '*',
      )
    const onMessage = async (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const data: unknown = event.data
      if (
        typeof data !== 'object' ||
        data === null ||
        (data as { sb?: unknown }).sb !== 1
      )
        return
      const message = data as Record<string, unknown>
      switch (message.type) {
        case 'ready':
          setReady(true)
          sendContext()
          return
        case 'resize':
          if (
            typeof message.height === 'number' &&
            Number.isFinite(message.height)
          )
            setHeight(Math.min(900, Math.max(60, Math.ceil(message.height))))
          return
        case 'notify':
          if (
            typeof message.text === 'string' &&
            message.text.length <= 300 &&
            NOTICE_TONES.includes(String(message.tone))
          ) {
            if (message.tone === 'danger') toast.error(message.text)
            else toast(message.text)
          }
          return
        case 'state': {
          let size = Infinity
          try {
            size = new TextEncoder().encode(
              JSON.stringify(message.state),
            ).length
          } catch {
            /* not JSON */
          }
          if (size <= MAX_STATE_BYTES) {
            echo.current = JSON.stringify(message.state ?? null)
            onState?.(message.state)
          }
          return
        }
        case 'call': {
          const id = typeof message.id === 'string' ? message.id : ''
          const operation =
            typeof message.operation === 'string' ? message.operation : ''
          const input =
            typeof message.input === 'object' &&
            message.input !== null &&
            !Array.isArray(message.input)
              ? (message.input as Record<string, unknown>)
              : null
          if (!id) return
          const access = operations[operation]
          if (!access || !input) {
            reply(id, {
              ok: false,
              error: 'That operation is not part of this plugin.',
            })
            return
          }
          if (access === 'write') {
            const allowed = await new Promise<boolean>((resolve) =>
              setAsking({ operation, decide: resolve }),
            )
            setAsking(null)
            if (!allowed) {
              reply(id, { ok: false, error: t('plugins.screen.askDeclined') })
              return
            }
          }
          try {
            const answer = await runPluginHook<{ output: unknown }>({
              kind: 'operation',
              extensionKey,
              operationId: operation,
              input,
            })
            reply(id, { ok: true, output: answer.output })
          } catch (error) {
            reply(id, {
              ok: false,
              error: error instanceof Error ? error.message : 'Failed.',
            })
          }
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [extensionKey, operations, onState, sendContext])

  return (
    <div className={className}>
      <div className="relative">
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        ) : null}
        <iframe
          ref={frame}
          title={t('plugins.screen.frameTitle', {
            name: title,
            plugin: pluginName,
          })}
          src={`/api/plugins/${extensionKey}/ui/${itemId}?point=${point}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block w-full border-0 bg-transparent"
          style={{ height }}
        />
      </div>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) asking?.decide(false)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('plugins.screen.askTitle', {
                plugin: pluginName,
                operation: asking?.operation ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('plugins.screen.askBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('plugins.screen.askCancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction onClick={() => asking?.decide(true)}>
              {t('plugins.screen.askRun')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
