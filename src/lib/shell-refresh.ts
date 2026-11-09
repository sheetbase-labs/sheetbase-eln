/**
 * The shell (sidebar pinned projects, counts, notifications) is loaded by the
 * page router, but record pages render inside workspace panes that have their
 * own router. A pane cannot invalidate the shell's router directly, so it
 * asks for a refresh through this event and the workspace host answers it.
 */
const SHELL_REFRESH_EVENT = 'sheetbase:shell-refresh'

/** Ask the workspace host to reload the shell data. */
export function requestShellRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SHELL_REFRESH_EVENT))
}

/** Run `refresh` whenever a pane asks for the shell to reload. */
export function registerShellRefresh(refresh: () => void) {
  window.addEventListener(SHELL_REFRESH_EVENT, refresh)

  return () => window.removeEventListener(SHELL_REFRESH_EVENT, refresh)
}
