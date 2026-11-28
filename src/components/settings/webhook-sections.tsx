import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { Status } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
import {
  endpointName,
  destinationLabel,
  lastDeliverySummary,
} from './webhook-display'

export {
  endpointHost,
  endpointName,
  destinationLabel,
  lastDeliverySummary,
} from './webhook-display'

interface OutgoingRow {
  sub: WebhookSubscriptionWire
  health: WebhookEndpointHealthWire | undefined
}

const outgoingColumns: RegistryColumn<OutgoingRow>[] = [
  {
    id: 'endpoint',
    header: t('settings.webhookSections.outgoingWebhook'),
    meta: { cellClassName: 'max-md:whitespace-normal max-md:py-2' },
    cell: ({ row }) => {
      const summary = lastDeliverySummary(row.original.sub, row.original.health)

      return (
        <span className="flex min-w-0 flex-col">
          <span className="truncate max-md:whitespace-normal">
            {endpointName(row.original.sub)}
          </span>
          <span className="truncate text-label text-fg-muted max-md:break-all max-md:whitespace-normal">
            {destinationLabel(row.original.sub)}
          </span>
          {/* On a phone the other columns fold in here, so none is cut. */}
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
            <Status tone={summary.tone}>{summary.text}</Status>
            <Link
              to="/settings/workspace/integrations/webhooks/$subscriptionId"
              params={{ subscriptionId: row.original.sub.id }}
            >
              {t('settings.webhookSections.deliveries')}
            </Link>
          </span>
        </span>
      )
    },
  },
  {
    id: 'events',
    header: 'Events',
    meta: { headerClassName: 'max-md:hidden', cellClassName: 'max-md:hidden' },
    cell: ({ row }) =>
      row.original.sub.eventTypes.length
        ? row.original.sub.eventTypes.join(', ')
        : t('settings.webhookSections.events'),
  },
  {
    id: 'last',
    header: t('settings.webhookSections.lastDelivery'),
    meta: { headerClassName: 'max-md:hidden', cellClassName: 'max-md:hidden' },
    cell: ({ row }) => {
      const s = lastDeliverySummary(row.original.sub, row.original.health)

      return <Status tone={s.tone}>{s.text}</Status>
    },
  },
  {
    id: 'deliveries',
    header: '',
    meta: { headerClassName: 'max-md:hidden', cellClassName: 'max-md:hidden' },
    cell: ({ row }) => (
      <Link
        to="/settings/workspace/integrations/webhooks/$subscriptionId"
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
      className="flex flex-col gap-3"
    >
      {subscriptions.error instanceof Error ? (
        <p role="alert" className="m-0 text-label text-danger-text">
          {t('settings.webhookSections.outgoingWebhooksCould')}
        </p>
      ) : rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('settings.webhookSections.outgoingWebhooksAria')}
            rows={rows}
            columns={outgoingColumns}
            getRowId={(row) => row.sub.id}
            selectable={false}
            sortable={false}
          />
        </TableBox>
      ) : subscriptions.isLoading ? (
        <Muted>{t('settings.webhookSections.loadingOutgoingWebhooks')}</Muted>
      ) : (
        <Muted>{t('settings.webhookSections.nothingSentOther')}</Muted>
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
        to="/pipelines/$pipelineId/starts"
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
      className="flex flex-col gap-3"
    >
      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('settings.webhookSections.incomingWebhooksAria')}
            rows={rows}
            columns={incomingColumns}
            getRowId={(row) => row.pipelineId}
            selectable={false}
          />
        </TableBox>
      ) : null}
      <Muted>{t('settings.webhookSections.incomingWebhooksBelong')}</Muted>
    </section>
  )
}
