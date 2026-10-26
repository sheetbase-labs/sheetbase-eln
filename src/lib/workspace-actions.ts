/**
 * Every change to the multiplex workspace as a pure function of its state.
 * The host calls these and renders the result; nothing here touches the DOM,
 * the router or storage, so each rule in the pane system can be tested alone.
 */
import {
  applyPreset,
  hasPane,
  listPaneIds,
  neighbourOf,
  removePane,
  resizeSplit,
  splitPane,
  presetPaneCount,
} from '#/lib/pane-tree'
import type { LayoutPreset, SplitDirection } from '#/lib/pane-tree'
import {
  linkLetters,
  newPane,
  newTab,
  paneKind,
  pageTitle,
} from '#/lib/workspace-state'
import type {
  PaneLink,
  ShelfItem,
  TrailStep,
  WorkspacePane,
  WorkspaceState,
  WorkspaceTab,
} from '#/lib/workspace-state'

/** How many earlier pages a pane remembers. */
export const TRAIL_LIMIT = 24

export function activeTab(state: WorkspaceState): WorkspaceTab {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
}

export function paneOf(
  tab: WorkspaceTab,
  id: string,
): WorkspacePane | undefined {
  return tab.panes.find((pane) => pane.id === id)
}

function updateTab(
  state: WorkspaceState,
  tabId: string,
  change: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? change(tab) : tab)),
  }
}

function touch(tab: WorkspaceTab): WorkspaceTab {
  return { ...tab, dirty: true }
}

export function focusPane(
  state: WorkspaceState,
  paneId: string,
): WorkspaceState {
  const tab = activeTab(state)
  if (tab.activeId === paneId || !hasPane(tab.tree, paneId)) return state
  return updateTab(state, tab.id, (current) => ({
    ...current,
    activeId: paneId,
  }))
}

/** The nth pane (1-based) in reading order, for ⌘1–⌘9. */
export function paneAtNumber(
  tab: WorkspaceTab,
  number: number,
): string | undefined {
  return listPaneIds(tab.tree)[number - 1]
}

export interface OpenRequest {
  href: string
  newId: string
  title?: string
  identifier?: string
  direction?: SplitDirection
  before?: boolean
  /** Open a second pane even if the page is already open. */
  duplicate?: boolean
  /** Split this pane instead of the focused one (a link dropped on its edge). */
  targetId?: string
}

export interface OpenResult {
  state: WorkspaceState
  /** The pane that now shows the page (new or existing). */
  paneId: string
  created: boolean
}

/**
 * Open a page beside the focused pane. The page lands read-only, pinned to
 * what it shows, unless the pane it opened from is a list or tool rather than
 * a record: nothing is being edited there, so the new pane takes over as
 * primary (opening an experiment from the registry must still let you work).
 */
export function openBeside(
  state: WorkspaceState,
  request: OpenRequest,
): OpenResult {
  const tab = activeTab(state)
  if (!request.duplicate) {
    const existing = tab.panes.find((pane) => pane.href === request.href)
    if (existing) {
      return {
        state: focusPane(state, existing.id),
        paneId: existing.id,
        created: false,
      }
    }
  }
  const targetId =
    request.targetId && hasPane(tab.tree, request.targetId)
      ? request.targetId
      : tab.activeId
  const source = paneOf(tab, targetId)
  const base = newPane(request.href, request.newId)
  const pane: WorkspacePane = {
    ...base,
    title: request.title ?? base.title,
    identifier: request.identifier,
  }
  const sourceIsRecord = source ? paneKind(source.href).record : false
  const next = updateTab(state, tab.id, (current) =>
    touch({
      ...current,
      panes: [...current.panes, pane],
      tree: splitPane(
        current.tree,
        targetId,
        pane.id,
        request.direction ?? 'row',
        request.before ?? false,
      ),
      activeId: pane.id,
      primaryId: sourceIsRecord ? current.primaryId : pane.id,
    }),
  )
  return { state: next, paneId: pane.id, created: true }
}

export function closePane(
  state: WorkspaceState,
  paneId: string,
): WorkspaceState {
  const tab = activeTab(state)
  if (tab.panes.length < 2 || !hasPane(tab.tree, paneId)) return state
  const order = listPaneIds(tab.tree)
  const index = order.indexOf(paneId)
  const tree = removePane(tab.tree, paneId)
  if (!tree) return state
  const remaining = tab.panes.filter((pane) => pane.id !== paneId)
  const fallback = order[index + 1] ?? order[index - 1]
  const activeId = tab.activeId === paneId ? fallback : tab.activeId
  const primaryId = tab.primaryId === paneId ? activeId : tab.primaryId
  const links = tab.links.flatMap((link) => pruneLink(link, paneId))
  return updateTab(state, tab.id, (current) =>
    touch({ ...current, panes: remaining, tree, activeId, primaryId, links }),
  )
}

function pruneLink(link: PaneLink, removed: string): PaneLink[] {
  const followerIds = link.followerIds.filter((id) => id !== removed)
  if (link.driverId === removed) {
    const [driverId, ...rest] = followerIds
    return driverId && rest.length > 0
      ? [{ ...link, driverId, followerIds: rest }]
      : []
  }
  return followerIds.length > 0 ? [{ ...link, followerIds }] : []
}

export function makePrimary(
  state: WorkspaceState,
  paneId: string,
): WorkspaceState {
  const tab = activeTab(state)
  if (tab.primaryId === paneId || !hasPane(tab.tree, paneId)) return state
  return updateTab(state, tab.id, (current) =>
    touch({ ...current, primaryId: paneId, activeId: paneId }),
  )
}

export function resizeDivider(
  state: WorkspaceState,
  splitId: string,
  index: number,
  fraction: number,
): WorkspaceState {
  const tab = activeTab(state)
  return updateTab(state, tab.id, (current) =>
    touch({
      ...current,
      tree: resizeSplit(current.tree, splitId, index, fraction),
    }),
  )
}

/**
 * Tile the workspace into a preset. A preset that needs more panes than are
 * open duplicates the focused page into the missing ones, as the old split
 * buttons did; nothing already open is ever closed.
 */
export function arrange(
  state: WorkspaceState,
  preset: LayoutPreset,
  newIds: () => string,
): WorkspaceState {
  const tab = activeTab(state)
  if (preset === 'single') return state
  const source = paneOf(tab, tab.activeId)
  let panes = tab.panes
  const missing = Math.max(0, presetPaneCount[preset] - panes.length)
  for (let i = 0; i < missing && source; i += 1) {
    panes = [
      ...panes,
      {
        ...newPane(source.href, newIds()),
        title: source.title,
        identifier: source.identifier,
      },
    ]
  }
  const order = [
    ...listPaneIds(tab.tree),
    ...panes
      .filter((pane) => !hasPane(tab.tree, pane.id))
      .map((pane) => pane.id),
  ]
  return updateTab(state, tab.id, (current) =>
    touch({
      ...current,
      panes,
      tree: applyPreset(preset, order, current.primaryId),
    }),
  )
}

/** A pane's own history: moving to a new page pushes the old one. */
export function recordNavigation(
  state: WorkspaceState,
  paneId: string,
  href: string,
): WorkspaceState {
  const tab = activeTabContaining(state, paneId)
  const pane = tab ? paneOf(tab, paneId) : undefined
  if (!tab || !pane || pane.href === href) return state
  const samePage = pane.href.split(/[?#]/)[0] === href.split(/[?#]/)[0]
  const step: TrailStep = {
    href: pane.href,
    title: pane.title,
    identifier: pane.identifier,
    leftAt: new Date().toISOString(),
  }
  return updateTab(state, tab.id, (current) => ({
    ...current,
    panes: current.panes.map((entry) =>
      entry.id !== paneId
        ? entry
        : samePage
          ? { ...entry, href }
          : {
              ...entry,
              href,
              title: pageTitle(href),
              identifier: undefined,
              trail: [...entry.trail, step].slice(-TRAIL_LIMIT),
              forward: [],
            },
    ),
    dirty: samePage ? current.dirty : true,
  }))
}

function activeTabContaining(state: WorkspaceState, paneId: string) {
  return state.tabs.find((tab) => tab.panes.some((pane) => pane.id === paneId))
}

/** Step back to an earlier page; the step you leave becomes the way forward. */
export function stepBack(
  state: WorkspaceState,
  paneId: string,
  steps = 1,
): { state: WorkspaceState; href: string } | null {
  const tab = activeTabContaining(state, paneId)
  const pane = tab ? paneOf(tab, paneId) : undefined
  if (!tab || !pane || pane.trail.length < steps) return null
  const keep = pane.trail.slice(0, pane.trail.length - steps)
  const popped = pane.trail.slice(pane.trail.length - steps)
  const target = popped[0]
  const here: TrailStep = {
    href: pane.href,
    title: pane.title,
    identifier: pane.identifier,
    leftAt: new Date().toISOString(),
  }
  const forward = [...popped.slice(1), here, ...pane.forward]
  return {
    href: target.href,
    state: updateTab(state, tab.id, (current) => ({
      ...current,
      panes: current.panes.map((entry) =>
        entry.id === paneId
          ? {
              ...entry,
              href: target.href,
              title: target.title,
              identifier: target.identifier,
              trail: keep,
              forward,
            }
          : entry,
      ),
    })),
  }
}

export function stepForward(
  state: WorkspaceState,
  paneId: string,
): { state: WorkspaceState; href: string } | null {
  const tab = activeTabContaining(state, paneId)
  const pane = tab ? paneOf(tab, paneId) : undefined
  if (!tab || !pane || pane.forward.length === 0) return null
  const [target, ...rest] = pane.forward
  const here: TrailStep = {
    href: pane.href,
    title: pane.title,
    identifier: pane.identifier,
  }
  return {
    href: target.href,
    state: updateTab(state, tab.id, (current) => ({
      ...current,
      panes: current.panes.map((entry) =>
        entry.id === paneId
          ? {
              ...entry,
              href: target.href,
              title: target.title,
              identifier: target.identifier,
              trail: [...entry.trail, here].slice(-TRAIL_LIMIT),
              forward: rest,
            }
          : entry,
      ),
    })),
  }
}

/**
 * A pane's address changed without the scientist leaving the page, e.g. a
 * redirect on load: follow it without adding a step to the trail.
 */
export function setPaneHref(
  state: WorkspaceState,
  paneId: string,
  href: string,
): WorkspaceState {
  const tab = activeTabContaining(state, paneId)
  const pane = tab ? paneOf(tab, paneId) : undefined
  if (!tab || !pane || pane.href === href) return state
  const samePage = pane.href.split(/[?#]/)[0] === href.split(/[?#]/)[0]
  return updateTab(state, tab.id, (current) => ({
    ...current,
    panes: current.panes.map((entry) =>
      entry.id !== paneId
        ? entry
        : samePage
          ? { ...entry, href }
          : { ...entry, href, title: pageTitle(href), identifier: undefined },
    ),
  }))
}

/** Titles and record IDs come from the page itself once it has rendered. */
export function setPaneMeta(
  state: WorkspaceState,
  paneId: string,
  meta: { title?: string; identifier?: string },
): WorkspaceState {
  const tab = activeTabContaining(state, paneId)
  const pane = tab ? paneOf(tab, paneId) : undefined
  if (!tab || !pane) return state
  const title = meta.title ?? pane.title
  const identifier = meta.identifier ?? pane.identifier
  if (title === pane.title && identifier === pane.identifier) return state
  return updateTab(state, tab.id, (current) => ({
    ...current,
    panes: current.panes.map((entry) =>
      entry.id === paneId ? { ...entry, title, identifier } : entry,
    ),
  }))
}

export function linkOf(
  tab: WorkspaceTab,
  paneId: string,
): PaneLink | undefined {
  return tab.links.find(
    (link) => link.driverId === paneId || link.followerIds.includes(paneId),
  )
}

/**
 * ⌘L: link the focused pane with its neighbour, or take it out of its link.
 * The focused pane drives. A neighbour already linked brings the focused pane
 * into its group as a follower.
 */
export function toggleLink(state: WorkspaceState): WorkspaceState {
  const tab = activeTab(state)
  const existing = linkOf(tab, tab.activeId)
  if (existing) {
    const links = tab.links.flatMap((link) =>
      link === existing ? pruneLink(link, tab.activeId) : [link],
    )
    return updateTab(state, tab.id, (current) => touch({ ...current, links }))
  }
  const neighbour = neighbourOf(tab.tree, tab.activeId)
  if (!neighbour) return state
  const neighbourLink = linkOf(tab, neighbour)
  if (neighbourLink) {
    return updateTab(state, tab.id, (current) =>
      touch({
        ...current,
        links: current.links.map((link) =>
          link === neighbourLink
            ? { ...link, followerIds: [...link.followerIds, tab.activeId] }
            : link,
        ),
      }),
    )
  }
  const used = new Set(tab.links.map((link) => link.letter))
  const letter = linkLetters.find((candidate) => !used.has(candidate))
  if (!letter) return state
  const link: PaneLink = {
    letter,
    driverId: tab.activeId,
    followerIds: [neighbour],
  }
  return updateTab(state, tab.id, (current) =>
    touch({ ...current, links: [...current.links, link] }),
  )
}

export function makeDriver(
  state: WorkspaceState,
  paneId: string,
): WorkspaceState {
  const tab = activeTab(state)
  const link = linkOf(tab, paneId)
  if (!link || link.driverId === paneId) return state
  return updateTab(state, tab.id, (current) => ({
    ...current,
    links: current.links.map((entry) =>
      entry === link
        ? {
            ...entry,
            driverId: paneId,
            followerIds: [
              ...entry.followerIds.filter((id) => id !== paneId),
              entry.driverId,
            ],
          }
        : entry,
    ),
  }))
}

export function pinToShelf(
  state: WorkspaceState,
  item: Omit<ShelfItem, 'id'> & { id: string },
): WorkspaceState {
  if (state.shelf.some((entry) => entry.href === item.href)) {
    return { ...state, shelfOpen: true }
  }
  return { ...state, shelf: [...state.shelf, item], shelfOpen: true }
}

export function unpin(state: WorkspaceState, id: string): WorkspaceState {
  return { ...state, shelf: state.shelf.filter((entry) => entry.id !== id) }
}

/** Promote a kept record to a pane beside the focused one. */
export function promoteFromShelf(
  state: WorkspaceState,
  id: string,
  newId: string,
): OpenResult | null {
  const item = state.shelf.find((entry) => entry.id === id)
  if (!item) return null
  const opened = openBeside(unpin(state, id), {
    href: item.href,
    newId,
    title: item.title,
    identifier: item.identifier,
  })
  return opened
}

export function setShelfOpen(
  state: WorkspaceState,
  open: boolean,
): WorkspaceState {
  return { ...state, shelfOpen: open }
}

/* Workspace tabs */

export function addTab(
  state: WorkspaceState,
  href: string,
  ids: { tabId: string; paneId: string },
): WorkspaceState {
  const count = state.tabs.length + 1
  const tab = newTab(href, {
    id: ids.tabId,
    paneId: ids.paneId,
    name: `Workspace ${count}`,
  })
  return {
    ...state,
    tabs: [...state.tabs, { ...tab, dirty: true }],
    activeTabId: tab.id,
  }
}

export function addTabFrom(
  state: WorkspaceState,
  tab: WorkspaceTab,
): WorkspaceState {
  return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id }
}

export function switchTab(
  state: WorkspaceState,
  tabId: string,
): WorkspaceState {
  return state.tabs.some((tab) => tab.id === tabId)
    ? { ...state, activeTabId: tabId }
    : state
}

/** ⌃Tab: the next workspace tab, wrapping. */
export function nextTab(state: WorkspaceState): WorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
  return switchTab(state, state.tabs[(index + 1) % state.tabs.length].id)
}

export function closeTab(state: WorkspaceState, tabId: string): WorkspaceState {
  if (state.tabs.length < 2) return state
  const index = state.tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== tabId)
  const activeTabId =
    state.activeTabId === tabId
      ? tabs[Math.min(index, tabs.length - 1)].id
      : state.activeTabId
  return { ...state, tabs, activeTabId }
}

export function renameTab(
  state: WorkspaceState,
  tabId: string,
  name: string,
): WorkspaceState {
  const trimmed = name.trim()
  if (!trimmed) return state
  return updateTab(state, tabId, (tab) => touch({ ...tab, name: trimmed }))
}

export function markSaved(
  state: WorkspaceState,
  tabId: string,
  layoutId: string,
  name: string,
): WorkspaceState {
  return updateTab(state, tabId, (tab) => ({
    ...tab,
    layoutId,
    name,
    dirty: false,
  }))
}
