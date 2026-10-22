import { createContext, useContext } from 'react'

export interface WorkspaceNavigation {
  open: (href: string, options?: { beside?: boolean; title?: string }) => void
}

export const WorkspaceNavigationContext =
  createContext<WorkspaceNavigation | null>(null)

export function useWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext)
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
