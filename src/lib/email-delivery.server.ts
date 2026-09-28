/**
 * WORK-03.4 — the email delivery worker.
 *
 * Claims due rows from the durable outbox and hands each to the transport,
 * then records the outcome (sent or backoff/dead-letter). The transport is
 * injected so the queue logic is testable without SMTP; production wires an
 * SMTP transport from the environment when it is configured.
 */
export interface EmailDeliveryRow {
  id: string
  workspace_id: string
  user_id: string
  to_email: string
  event_type: string
  subject: string
  body: string
  attempt: number
}

export interface EmailQuery {
  query: <T = unknown>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export interface EmailTransport {
  send: (message: {
    to: string
    subject: string
    body: string
  }) => Promise<void>
}

export interface EmailWorkerResult {
  processed: number
  sent: number
  failed: number
}

export const EMAIL_MAX_ATTEMPTS = 5

/**
 * Process up to `limit` due deliveries. A send failure is recorded so the
 * outbox schedules the backoff (or dead-letters after the final attempt).
 */
export async function processEmailDeliveries(
  query: EmailQuery,
  transport: EmailTransport,
  limit = 20,
): Promise<EmailWorkerResult> {
  const claimed = await query.query<EmailDeliveryRow>(
    'SELECT * FROM internal.claim_due_email_deliveries($1)',
    [limit],
  )
  const result: EmailWorkerResult = { processed: 0, sent: 0, failed: 0 }
  for (const delivery of claimed.rows) {
    result.processed += 1
    try {
      await transport.send({
        to: delivery.to_email,
        subject: delivery.subject,
        body: delivery.body,
      })
      await query.query(
        'SELECT internal.finish_email_delivery($1, true, NULL)',
        [delivery.id],
      )
      result.sent += 1
    } catch (error) {
      await query.query(
        'SELECT internal.finish_email_delivery($1, false, $2)',
        [delivery.id, error instanceof Error ? error.message : 'send failed'],
      )
      result.failed += 1
    }
  }
  return result
}
