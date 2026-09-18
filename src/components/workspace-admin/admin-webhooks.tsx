import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Select,
} from '#/components/ui'
import { hasCapability } from '#/lib/capability'
import {
  archiveWebhookSubscriptionFn,
  describeWebhookAdminError,
  fetchWebhookHealthFn,
  listWebhookDeliveriesFn,
  listWebhookSubscriptionsFn,
  replayWebhookDeliveriesFn,
  replayWebhookDeliveryFn,
  rotateWebhookSecretFn,
  setWebhookSubscriptionStatusFn,
  webhookAdminKeys,
} from '#/lib/webhook-admin'
import type {
  RotatedWebhookSecretWire,
  WebhookDeliveryStatus,
  WebhookEndpointHealthWire,
  WebhookSubscriptionWire,
} from '#/lib/webhook-admin'
import { formatRelativeTime } from '#/lib/workspace-admin'

const DELIVERY_STATUSES: WebhookDeliveryStatus[] = [
  'pending',
  'delivered',
  'failed',
  'retrying',
  'dead_letter',
]

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'delivered',
  'failed',
  'dead_letter',
])

const subscriptionStatusClass: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-amber-100 text-amber-800',
  disabled: 'bg-red-100 text-red-800',
  archived: 'bg-zinc-100 text-zinc-700',
}

const deliveryStatusClass: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  delivered: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  retrying: 'bg-amber-100 text-amber-800',
  dead_letter: 'bg-red-100 text-red-800',
}

function subscriptionState(subscription: WebhookSubscriptionWire): {
  label: string
  autoDisabled: boolean
} {
  const autoDisabled =
    subscription.status === 'disabled' &&
    subscription.failureThreshold > 0 &&
    subscription.consecutiveFailures >= subscription.failureThreshold
  return {
    label: autoDisabled ? 'Auto-disabled' : subscription.status,
    autoDisabled,
  }
}

function successCell(health: WebhookEndpointHealthWire | undefined): string {
  if (!health) return '—'
  if (health.successRate24h == null) return 'No traffic 24h'
  const pct = (health.successRate24h * 100).toFixed(1)
  return `${pct}% (${health.delivered24h}/${health.total24h})`
}

function lastErrorCell(health: WebhookEndpointHealthWire | undefined): string {
  if (!health?.lastError) return '—'
  const code = health.lastError.code ?? 'error'
  const message = health.lastError.message
    ? ` — ${health.lastError.message.slice(0, 80)}`
    : ''
  const at = health.lastError.at
    ? ` (${formatRelativeTime(health.lastError.at)})`
    : ''
  return `${code}${message}${at}`
}

export function AdminWebhooks({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const queryClient = useQueryClient()
  const canManage = hasCapability(role, 'integrations.manage')
  const [subscriptionFilter, setSubscriptionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [rotated, setRotated] = useState<RotatedWebhookSecretWire | null>(null)
  const [replayWindow, setReplayWindow] = useState({
    since: '',
    until: '',
    status: 'dead_letter' as 'dead_letter' | 'failed' | 'delivered',
    limit: '50',
  })
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const subscriptionsQuery = useQuery({
    queryKey: webhookAdminKeys.subscriptions(workspaceId),
    queryFn: () => listWebhookSubscriptionsFn({ data: { workspaceId } }),
    enabled: canManage,
  })
  const healthQuery = useQuery({
    queryKey: webhookAdminKeys.health(workspaceId),
    queryFn: () => fetchWebhookHealthFn({ data: { workspaceId } }),
    enabled: canManage,
  })
  const deliveryFilters = {
    subscription: subscriptionFilter,
    status: statusFilter,
    eventType: eventTypeFilter.trim() ? eventTypeFilter.trim() : undefined,
  }
  const deliveriesQuery = useQuery({
    queryKey: webhookAdminKeys.deliveries(workspaceId, deliveryFilters),
    queryFn: () =>
      listWebhookDeliveriesFn({
        data: {
          workspaceId,
          subscriptionId:
            subscriptionFilter === 'all' ? null : subscriptionFilter,
          status:
            statusFilter === 'all'
              ? null
              : (statusFilter as WebhookDeliveryStatus),
          eventType: eventTypeFilter.trim() ? eventTypeFilter.trim() : null,
          limit: 50,
          offset: 0,
        },
      }),
    enabled: canManage,
  })

  const subscriptions = subscriptionsQuery.data ?? []
  const healthById = new Map(
    (healthQuery.data?.data ?? []).map((item) => [item.subscriptionId, item]),
  )
  const deliveries = deliveriesQuery.data?.data ?? []

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin-001'] })
  }
  function onMutationError(cause: unknown) {
    return describeWebhookAdminError(cause)
  }
  const statusMutation = useMutation({
    mutationFn: ({
      subscriptionId,
      status,
    }: {
      subscriptionId: string
      status: 'active' | 'paused' | 'disabled'
    }) =>
      setWebhookSubscriptionStatusFn({
        data: { workspaceId, subscriptionId, status },
      }),
    onSuccess: () => {
      invalidate()
    },
  })
  const archiveMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      archiveWebhookSubscriptionFn({ data: { workspaceId, subscriptionId } }),
    onSuccess: () => {
      invalidate()
    },
  })
  const rotateMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      rotateWebhookSecretFn({ data: { workspaceId, subscriptionId } }),
    onSuccess: (result) => {
      setRotated(result)
      invalidate()
    },
  })
  const replayMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      replayWebhookDeliveryFn({ data: { workspaceId, deliveryId } }),
    onSuccess: () => {
      invalidate()
    },
  })
  const bulkReplayMutation = useMutation({
    mutationFn: () =>
      replayWebhookDeliveriesFn({
        data: {
          workspaceId,
          subscriptionId:
            subscriptionFilter === 'all' ? null : subscriptionFilter,
          since: replayWindow.since.trim()
            ? new Date(replayWindow.since).toISOString()
            : null,
          until: replayWindow.until.trim()
            ? new Date(replayWindow.until).toISOString()
            : null,
          status: replayWindow.status,
          limit: Number(replayWindow.limit) || 50,
        },
      }),
    onSuccess: (result) => {
      setBulkResult(
        `Replayed ${result.replayedCount} ${replayWindow.status} ${result.replayedCount === 1 ? 'delivery' : 'deliveries'}.`,
      )
      invalidate()
    },
  })

  const error =
    subscriptionsQuery.error ??
    healthQuery.error ??
    deliveriesQuery.error ??
    statusMutation.error ??
    archiveMutation.error ??
    rotateMutation.error ??
    replayMutation.error ??
    bulkReplayMutation.error

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Webhook operations require the integrations.manage capability.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          [
            'Active subscriptions',
            subscriptions.filter((s) => s.status === 'active').length,
          ],
          [
            'Disabled / paused',
            subscriptions.filter(
              (s) => s.status === 'disabled' || s.status === 'paused',
            ).length,
          ],
          [
            'Dead letter 24h',
            (healthQuery.data?.data ?? []).reduce(
              (sum, h) => sum + h.deadLetter24h,
              0,
            ),
          ],
          [
            'Retry debt',
            (healthQuery.data?.data ?? []).reduce(
              (sum, h) => sum + h.retrying24h + h.pending24h,
              0,
            ),
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-background p-3">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {onMutationError(error)}
        </p>
      ) : null}
      {rotated ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium">
            New signing secret — shown exactly once.
          </p>
          <code className="block break-all rounded bg-background p-2">
            {rotated.signingSecret}
          </code>
          <Button size="sm" variant="outline" onClick={() => setRotated(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subscription</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Success 24h</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Failures</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((subscription) => {
              const health = healthById.get(subscription.id)
              const state = subscriptionState(subscription)
              return (
                <TableRow key={subscription.id}>
                  <TableCell className="font-medium">
                    {subscription.key}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {subscription.url}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {subscription.eventTypes.length
                      ? subscription.eventTypes.join(', ')
                      : 'All events'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        subscriptionStatusClass[subscription.status] ?? ''
                      }
                    >
                      {state.label}
                    </Badge>
                  </TableCell>
                  <TableCell>{successCell(health)}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {lastErrorCell(health)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {subscription.consecutiveFailures}/
                    {subscription.failureThreshold === 0
                      ? '∞'
                      : subscription.failureThreshold}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {subscription.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={statusMutation.isPending}
                          onClick={() =>
                            statusMutation.mutate({
                              subscriptionId: subscription.id,
                              status: 'disabled',
                            })
                          }
                        >
                          Disable
                        </Button>
                      ) : subscription.status === 'archived' ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={statusMutation.isPending}
                          onClick={() =>
                            statusMutation.mutate({
                              subscriptionId: subscription.id,
                              status: 'active',
                            })
                          }
                        >
                          Enable
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          rotateMutation.isPending ||
                          subscription.status === 'archived'
                        }
                        onClick={() => rotateMutation.mutate(subscription.id)}
                      >
                        Rotate secret
                      </Button>
                      {subscription.status === 'archived' ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={archiveMutation.isPending}
                          onClick={() =>
                            archiveMutation.mutate(subscription.id)
                          }
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!subscriptions.length ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  No webhook subscriptions. Create them through the webhooks
                  API.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 rounded-lg border bg-background p-4">
        <h3 className="text-sm font-semibold">Delivery history</h3>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Subscription
            <Select
              aria-label="Subscription filter"
              className="h-8 w-auto"
              value={subscriptionFilter}
              onChange={(event) => setSubscriptionFilter(event.target.value)}
            >
              <option value="all">All</option>
              {subscriptions.map((subscription) => (
                <option key={subscription.id} value={subscription.id}>
                  {subscription.key}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Status
            <Select
              aria-label="Delivery status filter"
              className="h-8 w-auto"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All</option>
              {DELIVERY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === 'dead_letter' ? 'Dead letter' : status}
                </option>
              ))}
            </Select>
          </label>
          <Input
            aria-label="Event type filter"
            className="h-8 max-w-56"
            placeholder="Event type, e.g. record.created"
            value={eventTypeFilter}
            onChange={(event) => setEventTypeFilter(event.target.value)}
          />
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="text-xs">
                    {formatRelativeTime(delivery.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {delivery.eventType}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={deliveryStatusClass[delivery.status] ?? ''}
                    >
                      {delivery.status === 'dead_letter'
                        ? 'Dead letter'
                        : delivery.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {delivery.attempt}
                    {delivery.responseStatus != null
                      ? ` · ${delivery.responseStatus}`
                      : ''}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {[delivery.errorCode, delivery.errorMessage]
                      .filter(Boolean)
                      .join(' — ') || '—'}
                  </TableCell>
                  <TableCell>
                    {TERMINAL_STATUSES.has(delivery.status) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={replayMutation.isPending}
                        onClick={() => replayMutation.mutate(delivery.id)}
                      >
                        Replay
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {!deliveries.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No deliveries match these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {deliveriesQuery.data ? (
          <p className="text-xs text-muted-foreground">
            Showing {deliveries.length} of {deliveriesQuery.data.total}{' '}
            deliveries.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border bg-background p-4">
        <h3 className="text-sm font-semibold">Replay by window</h3>
        <p className="text-xs text-muted-foreground">
          Operator-invoked bulk replay for the selected subscription scope and
          time window. Replays reuse the original idempotency key and skip
          originals that already have a replay queued, so re-running a window is
          safe. Each run is audited.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Status
            <Select
              aria-label="Bulk replay status"
              className="h-8 w-auto"
              value={replayWindow.status}
              onChange={(event) =>
                setReplayWindow((current) => ({
                  ...current,
                  status: event.target.value as
                    'dead_letter' | 'failed' | 'delivered',
                }))
              }
            >
              <option value="dead_letter">Dead letter</option>
              <option value="failed">Failed</option>
              <option value="delivered">Delivered</option>
            </Select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Since
            <Input
              aria-label="Bulk replay since"
              type="datetime-local"
              className="h-8"
              value={replayWindow.since}
              onChange={(event) =>
                setReplayWindow((current) => ({
                  ...current,
                  since: event.target.value,
                }))
              }
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Until
            <Input
              aria-label="Bulk replay until"
              type="datetime-local"
              className="h-8"
              value={replayWindow.until}
              onChange={(event) =>
                setReplayWindow((current) => ({
                  ...current,
                  until: event.target.value,
                }))
              }
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Limit
            <Input
              aria-label="Bulk replay limit"
              type="number"
              min={1}
              max={500}
              className="h-8 w-24"
              value={replayWindow.limit}
              onChange={(event) =>
                setReplayWindow((current) => ({
                  ...current,
                  limit: event.target.value,
                }))
              }
            />
          </label>
          <Button
            size="sm"
            disabled={bulkReplayMutation.isPending}
            onClick={() => {
              setBulkResult(null)
              bulkReplayMutation.mutate()
            }}
          >
            Replay window
          </Button>
        </div>
        {bulkResult ? (
          <p role="status" className="text-xs text-muted-foreground">
            {bulkResult}
          </p>
        ) : null}
      </div>
    </div>
  )
}
