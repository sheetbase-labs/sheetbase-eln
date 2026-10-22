import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'
import {
  addPaneToStack,
  listStacks,
  movePane,
  PaneLayout,
  removePane,
  setActivePane,
  singleStack,
  splitStack,
  stackOf,
} from '@sheetbase-labs/sheetbase-shared'
import type { Layout, PaneSpec } from '@sheetbase-labs/sheetbase-shared'
import type { RouterContext } from '#/routes/__root'
import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  initialWorkspace,
  pageTitle,
  restoreWorkspace,
  workspaceHref,
} from '#/lib/workspace-state'
import type { WorkspaceState } from '#/lib/workspace-state'
import { PanePage } from './pane-page'
import type { PanePageHandle } from './pane-page'
import {
  registerWorkspaceLeave,
  WorkspaceNavigationContext,
} from './workspace-navigation'

export function WorkspaceHost({
  context,
  children,
}: {
  context: RouterContext
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Start hydrates the canonical page once. Independent page routers are CSR
  // only; they must never write a second document or hydrate Start again.
  if (!mounted) return children
  return (
    <ClientWorkspace
      key={`${context.auth?.user.id}:${context.auth?.workspace?.id}`}
      context={context}
    />
  )
}

function ClientWorkspace({ context }: { context: RouterContext }) {
  const router = useRouter()
  const href = useRouterState({ select: (state) => state.location.href })
  const storageKey = `sheetbase-workspace:${context.auth?.user.id}:${context.auth?.workspace?.id}`
  const [state, setState] = useState<WorkspaceState>(() => {
    try {
      return restoreWorkspace(
        sessionStorage.getItem(storageKey),
        href,
        location.origin,
      )
    } catch {
      return initialWorkspace(href)
    }
  })
  const current = useRef(state)
  current.current = state
  const handles = useRef(new Map<string, PanePageHandle>())
  const [narrow, setNarrow] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [error, setError] = useState('')
  const busyClosing = useRef(false)
  const workspaceRoot = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const root = workspaceRoot.current
    if (!root) return
    const readTitles = () => {
      const titles = new Map<string, string>()
      for (const element of root.querySelectorAll<HTMLElement>(
        '[data-workspace-pane]',
      )) {
        const title = element.querySelector('h1')?.textContent.trim()
        const id = element.dataset.workspacePane
        if (id && title) titles.set(id, title)
      }
      setState((previous) => {
        if (
          !previous.panes.some(
            (pane) => titles.has(pane.id) && titles.get(pane.id) !== pane.title,
          )
        )
          return previous
        return {
          ...previous,
          panes: previous.panes.map((pane) => ({
            ...pane,
            title: titles.get(pane.id) ?? pane.title,
          })),
        }
      })
    }
    const observer = new MutationObserver(readTitles)
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    readTitles()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = matchMedia('(max-width: 900px)')
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Disabled/full storage does not prevent working in the current session.
    }
  }, [state, storageKey])

  const mirror = useCallback(
    (next: string) => {
      if (router.state.location.href !== next)
        void router.navigate({ href: next, replace: true, ignoreBlocker: true })
    },
    [router],
  )

  const focus = useCallback(
    (id: string) => {
      const pane = current.current.panes.find((entry) => entry.id === id)
      if (!pane) return
      setState((previous) => {
        if (previous.activeId === id) return previous
        const stack = stackOf(previous.layout, id)
        return {
          ...previous,
          activeId: id,
          layout: stack
            ? setActivePane(previous.layout, stack.id, id)
            : previous.layout,
        }
      })
      mirror(pane.href)
    },
    [mirror],
  )

  const open = useCallback(
    (
      value: string,
      options?: {
        beside?: boolean
        title?: string
        below?: boolean
        duplicate?: boolean
      },
    ) => {
      const nextHref = workspaceHref(value, location.origin)
      if (!nextHref) {
        setError(
          'Open a Sheetbase page, not an external link or sign-in/API address.',
        )
        return
      }
      setError('')
      const existing =
        !options?.duplicate &&
        current.current.panes.find((pane) => pane.href === nextHref)
      if (existing) {
        focus(existing.id)
        return
      }
      const id = crypto.randomUUID()
      setState((previous) => {
        const target = stackOf(previous.layout, previous.activeId)
        const layout = target
          ? options?.beside
            ? splitStack(
                previous.layout,
                target.id,
                id,
                options.below ? 'column' : 'row',
                false,
              )
            : addPaneToStack(previous.layout, target.id, id)
          : singleStack([id])
        return {
          ...previous,
          panes: [
            ...previous.panes,
            {
              id,
              href: nextHref,
              title: options?.title ?? pageTitle(nextHref),
            },
          ],
          layout,
          activeId: id,
        }
      })
      mirror(nextHref)
    },
    [focus, mirror],
  )

  const approveLeave = useCallback(async () => {
    // Sequential approval avoids stacked dialogs from several dirty pages.
    for (const pane of current.current.panes) {
      const handle = handles.current.get(pane.id)
      if (!handle || !(await handle.requestClose())) return false
    }
    return true
  }, [])

  useEffect(() => registerWorkspaceLeave(approveLeave), [approveLeave])

  useEffect(
    () =>
      router.history.block({
        blockerFn: async ({
          nextLocation,
        }: {
          nextLocation: RouterHistory['location']
        }) => {
          const nextHref = workspaceHref(nextLocation.href, location.origin)
          if (!nextHref) return !(await approveLeave())
          // Keep the concrete URL, including search/snapshot identity. A route's
          // fullPath is a pattern such as /records/$recordId, not its destination.
          const handle = handles.current.get(current.current.activeId)
          if (handle) await handle.navigate(nextHref)
          return true
        },
        enableBeforeUnload: false,
      }),
    [router, approveLeave],
  )

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        anchor.target === '_blank' ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return
      const raw = anchor.getAttribute('href')
      if (!raw || raw.startsWith('#')) return
      const target = workspaceHref(anchor.href, location.origin)
      if (!target) return
      if (event.altKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        open(target, {
          beside: true,
          title: anchor.textContent.trim() || undefined,
        })
      } else if (!anchor.closest('[data-workspace-pane]')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void handles.current.get(current.current.activeId)?.navigate(target)
      }
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [open])

  const close = useCallback(
    async (id: string) => {
      if (busyClosing.current || current.current.panes.length === 1) return
      const handle = handles.current.get(id)
      if (!handle) return
      busyClosing.current = true
      try {
        if (!(await handle.requestClose())) return
        const remaining = current.current.panes.filter((pane) => pane.id !== id)
        const next =
          remaining.find((pane) => pane.id === current.current.activeId) ??
          remaining[0]
        setState((previous) => ({
          ...previous,
          panes: remaining,
          layout: removePane(previous.layout, id),
          activeId: next.id,
        }))
        mirror(next.href)
      } finally {
        busyClosing.current = false
      }
    },
    [mirror],
  )

  const locationChanged = useCallback(
    (id: string, next: string) => {
      setState((previous) => ({
        ...previous,
        panes: previous.panes.map((pane) =>
          pane.id === id && pane.href !== next
            ? { ...pane, href: next, title: pageTitle(next) }
            : pane,
        ),
      }))
      if (current.current.activeId === id) mirror(next)
    },
    [mirror],
  )

  const layoutChanged = (layout: Layout) => {
    const changed = listStacks(layout).find(
      (stack) =>
        stackOf(current.current.layout, stack.active)?.active !== stack.active,
    )
    const activeId =
      changed?.active ??
      (narrow ? listStacks(layout)[0]?.active : undefined) ??
      current.current.activeId
    setState((previous) => {
      const target = stackOf(previous.layout, activeId)
      return {
        ...previous,
        layout:
          narrow && target
            ? setActivePane(previous.layout, target.id, activeId)
            : layout,
        activeId,
      }
    })
    const active = current.current.panes.find((pane) => pane.id === activeId)
    if (active) mirror(active.href)
  }

  const navigation = useMemo(() => ({ open }), [open])
  const active =
    state.panes.find((pane) => pane.id === state.activeId) ?? state.panes[0]
  const panes: PaneSpec[] = state.panes.map((pane) => ({
    id: pane.id,
    title: pane.title,
    // The library closes synchronously. Only our approved close may unmount a
    // real page, so its unguarded Delete/menu close remains disabled.
    closable: false,
    content: (
      <div
        className="workspace-page"
        data-workspace-pane={pane.id}
        data-workspace-maximized={
          (maximized && pane.id === state.activeId) || undefined
        }
        data-workspace-focused={pane.id === state.activeId || undefined}
        onPointerDownCapture={() => focus(pane.id)}
        onFocusCapture={() => focus(pane.id)}
      >
        <div className="workspace-page-heading">
          <span className="min-w-0 flex-1 truncate" title={pane.href}>
            {pane.title}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="workspace-pane-button"
              aria-label={`Arrange ${pane.title}`}
            >
              ⋯
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  open(pane.href, { beside: true, duplicate: true })
                }
              >
                Split right
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  open(pane.href, {
                    beside: true,
                    below: true,
                    duplicate: true,
                  })
                }
              >
                Split below
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => open(pane.href, { duplicate: true })}
              >
                Duplicate as tab
              </DropdownMenuItem>
              {listStacks(state.layout)
                .filter((stack) => !stack.panes.includes(pane.id))
                .map((stack) => (
                  <DropdownMenuItem
                    key={stack.id}
                    onClick={() =>
                      setState((previous) => ({
                        ...previous,
                        layout: movePane(
                          previous.layout,
                          pane.id,
                          stack.id,
                          'center',
                        ),
                        activeId: pane.id,
                      }))
                    }
                  >
                    Join{' '}
                    {state.panes.find((entry) => entry.id === stack.active)
                      ?.title ?? 'pane'}{' '}
                    tabs
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem
                onClick={() => {
                  focus(pane.id)
                  setMaximized((value) => !value)
                }}
              >
                {maximized ? 'Restore layout' : 'Maximise pane'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className="workspace-pane-button"
            aria-label={`Close ${pane.title} pane`}
            disabled={state.panes.length === 1}
            onClick={() => void close(pane.id)}
          >
            ×
          </button>
        </div>
        <div className="workspace-page-content">
          <PanePage
            id={pane.id}
            href={pane.href}
            active={pane.id === state.activeId}
            context={context}
            onReady={(handle) => {
              if (handle) handles.current.set(pane.id, handle)
              else handles.current.delete(pane.id)
            }}
            onLocationChange={(next) => locationChanged(pane.id, next)}
          />
        </div>
      </div>
    ),
  }))

  return (
    <WorkspaceNavigationContext.Provider value={navigation}>
      <section
        ref={workspaceRoot}
        className="workspace flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Workspace"
      >
        <div className="workspace-toolbar">
          <span className="font-medium">Workspace</span>
          <span className="text-fg-muted">
            {state.panes.length} {state.panes.length === 1 ? 'page' : 'pages'}
          </span>
          <span className="ml-auto hidden truncate text-fg-muted lg:block">
            Alt-click any link to open beside
          </span>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => open('/', { duplicate: true })}
          >
            New pane
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => open(active.href, { beside: true, duplicate: true })}
          >
            Split right
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setMaximized((value) => !value)}
          >
            {maximized ? 'Restore layout' : 'Maximise'}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="px-3 py-1 text-danger-text">
            {error}
          </p>
        ) : null}
        <PaneLayout
          panes={panes}
          layout={
            narrow
              ? {
                  ...singleStack(
                    state.panes.map((pane) => pane.id),
                    'compact',
                  ),
                  active: state.activeId,
                }
              : state.layout
          }
          onLayoutChange={layoutChanged}
          paneMenu="off"
          minPaneSize={280}
          className={
            maximized
              ? 'workspace-layout sb-panes--fit is-maximized'
              : 'workspace-layout sb-panes--fit'
          }
        />
      </section>
    </WorkspaceNavigationContext.Provider>
  )
}
