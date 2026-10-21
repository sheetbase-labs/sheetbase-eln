import { formatNotebookDateTime } from '#/lib/notebook-data'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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
  pending: { tone: 'draft', label: 'Queued' },
  retrying: { tone: 'warn', label: 'Retrying' },
  delivered: { tone: 'ok', label: 'Delivered' },
  failed: { tone: 'bad', label: 'Failed' },
  dead_letter: { tone: 'bad', label: 'Failed after retries' },
}

/** The destination the canvas shows: its description, else its key. */
export function deliveryChannel(delivery: PipelineRunDeliveryWire): string {
  const description = delivery.destination?.description?.trim()
  if (description) return description
  const key = delivery.destination?.key.trim()
  if (key) return key
  return `Destination ${delivery.subscription_id.slice(0, 8)}`
}

/** Why a delivery did not arrive, using whatever the engine recorded. */
export function deliveryFailureReason(
  delivery: PipelineRunDeliveryWire,
): string {
  const message = delivery.error_message?.trim()
  if (message) return message
  if (delivery.response_status != null)
    return `The endpoint replied ${delivery.response_status}.`
  if (delivery.error_code?.trim()) return delivery.error_code.trim()
  return 'No reason was recorded.'
}

/** What happened to the delivery, in the canvas's words. */
export function deliveryOutcome(delivery: PipelineRunDeliveryWire): string {
  switch (delivery.status) {
    case 'delivered': {
      const sentAt = delivery.delivered_at ?? delivery.created_at
      return `Sent ${formatNotebookDateTime(sentAt, { zone: true })}`
    }
    case 'pending':
      return 'Queued for delivery.'
    case 'retrying':
      return `Queued; retrying after attempt ${delivery.attempt}.`
    default:
      return deliveryFailureReason(delivery)
  }
}

/** The honest state when a run has no delivery to show. */
export function emptyDeliveryMessage(status: PipelineRunStatus): string {
  switch (status) {
    case 'running':
    case 'waiting':
      return 'This run has not queued notifications yet; a run notifies once it finishes.'
    case 'succeeded':
      return 'This run queued no notifications — the published version configured no destinations.'
    default:
      return 'This run queued no notifications; a run that does not succeed does not notify.'
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
        Notifications
      </h2>
      {isLoading ? (
        <Muted>Loading deliveries…</Muted>
      ) : deliveries.length === 0 ? (
        <Notice icon="info">
          {queuedCount === 0
            ? emptyDeliveryMessage(runStatus)
            : `${queuedCount} notification${queuedCount === 1 ? '' : 's'} were queued for this run, but no delivery record is readable.`}
        </Notice>
      ) : (
        <>
          <TableBox>
            <Table aria-label="Run notification deliveries">
              <TableHeader>
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => {
                  const state = DELIVERY_STATUS[delivery.status]
                  return (
                    <TableRow key={delivery.id}>
                      <TableCell>
                        {deliveryChannel(delivery)}
                        <Muted>{delivery.event_type}</Muted>
                      </TableCell>
                      <TableCell>
                        <Status tone={state.tone}>{state.label}</Status>
                      </TableCell>
                      <TableCell>{deliveryOutcome(delivery)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
          {missing > 0 ? (
            <Muted className="mt-1.5">
              {missing} queued delivery{missing === 1 ? '' : 's'} could not be
              read.
            </Muted>
          ) : null}
          <Muted className="mt-1.5">
            Deliveries record the destination webhook and its outcome. The
            channel type (Teams, email) is not recorded on the run yet.
          </Muted>
        </>
      )}
    </section>
  )
}
