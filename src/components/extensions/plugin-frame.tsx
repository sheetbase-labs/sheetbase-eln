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
import { useRouter } from '@tanstack/react-router'

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
import { PluginTable } from './plugin-table'
import {
  HostRequestError,
  describeHostChange,
  runHostRequest,
} from './plugin-host'
import {
  HOST_CAPABILITIES,
  isHostCapability,
} from '#/lib/extensions/host-capabilities'
import { checkFrameTable } from '#/lib/extensions/frame-table'
import type { FrameTable } from '#/lib/extensions/frame-table'
import { runPluginHost, runPluginOperation } from '#/lib/extensions/run-client'
import type { PluginFramePoint } from '#/lib/extensions/ui-points'
import { cn } from '#/lib/utils'
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

/** Same-site paths only: never a full address, a script or a protocol-relative link. */
const INTERNAL_PATH_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/

export function readTheme() {
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

/** State is kept with the block in the database; this only guards against a runaway loop. */
const MAX_STATE_BYTES = 4 * 1024 * 1024
const NOTICE_TONES = ['neutral', 'success', 'warning', 'danger', 'info']

export interface PluginFrameProps {
  extensionKey: string
  pluginName: string
  point: PluginFramePoint
  itemId: string
  title: string
  context: Record<string, unknown>
  state?: unknown
  /** Access of each operation the plugin declares, so a write can be confirmed. */
  operations: Record<string, 'read' | 'write'>
  /** What the plugin's manifest declares it may reach (`permissions`); unlocks `sheetbase.host` calls. */
  scopes?: readonly string[]
  /** Put a block below this one, where the screen is in an editable notebook. */
  insertBelow?: (type: string, payload: Record<string, unknown>) => void
  onState?: (state: unknown) => void
  /** Messages the screen sends up by name: `value` (a field input), `section` (a report section). */
  onEmit?: (name: string, payload: unknown) => void
  /** Fill the space around the frame (a page) instead of growing with the content. */
  fill?: boolean
  /**
   * Keep what the screen saves with `setState` in this browser, under this
   * name, for the signed-in person: for a page, settings page or Home card,
   * which have no block to keep it with. Not shared with anyone else.
   */
  persist?: string
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
    scopes,
    insertBelow,
    onState,
    onEmit,
    fill,
    persist,
    className,
  } = props

  const storageKey = persist ? `sb-plugin-state:${persist}` : null

  const [kept, setKept] = React.useState<unknown>(() => {
    if (!storageKey) return undefined

    try {
      const raw = localStorage.getItem(storageKey)

      return raw === null ? undefined : (JSON.parse(raw) as unknown)
    } catch {
      return undefined
    }
  })

  const shownState = state !== undefined ? state : kept
  const router = useRouter()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(160)
  const [ready, setReady] = React.useState(false)
  const [table, setTable] = React.useState<FrameTable | null>(null)

  const [asking, setAsking] = React.useState<{
    operation: string
    detail?: string
    decide: (run: boolean) => void
  } | null>(null)

  const latest = React.useRef({ context, state: shownState })
  latest.current = { context, state: shownState }

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
  const stateKey = JSON.stringify(shownState ?? null)
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
            setHeight(Math.max(60, Math.ceil(message.height)))

          return
        case 'table':
          setTable(checkFrameTable(message.table))

          return
        case 'emit':
          if (typeof message.name === 'string' && message.name.length <= 40)
            onEmit?.(message.name, message.payload)

          return
        case 'navigate':
          if (
            typeof message.path === 'string' &&
            message.path.length <= 500 &&
            INTERNAL_PATH_RE.test(message.path)
          )
            router.history.push(message.path)

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

            if (storageKey) {
              setKept(message.state)

              try {
                localStorage.setItem(storageKey, JSON.stringify(message.state))
              } catch {
                /* storage is off: the state lasts until the page closes */
              }
            }
          }

          return
        }

        case 'host': {
          const id = typeof message.id === 'string' ? message.id : ''

          if (!id) return
          const name = message.name

          const input =
            typeof message.input === 'object' &&
            message.input !== null &&
            !Array.isArray(message.input)
              ? (message.input as Record<string, unknown>)
              : {}

          if (typeof name === 'string' && name.startsWith('sheetbase.')) {
            // Any tool the MCP server has, by its MCP name. The server checks
            // the plugin's declared scopes and says when a change needs the
            // person's yes.
            const run = (confirmed: boolean) =>
              runPluginHost({
                extensionKey,
                point,
                name,
                arguments: input,
                confirmed,
              })

            try {
              let output

              try {
                output = await run(false)
              } catch (error) {
                if ((error as { code?: string }).code !== 'confirmation_needed')
                  throw error

                const action =
                  typeof input.action === 'string' ? input.action : name

                const allowed = await new Promise<boolean>((resolve) =>
                  setAsking({
                    operation: action.replace(/_/g, ' '),
                    detail: '',
                    decide: resolve,
                  }),
                )

                setAsking(null)

                if (!allowed) {
                  reply(id, {
                    ok: false,
                    error: t('plugins.screen.askDeclined'),
                  })

                  return
                }

                output = await run(true)
              }

              reply(id, { ok: true, output })
            } catch (error) {
              reply(id, {
                ok: false,
                error: error instanceof Error ? error.message : 'Failed.',
              })
            }

            return
          }

          if (!isHostCapability(name)) {
            reply(id, { ok: false, error: 'Sheetbase does not offer that.' })

            return
          }

          const capability = HOST_CAPABILITIES[name]

          if (!(scopes ?? []).includes(capability.scope)) {
            reply(id, {
              ok: false,
              error: `This plugin did not ask for the access “${capability.scope}”, so it cannot do that.`,
            })

            return
          }

          if (capability.write) {
            const allowed = await new Promise<boolean>((resolve) =>
              setAsking({
                operation: capability.summary,
                detail: describeHostChange(name, input),
                decide: resolve,
              }),
            )

            setAsking(null)

            if (!allowed) {
              reply(id, { ok: false, error: t('plugins.screen.askDeclined') })

              return
            }
          }

          try {
            const output = await runHostRequest(name, input, {
              recordId:
                typeof latest.current.context.recordId === 'string'
                  ? latest.current.context.recordId
                  : null,
              insertBelow,
            })

            reply(id, { ok: true, output })
          } catch (error) {
            reply(id, {
              ok: false,
              error: error instanceof Error ? error.message : 'Failed.',
              ...(error instanceof HostRequestError && error.code
                ? { code: error.code }
                : {}),
            })
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
          const access = operations[operation] as 'read' | 'write' | undefined

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
            const answer = await runPluginOperation(
              { extensionKey, operationId: operation, input },
              // The operation called into the app and one call changes
              // something: the person is asked about that call.
              async (confirmation) => {
                const allowed = await new Promise<boolean>((resolve) =>
                  setAsking({
                    operation:
                      confirmation.summary ??
                      (confirmation.action ?? confirmation.name).replace(
                        /_/g,
                        ' ',
                      ),
                    detail: '',
                    decide: resolve,
                  }),
                )

                setAsking(null)

                return allowed
              },
              t('plugins.screen.askDeclined'),
            )

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
  }, [
    extensionKey,
    operations,
    scopes,
    insertBelow,
    onState,
    onEmit,
    router,
    sendContext,
    storageKey,
  ])

  return (
    <div
      className={cn(
        fill && !table && 'h-full',
        fill && table && 'overflow-y-auto',
        className,
      )}
    >
      <div className={cn('relative', fill && !table && 'h-full')}>
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
          style={{ height: fill && !table ? '100%' : height }}
        />
      </div>
      {table ? (
        <div className={cn(fill && 'px-6 pb-6')}>
          <PluginTable table={table} />
        </div>
      ) : null}
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
              {asking?.detail ? `${asking.detail} ` : ''}
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
