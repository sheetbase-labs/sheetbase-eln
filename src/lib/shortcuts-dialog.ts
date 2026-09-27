/**
 * Minimum API for opening the keyboard-shortcuts dialog (SHELL-03) from
 * anywhere, without the caller needing a handle on the shell's dialog state.
 * The shell owns one listener; routes and buttons dispatch the event.
 */
export const OPEN_SHORTCUTS_EVENT = 'sheetbase:open-shortcuts'

export function requestShortcutsDialog(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))
}
