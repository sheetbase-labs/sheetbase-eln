import type { UIMessage } from 'ai'
import { z } from 'zod'

/**
 * What became of each card the assistant showed: applied, dismissed, failed or
 * still waiting, and the record an applied card made. The assistant is told
 * this with every question (`toChatTurns`) and it is saved with the chat, so
 * it knows what it did, in this chat and in later ones.
 */
export const cardOutcomeSchema = z.object({
  status: z.enum(['applied', 'dismissed', 'failed', 'needs_signature']),
  /** The card's own title, as the person saw it. */
  title: z.string(),
  /** Why it failed. */
  reason: z.string().optional(),
  /** The record the card made or changed, by the ID the app shows. */
  made: z.object({ identifier: z.string(), title: z.string() }).optional(),
  /** Where the card led to, for a card that made something with no ID. */
  opened: z.string().optional(),
  at: z.string(),
})

export type CardOutcome = z.infer<typeof cardOutcomeSchema>

const outcomes = new Map<string, CardOutcome>()
const listeners = new Set<() => void>()

export function recordCardOutcome(callId: string, outcome: CardOutcome): void {
  outcomes.set(callId, outcome)

  for (const listener of listeners) listener()
}

export function cardOutcomeFor(callId: string): CardOutcome | undefined {
  return outcomes.get(callId)
}

export function subscribeCardOutcomes(listener: () => void): () => void {
  listeners.add(listener)

  return () => void listeners.delete(listener)
}

/** For tests: forget every outcome. */
export function resetCardOutcomes(): void {
  outcomes.clear()
  listeners.clear()
}

const savedOutputSchema = z.looseObject({ outcome: cardOutcomeSchema })

/** An outcome saved on a tool part's output, or null when there is none. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Saved tool output is untyped JSON; the schema below is the boundary.
export function outcomeFromOutput(output: unknown): CardOutcome | null {
  const parsed = savedOutputSchema.safeParse(output)

  return parsed.success ? parsed.data.outcome : null
}

/** One line telling the assistant what a card came to. */
export function outcomeLine(
  title: string,
  outcome: CardOutcome | undefined,
): string {
  if (!outcome) return `"${title}": shown, not applied yet`

  switch (outcome.status) {
    case 'applied': {
      const made = outcome.made
        ? `; made ${outcome.made.identifier} "${outcome.made.title}"`
        : outcome.opened
          ? `; led to ${outcome.opened}`
          : ''

      return `"${title}": APPLIED by the person${made}`
    }

    case 'dismissed':
      return `"${title}": dismissed, nothing was done`
    case 'needs_signature':
      return `"${title}": waiting for a signature, not done yet`
    case 'failed':
      return `"${title}": FAILED${outcome.reason ? ` (${outcome.reason})` : ''}, nothing was done`
  }
}

const toolPartSchema = z.looseObject({
  type: z.literal('dynamic-tool'),
  toolCallId: z.string(),
  state: z.string(),
  output: z.unknown(),
})

const cardOutputSchema = z.looseObject({
  proposal: z.looseObject({ title: z.string().optional() }),
})

/** The cards in an assistant message, as lines about what each came to. */
export function cardLines(message: UIMessage): string[] {
  const lines: string[] = []

  for (const part of message.parts) {
    const tool = toolPartSchema.safeParse(part)

    if (!tool.success || tool.data.state !== 'output-available') continue
    const card = cardOutputSchema.safeParse(tool.data.output)

    if (!card.success) continue

    const outcome =
      cardOutcomeFor(tool.data.toolCallId) ??
      outcomeFromOutput(tool.data.output) ??
      undefined

    lines.push(outcomeLine(card.data.proposal.title ?? 'Card', outcome))
  }

  return lines
}

/** Load the outcomes saved with a chat, so its cards show and report them again. */
export function hydrateCardOutcomes(messages: readonly UIMessage[]): void {
  for (const message of messages) {
    for (const part of message.parts) {
      const tool = toolPartSchema.safeParse(part)

      if (!tool.success) continue
      const outcome = outcomeFromOutput(tool.data.output)

      if (outcome && !outcomes.has(tool.data.toolCallId))
        outcomes.set(tool.data.toolCallId, outcome)
    }
  }
}

const OPENED_RECORD =
  /^\/(?:experiments|records|samples|materials|protocols|instruments|reports)\/([0-9a-f-]{36})(?:\/|$)/i

/** The record id in a page address a card led to, or null. */
export function recordIdFromHref(
  href: string | null | undefined,
): string | null {
  return href ? (OPENED_RECORD.exec(href)?.[1] ?? null) : null
}
