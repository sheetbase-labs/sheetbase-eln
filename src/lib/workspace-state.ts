import {
  isLayoutNode,
  listPanes,
  singleStack,
} from '@sheetbase-labs/sheetbase-shared'
import type { Layout } from '@sheetbase-labs/sheetbase-shared'
import { z } from 'zod'

/** Public/authentication, API and standalone reference routes keep their shell. */
export function workspaceHref(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin)
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      /^\/(?:api(?:\/|$)|sign-in(?:\/|$)|client-portal(?:\/|$)|accept-invitation(?:\/|$)|docs(?:\/|$)|foundations(?:\/|$)|r(?:\/|$)|sheetbase-components(?:\/|$)|component-compare(?:\/|$))/.test(
        url.pathname,
      )
    )
      return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export interface WorkspacePane {
  id: string
  href: string
  title: string
}

export interface WorkspaceState {
  version: 1
  panes: WorkspacePane[]
  layout: Layout
  activeId: string
}

export function pageTitle(href: string) {
  const part = href.split(/[?#]/)[0]?.split('/').filter(Boolean).at(-1)
  if (!part) return 'Home'
  if (/^[\da-f-]{36}$/i.test(part)) return 'Record'
  return part
    .replaceAll('-', ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function initialWorkspace(href: string): WorkspaceState {
  return {
    version: 1,
    panes: [{ id: 'initial', href, title: pageTitle(href) }],
    layout: singleStack(['initial'], 'initial-stack'),
    activeId: 'initial',
  }
}

const savedWorkspace = z.object({
  version: z.literal(1),
  panes: z.array(
    z.object({ id: z.string().min(1), href: z.string(), title: z.string() }),
  ),
  layout: z.unknown(),
  activeId: z.string(),
})

/** Persist destinations/layout only, never scientific data or unsaved drafts. */
export function restoreWorkspace(
  saved: string | null,
  href: string,
  origin: string,
): WorkspaceState {
  if (!saved) return initialWorkspace(href)
  try {
    const parsed = savedWorkspace.safeParse(JSON.parse(saved))
    if (!parsed.success) return initialWorkspace(href)
    const state = parsed.data
    const ids = state.panes.map((pane) => pane.id)
    if (
      !state.panes.length ||
      new Set(ids).size !== ids.length ||
      !ids.includes(state.activeId) ||
      !state.panes.every(
        (pane) => workspaceHref(pane.href, origin) === pane.href,
      ) ||
      !isLayoutNode(state.layout)
    )
      return initialWorkspace(href)
    const placed = listPanes(state.layout)
    if (
      placed.length !== ids.length ||
      new Set(placed).size !== ids.length ||
      placed.some((id) => !ids.includes(id))
    )
      return initialWorkspace(href)
    // The address bar remains authoritative for the focused page on reload.
    return {
      version: 1,
      panes: state.panes.map((pane) =>
        pane.id === state.activeId
          ? { ...pane, href, title: pageTitle(href) }
          : pane,
      ),
      layout: state.layout,
      activeId: state.activeId,
    }
  } catch {
    return initialWorkspace(href)
  }
}
