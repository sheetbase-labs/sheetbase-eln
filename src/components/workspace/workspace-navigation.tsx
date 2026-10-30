import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

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
 * The click rule for a registry row, once: the row opens in the pane it was
 * clicked in, Alt-click opens it beside, and the browser keeps Ctrl, Meta,
 * Shift and middle clicks. The returned handler serves both the name link
 * (which passes its event, so the link runs) and `RegistryGrid`'s `onRowClick`
 * (no event, so it navigates itself).
 */
export function useOpenRow<T>(
  navigate: (options: { href: string }) => unknown,
  hrefFor: (row: T) => string | null,
  titleFor: (row: T) => string,
) {
  const workspace = useWorkspaceNavigation()
  // Callers pass inline arrows; the handler stays stable so column memos do too.
  const latest = useRef({ hrefFor, titleFor })
  latest.current = { hrefFor, titleFor }
  return useCallback(
    (row: T, event?: ReactMouseEvent) => {
      event?.stopPropagation()
      if (event && isBrowserClick(event)) return
      const href = latest.current.hrefFor(row)
      if (!href) return
      if (openBesideOnAlt(workspace, href, event, latest.current.titleFor(row)))
        return
      if (!event) void navigate({ href })
    },
    [workspace, navigate],
  )
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
  /** Report that the record on show is frozen by an approved signature. */
  reportFrozen: (frozen: boolean) => void
  /** Report the row this pane has selected, for panes linked to follow it. */
  reportSelection: (rowId: string | undefined) => void
  /** Make this pane the one that edits; a no-op outside the workspace. */
  makePrimary?: () => void
  /** The row the pane this one follows has selected, if it has one. */
  followedSelection?: string
  /**
   * The pane that edits while this one is read-only: its record's identifier
   * when it has one, and whether it shows this same record.
   */
  editingPane?: { identifier?: string; sameRecord: boolean }
}

const standalone: PaneContextValue = {
  paneId: null,
  readOnly: false,
  reportNewer: () => {},
  reportFrozen: () => {},
  reportSelection: () => {},
}

export const PaneContext = createContext<PaneContextValue>(standalone)

export function usePaneContext() {
  return useContext(PaneContext)
}

/** Tell the pane header that the record on show is frozen, so it reads
 * "Frozen evidence" rather than "Editing". */
export function useReportFrozen(frozen: boolean) {
  const { reportFrozen } = useContext(PaneContext)
  useEffect(() => {
    reportFrozen(frozen)
  }, [reportFrozen, frozen])
}

/** True when this page is shown in a pane that may not edit. */
export function usePaneReadOnly() {
  return useContext(PaneContext).readOnly
}

const BESIDE_EVENT = 'sheetbase:workspace-open-beside'

/** For surfaces outside the workspace (the search palette): open a pane beside. */
export function requestOpenBeside(href: string, title?: string) {
  window.dispatchEvent(
    new CustomEvent(BESIDE_EVENT, { detail: { href, title } }),
  )
}

export function registerOpenBeside(
  open: (href: string, title?: string) => void,
) {
  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const { href, title } = event.detail as { href: string; title?: string }
    open(href, title)
  }
  window.addEventListener(BESIDE_EVENT, listener)
  return () => window.removeEventListener(BESIDE_EVENT, listener)
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
