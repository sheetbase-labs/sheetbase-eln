/**
 * When a card or a plan step fails to apply, the assistant is told in the same
 * chat so it can explain the failure and offer a fixed card without the person
 * asking again. Cards report here; the open chat listens.
 */

export interface ActionFailure {
  /** One per card or plan, so a failure is fed back once. */
  id: string
  /** What the card was for, in the card's own words. */
  title: string
  /** Plain words for why it failed. */
  reason: string
}

type Listener = (failure: ActionFailure) => void

const listeners = new Set<Listener>()
const reported = new Set<string>()

/** Tells the open chat that an applied card failed. A card is reported once. */
export function reportActionFailure(failure: ActionFailure): void {
  if (reported.has(failure.id)) return

  reported.add(failure.id)

  for (const listener of listeners) listener(failure)
}

/** Lets a chat hear failures; returns the way to stop listening. */
export function onActionFailure(listener: Listener): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The message sent to the assistant for a failed card. */
export function failureMessage(failure: ActionFailure): string {
  return `The card "${failure.title}" could not be applied: ${failure.reason} Explain what went wrong in one plain sentence, then fix it yourself and offer a corrected card (for example under another name, or as an update to the one that already exists). Do not ask me to re-explain.`
}
