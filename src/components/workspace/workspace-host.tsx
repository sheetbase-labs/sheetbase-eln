import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '#/lib/use-platform'
import { useRouter, useRouterState } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'

import type { RouterContext } from '#/routes/__root'
import { toast } from '#/components/v3/ui/sonner'
import { useRegisterShortcuts } from '#/components/shortcuts/shortcut-provider'
import { dragFraction, dropEdge, layoutGeometry } from '#/lib/pane-geometry'
import type { DropEdge } from '#/lib/pane-geometry'
import { detectPreset, listPaneIds, neighbourOf } from '#/lib/pane-tree'
import type { LayoutPreset } from '#/lib/pane-tree'
import { paneShortcuts } from '#/lib/shortcut-scopes'
import { isEditableTarget } from '#/lib/shortcuts'
import {
  activeTab,
  addTab,
  addTabFrom,
  arrange,
  closePane as closePaneState,
  closeTab as closeTabState,
  focusPane as focusPaneState,
  linkOf,
  makeDriver,
  makePrimary,
  markSaved,
  nextTab as nextWorkspaceTab,
  openBeside,
  paneAtNumber,
  editingPaneFor,
  paneOf,
  pinToShelf,
  promoteFromShelf,
  recordNavigation,
  renameTab,
  resizeDivider,
  setPaneHref,
  setPaneMeta,
  setShelfOpen,
  stepBack,
  stepForward,
  switchTab,
  toggleLink,
  unpin,
} from '#/lib/workspace-actions'
import {
  initialWorkspace,
  layoutFromTab,
  paneKind,
  paneMode,
  restoreSavedLayouts,
  restoreWorkspace,
  tabFromLayout,
  workspaceHref,
} from '#/lib/workspace-state'
import type {
  SavedLayout,
  WorkspaceState,
  WorkspaceTab,
} from '#/lib/workspace-state'
import { notebookDataClient } from '#/lib/notebook-data'
import { saveTrailEvidence, trailEvidenceSteps } from '#/lib/trail-evidence'
import {
  citationLabel,
  citationTarget,
  citeInNotebook,
  resolveCitation,
} from '#/lib/pane-citation'
import { useTeamLayouts } from './team-layouts'
import { PanePage } from './pane-page'
import type { PanePageHandle } from './pane-page'
import { PaneHeader } from './pane-header'
import type { PaneCrumb } from './pane-header'
import { PeekCard } from './peek-card'
import { Shelf } from './shelf'
import {
  LINK_MIME,
  focusedRecordAnchor,
  useRecordLinks,
} from './use-record-links'
import {
  registerOpenBeside,
  registerWorkspaceLeave,
  WorkspaceNavigationContext,
} from './workspace-navigation'
import type { WorkspaceOpenOptions } from './workspace-navigation'
import { WorkspaceBar } from './workspace-bar'
import { statusHints, WorkspaceStatus } from './workspace-status'

const ID_PATTERN = /^[A-Z]{2,5}-[A-Z0-9-]{2,}$/
/** A redirect right after a pane opens is not a step in its trail. */
const SETTLE_MS = 1500

/** The row selected in the pane that drives this one, when this one follows. */
function followedSelectionFor(
  tab: WorkspaceTab,
  paneId: string,
  selected: Record<string, string | undefined>,
): string | undefined {
  const link = tab.links.find((entry) => entry.followerIds.includes(paneId))
  return link ? selected[link.driverId] : undefined
}

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

/** The largest scrolling region inside a pane, for linked scrolling. */
function mainScroller(pane: Element): HTMLElement | null {
  let best: HTMLElement | null = null
  let extent = 1
  for (const element of pane.querySelectorAll<HTMLElement>('*')) {
    const overflow = getComputedStyle(element).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const room = element.scrollHeight - element.clientHeight
    if (room > extent) {
      best = element
      extent = room
    }
  }
  return best
}

function ClientWorkspace({ context }: { context: RouterContext }) {
  const platform = usePlatform()
  const router = useRouter()
  const href = useRouterState({ select: (state) => state.location.href })
  const dataAccess = Boolean(context.auth?.dataAccess)
  const scope = `${context.auth?.user.id}:${context.auth?.workspace?.id}`
  const storageKey = `sheetbase-workspace:${scope}`
  const layoutsKey = `sheetbase-layouts:${scope}`
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
  const [layouts, setLayouts] = useState<SavedLayout[]>(() => {
    try {
      return restoreSavedLayouts(
        localStorage.getItem(layoutsKey),
        location.origin,
      )
    } catch {
      return []
    }
  })
  const team = useTeamLayouts(Boolean(context.auth?.workspace?.id))
  const current = useRef(state)
  current.current = state
  const handles = useRef(new Map<string, PanePageHandle>())
  const openedAt = useRef(new Map<string, number>())
  const stepping = useRef(new Map<string, number>())
  const [narrow, setNarrow] = useState(false)
  const [phone, setPhone] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [error, setError] = useState('')
  const [crumbs, setCrumbs] = useState<Record<string, PaneCrumb[] | undefined>>(
    {},
  )
  const [newer, setNewer] = useState<Record<string, string | undefined>>({})
  const [selected, setSelected] = useState<Record<string, string | undefined>>(
    {},
  )
  const [dropTarget, setDropTarget] = useState<{
    paneId: string
    edge: DropEdge | 'center'
  } | null>(null)
  const busyClosing = useRef(false)
  const workspaceRoot = useRef<HTMLElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const links = useRecordLinks(workspaceRoot)

  /** Apply a change now, so two changes in one event see each other. */
  const apply = useCallback(
    (change: (previous: WorkspaceState) => WorkspaceState) => {
      const next = change(current.current)
      if (next !== current.current) {
        current.current = next
        setState(next)
      }
      return next
    },
    [],
  )

  const tab = activeTab(state)

  /* Titles and record IDs come from the page each pane renders. */
  useEffect(() => {
    const root = workspaceRoot.current
    if (!root) return
    const read = () => {
      for (const element of root.querySelectorAll<HTMLElement>(
        '[data-workspace-pane]',
      )) {
        const id = element.dataset.workspacePane
        if (!id) continue
        // An editable title is an input inside the heading, so its text lives
        // in the value rather than the heading's text content.
        const title = Array.from(element.querySelectorAll('h1'))
          .map(
            (heading) =>
              heading.textContent.trim() ||
              heading.querySelector('input')?.value.trim() ||
              '',
          )
          .find(Boolean)
        const pageTrail = 'nav[aria-label="Breadcrumb"]:not([data-pane-path])'
        const crumb = element
          .querySelector(`${pageTrail} [aria-current="page"]`)
          ?.textContent.trim()
        // The page's own location, so the pane header can show the same path.
        const path = Array.from(element.querySelectorAll(`${pageTrail} li`))
          .map((item) => ({
            label: Array.from(item.children)
              .filter((child) => child.getAttribute('aria-hidden') !== 'true')
              .map((child) => child.textContent.trim())
              .join(''),
            href: item.querySelector('a')?.getAttribute('href') ?? undefined,
          }))
          .filter((entry) => entry.label)
        setCrumbs((previous) =>
          JSON.stringify(previous[id]) === JSON.stringify(path)
            ? previous
            : { ...previous, [id]: path },
        )
        const identifier = crumb && ID_PATTERN.test(crumb) ? crumb : undefined
        if (title || identifier) {
          apply((previous) =>
            setPaneMeta(previous, id, {
              title: title || undefined,
              identifier,
            }),
          )
        }
      }
    }
    const observer = new MutationObserver(read)
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    read()
    return () => observer.disconnect()
  }, [apply])

  useEffect(() => {
    const media = matchMedia('(max-width: 900px)')
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const media = matchMedia('(max-width: 640px)')
    const update = () => setPhone(media.matches)
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

  useEffect(() => {
    try {
      localStorage.setItem(layoutsKey, JSON.stringify(layouts))
    } catch {
      // Saved layouts are a convenience; losing them never loses work.
    }
  }, [layouts, layoutsKey])

  // Only a page the focused pane moved to adds a browser history entry, so the
  // browser's Back steps through the pages the pane showed. Focus, close and
  // layout changes replace the entry instead.
  const mirror = useCallback(
    (next: string, push = false) => {
      if (router.state.location.href !== next)
        void router.navigate({
          href: next,
          replace: !push,
          ignoreBlocker: true,
        })
    },
    [router],
  )

  const focus = useCallback(
    (id: string) => {
      const next = apply((previous) => focusPaneState(previous, id))
      const target = paneOf(activeTab(next), id)
      if (target) mirror(target.href)
    },
    [apply, mirror],
  )

  const open = useCallback(
    (value: string, options?: WorkspaceOpenOptions) => {
      const nextHref = workspaceHref(value, location.origin)
      if (!nextHref) {
        setError(
          'Open a Sheetbase page, not an external link or sign-in/API address.',
        )
        return
      }
      setError('')
      if (!options?.beside && !options?.duplicate) {
        // Ordinary navigation changes the focused pane and adds a trail step.
        const active = activeTab(current.current).activeId
        void handles.current.get(active)?.navigate(nextHref)
        return
      }
      const newId = crypto.randomUUID()
      const result = openBeside(current.current, {
        href: nextHref,
        newId,
        title: options.title,
        identifier: options.identifier,
        duplicate: options.duplicate,
        direction: options.below ? 'column' : 'row',
        before: options.before,
      })
      apply(() => result.state)
      if (result.created) openedAt.current.set(result.paneId, Date.now())
      const pane = paneOf(activeTab(result.state), result.paneId)
      if (pane) mirror(pane.href)
    },
    [apply, mirror],
  )

  const stepTrail = useCallback(
    (id: string, direction: 'back' | 'forward', steps = 1) => {
      const result =
        direction === 'back'
          ? stepBack(current.current, id, steps)
          : stepForward(current.current, id)
      if (!result) return
      stepping.current.set(id, Date.now())
      apply(() => result.state)
      void handles.current.get(id)?.navigate(result.href)
    },
    [apply],
  )

  const approveLeave = useCallback(async () => {
    // Sequential approval avoids stacked dialogs from several dirty pages.
    for (const workspaceTab of current.current.tabs) {
      for (const pane of workspaceTab.panes) {
        const handle = handles.current.get(pane.id)
        if (!handle || !(await handle.requestClose())) return false
      }
    }
    return true
  }, [])

  useEffect(() => registerWorkspaceLeave(approveLeave), [approveLeave])

  useEffect(
    () =>
      registerOpenBeside((href, title) => open(href, { beside: true, title })),
    [open],
  )

  useEffect(
    () =>
      router.history.block({
        blockerFn: async ({
          nextLocation,
          action,
        }: {
          nextLocation: RouterHistory['location']
          action: string
        }) => {
          const nextHref = workspaceHref(nextLocation.href, location.origin)
          if (!nextHref) return !(await approveLeave())
          if (action !== 'PUSH' && action !== 'REPLACE') {
            // The browser's Back and Forward step the focused pane's own trail.
            const activeId = activeTab(current.current).activeId
            const pane = paneOf(activeTab(current.current), activeId)
            if (pane?.trail.at(-1)?.href === nextHref) {
              stepTrail(activeId, 'back')
              return false
            }
            if (pane?.forward[0]?.href === nextHref) {
              stepTrail(activeId, 'forward')
              return false
            }
          }
          // Keep the concrete URL, including search/snapshot identity. A route's
          // fullPath is a pattern such as /records/$recordId, not its destination.
          const active = activeTab(current.current).activeId
          const handle = handles.current.get(active)
          if (handle) await handle.navigate(nextHref)
          return true
        },
        enableBeforeUnload: false,
      }),
    [router, approveLeave, stepTrail],
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
        const active = activeTab(current.current).activeId
        void handles.current.get(active)?.navigate(target)
      }
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [open])

  const closePane = useCallback(
    async (id: string) => {
      if (busyClosing.current) return
      const active = activeTab(current.current)
      const handle = handles.current.get(id)
      if (!handle || !active.panes.some((pane) => pane.id === id)) return
      busyClosing.current = true
      try {
        if (!(await handle.requestClose())) return
        if (active.panes.length === 1) {
          // The last pane of a workspace tab closes the tab, if there is another.
          if (current.current.tabs.length < 2) return
          const next = apply((previous) => closeTabState(previous, active.id))
          const nextTab = activeTab(next)
          const pane = paneOf(nextTab, nextTab.activeId)
          if (pane) mirror(pane.href)
          return
        }
        const next = apply((previous) => closePaneState(previous, id))
        const nextActive = activeTab(next)
        const pane = paneOf(nextActive, nextActive.activeId)
        if (pane) mirror(pane.href)
      } finally {
        busyClosing.current = false
      }
    },
    [apply, mirror],
  )

  const closeWorkspaceTab = useCallback(
    async (id: string) => {
      const target = current.current.tabs.find((entry) => entry.id === id)
      if (!target || current.current.tabs.length < 2) return
      for (const pane of target.panes) {
        const handle = handles.current.get(pane.id)
        if (!handle || !(await handle.requestClose())) return
      }
      const next = apply((previous) => closeTabState(previous, id))
      const nextTab = activeTab(next)
      const pane = paneOf(nextTab, nextTab.activeId)
      if (pane) mirror(pane.href)
    },
    [apply, mirror],
  )

  const locationChanged = useCallback(
    (id: string, next: string) => {
      const stepAt = stepping.current.get(id)
      stepping.current.delete(id)
      const settling = Date.now() - (openedAt.current.get(id) ?? 0) < SETTLE_MS
      let moved = false
      if (stepAt && Date.now() - stepAt < 3000) {
        apply((previous) => setPaneHref(previous, id, next))
      } else if (settling) {
        apply((previous) => setPaneHref(previous, id, next))
      } else {
        moved = true
        apply((previous) => recordNavigation(previous, id, next))
      }
      const active = activeTab(current.current)
      if (active.activeId === id) mirror(next, moved)
    },
    [apply, mirror],
  )

  const splitFocused = useCallback(
    (direction: 'row' | 'column', paneId?: string) => {
      const active = activeTab(current.current)
      const target = paneOf(active, paneId ?? active.activeId)
      if (!target) return
      if (paneId) apply((previous) => focusPaneState(previous, paneId))
      open(target.href, {
        beside: true,
        below: direction === 'column',
        duplicate: true,
        title: target.title,
        identifier: target.identifier,
      })
    },
    [apply, open],
  )

  const toggleMaximise = useCallback(
    (id?: string) => {
      if (id) apply((previous) => focusPaneState(previous, id))
      setMaximized((value) => !value)
    },
    [apply],
  )

  const choosePreset = useCallback(
    (preset: LayoutPreset) => {
      if (preset === 'single') {
        setMaximized((value) => !value)
        return
      }
      setMaximized(false)
      apply((previous) => arrange(previous, preset, () => crypto.randomUUID()))
    },
    [apply],
  )

  const makeNewTab = useCallback(() => {
    const next = apply((previous) =>
      addTab(previous, '/', {
        tabId: crypto.randomUUID(),
        paneId: crypto.randomUUID(),
      }),
    )
    const added = activeTab(next)
    openedAt.current.set(added.activeId, Date.now())
    const pane = paneOf(added, added.activeId)
    if (pane) mirror(pane.href)
  }, [apply, mirror])

  const switchWorkspaceTab = useCallback(
    (id: string) => {
      const next = apply((previous) => switchTab(previous, id))
      const nextTab = activeTab(next)
      const pane = paneOf(nextTab, nextTab.activeId)
      if (pane) mirror(pane.href)
    },
    [apply, mirror],
  )

  const saveLayout = useCallback(
    (naming?: string) => {
      const active = activeTab(current.current)
      const name = naming ?? active.name
      const id = active.layoutId ?? crypto.randomUUID()
      const saved = layoutFromTab(active, id, name)
      setLayouts((previous) => [
        ...previous.filter((layout) => layout.id !== id),
        saved,
      ])
      apply((previous) => markSaved(previous, active.id, id, name))
      toast.success(`Saved layout “${name}”`)
    },
    [apply],
  )

  const openLayout = useCallback(
    (id: string) => {
      const layout = [...layouts, ...team.layouts].find(
        (entry) => entry.id === id,
      )
      if (!layout) return
      const opened = tabFromLayout(layout)
      for (const pane of opened.panes) openedAt.current.set(pane.id, Date.now())
      const next = apply((previous) => addTabFrom(previous, opened))
      const nextTab = activeTab(next)
      const pane = paneOf(nextTab, nextTab.activeId)
      if (pane) mirror(pane.href)
    },
    [apply, layouts, team.layouts, mirror],
  )

  const shareLayout = useCallback(() => {
    const active = activeTab(current.current)
    const saved = layoutFromTab(
      active,
      active.layoutId ?? crypto.randomUUID(),
      active.name,
    )
    team.share(saved).then(
      () => toast.success(`Shared “${active.name}” with the team`),
      (error: unknown) =>
        toast.error('Could not share the layout', {
          description: error instanceof Error ? error.message : undefined,
        }),
    )
  }, [team])

  /** Save the pane's trail against the primary pane's record, as evidence of
   * what was looked at while the work was written. */
  const saveTrail = useCallback(async (paneId: string) => {
    const active = activeTab(current.current)
    const pane = paneOf(active, paneId)
    const identifier = paneOf(active, active.primaryId)?.identifier
    if (!pane || !identifier) return
    try {
      const found = await notebookDataClient.list<{ id: string }>(
        'records',
        `?identifier=eq.${encodeURIComponent(identifier)}&select=id&limit=1`,
      )
      const recordId = found.at(0)?.id
      if (!recordId) throw new Error(`${identifier} could not be found.`)
      const steps = trailEvidenceSteps(pane.trail, pane)
      await saveTrailEvidence(notebookDataClient, { recordId, steps })
      toast.success(`Saved the trail on ${identifier}`, {
        description: `${steps.length} ${steps.length === 1 ? 'page' : 'pages'}, kept with its History.`,
      })
    } catch (error) {
      toast.error('Could not save the trail', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }, [])

  const paneLabel = useCallback((element: Element) => {
    const id = element
      .closest('[data-workspace-pane]')
      ?.getAttribute('data-workspace-pane')
    if (!id) return undefined
    const pane = paneOf(activeTab(current.current), id)
    return pane?.identifier ?? pane?.title
  }, [])

  const pinHref = useCallback(
    (hrefValue: string, title: string, identifier?: string, from?: string) => {
      apply((previous) =>
        pinToShelf(previous, {
          id: crypto.randomUUID(),
          href: hrefValue,
          title,
          identifier,
          from,
        }),
      )
    },
    [apply],
  )

  const pinPane = useCallback(
    (id: string) => {
      const pane = paneOf(activeTab(current.current), id)
      if (!pane) return
      const kept = current.current.shelf.find((item) => item.href === pane.href)
      if (kept) {
        apply((previous) => unpin(previous, kept.id))
        return
      }
      pinHref(pane.href, pane.title, pane.identifier)
    },
    [apply, pinHref],
  )

  /* Linked panes: the driver's scroll position carries to its followers. */
  useEffect(() => {
    const root = workspaceRoot.current
    if (!root) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const paneElement = target.closest('[data-workspace-pane]')
      const id = paneElement?.getAttribute('data-workspace-pane')
      if (!paneElement || !id) return
      const link = activeTab(current.current).links.find(
        (entry) => entry.driverId === id,
      )
      if (!link) return
      const room = target.scrollHeight - target.clientHeight
      if (room <= 0 || mainScroller(paneElement) !== target) return
      const ratio = target.scrollTop / room
      for (const followerId of link.followerIds) {
        const follower = root.querySelector(
          `[data-workspace-pane="${CSS.escape(followerId)}"]`,
        )
        const scroller = follower ? mainScroller(follower) : null
        if (scroller) {
          scroller.scrollTop =
            ratio * (scroller.scrollHeight - scroller.clientHeight)
        }
      }
    }
    root.addEventListener('scroll', onScroll, true)
    return () => root.removeEventListener('scroll', onScroll, true)
  }, [])

  /* Keyboard: the multiplex map. Handlers read live state, never closures. */
  const focusedLinkAnchor = () => {
    const element = document.activeElement
    return element instanceof HTMLAnchorElement &&
      workspaceHref(element.href, location.origin)
      ? element
      : null
  }
  const shortcuts = useMemo(
    () =>
      paneShortcuts({
        'pane-split-right': { handler: () => splitFocused('row') },
        'pane-split-below': { handler: () => splitFocused('column') },
        'pane-close': {
          handler: () => void closePane(activeTab(current.current).activeId),
        },
        'pane-maximise': { handler: () => toggleMaximise() },
        'pane-make-primary': {
          handler: () => {
            const active = activeTab(current.current)
            apply((previous) => makePrimary(previous, active.activeId))
          },
        },
        'pane-link': {
          handler: () => apply((previous) => toggleLink(previous)),
        },
        'pane-back': {
          handler: () => stepTrail(activeTab(current.current).activeId, 'back'),
        },
        'pane-forward': {
          handler: () =>
            stepTrail(activeTab(current.current).activeId, 'forward'),
        },
        'pane-peek': {
          when: () => !!links.hoveredAnchor() || !!focusedRecordAnchor(),
          handler: () => links.peekHovered(paneLabel),
        },
        'pane-pin': {
          when: () => !!links.peek || !!links.hoveredAnchor(),
          handler: () => {
            if (links.peek) {
              pinHref(
                links.peek.href,
                links.peek.title,
                links.peek.identifier,
                links.peek.from,
              )
              links.setPeek(null)
              return
            }
            const anchor = links.hoveredAnchor()
            const target = anchor && workspaceHref(anchor.href, location.origin)
            if (anchor && target) {
              const text = anchor.textContent.trim()
              pinHref(
                target,
                text,
                ID_PATTERN.test(text) ? text : undefined,
                paneLabel(anchor),
              )
            }
          },
        },
        'pane-open-beside': {
          when: () => !!focusedLinkAnchor(),
          handler: () => {
            const anchor = focusedLinkAnchor()
            const target = anchor && workspaceHref(anchor.href, location.origin)
            if (anchor && target)
              open(target, {
                beside: true,
                title: anchor.textContent.trim() || undefined,
              })
          },
        },
        'workspace-new': { handler: () => makeNewTab() },
        'workspace-next': {
          handler: () => {
            const next = apply((previous) => nextWorkspaceTab(previous))
            const nextActive = activeTab(next)
            const pane = paneOf(nextActive, nextActive.activeId)
            if (pane) mirror(pane.href)
          },
        },
        'workspace-save': {
          // Inside an editor the browser's own save stays out of the way.
          when: (event) => !isEditableTarget(event.target),
          handler: () => {
            const active = activeTab(current.current)
            if (active.layoutId) saveLayout()
            else toast.message('Name this layout, then press Enter to save it.')
          },
        },
      }),
    // Handlers only read refs and stable callbacks.
    [
      links.peek,
      apply,
      closePane,
      splitFocused,
      stepTrail,
      makeNewTab,
      saveLayout,
    ],
  )
  useRegisterShortcuts(shortcuts)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = /mac|iphone|ipad/i.test(navigator.platform)
        ? event.metaKey
        : event.ctrlKey
      if (
        !modifier ||
        event.altKey ||
        event.shiftKey ||
        !/^[1-9]$/.test(event.key) ||
        event.defaultPrevented
      )
        return
      const target = paneAtNumber(activeTab(current.current), Number(event.key))
      if (!target) return
      event.preventDefault()
      focus(target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [focus])

  /* Drop a link on the middle of the primary pane to cite it in that notebook. */
  const citeOnPrimary = async (href: string) => {
    const active = activeTab(current.current)
    const identifier = paneOf(active, active.primaryId)?.identifier
    try {
      const target = citationTarget(href)
      if (!identifier || !target) throw new Error('That page can’t be cited.')
      const [found, cited] = await Promise.all([
        notebookDataClient.list<{ id: string }>(
          'records',
          `?identifier=eq.${encodeURIComponent(identifier)}&select=id&limit=1`,
        ),
        resolveCitation(notebookDataClient, target),
      ])
      const recordId = found.at(0)?.id
      if (!recordId) throw new Error(`${identifier} could not be found.`)
      if (!cited) throw new Error('That object could not be found.')
      await citeInNotebook(notebookDataClient, { recordId, cited })
      await context.queryClient.invalidateQueries()
      toast.success(`Cited ${citationLabel(cited)} in ${identifier}`, {
        description: 'Added as a block and linked from the Links tab.',
      })
    } catch (error) {
      toast.error('Could not cite it', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  /* Drag a link onto a pane edge to open it beside that pane. */
  const dropOnPane = (
    paneId: string,
    edge: DropEdge | 'center',
    event: React.DragEvent,
  ) => {
    const dropped = event.dataTransfer.getData(LINK_MIME)
    const nextHref = dropped && workspaceHref(dropped, location.origin)
    setDropTarget(null)
    if (!nextHref) return
    event.preventDefault()
    if (edge === 'center') {
      void citeOnPrimary(nextHref)
      return
    }
    const newId = crypto.randomUUID()
    const result = openBeside(current.current, {
      href: nextHref,
      newId,
      title: event.dataTransfer.getData('text/x-sheetbase-title') || undefined,
      targetId: paneId,
      direction: edge === 'left' || edge === 'right' ? 'row' : 'column',
      before: edge === 'left' || edge === 'top',
    })
    apply(() => result.state)
    if (result.created) openedAt.current.set(result.paneId, Date.now())
    const pane = paneOf(activeTab(result.state), result.paneId)
    if (pane) mirror(pane.href)
  }

  /* Dividers: drag with the pointer, or arrow keys when focused. */
  const startDrag = (
    event: React.PointerEvent,
    splitId: string,
    index: number,
  ) => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    element.classList.add('is-drag')
    let last = { x: event.clientX, y: event.clientY }
    const move = (moveEvent: PointerEvent) => {
      const geometry = layoutGeometry(
        activeTab(current.current).tree,
      ).dividers.find(
        (entry) => entry.splitId === splitId && entry.index === index,
      )
      if (!geometry) return
      const delta =
        geometry.direction === 'row'
          ? moveEvent.clientX - last.x
          : moveEvent.clientY - last.y
      last = { x: moveEvent.clientX, y: moveEvent.clientY }
      apply((previous) =>
        resizeDivider(
          previous,
          splitId,
          index,
          dragFraction(geometry, delta, {
            width: box.width,
            height: box.height,
          }),
        ),
      )
    }
    const end = () => {
      element.classList.remove('is-drag')
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
  }

  const navigation = useMemo(() => ({ open }), [open])
  const solo = narrow || maximized
  const hints = useMemo(() => {
    const focusedPane = paneOf(tab, tab.activeId)
    return statusHints({
      hasTrail: (focusedPane?.trail.length ?? 0) > 0,
      linked: !!linkOf(tab, tab.activeId),
      primary: tab.activeId === tab.primaryId,
      paneCount: tab.panes.length,
    })
  }, [tab])
  const focusedLink = linkOf(tab, tab.activeId)
  const driver = focusedLink ? paneOf(tab, focusedLink.driverId) : undefined
  const shelfHrefs = new Set(state.shelf.map((item) => item.href))
  const currentPreset = detectPreset(tab.tree)

  return (
    <WorkspaceNavigationContext.Provider value={navigation}>
      <section
        ref={workspaceRoot}
        className="workspace flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Workspace"
        data-bare={(phone && tab.panes.length === 1) || undefined}
      >
        <WorkspaceBar
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          preset={currentPreset}
          maximized={maximized}
          shelfOpen={state.shelfOpen}
          shelfCount={state.shelf.length}
          layouts={layouts}
          teamLayouts={team.layouts}
          onShareLayout={shareLayout}
          onRemoveTeamLayout={(id) =>
            void team.remove(id).then(
              () => toast.success('Removed the team layout'),
              (error: unknown) =>
                toast.error('Could not remove the team layout', {
                  description:
                    error instanceof Error ? error.message : undefined,
                }),
            )
          }
          onSwitch={switchWorkspaceTab}
          onClose={(id) => void closeWorkspaceTab(id)}
          onNew={makeNewTab}
          onRename={(id, name) =>
            apply((previous) => renameTab(previous, id, name))
          }
          onPreset={choosePreset}
          onShelf={() =>
            apply((previous) => setShelfOpen(previous, !previous.shelfOpen))
          }
          onSave={saveLayout}
          onOpenLayout={openLayout}
          onDeleteLayout={(id) => {
            setLayouts((previous) =>
              previous.filter((layout) => layout.id !== id),
            )
            apply((previous) => ({
              ...previous,
              tabs: previous.tabs.map((entry) =>
                entry.layoutId === id
                  ? { ...entry, layoutId: undefined, dirty: true }
                  : entry,
              ),
            }))
          }}
          paneChips={
            narrow && tab.panes.length > 1 ? (
              <div
                className="flex items-center gap-1 px-2"
                role="group"
                aria-label="Panes"
              >
                {listPaneIds(tab.tree).map((id, index) => (
                  <button
                    key={id}
                    type="button"
                    className="mx-num"
                    aria-pressed={id === tab.activeId}
                    aria-label={`Show pane ${index + 1}`}
                    onClick={() => focus(id)}
                    style={
                      id === tab.activeId
                        ? {
                            background: 'var(--mx-accent)',
                            borderColor: 'var(--mx-accent)',
                            color: 'var(--mx-on-accent)',
                          }
                        : undefined
                    }
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            ) : null
          }
        />
        {error ? (
          <p role="alert" className="px-3 py-1 text-danger-text">
            {error}
          </p>
        ) : null}
        <div className="mx-body">
          <div className="mx-stage" ref={stage}>
            {state.tabs.map((workspaceTab) => {
              const isActiveTab = workspaceTab.id === state.activeTabId
              const geometry = layoutGeometry(workspaceTab.tree)
              const order = listPaneIds(workspaceTab.tree)
              return (
                <div
                  key={workspaceTab.id}
                  className="mx-tabpanel"
                  role="tabpanel"
                  aria-label={workspaceTab.name}
                  hidden={!isActiveTab}
                >
                  {workspaceTab.panes.map((pane) => {
                    const rect = geometry.panes.get(pane.id)
                    const focused = pane.id === workspaceTab.activeId
                    const primary = pane.id === workspaceTab.primaryId
                    const mode = paneMode(pane.href, primary)
                    const readOnly =
                      mode.kind === 'read-only' || mode.kind === 'signed'
                    const kind = paneKind(pane.href)
                    const link = linkOf(workspaceTab, pane.id)
                    const hiddenBySolo = solo && !focused
                    const style: React.CSSProperties = rect
                      ? {
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.w * 100}%`,
                          height: `${rect.h * 100}%`,
                        }
                      : {}
                    return (
                      <div
                        key={pane.id}
                        className="mx-pane workspace-page"
                        style={style}
                        hidden={hiddenBySolo}
                        data-workspace-pane={pane.id}
                        data-workspace-focused={focused || undefined}
                        data-workspace-maximized={
                          (solo && focused) || undefined
                        }
                        data-pane-readonly={readOnly || undefined}
                        data-pane-primary={primary || undefined}
                        onPointerDownCapture={() => focus(pane.id)}
                        onFocusCapture={() => focus(pane.id)}
                        onDragOver={(event) => {
                          if (!event.dataTransfer.types.includes(LINK_MIME))
                            return
                          event.preventDefault()
                          const box =
                            event.currentTarget.getBoundingClientRect()
                          const point = {
                            x: event.clientX - box.left,
                            y: event.clientY - box.top,
                          }
                          const middle =
                            Math.abs(point.x / box.width - 0.5) < 0.2 &&
                            Math.abs(point.y / box.height - 0.5) < 0.2
                          const edge =
                            primary && middle
                              ? ('center' as const)
                              : dropEdge(point, box)
                          setDropTarget((previous) =>
                            previous?.paneId === pane.id &&
                            previous.edge === edge
                              ? previous
                              : { paneId: pane.id, edge },
                          )
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node,
                            )
                          ) {
                            setDropTarget((previous) =>
                              previous?.paneId === pane.id ? null : previous,
                            )
                          }
                        }}
                        onDrop={(event) => {
                          const edge =
                            dropTarget?.paneId === pane.id
                              ? dropTarget.edge
                              : 'right'
                          dropOnPane(pane.id, edge, event)
                        }}
                      >
                        <PaneHeader
                          pane={pane}
                          number={order.indexOf(pane.id) + 1}
                          focused={focused}
                          primary={primary}
                          mode={mode}
                          kind={kind}
                          link={
                            link
                              ? {
                                  letter: link.letter,
                                  role:
                                    link.driverId === pane.id
                                      ? 'drives'
                                      : 'follows',
                                }
                              : undefined
                          }
                          crumbs={crumbs[pane.id]}
                          dataAccess={dataAccess}
                          onCrumb={(target) => {
                            focus(pane.id)
                            void handles.current.get(pane.id)?.navigate(target)
                          }}
                          newer={newer[pane.id]}
                          onShelf={shelfHrefs.has(pane.href)}
                          maximized={solo && focused && !narrow}
                          canClose={
                            workspaceTab.panes.length > 1 ||
                            state.tabs.length > 1
                          }
                          canLink={!!neighbourOf(workspaceTab.tree, pane.id)}
                          onFocus={() => focus(pane.id)}
                          onBack={() => stepTrail(pane.id, 'back')}
                          onForward={() => stepTrail(pane.id, 'forward')}
                          onPin={() => pinPane(pane.id)}
                          onMakePrimary={() => {
                            apply((previous) =>
                              focusPaneState(previous, pane.id),
                            )
                            apply((previous) => makePrimary(previous, pane.id))
                          }}
                          onMaximize={() => toggleMaximise(pane.id)}
                          onClose={() => void closePane(pane.id)}
                          onSplit={(direction) =>
                            splitFocused(direction, pane.id)
                          }
                          onToggleLink={() => {
                            apply((previous) =>
                              focusPaneState(previous, pane.id),
                            )
                            apply((previous) => toggleLink(previous))
                          }}
                          onMakeDriver={() =>
                            apply((previous) => makeDriver(previous, pane.id))
                          }
                          onCompareNewer={() => {
                            const revision = newer[pane.id]
                            if (!revision) return
                            const target = pane.href.replace(
                              /([?&])snapshot=[^&#]*/,
                              `$1snapshot=${encodeURIComponent(revision)}`,
                            )
                            open(target, { beside: true, duplicate: true })
                          }}
                          trailTarget={
                            paneOf(workspaceTab, workspaceTab.primaryId)
                              ?.identifier
                          }
                          onSaveTrail={() => void saveTrail(pane.id)}
                          onCopyLink={() => {
                            void navigator.clipboard
                              .writeText(`${location.origin}${pane.href}`)
                              .then(() => toast.success('Link copied'))
                          }}
                        />
                        <div className="mx-pb">
                          <div className="workspace-page-content">
                            <PanePage
                              id={pane.id}
                              href={pane.href}
                              active={
                                isActiveTab && pane.id === workspaceTab.activeId
                              }
                              context={context}
                              readOnly={readOnly}
                              onMakePrimary={() => {
                                apply((previous) =>
                                  focusPaneState(previous, pane.id),
                                )
                                apply((previous) =>
                                  makePrimary(previous, pane.id),
                                )
                              }}
                              editingPane={
                                readOnly && !primary
                                  ? editingPaneFor(workspaceTab, pane)
                                  : undefined
                              }
                              followedSelection={followedSelectionFor(
                                workspaceTab,
                                pane.id,
                                selected,
                              )}
                              onSelect={(rowId) =>
                                setSelected((previous) =>
                                  previous[pane.id] === rowId
                                    ? previous
                                    : { ...previous, [pane.id]: rowId },
                                )
                              }
                              onNewer={(revision) =>
                                setNewer((previous) =>
                                  previous[pane.id] === revision
                                    ? previous
                                    : { ...previous, [pane.id]: revision },
                                )
                              }
                              onReady={(handle) => {
                                if (handle) handles.current.set(pane.id, handle)
                                else handles.current.delete(pane.id)
                              }}
                              onLocationChange={(next) =>
                                locationChanged(pane.id, next)
                              }
                            />
                          </div>
                        </div>
                        {links.dragging && rect ? (
                          <DropOverlay
                            edge={
                              dropTarget?.paneId === pane.id
                                ? dropTarget.edge
                                : null
                            }
                          />
                        ) : null}
                      </div>
                    )
                  })}
                  {!solo
                    ? geometry.dividers.map((divider) => {
                        const vertical = divider.direction === 'row'
                        return (
                          <div
                            key={`${divider.splitId}-${divider.index}`}
                            role="separator"
                            tabIndex={0}
                            aria-label="Resize panes"
                            aria-orientation={
                              vertical ? 'vertical' : 'horizontal'
                            }
                            className={`mx-div ${vertical ? 'is-row' : 'is-column'}`}
                            style={
                              vertical
                                ? {
                                    left: `${divider.rect.x * 100}%`,
                                    top: `${divider.rect.y * 100}%`,
                                    height: `${divider.rect.h * 100}%`,
                                  }
                                : {
                                    left: `${divider.rect.x * 100}%`,
                                    top: `${divider.rect.y * 100}%`,
                                    width: `${divider.rect.w * 100}%`,
                                  }
                            }
                            onPointerDown={(event) =>
                              startDrag(event, divider.splitId, divider.index)
                            }
                            onKeyDown={(event) => {
                              const forward = vertical
                                ? 'ArrowRight'
                                : 'ArrowDown'
                              const back = vertical ? 'ArrowLeft' : 'ArrowUp'
                              if (event.key !== forward && event.key !== back)
                                return
                              event.preventDefault()
                              const step = event.shiftKey ? 0.1 : 0.02
                              apply((previous) =>
                                resizeDivider(
                                  previous,
                                  divider.splitId,
                                  divider.index,
                                  event.key === forward ? step : -step,
                                ),
                              )
                            }}
                          >
                            <span className="mx-grab" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </span>
                          </div>
                        )
                      })
                    : null}
                </div>
              )
            })}
          </div>
          {state.shelfOpen ? (
            <Shelf
              items={state.shelf}
              dropActive={links.dragging}
              onPromote={(id) => {
                const result = promoteFromShelf(
                  current.current,
                  id,
                  crypto.randomUUID(),
                )
                if (!result) return
                apply(() => result.state)
                if (result.created)
                  openedAt.current.set(result.paneId, Date.now())
                const pane = paneOf(activeTab(result.state), result.paneId)
                if (pane) mirror(pane.href)
              }}
              onRemove={(id) => apply((previous) => unpin(previous, id))}
              onClose={() => apply((previous) => setShelfOpen(previous, false))}
              onDropLink={(dropped) => {
                const nextHref = workspaceHref(dropped, location.origin)
                if (nextHref) pinHref(nextHref, pageTitleFor(nextHref))
              }}
            />
          ) : null}
        </div>
        <WorkspaceStatus
          layoutName={tab.name}
          saved={!tab.dirty && !!tab.layoutId}
          link={
            focusedLink && driver
              ? {
                  letter: focusedLink.letter,
                  driverLabel: driver.identifier ?? driver.title,
                  followers: focusedLink.followerIds.length,
                }
              : undefined
          }
          hints={hints}
        />
        {links.hint ? (
          <div
            className="mx-pill"
            role="presentation"
            style={{ left: links.hint.left, top: links.hint.top }}
          >
            <span className="mx-kbd is-inv">Space</span> peek
            <span className="mx-dotsep">·</span>
            <span className="mx-kbd is-inv">
              {platform === 'mac' ? '⌥' : 'Alt'}
            </span>
            -click open beside
          </div>
        ) : null}
        {links.peek ? (
          <PeekCard
            target={links.peek}
            pinned={shelfHrefs.has(links.peek.href)}
            onClose={() => links.setPeek(null)}
            onOpenBeside={() => {
              const target = links.peek
              links.setPeek(null)
              if (target)
                open(target.href, {
                  beside: true,
                  title: target.identifier ?? target.title,
                  identifier: target.identifier,
                })
            }}
            onOpenHere={() => {
              const target = links.peek
              links.setPeek(null)
              if (target) open(target.href)
            }}
            onPin={() => {
              const target = links.peek
              links.setPeek(null)
              if (target)
                pinHref(
                  target.href,
                  target.title,
                  target.identifier,
                  target.from,
                )
            }}
          />
        ) : null}
      </section>
    </WorkspaceNavigationContext.Provider>
  )
}

function pageTitleFor(href: string) {
  return paneKind(href).label
}

function DropOverlay({ edge }: { edge: DropEdge | 'center' | null }) {
  if (!edge) return null
  if (edge === 'center')
    return (
      <div
        className="mx-drop"
        style={{ top: '30%', bottom: '30%', left: '30%', right: '30%' }}
        aria-hidden="true"
      >
        <span className="mx-drop-l">Cite here</span>
      </div>
    )
  const style: React.CSSProperties =
    edge === 'left'
      ? { top: 0, bottom: 0, left: 0, width: '50%' }
      : edge === 'right'
        ? { top: 0, bottom: 0, right: 0, width: '50%' }
        : edge === 'top'
          ? { top: 0, left: 0, right: 0, height: '50%' }
          : { bottom: 0, left: 0, right: 0, height: '50%' }
  return (
    <div className="mx-drop" style={style} aria-hidden="true">
      <span className="mx-drop-l">Open beside</span>
    </div>
  )
}
