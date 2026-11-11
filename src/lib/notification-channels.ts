import { eventLabel } from './event-catalogue'

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

/** What a run's output contributed to the notification, as the run recorded it. */
export interface PipelineRunNotificationResult {
  rowCount?: number | null
  outputDatasetId?: string | null
  outputDatasetVersionId?: string | null
  outputLabel?: string | null
}

export interface PipelineRunNotification {
  schemaVersion: string
  eventType: string
  eventId: string
  workspaceId: string
  runId: string
  definitionVersionId: string
  data?: unknown
  /** Built from resolved action values, so the shape is not known here. */
  result: PipelineRunNotificationResult
}

/** One labelled line in a Teams message card. */
export interface TeamsMessageFact {
  name: string
  value: string
}

/** A Teams incoming webhook message card. */
export interface TeamsMessageCard {
  '@type': 'MessageCard'
  '@context': string
  summary: string
  title: string
  facts?: TeamsMessageFact[]
  text: string
}

/** The subject and plain-text body an email destination sends. */
export interface EmailMessage {
  subject: string
  body: string
}

/** A person-facing message: a title, then the body lines it has. */
export interface EventMessage {
  title: string
  body: string
}

/** A Teams incoming webhook message card for a completed run. */
export function teamsMessageCard(
  payload: PipelineRunNotification,
  options: { title?: string } = {},
): TeamsMessageCard {
  const label =
    payload.result.outputLabel ?? payload.result.outputDatasetId ?? null

  const facts: TeamsMessageFact[] = [{ name: 'Run', value: payload.runId }]

  if (label) facts.push({ name: 'Output', value: label })

  if (payload.result.rowCount != null)
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
): EmailMessage {
  const subject = options.title ?? 'Pipeline run completed'
  const lines = [`Run ${payload.runId} completed.`]

  const label =
    payload.result.outputLabel ?? payload.result.outputDatasetId ?? null

  if (label) lines.push(`Output: ${label}`)

  if (payload.result.rowCount != null)
    lines.push(`Rows: ${payload.result.rowCount}`)

  return { subject, body: lines.join('\n') }
}

/**
 * Any catalogue event, as a message for a person. Only the event's name and time
 * are shown: the full payload goes to webhook receivers, and a message for a
 * person has no use for ids.
 */
export interface EventNotification {
  eventType: string
  createdAt: string
}

export function eventMessage(
  event: EventNotification,
  appUrl: string,
): EventMessage {
  const title = eventLabel(event.eventType)
  const when = new Date(event.createdAt)

  const lines = [
    title,
    Number.isNaN(when.getTime())
      ? null
      : `When: ${when.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    `Open Sheetbase: ${appUrl}`,
  ]

  return { title, body: lines.filter(Boolean).join('\n') }
}

/** The Teams card for any catalogue event. */
export function eventTeamsCard(
  event: EventNotification,
  appUrl: string,
): TeamsMessageCard {
  const { title, body } = eventMessage(event, appUrl)

  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: title,
    title,
    text: body.split('\n').slice(1).join('  \n'),
  }
}
