import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { formatDate } from '#/lib/format-date'
import {
  fetchWebhookHealthFn,
  listIncomingWebhooksFn,
  listWebhookSubscriptionsFn,
  webhookAdminKeys,
} from '#/lib/webhook-admin'
import type {
  IncomingWebhookWire,
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
}): string {
  return sub.description?.trim() || endpointHost(sub.url)
}

/** Where the last delivery got to, in the words of the integrations board. */
export function lastDeliverySummary(
  sub: WebhookSubscriptionWire,
  health: WebhookEndpointHealthWire | undefined,
): { tone: Tone; text: string } {
  if (sub.status === 'paused') return { tone: 'stored', text: 'Paused' }
  if (sub.status === 'disabled') {
    return {
      tone: 'bad',
      text: t('settings.webhookSections.stoppedAfterRepeated'),
    }
  }
  if (sub.status === 'archived') return { tone: 'stored', text: 'Archived' }
  if (health && health.consecutiveFailures > 0) {
    const tries = health.consecutiveFailures
    return {
      tone: 'bad',
      text: `Failing · retried ${tries} ${tries === 1 ? 'time' : 'times'}`,
    }
  }
  if (health?.lastDeliveredAt) {
    return {
      tone: 'ok',
      text: `Delivered ${formatDate(health.lastDeliveredAt, { time: true })}`,
    }
  }
  return { tone: 'none', text: t('settings.webhookSections.deliveriesYet') }
}

interface OutgoingRow {
  sub: WebhookSubscriptionWire
  health: WebhookEndpointHealthWire | undefined
}

const outgoingColumns: RegistryColumn<OutgoingRow>[] = [
  {
    id: 'endpoint',
    header: t('settings.webhookSections.outgoingWebhook'),
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{endpointName(row.original.sub)}</span>
        <span className="truncate text-label text-fg-muted">
          {row.original.sub.url}
        </span>
      </span>
    ),
  },
  {
    id: 'events',
    header: 'Events',
    cell: ({ row }) =>
      row.original.sub.eventTypes.length
        ? row.original.sub.eventTypes.join(', ')
        : t('settings.webhookSections.events'),
  },
  {
    id: 'last',
    header: t('settings.webhookSections.lastDelivery'),
    cell: ({ row }) => {
      const s = lastDeliverySummary(row.original.sub, row.original.health)
      return <Status tone={s.tone}>{s.text}</Status>
    },
  },
  {
    id: 'deliveries',
    header: '',
    cell: ({ row }) => (
      <Link
        to="/settings/integrations/webhooks/$subscriptionId"
        params={{ subscriptionId: row.original.sub.id }}
      >
        {t('settings.webhookSections.deliveries')}
      </Link>
    ),
  },
]

/** The workspace's outgoing webhooks: where each one sends, what it sends and
 * how its last delivery went. Only people who manage integrations see it. */
export function OutgoingWebhooks({ workspaceId }: { workspaceId: string }) {
  const subscriptions = useQuery({
    queryKey: webhookAdminKeys.subscriptions(workspaceId),
    queryFn: () => listWebhookSubscriptionsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const health = useQuery({
    queryKey: webhookAdminKeys.health(workspaceId),
    queryFn: () => fetchWebhookHealthFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const healthById = new Map(
    (health.data?.data ?? []).map((h) => [h.subscriptionId, h]),
  )
  const rows: OutgoingRow[] = (subscriptions.data ?? [])
    .filter((sub) => sub.status !== 'archived')
    .map((sub) => ({ sub, health: healthById.get(sub.id) }))

  return (
    <section
      aria-label={t('settings.webhookSections.outgoingWebhooksAria')}
      className="flex flex-col"
    >
      {subscriptions.error instanceof Error ? (
        <p
          role="alert"
          className="px-4 py-3 text-label text-danger-text md:px-6"
        >
          {t('settings.webhookSections.outgoingWebhooksCould')}
        </p>
      ) : rows.length ? (
        <RegistryGrid
          label={t('settings.webhookSections.outgoingWebhooksAria')}
          rows={rows}
          columns={outgoingColumns}
          getRowId={(row) => row.sub.id}
          selectable={false}
        />
      ) : subscriptions.isLoading ? (
        <Muted className="px-4 py-3 md:px-6">
          {t('settings.webhookSections.loadingOutgoingWebhooks')}
        </Muted>
      ) : (
        <Muted className="px-4 py-3 md:px-6">
          {t('settings.webhookSections.nothingSentOther')}
        </Muted>
      )}
    </section>
  )
}

const incomingColumns: RegistryColumn<IncomingWebhookWire>[] = [
  {
    id: 'name',
    header: t('settings.webhookSections.incomingWebhook'),
    cell: ({ row }) => (
      <Link
        to="/pipelines/$pipelineId/triggers"
        params={{ pipelineId: row.original.pipelineId }}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'starts',
    header: 'Starts',
    cell: ({ row }) => row.original.displayId ?? row.original.name,
  },
  {
    id: 'last',
    header: t('settings.webhookSections.lastCall'),
    cell: ({ row }) =>
      row.original.enabled ? (
        row.original.lastCallAt ? (
          formatDate(row.original.lastCallAt, { time: true })
        ) : (
          t('settings.webhookSections.calledYet')
        )
      ) : (
        <Status tone="stored">{t('settings.webhookSections.off')}</Status>
      ),
  },
]

/** Read-only list of pipelines that start from an incoming webhook; they are
 * set up on the pipeline's Triggers tab. */
export function IncomingWebhooks({ workspaceId }: { workspaceId: string }) {
  const incoming = useQuery({
    queryKey: ['admin-001', 'incoming-webhooks', workspaceId],
    queryFn: () => listIncomingWebhooksFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const rows = incoming.data ?? []
  return (
    <section
      aria-label={t('settings.webhookSections.incomingWebhooksAria')}
      className="flex flex-col"
    >
      {rows.length ? (
        <RegistryGrid
          label={t('settings.webhookSections.incomingWebhooksAria')}
          rows={rows}
          columns={incomingColumns}
          getRowId={(row) => row.pipelineId}
          selectable={false}
        />
      ) : null}
      <Muted className="px-4 py-3 md:px-6">
        {t('settings.webhookSections.incomingWebhooksBelong')}
      </Muted>
    </section>
  )
}
