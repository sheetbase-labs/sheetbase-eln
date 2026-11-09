/**
 * One plugin screen, wherever it appears (a notebook block, a record panel).
 *
 * A screen declared in Python is run on the server (`kind: 'screen'`), drawn by
 * `PluginView`, and run again with the person's event whenever they press a
 * button or send a form; the state it returns is passed back each time and, for
 * a block, handed to `onState` so it is kept with the block. A screen declared
 * as a UI bundle is hosted in the sandboxed frame instead.
 */
import * as React from 'react'

import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { runPluginHook } from '#/lib/extensions/run-client'
import type { PluginFramePoint } from '#/lib/extensions/ui-points'
import type { PluginHookAnswer } from '#/lib/extensions/run-client'
import type { ScreenNotice, ScreenResult } from '#/lib/extensions/screens'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { PluginFrame } from './plugin-frame'
import { PluginView } from './plugin-view'
import type { PluginValues } from './plugin-view'
import { TONE_CLASSES } from './tone'

export interface PluginScreenProps {
  extensionKey: string
  pluginName: string
  point: PluginFramePoint
  itemId: string
  title: string
  /** `screen`: a Python function describes it. `ui`: a bundle runs in the sandboxed frame. */
  source: 'screen' | 'ui'
  context: Record<string, unknown>
  state?: unknown
  onState?: (state: unknown) => void
  operations: Record<string, 'read' | 'write'>
  /** What the plugin declares it may reach; unlocks `sheetbase.host` in a UI bundle. */
  scopes?: readonly string[]
  /** Put a block below this one (editable notebooks only). */
  insertBelow?: (type: string, payload: Record<string, unknown>) => void
  className?: string
}

export function PluginScreen(props: PluginScreenProps) {
  if (props.source === 'ui')
    return (
      <PluginFrame
        extensionKey={props.extensionKey}
        pluginName={props.pluginName}
        point={props.point}
        itemId={props.itemId}
        title={props.title}
        context={props.context}
        state={props.state}
        operations={props.operations}
        scopes={props.scopes}
        insertBelow={props.insertBelow}
        onState={props.onState}
        className={props.className}
      />
    )

  return <PythonScreen {...props} />
}

function PythonScreen({
  extensionKey,
  point,
  itemId,
  context,
  state,
  onState,
  className,
}: PluginScreenProps) {
  const [result, setResult] = React.useState<ScreenResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<ScreenNotice | null>(null)
  const kept = React.useRef<unknown>(state)
  const contextKey = JSON.stringify(context)
  // The caller's handler changes as the block is saved; drawing must not start over each time.
  const keep = React.useRef(onState)
  keep.current = onState

  const run = React.useCallback(
    async (event: { action: string; values: PluginValues } | null) => {
      setBusy(true)
      setError(null)

      try {
        const answer = await runPluginHook<
          Extract<PluginHookAnswer, { kind: 'screen' }>
        >({
          kind: 'screen',
          extensionKey,
          point: point as 'blocks' | 'panels',
          itemId,
          context: JSON.parse(contextKey) as Record<string, unknown>,
          state: kept.current,
          event,
        })

        setResult(answer)
        setNotice(answer.notice ?? null)

        // Drawing the screen for the first time is not a change; only what a
        // person did is kept with the block.
        if (
          event !== null &&
          answer.state !== undefined &&
          JSON.stringify(answer.state) !== JSON.stringify(kept.current)
        ) {
          kept.current = answer.state
          keep.current?.(answer.state)
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy(false)
      }
    },
    [extensionKey, point, itemId, contextKey],
  )

  React.useEffect(() => {
    void run(null)
  }, [run])

  if (error && !result)
    return (
      <div className={cn('flex flex-col items-start gap-2', className)}>
        <p role="alert" className="m-0 text-body text-danger-text">
          {t('plugins.screen.failed', { reason: error })}
        </p>
        <Button size="sm" onClick={() => void run(null)}>
          {t('plugins.screen.retry')}
        </Button>
      </div>
    )

  if (!result)
    return (
      <div className={cn('flex items-center gap-2 text-fg-muted', className)}>
        <Spinner />
        <span className="text-body">{t('plugins.screen.loading')}</span>
      </div>
    )

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {notice ? (
        <p
          role="status"
          className={cn(
            'm-0 rounded-md px-2.5 py-1.5 text-body',
            TONE_CLASSES[notice.tone],
          )}
        >
          {notice.text}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-body text-danger-text">
          {error}
        </p>
      ) : null}
      <PluginView
        view={result.view}
        busy={busy}
        onEvent={(action, values) => void run({ action, values })}
      />
    </div>
  )
}
