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

import * as React from 'react'

import { useLiveStatus } from '#/components/live/live-event-provider'
import { Notice } from '#/components/v3/ui/alert'
import {
  createCanonicalOfflineReplayWriter,
  replayOfflineEdits,
  shouldReplayOfflineEdits,
} from '#/lib/offline/replay'
import type {
  OfflineReplayPort,
  OfflineReplayReport,
} from '#/lib/offline/replay'
import type { OfflineEditScope, OfflineEditStore } from '#/lib/offline/store'
import type { LiveStatus } from '#/lib/live-events'
import { useOfflineEdits } from './offline-edits'

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
  const { refresh } = useOfflineEdits()
  const [report, setReport] = React.useState<OfflineReplayReport | null>(null)
  const previousStatus = React.useRef<string | null>(null)
  const running = React.useRef(false)
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
    if (running.current) return
    running.current = true
    void (async () => {
      try {
        const next = await replayOfflineEdits({
          scope: { userId, recordId },
          store,
          port: writer,
        })
        if (!mounted.current) return
        setReport(next)
        onReport?.(next)
        if (next.committedEditIds.length > 0) refresh()
      } finally {
        running.current = false
      }
    })()
  }, [status.status, store, userId, recordId, writer, refresh, onReport])

  if (!report || !unresolved(report)) return null

  const conflictCount = report.conflicts.length + report.held.length
  return (
    <Notice
      tone={noticeTone(report)}
      className={className}
      title="Some edits could not sync"
    >
      {conflictCount > 0 ? (
        <span>
          {conflictCount === 1
            ? '1 edit conflicts with a change on the server'
            : `${conflictCount} edits conflict with changes on the server`}
          {report.heldCalculations.length > 0
            ? '; dependent calculations are held until it is resolved'
            : ''}
          .{' '}
        </span>
      ) : null}
      {report.failed.length > 0 ? (
        <span>
          {report.failed.length === 1
            ? '1 edit was refused and stays queued.'
            : `${report.failed.length} edits were refused and stay queued.`}
        </span>
      ) : null}
    </Notice>
  )
}
