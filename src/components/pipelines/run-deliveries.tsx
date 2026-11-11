import { useMemo } from 'react'

import { t } from '#/copy'
import { eventLabel } from '#/lib/pipeline-schedule-form'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import type { PipelineRunStatus } from '#/lib/pipelines/types'
import type {
  PipelineRunDeliveryStatus,
  PipelineRunDeliveryWire,
} from './pipelines-data'

/**
 * PIPE-05.3 — the run's notification delivery status (canvas
 * `PipelineRun.dc.html`: "Notify · queued, sent 10:13", "Sent 1 message to
 * #aav9-process"). A run queues one delivery per configured destination after
 * it succeeds; this panel reads those real `api.webhook_deliveries` rows.
 *
 * The delivery engine records the destination webhook and the outcome. It does
 * not record a channel *type* (Teams, email) per row, so the panel names that
 * gap instead of inventing a channel.
 */

const DELIVERY_STATUS: Record<
  PipelineRunDeliveryStatus,
  { tone: Tone; label: string }
> = {
  pending: { tone: 'draft', label: t('data.runDeliveries.queued') },
  retrying: { tone: 'warn', label: t('data.runDeliveries.retrying') },
  delivered: { tone: 'ok', label: t('data.runDeliveries.delivered') },
  failed: { tone: 'bad', label: t('common.states.failed') },
  dead_letter: {
    tone: 'bad',
    label: t('data.runDeliveries.failedAfterRetries'),
  },
}

/** The destination the canvas shows: its description, else its key. */
function deliveryChannel(delivery: PipelineRunDeliveryWire): string {
  const description = delivery.destination?.description?.trim()

  if (description) return description
  const key = delivery.destination?.key.trim()

  if (key) return key

  return t('data.runDeliveries.destination2', {
    slice: delivery.subscription_id.slice(0, 8),
  })
}

/** Why a delivery did not arrive, using whatever the engine recorded. */
function deliveryFailureReason(delivery: PipelineRunDeliveryWire): string {
  const message = delivery.error_message?.trim()

  if (message) return message

  if (delivery.response_status != null)
    return t('data.runDeliveries.endpointReplied', {
      responseStatus: delivery.response_status,
    })

  if (delivery.error_code?.trim()) return delivery.error_code.trim()

  return t('data.runDeliveries.reasonRecorded')
}

/** What happened to the delivery, in the canvas's words. */
function deliveryOutcome(delivery: PipelineRunDeliveryWire): string {
  switch (delivery.status) {
    case 'delivered': {
      const sentAt = delivery.delivered_at ?? delivery.created_at

      return t('data.runDeliveries.sent', {
        value: formatNotebookDateTime(sentAt, { zone: true }),
      })
    }

    case 'pending':
      return t('data.runDeliveries.queuedDelivery2')
    case 'retrying':
      return t('data.runDeliveries.queuedRetryingAfterAttempt', {
        attempt: delivery.attempt,
      })
    default:
      return deliveryFailureReason(delivery)
  }
}

/** The honest state when a run has no delivery to show. */
function emptyDeliveryMessage(status: PipelineRunStatus): string {
  switch (status) {
    case 'running':
    case 'waiting':
      return t('data.runDeliveries.runHasQueuedNotifications')
    case 'succeeded':
      return t('data.runDeliveries.runQueuedNotificationsPublished')
    default:
      return t('data.runDeliveries.runQueuedNotificationsRun')
  }
}

export interface RunDeliveriesPanelProps {
  deliveries: PipelineRunDeliveryWire[]
  /** The run's own status, so the empty state tells the truth. */
  runStatus: PipelineRunStatus
  /** How many deliveries the run queued; the readable rows are `deliveries`. */
  queuedCount: number
  isLoading?: boolean
}

function DeliveriesGrid({
  deliveries,
}: {
  deliveries: PipelineRunDeliveryWire[]
}) {
  const columns = useMemo<RegistryColumn<PipelineRunDeliveryWire>[]>(
    () => [
      {
        id: 'destination',
        header: t('data.runDeliveries.destination'),
        accessorFn: (delivery) => deliveryChannel(delivery),
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">{deliveryChannel(row.original)}</span>
            <Muted>{eventLabel(row.original.event_type)}</Muted>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('data.runDeliveries.status'),
        accessorFn: (delivery) => DELIVERY_STATUS[delivery.status].label,
        cell: ({ row }) => {
          const state = DELIVERY_STATUS[row.original.status]

          return <Status tone={state.tone}>{state.label}</Status>
        },
      },
      {
        id: 'outcome',
        header: t('data.runDeliveries.outcome'),
        accessorFn: (delivery) => deliveryOutcome(delivery),
        cell: ({ row }) => deliveryOutcome(row.original),
      },
    ],
    [],
  )

  return (
    <RegistryGrid
      label={t('data.runDeliveries.ariaRunNotificationDeliveries')}
      rows={deliveries}
      columns={columns}
      getRowId={(delivery) => delivery.id}
      selectable={false}
      rowHeight={48}
    />
  )
}

export function RunDeliveriesPanel({
  deliveries,
  runStatus,
  queuedCount,
  isLoading = false,
}: RunDeliveriesPanelProps) {
  const missing = Math.max(0, queuedCount - deliveries.length)

  return (
    <section>
      <h2 className="mb-1.5 font-sans text-label font-semibold">
        {t('data.runDeliveries.notifications')}
      </h2>
      {isLoading ? (
        <Muted>{t('data.runDeliveries.loadingDeliveries')}</Muted>
      ) : deliveries.length === 0 ? (
        <Notice icon="info">
          {queuedCount === 0
            ? emptyDeliveryMessage(runStatus)
            : t('data.runDeliveries.notificationWereQueuedRun', {
                count: queuedCount,
              })}
        </Notice>
      ) : (
        <>
          <TableBox>
            <DeliveriesGrid deliveries={deliveries} />
          </TableBox>
          {missing > 0 ? (
            <Muted className="mt-1.5">
              {t('data.runDeliveries.queuedDeliveryUnread', { count: missing })}
            </Muted>
          ) : null}
          <Muted className="mt-1.5">
            {t('data.runDeliveries.deliveriesRecordDestinationWebhook')}
          </Muted>
        </>
      )}
    </section>
  )
}
