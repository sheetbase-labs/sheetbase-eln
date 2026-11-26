/**
 * The pages open in the person's panes, so "the milestones you're looking at"
 * means something to the assistant. The workspace publishes them as they
 * change; the chat reads them when it sends a question.
 */
export interface OpenPane {
  /** The page address inside the app. */
  path: string
  /** What the pane's header shows. */
  title: string
  /** The record's own ID, such as EXP-4302, once the page showed one. */
  identifier?: string
  /** The pane with focus. */
  active: boolean
}

const MAX_PANES = 8

let panes: readonly OpenPane[] = []
const listeners = new Set<() => void>()

export function setOpenPanes(next: readonly OpenPane[]): void {
  const kept = next.slice(0, MAX_PANES)

  if (JSON.stringify(kept) === JSON.stringify(panes)) return
  panes = kept

  for (const listener of listeners) listener()
}

export function getOpenPanes(): readonly OpenPane[] {
  return panes
}

export function subscribeOpenPanes(listener: () => void): () => void {
  listeners.add(listener)

  return () => void listeners.delete(listener)
}

/** The panes as the chat request carries them: short, and never the chat itself. */
export function openPanesForRequest(): OpenPane[] {
  return panes.flatMap((pane) => {
    if (pane.path.startsWith('/agent')) return []

    const sent: OpenPane = {
      path: pane.path.slice(0, 200),
      title: pane.title.slice(0, 80),
      active: pane.active,
    }

    if (pane.identifier) sent.identifier = pane.identifier.slice(0, 40)

    return [sent]
  })
}
