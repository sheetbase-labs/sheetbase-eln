import * as React from 'react'
import { Wifi, WifiOff, RefreshCw, Loader2 } from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui'
import type { LiveStatus } from '#/lib/live-events'

/**
 * ConnectionStatus — a quiet indicator of the live-event stream's
 * health, placed in the app-shell top bar (LIVE-003). It communicates
 * by icon shape AND colour (DESIGN.md: never colour alone), stays
 * unobtrusive when healthy, and explains what will or will not sync
 * when the connection is degraded (DESIGN.md application states).
 *
 * Statuses:
 *   live         — green dot + "Live"; tooltip: "Changes from other
 *                  tabs arrive automatically."
 *   connecting   — muted dot + "Connecting…"
 *   reconnecting — amber dot + "Reconnecting…"; tooltip: "You may be
 *                  seeing stale data. Saved work is not lost; the stream
 *                  will catch up automatically."
 *   offline      — red dot + "Offline"; tooltip: "Live updates are
 *                  paused. Saved work syncs when you reconnect."
 *
 * The indicator is purely presentational; the coordinator owns state.
 */

const STATUS_META: Record<
  LiveStatus['status'],
  { label: string; dot: string; icon: React.ReactNode; tip: string }
> = {
  live: {
    label: 'Live',
    dot: 'bg-success',
    icon: (
      <Wifi
        className="size-3 text-success"
        aria-hidden="true"
      />
    ),
    tip: 'Changes from other tabs arrive automatically.',
  },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-muted-foreground/60',
    icon: (
      <Loader2
        className="size-3 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
    ),
    tip: 'Connecting to the live-event stream.',
  },
  reconnecting: {
    label: 'Reconnecting…',
    dot: 'bg-warning',
    icon: (
      <RefreshCw
        className="size-3 animate-spin text-warning-foreground"
        aria-hidden="true"
      />
    ),
    tip: 'You may be seeing stale data. Saved work is not lost; the stream will catch up automatically.',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-destructive',
    icon: (
      <WifiOff
        className="size-3 text-destructive"
        aria-hidden="true"
      />
    ),
    tip: 'Live updates are paused. Saved work syncs when you reconnect.',
  },
}

export interface ConnectionStatusProps {
  status: LiveStatus['status']
  /** Sequence cursor, shown in the tooltip when live/reconnecting. */
  lastAppliedSeq?: number
  className?: string
}

export function ConnectionStatus({
  status,
  lastAppliedSeq,
  className,
}: ConnectionStatusProps) {
  const meta = STATUS_META[status]
  const seqNote =
    lastAppliedSeq !== undefined && lastAppliedSeq > 0
      ? ` Caught up to event ${lastAppliedSeq}.`
      : ''
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
            aria-label={`Live-event stream: ${meta.label}`}
            aria-live="polite"
          >
            <span
              className={cn('size-1.5 rounded-full', meta.dot)}
              aria-hidden="true"
            />
            {meta.icon}
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {meta.tip}
          {seqNote}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
