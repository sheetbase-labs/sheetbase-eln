import { createContext, useContext } from 'react'

export interface WorkspaceOpenOptions {
  beside?: boolean
  below?: boolean
  title?: string
  identifier?: string
  /** Open a second pane on a page that is already open. */
  duplicate?: boolean
  /** Which side of the target the new pane goes (default: after it). */
  before?: boolean
}

export interface WorkspaceNavigation {
  open: (href: string, options?: WorkspaceOpenOptions) => void
}

export const WorkspaceNavigationContext =
  createContext<WorkspaceNavigation | null>(null)

export function useWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext)
}

type ClickLike = Pick<
  MouseEvent,
  'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>

/** A click the browser keeps for itself: another tab, a window, a download. */
export function isBrowserClick(event: Omit<ClickLike, 'altKey'>) {
  return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey
}

/**
 * The one rule for activating an object (a registry row, an identifier such as
 * EXP-0142, a block's source link): it opens in the pane you are in, like any
 * other link, and Alt-click (or ⌥↵) opens it beside instead. Returns true only
 * when it opened a pane beside; otherwise the caller lets the link run, or
 * navigates itself for a row or keyboard activation that has no link.
 */
export function openBesideOnAlt(
  workspace: WorkspaceNavigation | null,
  href: string,
  event: (ClickLike & { preventDefault: () => void }) | undefined,
  title?: string,
) {
  if (!workspace || !event?.altKey || isBrowserClick(event)) return false
  event.preventDefault()
  workspace.open(href, { beside: true, title })
  return true
}

/**
 * What a pane is allowed to do. Exactly one pane in a workspace is primary and
 * may edit; every other pane is read-only and pinned to the revision it shows.
 * A page outside a workspace (or a pane that is primary) is editable.
 */
export interface PaneContextValue {
  paneId: string | null
  readOnly: boolean
  /** Report that a newer revision than the pinned one exists (`S-16`). */
  reportNewer: (revision: string | undefined) => void
  /** Report the row this pane has selected, for panes linked to follow it. */
  reportSelection: (rowId: string | undefined) => void
  /** The row the pane this one follows has selected, if it has one. */
  followedSelection?: string
}

const standalone: PaneContextValue = {
  paneId: null,
  readOnly: false,
  reportNewer: () => {},
  reportSelection: () => {},
}

export const PaneContext = createContext<PaneContextValue>(standalone)

export function usePaneContext() {
  return useContext(PaneContext)
}

/** True when this page is shown in a pane that may not edit. */
export function usePaneReadOnly() {
  return useContext(PaneContext).readOnly
}

const LEAVE_EVENT = 'sheetbase:workspace-leave'

/** Shell actions must obtain approval before changing the session/workspace. */
export async function requestWorkspaceLeave(): Promise<boolean> {
  const approvals: Promise<boolean>[] = []
  window.dispatchEvent(
    new CustomEvent<(approval: Promise<boolean>) => void>(LEAVE_EVENT, {
      detail: (approval) => approvals.push(approval),
    }),
  )
  return (await Promise.all(approvals)).every(Boolean)
}

export function registerWorkspaceLeave(approve: () => Promise<boolean>) {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent) event.detail(approve())
  }
  window.addEventListener(LEAVE_EVENT, listener)
  return () => window.removeEventListener(LEAVE_EVENT, listener)
}
