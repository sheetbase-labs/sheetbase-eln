import { useMemo } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, PageHeader, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  destinationLabel,
  endpointName,
} from '#/components/v3/settings/webhook-sections'
import { canManageSettings } from '#/lib/settings-access'
import { formatDate } from '#/lib/format-date'
import { signInRedirect } from '#/lib/sign-in-redirect'
import {
  describeWebhookAdminError,
  fetchWebhookDeliveryRecordsFn,
  fetchWebhookHealthFn,
  listWebhookDeliveriesFn,
  listWebhookSubscriptionsFn,
  replayWebhookDeliveriesFn,
  setWebhookSubscriptionStatusFn,
  webhookAdminKeys,
} from '#/lib/webhook-admin'
import type {
  WebhookDeliveryWire,
  WebhookEndpointHealthWire,
} from '#/lib/webhook-admin'
import { t } from '#/copy'

/** Settings → Integrations → one outgoing webhook: whether it is delivering,
 * every delivery and what the receiving service answered, with Retry now and
 * Pause for the people who manage integrations. */
export const Route = createFileRoute(
  '/settings/integrations/webhooks/$subscriptionId',
)({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: WebhookDeliveriesRoute,
})

const PAGE_SIZE = 50

/** What the receiving service answered, in words. */
export function responseText(d: WebhookDeliveryWire): string {
  if (d.responseStatus != null) {
    const reason = RESPONSE_REASONS[d.responseStatus]
    return reason ? `${d.responseStatus} ${reason}` : String(d.responseStatus)
  }
  if (
    d.errorCode &&
    /timeout|timed/i.test(d.errorCode + (d.errorMessage ?? ''))
  ) {
    return t('settings.integrationsWebhooks.Subscriptionid.timedOut')
  }
  if (d.status === 'pending')
    return t('settings.integrationsWebhooks.Subscriptionid.waitingSend')
  return (
    d.errorMessage?.trim() ||
    t('settings.integrationsWebhooks.Subscriptionid.answer')
  )
}

const RESPONSE_REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: t('settings.integrationsWebhooks.Subscriptionid.content'),
  400: t('settings.integrationsWebhooks.Subscriptionid.badRequest'),
  401: 'Unauthorised',
  403: 'Forbidden',
  404: t('common.errors.notFound'),
  410: 'Gone',
  429: t('settings.integrationsWebhooks.Subscriptionid.tooManyRequests'),
  500: t('settings.integrationsWebhooks.Subscriptionid.serverError'),
  502: t('settings.integrationsWebhooks.Subscriptionid.badGateway'),
  503: t('settings.integrationsWebhooks.Subscriptionid.serviceUnavailable'),
  504: t('settings.integrationsWebhooks.Subscriptionid.gatewayTimeout'),
}

/** The "What to check" paragraph, from the latest failure. */
export function whatToCheck(
  health: WebhookEndpointHealthWire | undefined,
  latest: WebhookDeliveryWire | undefined,
): string {
  const status = latest?.responseStatus ?? null
  if (status != null && status >= 500) {
    return t(
      'settings.integrationsWebhooks.Subscriptionid.receivingServiceAnswers',
      { status },
    )
  }
  if (status != null && status >= 400) {
    return t(
      'settings.integrationsWebhooks.Subscriptionid.receivingServiceRefused',
      { status },
    )
  }
  if (health?.lastError) {
    return t(
      'settings.integrationsWebhooks.Subscriptionid.receivingServiceAnswer',
    )
  }
  return t(
    'settings.integrationsWebhooks.Subscriptionid.nothingCheckDeliveries',
  )
}

function deliveryTone(status: WebhookDeliveryWire['status']): Tone {
  switch (status) {
    case 'delivered':
      return 'ok'
    case 'failed':
    case 'dead_letter':
      return 'bad'
    case 'retrying':
      return 'warn'
    default:
      return 'stored'
  }
}

function WebhookDeliveriesRoute() {
  const { context } = Route.useRouteContext()
  const { subscriptionId } = Route.useParams()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'integrations')
  const queryClient = useQueryClient()

  const subscriptions = useQuery({
    queryKey: webhookAdminKeys.subscriptions(workspaceId),
    queryFn: () => listWebhookSubscriptionsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const sub = subscriptions.data?.find((s) => s.id === subscriptionId)

  const health = useQuery({
    queryKey: webhookAdminKeys.health(workspaceId, subscriptionId),
    queryFn: () =>
      fetchWebhookHealthFn({ data: { workspaceId, subscriptionId } }),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  })
  const h = health.data?.data[0]

  const deliveries = useQuery({
    queryKey: webhookAdminKeys.deliveries(workspaceId, {
      subscriptionId,
      limit: String(PAGE_SIZE),
    }),
    queryFn: () =>
      listWebhookDeliveriesFn({
        data: { workspaceId, subscriptionId, limit: PAGE_SIZE },
      }),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  })
  const rows = deliveries.data?.data ?? []
  const eventIds = useMemo(
    () => [...new Set(rows.map((r) => r.changeEventId))],
    [rows],
  )
  const records = useQuery({
    queryKey: ['admin-001', 'webhook-delivery-records', eventIds],
    queryFn: () =>
      fetchWebhookDeliveryRecordsFn({
        data: { workspaceId, changeEventIds: eventIds },
      }),
    enabled: eventIds.length > 0,
    staleTime: 60_000,
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-001'] })

  const pause = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      setWebhookSubscriptionStatusFn({
        data: { workspaceId, subscriptionId, status },
      }),
    onSuccess: refresh,
  })
  const retry = useMutation({
    mutationFn: async () => {
      let replayed = 0
      for (const status of ['dead_letter', 'failed'] as const) {
        const result = await replayWebhookDeliveriesFn({
          data: { workspaceId, subscriptionId, status },
        })
        replayed += result.replayedCount
      }
      if (sub?.status === 'disabled') {
        await setWebhookSubscriptionStatusFn({
          data: { workspaceId, subscriptionId, status: 'active' },
        })
      }
      return replayed
    },
    onSuccess: refresh,
  })

  const columns = useMemo<RegistryColumn<WebhookDeliveryWire>[]>(
    () => [
      {
        id: 'time',
        header: 'Time',
        cell: ({ row }) => formatDate(row.original.createdAt, { time: true }),
      },
      {
        id: 'event',
        header: 'Event',
        cell: ({ row }) => row.original.eventType,
      },
      {
        id: 'record',
        header: 'Record',
        cell: ({ row }) => records.data?.[row.original.changeEventId] ?? '—',
      },
      {
        id: 'response',
        header: 'Response',
        cell: ({ row }) => (
          <Status tone={deliveryTone(row.original.status)}>
            {responseText(row.original)}
          </Status>
        ),
      },
      {
        id: 'attempts',
        header: 'Attempts',
        meta: { cellClassName: 'num' },
        cell: ({ row }) => row.original.attempt,
      },
      {
        id: 'next',
        header: t('settings.integrationsWebhooks.Subscriptionid.nextTry'),
        cell: ({ row }) =>
          row.original.nextAttemptAt &&
          (row.original.status === 'retrying' ||
            row.original.status === 'pending')
            ? formatDate(row.original.nextAttemptAt, { time: true })
            : '—',
      },
    ],
    [records.data],
  )

  const failing =
    sub != null &&
    (sub.status === 'disabled' || (h?.consecutiveFailures ?? 0) > 0)
  const waiting = (h?.retrying24h ?? 0) + (h?.pending24h ?? 0)
  const latestFailure = rows.find(
    (r) =>
      r.status === 'failed' ||
      r.status === 'dead_letter' ||
      r.status === 'retrying',
  )
  const name = sub ? endpointName(sub) : 'Webhook'
  const error = pause.error ?? retry.error

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t(
              'settings.integrationsWebhooks.Subscriptionid.integrations',
            ),
            link: { to: '/settings/integrations' },
          },
        ]}
        title={t('settings.integrationsWebhooks.Subscriptionid.deliveries', {
          name,
        })}
        meta={
          sub ? (
            <>
              <span>{destinationLabel(sub)}</span>
              <span>
                {sub.eventTypes.length
                  ? sub.eventTypes.join(', ')
                  : t('settings.integrationsWebhooks.Subscriptionid.events')}
              </span>
            </>
          ) : null
        }
        actions={
          canManage && sub && sub.status !== 'archived' ? (
            <>
              {failing || waiting > 0 ? (
                <Button
                  variant="primary"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate()}
                >
                  {retry.isPending
                    ? t('common.states.retrying')
                    : t(
                        'settings.integrationsWebhooks.Subscriptionid.retryNow',
                      )}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={pause.isPending}
                onClick={() =>
                  pause.mutate(sub.status === 'active' ? 'paused' : 'active')
                }
              >
                {sub.status === 'active' ? 'Pause' : 'Resume'}
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-6">
        {failing ? (
          <div className="px-4 pt-3 md:px-6">
            <Notice tone="bad">
              {t('settings.integrationsWebhooks.Subscriptionid.failingNotice', {
                name,
                waiting:
                  waiting > 0
                    ? t(
                        'settings.integrationsWebhooks.Subscriptionid.waitingCount',
                        { count: waiting },
                      ) + ' '
                    : '',
              })}
            </Notice>
          </div>
        ) : sub?.status === 'paused' ? (
          <div className="px-4 pt-3 md:px-6">
            <Notice>
              {t(
                'settings.integrationsWebhooks.Subscriptionid.pausedEventsSent',
              )}
            </Notice>
          </div>
        ) : null}
        {error ? (
          <div className="px-4 md:px-6">
            <Notice tone="bad">{describeWebhookAdminError(error)}</Notice>
          </div>
        ) : null}
        {retry.isSuccess ? (
          <Muted className="px-4 md:px-6">
            {retry.data > 0
              ? `${retry.data} ${retry.data === 1 ? 'delivery' : 'deliveries'} queued to send again.`
              : t(
                  'settings.integrationsWebhooks.Subscriptionid.nothingWaitingSent',
                )}
          </Muted>
        ) : null}
        {rows.length ? (
          <RegistryGrid
            label={t(
              'settings.integrationsWebhooks.Subscriptionid.deliveries2',
            )}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={false}
          />
        ) : deliveries.isLoading ? (
          <Muted className="px-4 md:px-6">
            {t(
              'settings.integrationsWebhooks.Subscriptionid.loadingDeliveries',
            )}
          </Muted>
        ) : (
          <Muted className="px-4 md:px-6">
            {t('settings.integrationsWebhooks.Subscriptionid.deliveriesYet')}
          </Muted>
        )}
        {failing ? (
          <div className="px-4 md:px-6">
            <Section
              title={t(
                'settings.integrationsWebhooks.Subscriptionid.whatCheck',
              )}
            >
              <p className="m-0 text-body">{whatToCheck(h, latestFailure)}</p>
              <p className="m-0 text-label text-fg-muted">
                {t(
                  'settings.integrationsWebhooks.Subscriptionid.signingSheetbaseAffected',
                )}
              </p>
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  )
}
