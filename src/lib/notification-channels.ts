/**
 * PIPE-05.1 — the body a channel sends.
 *
 * A destination is typed, because the same URL shape means different things: a generic
 * webhook receives the signed event payload as JSON, while a Teams incoming webhook expects a
 * message card and ignores the signature. Sending the wrong one is not a delivery failure the
 * engine can see — Teams answers 200 for a card it can render and 400 for one it cannot — so
 * the type has to be chosen here rather than guessed at delivery time.
 *
 * An `email` destination is a person, not a URL: the outbox is keyed by person (user_id plus
 * to_email) and the address is read from their account, so a changed address is not a stale
 * copy sitting in a destination. Its template is a subject and a plain-text body.
 */

export type NotificationChannelType = 'webhook' | 'teams' | 'email'

export interface PipelineRunNotification {
  schemaVersion: string
  eventType: string
  eventId: string
  workspaceId: string
  runId: string
  definitionVersionId: string
  data?: unknown
  /** Built from resolved action values, so the shape is not known here. */
  result: {
    rowCount?: unknown
    outputDatasetId?: unknown
    outputDatasetVersionId?: unknown
    outputLabel?: unknown
  }
}

/** A Teams incoming webhook message card for a completed run. */
export function teamsMessageCard(
  payload: PipelineRunNotification,
  options: { title?: string } = {},
): Record<string, unknown> {
  const label =
    typeof payload.result.outputLabel === 'string'
      ? payload.result.outputLabel
      : typeof payload.result.outputDatasetId === 'string'
        ? payload.result.outputDatasetId
        : null
  const facts: Array<{ name: string; value: string }> = [
    { name: 'Run', value: payload.runId },
  ]
  if (label) facts.push({ name: 'Output', value: label })
  if (typeof payload.result.rowCount === 'number')
    facts.push({ name: 'Rows', value: String(payload.result.rowCount) })
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: options.title ?? 'Pipeline run completed',
    title: options.title ?? 'Pipeline run completed',
    facts,
    text: `Pipeline run ${payload.runId} completed.`,
  }
}

/**
 * The body a channel sends for this payload. `webhook` is the signed JSON the delivery engine
 * already posts; `teams` is the card. An unknown type falls back to the webhook body, which is
 * what a subscription without a type has always sent.
 */
export function channelBody(
  channelType: string | null | undefined,
  payload: PipelineRunNotification,
  options: { title?: string } = {},
): string {
  if (channelType === 'teams')
    return JSON.stringify(teamsMessageCard(payload, options))
  return JSON.stringify(payload)
}

/** The subject and body an email destination sends for a completed run. */
export function emailMessage(
  payload: PipelineRunNotification,
  options: { title?: string } = {},
): { subject: string; body: string } {
  const subject = options.title ?? 'Pipeline run completed'
  const lines = [`Run ${payload.runId} completed.`]
  const label =
    typeof payload.result.outputLabel === 'string'
      ? payload.result.outputLabel
      : typeof payload.result.outputDatasetId === 'string'
        ? payload.result.outputDatasetId
        : null
  if (label) lines.push(`Output: ${label}`)
  if (typeof payload.result.rowCount === 'number')
    lines.push(`Rows: ${payload.result.rowCount}`)
  return { subject, body: lines.join('\n') }
}
