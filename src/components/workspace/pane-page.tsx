import { useEffect, useMemo, useRef, useState } from 'react'
import { RouterProvider, useRouter } from '@tanstack/react-router'
import type { HistoryLocation, RouterHistory } from '@tanstack/react-router'

import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import { toast } from '#/components/v3/ui/sonner'
import { getPaneRouter } from '#/router'
import type { RouterContext } from '#/routes/__root'
import type { ShortcutDefinition } from '#/lib/shortcuts'
import { workspaceHref } from '#/lib/workspace-state'
import { PaneContext } from './workspace-navigation'
import { t } from '#/copy'

export interface PanePageHandle {
  navigate: (href: string) => Promise<void>
  requestClose: () => Promise<boolean>
}

interface PanePageProps {
  id: string
  href: string
  active: boolean
  context: RouterContext
  /** Not the primary pane: the page must not offer to change anything. */
  readOnly?: boolean
  onNewer?: (revision: string | undefined) => void
  onSelect?: (rowId: string | undefined) => void
  onFrozen?: (frozen: boolean) => void
  /** Make this pane the one that edits. */
  onMakePrimary?: () => void
  /** The pane that edits instead, when this one is a read-only copy. */
  editingPane?: { identifier?: string; sameRecord: boolean }
  /** The row selected in the pane this one follows (link groups). */
  followedSelection?: string
  onLocationChange: (href: string) => void
  onReady: (handle: PanePageHandle | null) => void
}

const noGlobalShortcuts: ShortcutDefinition[] = []

/** The key also protects callers that reuse a React position for a new pane. */
export function PanePage(props: PanePageProps) {
  return <PanePageInstance key={props.id} {...props} />
}

function PanePageInstance({
  id,
  href,
  active,
  context,
  readOnly = false,
  onNewer,
  onSelect,
  onFrozen,
  onMakePrimary,
  editingPane,
  followedSelection,
  onLocationChange,
  onReady,
}: PanePageProps) {
  const outerRouter = useRouter()
  const callbacks = useRef({
    onLocationChange,
    onReady,
    onNewer,
    onSelect,
    onFrozen,
    onMakePrimary,
  })
  callbacks.current = {
    onLocationChange,
    onReady,
    onNewer,
    onSelect,
    onFrozen,
    onMakePrimary,
  }
  const paneContext = useMemo(
    () => ({
      paneId: id,
      readOnly,
      reportNewer: (revision: string | undefined) =>
        callbacks.current.onNewer?.(revision),
      reportSelection: (rowId: string | undefined) =>
        callbacks.current.onSelect?.(rowId),
      reportFrozen: (frozen: boolean) => callbacks.current.onFrozen?.(frozen),
      makePrimary: () => callbacks.current.onMakePrimary?.(),
      followedSelection,
      editingPane,
    }),
    [
      id,
      readOnly,
      followedSelection,
      editingPane?.identifier,
      editingPane?.sameRecord,
    ],
  )
  const [page] = useState(() => {
    const router = getPaneRouter(context, href)
    type Blocker = Parameters<RouterHistory['block']>[0]
    const blockers = new Set<Blocker>()
    const pending = new Set<() => void>()
    const register = router.history.block

    // Keep the actual useBlocker functions, including their resolvers, so
    // approval can happen before navigation creates a router commit promise.
    router.history.block = (blocker) => {
      const guarded: Blocker = {
        ...blocker,
        blockerFn: async (args) => {
          let cancel = () => {}
          const cancelled = new Promise<boolean>((resolve) => {
            cancel = () => resolve(true)
            pending.add(cancel)
          })
          try {
            const blocked = await Promise.race([
              blocker.blockerFn(args),
              cancelled,
            ])
            return blocked
          } finally {
            pending.delete(cancel)
          }
        },
      }
      blockers.add(guarded)
      const unregister = register(guarded)
      return () => {
        blockers.delete(guarded)
        unregister()
      }
    }

    function canLeaveEditors() {
      // Existing spreadsheet/notebook guards are window-scoped. Until they
      // expose pane ownership, conservatively refuse if ANY editor is dirty.
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      if (!event.defaultPrevented) return true
      toast.error(t('projects.panePage.unsaved'))
      return false
    }

    // Studio also uses raw history pushes. They must retain both native
    // spreadsheet leave protection and the registered router blockers.
    for (const method of ['push', 'replace'] as const) {
      const commit = router.history[method]
      router.history[method] = (path, state, options) => {
        if (options?.ignoreBlocker || canLeaveEditors()) {
          commit(path, state, options)
        }
      }
    }

    async function approve(
      nextLocation: HistoryLocation,
      action: 'PUSH' | 'REPLACE',
    ) {
      for (const cancel of pending) cancel()
      if (!canLeaveEditors()) return false
      for (const blocker of [...blockers]) {
        if (
          await blocker.blockerFn({
            currentLocation: router.history.location,
            nextLocation,
            action,
          })
        )
          return false
      }
      return true
    }

    const navigate = router.navigate
    router.navigate = async (options) => {
      const targetHref =
        options.href ??
        router.buildLocation(
          options as Parameters<typeof router.buildLocation>[0],
        ).href
      if (!workspaceHref(targetHref, window.location.origin)) {
        return outerRouter.navigate({ href: targetHref })
      }
      const target = new URL(targetHref, window.location.origin)
      if (
        !options.ignoreBlocker &&
        !(await approve(
          {
            href: targetHref,
            pathname: target.pathname,
            search: target.search,
            hash: target.hash,
            state: router.history.location.state,
          },
          options.replace ? 'REPLACE' : 'PUSH',
        ))
      ) {
        return
      }
      return navigate({
        ...options,
        ignoreBlocker: true,
        resetScroll: false,
        hashScrollIntoView: false,
      })
    }

    let closing: Promise<boolean> | undefined
    const handle: PanePageHandle = {
      navigate: async (nextHref) => {
        await router.navigate({ href: nextHref })
      },
      requestClose: () => {
        if (closing) return closing
        closing = approve(router.history.location, 'REPLACE').finally(() => {
          closing = undefined
        })
        return closing
      },
    }
    return { router, handle, pending }
  })

  const contextKey = JSON.stringify({ ...context, queryClient: undefined })
  const previousContextKey = useRef(contextKey)
  useEffect(() => {
    page.router.update({ context: { ...context, workspacePane: true } })
    if (previousContextKey.current === contextKey) return
    previousContextKey.current = contextKey
    void page.router.invalidate()
  }, [context, contextKey, page])

  useEffect(() => {
    let lastHref: string | undefined
    const notify = (committedHref: string) => {
      if (committedHref === lastHref) return
      lastHref = committedHref
      callbacks.current.onLocationChange(committedHref)
    }
    const unsubscribe = page.router.subscribe(
      'onResolved',
      ({ toLocation }) => {
        notify(toLocation.href)
      },
    )
    callbacks.current.onReady(page.handle)
    if (
      page.router.state.status === 'idle' &&
      page.router.state.resolvedLocation
    ) {
      notify(page.router.state.resolvedLocation.href)
    }
    return () => {
      callbacks.current.onReady(null)
      unsubscribe()
      for (const cancel of page.pending) cancel()
      page.router.history.destroy()
    }
  }, [page])

  return (
    <PaneContext.Provider value={paneContext}>
      <ShortcutProvider definitions={noGlobalShortcuts} enabled={active}>
        <RouterProvider router={page.router} />
      </ShortcutProvider>
    </PaneContext.Provider>
  )
}
