import type { Tone } from '#/components/ui/status'
import { formatDate } from '#/lib/format-date'
import type {
  WebhookEndpointHealthWire,
  WebhookSubscriptionWire,
} from '#/lib/webhook-admin'
import { t } from '#/copy'

/** The host of an endpoint, or the whole address when it does not parse. */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The name people give an endpoint: its description, else its host. */
export function endpointName(sub: {
  description: string | null
  url: string
  recipientName?: string | null
}): string {
  return (
    sub.description?.trim() ||
    (sub.url ? endpointHost(sub.url) : (sub.recipientName ?? ''))
  )
}

/** Where a destination sends, in words a scientist would use. */
export function destinationLabel(sub: {
  channelType: string
  url: string
  recipientName?: string | null
}): string {
  if (sub.channelType === 'email') {
    return t('settings.webhookSections.emailTo', {
      name: sub.recipientName || t('settings.webhookSections.aPerson'),
    })
  }

  if (sub.channelType === 'teams') {
    return t('settings.webhookSections.teamsChannel', {
      host: endpointHost(sub.url),
    })
  }

  return sub.url
}

interface DeliverySummary {
  tone: Tone
  text: string
}

/** Where the last delivery got to, in the words of the integrations board. */
export function lastDeliverySummary(
  sub: WebhookSubscriptionWire,
  health: WebhookEndpointHealthWire | undefined,
): DeliverySummary {
  if (sub.status === 'paused') return { tone: 'stored', text: 'Paused' }

  if (sub.status === 'disabled')
    return {
      tone: 'bad',
      text: t('settings.webhookSections.stoppedAfterRepeated'),
    }

  if (sub.status === 'archived') return { tone: 'stored', text: 'Archived' }

  if (health && health.consecutiveFailures > 0) {
    const tries = health.consecutiveFailures

    return {
      tone: 'bad',
      text: `Failing · retried ${tries} ${tries === 1 ? 'time' : 'times'}`,
    }
  }

  if (health?.lastDeliveredAt)
    return {
      tone: 'ok',
      text: `Delivered ${formatDate(health.lastDeliveredAt, { time: true })}`,
    }

  return { tone: 'none', text: t('settings.webhookSections.deliveriesYet') }
}
