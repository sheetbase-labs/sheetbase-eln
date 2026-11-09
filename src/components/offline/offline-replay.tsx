'use client'

/**
 * EXP-05.3 — the reconnect trigger for offline replay.
 *
 * The device store holds the drafts; `replayOfflineEdits` knows how to send
 * them. This component is the seam between them and the connection: when the
 * live-event stream becomes `live` (the connection returned), or a tab mounts
 * already live with drafts waiting, it replays the queue once, refreshes the
 * unsynced list, and reports the result.
 *
 * It states what it could not send rather than hiding it: while a conflict is
 * unresolved, or an edit is held behind one or was refused, a notice says so.
 * Renders nothing when every edit committed.
 */

import { t } from '#/copy'
import * as React from 'react'

import { useLiveStatus } from '#/components/live/live-event-provider'
import { Notice } from '#/components/ui/alert'
import {
  createCanonicalOfflineReplayWriter,
  replayOfflineEdits,
  shouldReplayOfflineEdits,
} from '#/lib/offline/replay'
import type {
  OfflineReplayOutcome,
  OfflineReplayPort,
  OfflineReplayReport,
} from '#/lib/offline/replay'
import type {
  OfflineEdit,
  OfflineEditScope,
  OfflineEditStore,
} from '#/lib/offline/store'
import type { LiveStatus } from '#/lib/live-events'
import { OFFLINE_SYNC_EVENT } from '#/lib/offline/service-worker'
import { Button } from '#/components/ui/button'
import { BlockConflictDiff } from './block-conflict-diff'
import { describeOfflineEdit, useOfflineEdits } from './offline-edits'

export interface OfflineReplayRunnerProps {
  store: OfflineEditStore
  scope: OfflineEditScope
  /** Defaults to the canonical write path against `/api/db`. */
  port?: OfflineReplayPort
  /** Called once per replay with everything the queue did. */
  onReport?: (report: OfflineReplayReport) => void
  /** The connection status to react to; defaults to the live-event stream. */
  status?: LiveStatus
  className?: string
}

/** True when a report has work a person still has to deal with. */
function unresolved(report: OfflineReplayReport): boolean {
  return (
    report.conflicts.length > 0 ||
    report.held.length > 0 ||
    report.failed.length > 0
  )
}

function noticeTone(report: OfflineReplayReport): 'warn' | 'bad' {
  return report.failed.length > 0 ? 'bad' : 'warn'
}

export function OfflineReplayRunner({
  store,
  scope,
  port,
  onReport,
  status: statusOverride,
  className,
}: OfflineReplayRunnerProps) {
  const liveStatus = useLiveStatus()
  const status = statusOverride ?? liveStatus
  const { refresh, edits } = useOfflineEdits()
  const [report, setReport] = React.useState<OfflineReplayReport | null>(null)
  const previousStatus = React.useRef<string | null>(null)
  const running = React.useRef(false)
  const [retrying, setRetrying] = React.useState(false)
  const [confirming, setConfirming] = React.useState<string | null>(null)
  const mounted = React.useRef(true)
  const { userId, recordId } = scope

  React.useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const writer = React.useMemo(
    () => port ?? createCanonicalOfflineReplayWriter({ userId, recordId }),
    [port, userId, recordId],
  )

  const runReplay = React.useCallback(async () => {
    if (running.current) return
    running.current = true
    setRetrying(true)

    try {
      const next = await replayOfflineEdits({
        scope: { userId, recordId },
        store,
        port: writer,
      })

      if (!mounted.current) return
      setReport(next)
      onReport?.(next)
      // A retry or an earlier discard changes what the list shows even when
      // nothing committed, so always re-read the store.
      refresh()
    } finally {
      running.current = false

      if (mounted.current) setRetrying(false)
    }
  }, [store, userId, recordId, writer, refresh, onReport])

  React.useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = status.status

    // `null` is the mount case: a tab that loads already live also has drafts
    // to send, so the first live status counts as the reconnect.
    if (
      previous !== null &&
      !shouldReplayOfflineEdits(previous, status.status)
    ) {
      return
    }

    if (previous === null && status.status !== 'live') return
    void runReplay()
  }, [status.status, runReplay])

  // Background sync: the service worker wakes this window when the browser
  // regains a connection, even if the live stream has not reconnected yet.
  React.useEffect(() => {
    const onSync = () => void runReplay()
    window.addEventListener(OFFLINE_SYNC_EVENT, onSync)

    return () => window.removeEventListener(OFFLINE_SYNC_EVENT, onSync)
  }, [runReplay])

  const keepMine = React.useCallback(
    async (edit: OfflineEdit) => {
      if (edit.kind !== 'block_payload' || !writer.keepMyBlockEdit) return

      try {
        await writer.keepMyBlockEdit(edit)
      } catch {
        // Still queued; the next replay says why.
        await runReplay()

        return
      }

      await store.removeEdits({ userId, recordId }, [edit.id])
      setReport((current) =>
        current
          ? {
              ...current,
              conflicts: current.conflicts.filter((o) => o.editId !== edit.id),
              held: current.held.filter((o) => o.editId !== edit.id),
            }
          : current,
      )
      refresh()
    },
    [writer, store, userId, recordId, refresh, runReplay],
  )

  const discard = React.useCallback(
    async (editId: string) => {
      await store.removeEdits({ userId, recordId }, [editId])
      setConfirming(null)
      setReport((current) =>
        current
          ? {
              ...current,
              conflicts: current.conflicts.filter((o) => o.editId !== editId),
              held: current.held.filter((o) => o.editId !== editId),
              failed: current.failed.filter((o) => o.editId !== editId),
            }
          : current,
      )
      refresh()
    },
    [store, userId, recordId, refresh],
  )

  if (!report || !unresolved(report)) return null

  const conflictCount = report.conflicts.length + report.held.length

  const unresolvedOutcomes: OfflineReplayOutcome[] = [
    ...report.conflicts,
    ...report.held,
    ...report.failed,
  ].sort((a, b) => a.sequence - b.sequence)

  return (
    <Notice
      tone={noticeTone(report)}
      className={className}
      title={t('notebook.offlineReplay.title')}
      action={
        <Button size="sm" disabled={retrying} onClick={() => void runReplay()}>
          {retrying
            ? t('notebook.offlineReplay.trying')
            : t('notebook.offlineReplay.tryAgainNow')}
        </Button>
      }
    >
      {conflictCount > 0 ? (
        <span>
          {t('notebook.offlineReplay.conflicts', { count: conflictCount })}
          {report.heldCalculations.length > 0
            ? t('notebook.offlineReplay.dependentCalculationsAreHeld')
            : ''}
          .{' '}
        </span>
      ) : null}
      {report.failed.length > 0 ? (
        <span>
          {t('notebook.offlineReplay.refused', {
            count: report.failed.length,
          })}
        </span>
      ) : null}
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {unresolvedOutcomes.map((outcome) => {
          const edit = edits.find((e) => e.id === outcome.editId)
          const description = edit ? describeOfflineEdit(edit) : null

          return (
            <li
              key={outcome.editId}
              data-offline-unresolved-edit
              className="flex flex-col gap-1 text-label"
            >
              <span className="font-medium">
                {edit?.kind === 'block_payload' && description
                  ? description.title
                  : description
                    ? `${description.title}: ${description.detail}`
                    : t('notebook.offlineReplay.anEditMadeOffline')}
              </span>
              {edit?.kind === 'block_payload' ? null : (
                <span>{outcome.message}</span>
              )}
              {edit?.kind === 'block_payload' &&
              outcome.status === 'conflict' ? (
                <BlockConflictDiff edit={edit} port={writer} />
              ) : null}
              <span className="flex flex-wrap gap-1.5">
                {edit?.kind === 'block_text' ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void navigator.clipboard.writeText(edit.text)
                    }
                  >
                    {t('notebook.offlineReplay.copyText')}
                  </Button>
                ) : null}
                {edit?.kind === 'block_payload' &&
                outcome.status === 'conflict' ? (
                  <Button size="sm" onClick={() => void keepMine(edit)}>
                    {t('notebook.offlineReplay.keepMine')}
                  </Button>
                ) : null}
                {confirming === outcome.editId ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void discard(outcome.editId)}
                    >
                      {t('notebook.offlineReplay.discardThisEditFor')}
                    </Button>
                    <Button size="sm" onClick={() => setConfirming(null)}>
                      {t('notebook.offlineReplay.keepIt')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setConfirming(outcome.editId)}
                  >
                    {edit?.kind === 'block_payload' &&
                    outcome.status === 'conflict'
                      ? t('notebook.offlineReplay.useTheirs')
                      : t('common.actions.discard')}
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Notice>
  )
}
