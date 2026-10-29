// @vitest-environment jsdom
'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createLiveEventCoordinator } from '#/lib/live-events'
import type {
  LiveCoordinator,
  LiveStatus,
  EventSourceLike,
} from '#/lib/live-events'
import { getOrCreateClientId } from '#/lib/client-identity'
import { useDevFlag } from '#/lib/dev-flags'

/**
 * LiveEventProvider — mounts the LIVE-003 live-event coordinator for the
 * whole authenticated session. The coordinator opens an SSE stream to
 * `/api/events`, reconciles durable change events into the TanStack Query
 * cache, and exposes its status via `useLiveStatus()` so the app-shell
 * can surface a quiet connection indicator.
 *
 * Browser-only: the `useEffect` that creates the coordinator runs after
 * hydration, so SSR never opens a stream. The native `EventSource`
 * handles auto-reconnect with `Last-Event-ID`; the coordinator manages
 * manual reconnects after `reset` / `bye`.
 *
 * On unauthenticated routes the SSE endpoint returns 401 JSON; the
 * `EventSource` fires `onerror`, the coordinator reports `reconnecting`,
 * and native backoff retries once the user signs in and navigates. No
 * hammering, no false "live" state.
 */

const LiveEventContext = React.createContext<LiveCoordinator | null>(null)

/**
 * Native EventSource adapter satisfying the coordinator's
 * `EventSourceLike`. The coordinator is testable without a real
 * EventSource; in the browser we wrap the native one.
 */
function nativeEventSource(url: string): EventSourceLike {
  const es = new EventSource(url)
  return {
    readyState: es.readyState,
    onopen: null,
    onerror: null,
    addEventListener(type, listener) {
      // native EventSource dispatches MessageEvent; adapt the shape.
      const wrapped = (ev: MessageEvent) => {
        listener({ type, data: typeof ev.data === 'string' ? ev.data : '' })
      }
      es.addEventListener(type, wrapped as EventListener)
    },
    close: () => es.close(),
  }
}

export function LiveEventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const coordinatorRef = React.useRef<LiveCoordinator | null>(null)
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createLiveEventCoordinator({
      queryClient,
      eventSourceFactory: nativeEventSource,
      getClientId: () => getOrCreateClientId(),
    })
  }

  // The dev toolbar can stop the stream for this browser.
  const streaming = useDevFlag('liveUpdates')
  React.useEffect(() => {
    const coord = coordinatorRef.current
    if (!coord || !streaming) return
    coord.connect()
    return () => {
      coord.disconnect()
    }
  }, [streaming])

  return (
    <LiveEventContext.Provider value={coordinatorRef.current}>
      {children}
    </LiveEventContext.Provider>
  )
}

export function useLiveCoordinator(): LiveCoordinator | null {
  return React.useContext(LiveEventContext)
}

/**
 * Subscribe to the coordinator's status. Re-renders the caller only when
 * the status snapshot changes. Returns the initial `offline` snapshot
 * when no coordinator is mounted (e.g. during SSR or on public routes).
 */
export function useLiveStatus(): LiveStatus {
  const coord = useLiveCoordinator()
  const [status, setStatus] = React.useState<LiveStatus>(
    coord?.getStatus() ?? {
      status: 'offline',
      lastAppliedSeq: 0,
      workspaceId: null,
      lastResetReason: null,
    },
  )
  React.useEffect(() => {
    if (!coord) return
    setStatus(coord.getStatus())
    return coord.subscribe(setStatus)
  }, [coord])
  return status
}
