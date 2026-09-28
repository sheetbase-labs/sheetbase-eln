import { describe, expect, it, vi } from 'vitest'

import { processEmailDeliveries, readSmtpConfig } from './email-delivery.server'
import type { EmailDeliveryRow, EmailQuery } from './email-delivery.server'

function row(id: string): EmailDeliveryRow {
  return {
    id,
    workspace_id: 'w1',
    user_id: 'u1',
    to_email: 'g@x.test',
    event_type: 'review_requested',
    subject: 'Review requested',
    body: 'body',
    attempt: 1,
  }
}

function fakeQuery(rows: EmailDeliveryRow[]) {
  const calls: string[] = []
  const query: EmailQuery = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql)
      return { rows: sql.includes('claim_due_email_deliveries') ? rows : [] }
    }) as EmailQuery['query'],
  }
  return { query, calls }
}

describe('processEmailDeliveries', () => {
  it('sends each claimed delivery and records success', async () => {
    const { query, calls } = fakeQuery([row('d1'), row('d2')])
    const send = vi.fn(async () => {})
    const result = await processEmailDeliveries(query, { send })
    expect(result).toEqual({ processed: 2, sent: 2, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      calls.filter((sql) => sql.includes('finish_email_delivery($1, true')),
    ).toHaveLength(2)
  })

  it('records a failure so the outbox schedules the backoff', async () => {
    const { query, calls } = fakeQuery([row('d1')])
    const send = vi.fn(async () => {
      throw new Error('SMTP down')
    })
    const result = await processEmailDeliveries(query, { send })
    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(
      calls.some((sql) => sql.includes('finish_email_delivery($1, false')),
    ).toBe(true)
  })
})

describe('readSmtpConfig', () => {
  it('is null without a host and full when configured', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(
      readSmtpConfig({
        SMTP_HOST: 'smtp.test',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    ).toEqual({
      host: 'smtp.test',
      port: 465,
      user: 'u',
      pass: 'p',
      from: 'Sheetbase <no-reply@sheetbase.local>',
    })
  })
})
