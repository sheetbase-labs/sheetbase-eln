/**
 * Everything the frame talks to: the message channel, the confirmation the
 * person is asked for a write, and the state a page or Home card keeps here.
 *
 * Split from `plugin-frame.tsx` so the screen is only markup. The frame itself
 * is sandboxed (`ui-frame.ts`); this hook is its only listener and answers only
 * for the plugin the frame belongs to.
 */
import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { toast } from '#/components/ui/sonner'
import {
  HOST_CAPABILITIES,
  isHostCapability,
} from '#/lib/extensions/host-capabilities'
import { checkFrameTable } from '#/lib/extensions/frame-table'
import type { FrameTable } from '#/lib/extensions/frame-table'
import { runPluginHost, runPluginOperation } from '#/lib/extensions/run-client'
import type { PluginFramePoint } from '#/lib/extensions/ui-points'
import { t } from '#/copy'
import {
  HostRequestError,
  describeHostChange,
  runHostRequest,
} from './plugin-host'
import type { HostEnvironment } from './plugin-host'
import {
  frameObjectSchema,
  maxStateBytes,
  parseFrameMessage,
  readStoredState,
  readTheme,
  writeStoredState,
} from './plugin-frame-protocol'
import type {
  FrameQuestion,
  FrameReply,
  PluginFrameMessage,
  PluginScreenContext,
} from './plugin-frame-protocol'

/** The frame sends its own operation calls and their answers. */
type CallMessage = Extract<PluginFrameMessage, { type: 'call' }>

/** The frame asks the app to do something on its behalf. */
type HostMessage = Extract<PluginFrameMessage, { type: 'host' }>

/** Access of each operation the plugin declares, so a write can be confirmed. */
const operationAccessSchema = z.enum(['read', 'write'])

/** Everything a message needs, gathered once by the hook. */
interface FrameChannel {
  extensionKey: string
  point: PluginFramePoint
  operations: Record<string, 'read' | 'write'>
  scopes: readonly string[]
  insertBelow?: HostEnvironment['insertBelow']
  /** The record the screen is on, as the latest context names it. */
  recordId: () => string | null
  reply: (id: string, body: FrameReply) => void
  ask: (operation: string, detail?: string) => Promise<boolean>
  declined: string
}

/** The person's answer to a write, or a refusal stated in a sentence. */
async function confirmOrDecline(
  channel: FrameChannel,
  operation: string,
  detail?: string,
): Promise<FrameReply | null> {
  const allowed = await channel.ask(operation, detail)

  return allowed ? null : { ok: false, error: channel.declined }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A rejected call carries whatever was thrown; its message is read only when it is an Error.
function failureReply(error: unknown): FrameReply {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed.',
  }
}

/**
 * Any tool the MCP server has, by its MCP name. The server checks the plugin's
 * declared scopes and says when a change needs the person's yes.
 */
async function runHostCall(channel: FrameChannel, message: HostMessage) {
  const { id } = message
  const input = frameObjectSchema.safeParse(message.input).data ?? {}
  const name = z.string().safeParse(message.name).data

  if (name?.startsWith('sheetbase.')) {
    const run = (confirmed: boolean) =>
      runPluginHost({
        extensionKey: channel.extensionKey,
        point: channel.point,
        name,
        arguments: input,
        confirmed,
      })

    try {
      let output

      try {
        output = await run(false)
      } catch (error) {
        const code = z.object({ code: z.string() }).safeParse(error).data?.code

        if (code !== 'confirmation_needed') throw error
        const action = z.string().safeParse(input.action).data ?? name

        const declined = await confirmOrDecline(
          channel,
          action.replace(/_/g, ' '),
          '',
        )

        if (declined) {
          channel.reply(id, declined)

          return
        }

        output = await run(true)
      }

      channel.reply(id, { ok: true, output })
    } catch (error) {
      channel.reply(id, failureReply(error))
    }

    return
  }

  if (!isHostCapability(name)) {
    channel.reply(id, { ok: false, error: 'Sheetbase does not offer that.' })

    return
  }

  const capability = HOST_CAPABILITIES[name]

  if (!channel.scopes.includes(capability.scope)) {
    channel.reply(id, {
      ok: false,
      error: `This plugin did not ask for the access “${capability.scope}”, so it cannot do that.`,
    })

    return
  }

  if (capability.write) {
    const declined = await confirmOrDecline(
      channel,
      capability.summary,
      describeHostChange(name, input),
    )

    if (declined) {
      channel.reply(id, declined)

      return
    }
  }

  try {
    const output = await runHostRequest(name, input, {
      recordId: channel.recordId(),
      insertBelow: channel.insertBelow,
    })

    channel.reply(id, { ok: true, output })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed.'
    const code = error instanceof HostRequestError ? error.code : undefined

    channel.reply(
      id,
      code ? { ok: false, error: reason, code } : { ok: false, error: reason },
    )
  }
}

/** One of the plugin's own operations, run as the person. */
async function runOperationCall(channel: FrameChannel, message: CallMessage) {
  const { id } = message

  const access = operationAccessSchema.safeParse(
    channel.operations[message.operation],
  ).data

  const input = frameObjectSchema.safeParse(message.input).data ?? null

  if (!access || !input) {
    channel.reply(id, {
      ok: false,
      error: 'That operation is not part of this plugin.',
    })

    return
  }

  if (access === 'write') {
    const declined = await confirmOrDecline(channel, message.operation)

    if (declined) {
      channel.reply(id, declined)

      return
    }
  }

  try {
    const answer = await runPluginOperation(
      {
        extensionKey: channel.extensionKey,
        operationId: message.operation,
        input,
      },
      // The operation called into the app and one call changes something: the
      // person is asked about that call.
      async (confirmation) => {
        const declined = await confirmOrDecline(
          channel,
          confirmation.summary ??
            (confirmation.action ?? confirmation.name).replace(/_/g, ' '),
          '',
        )

        return declined === null
      },
      channel.declined,
    )

    channel.reply(id, { ok: true, output: answer.output })
  } catch (error) {
    channel.reply(id, failureReply(error))
  }
}

/** What a frame keeps: sent context and state, and the two messages that report it. */
export interface PluginFrameLink {
  frame: React.RefObject<HTMLIFrameElement | null>
  ready: boolean
  height: number
  table: FrameTable | null
  /** The write the person is being asked about, if any. */
  asking: FrameQuestion | null
}

export interface PluginFrameLinkOptions {
  extensionKey: string
  point: PluginFramePoint
  context: PluginScreenContext
  state?: unknown
  operations: Record<string, 'read' | 'write'>
  scopes?: readonly string[]
  insertBelow?: HostEnvironment['insertBelow']
  // The screen's own value and messages: opaque to the frame host, which keeps
  // or forwards exactly what the plugin sent.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The plugin's own state, stored or kept as it arrived.
  onState?: (state: unknown) => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The plugin's own payload for a named message, forwarded as it arrived.
  onEmit?: (name: string, payload: unknown) => void
  persist?: string
}

export function usePluginFrameLink(
  options: PluginFrameLinkOptions,
): PluginFrameLink {
  const {
    extensionKey,
    point,
    context,
    state,
    operations,
    scopes,
    insertBelow,
    onState,
    onEmit,
    persist,
  } = options

  const storageKey = persist ? `sb-plugin-state:${persist}` : null

  const [kept, setKept] = React.useState<unknown>(() =>
    readStoredState(storageKey),
  )

  const shownState = state !== undefined ? state : kept
  const router = useRouter()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(160)
  const [ready, setReady] = React.useState(false)
  const [table, setTable] = React.useState<FrameTable | null>(null)
  const [asking, setAsking] = React.useState<FrameQuestion | null>(null)
  const latest = React.useRef({ context, state: shownState })

  React.useEffect(() => {
    latest.current = { context, state: shownState }
  })

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
    const reply = (id: string, body: FrameReply) =>
      frame.current?.contentWindow?.postMessage(
        { sb: 1, type: 'result', id, ...body },
        '*',
      )

    const ask = (operation: string, detail?: string) =>
      new Promise<boolean>((resolve) => {
        setAsking({ operation, detail, decide: resolve })
      })

    const channel: FrameChannel = {
      extensionKey,
      point,
      operations,
      scopes: scopes ?? [],
      insertBelow,
      recordId: () =>
        z.string().safeParse(latest.current.context.recordId).data ?? null,
      reply,
      ask: async (operation, detail) => {
        const allowed = await ask(operation, detail)

        setAsking(null)

        return allowed
      },
      declined: t('plugins.screen.askDeclined'),
    }

    const onMessage = async (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const message = parseFrameMessage(event.data)

      if (!message) return

      switch (message.type) {
        case 'ready':
          setReady(true)
          sendContext()

          return
        case 'resize':
          setHeight(Math.max(60, Math.ceil(message.height)))

          return
        case 'table':
          setTable(checkFrameTable(message.table))

          return
        case 'emit':
          onEmit?.(message.name, message.payload)

          return
        case 'navigate':
          router.history.push(message.path)

          return
        case 'notify':
          if (message.tone === 'danger') toast.error(message.text)
          else toast(message.text)

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

          if (size <= maxStateBytes) {
            echo.current = JSON.stringify(message.state ?? null)
            onState?.(message.state)

            if (storageKey) {
              setKept(message.state)
              writeStoredState(storageKey, message.state)
            }
          }

          return
        }

        case 'host':
          await runHostCall(channel, message)

          return
        case 'call':
          await runOperationCall(channel, message)
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
    point,
  ])

  return { frame, ready, height, table, asking }
}
