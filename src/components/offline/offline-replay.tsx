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
import { Notice } from '#/components/v3/ui/alert'
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
import type { OfflineEditScope, OfflineEditStore } from '#/lib/offline/store'
import type { LiveStatus } from '#/lib/live-events'
import { Button } from '#/components/v3/ui/button'
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
    () => port ?? createCanonicalOfflineReplayWriter({ userId }),
    [port, userId],
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
          {conflictCount === 1
            ? t('notebook.offlineReplay.1EditConflictsWith')
            : t('notebook.offlineReplay.conflictcountEditsConflictWith', {
                conflictCount,
              })}
          {report.heldCalculations.length > 0
            ? t('notebook.offlineReplay.dependentCalculationsAreHeld')
            : ''}
          .{' '}
        </span>
      ) : null}
      {report.failed.length > 0 ? (
        <span>
          {report.failed.length === 1
            ? t('notebook.offlineReplay.1EditWasRefused')
            : t('notebook.offlineReplay.countEditsWereRefused', {
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
                {description
                  ? `${description.title}: ${description.detail}`
                  : t('notebook.offlineReplay.anEditMadeOffline')}
              </span>
              <span>{outcome.message}</span>
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
                    {t('common.actions.discard')}
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
