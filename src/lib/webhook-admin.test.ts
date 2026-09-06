/** ADMIN-02 — webhook admin wire mappers, error mapping, query keys. */
import { describe, expect, it } from 'vitest'

import {
  describeWebhookAdminError,
  toDeliveryWire,
  toHealthWire,
  toSubscriptionWire,
  webhookAdminKeys,
} from './webhook-admin'

describe('toSubscriptionWire', () => {
  it('maps the registry row without secrets', () => {
    const wire = toSubscriptionWire({
      id: 'sub-1',
      key: 'orders',
      url: 'https://example.com/hook',
      description: null,
      event_types: ['record.created'],
      status: 'active',
      max_retries: 5,
      failure_threshold: 10,
      consecutive_failures: '2',
      rate_limit_per_minute: null,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-02T10:00:00Z',
    })
    expect(wire).toMatchObject({
      id: 'sub-1',
      key: 'orders',
      eventTypes: ['record.created'],
      consecutiveFailures: 2,
      rateLimitPerMinute: null,
    })
    expect(wire).not.toHaveProperty('signing_secret')
    expect(wire).not.toHaveProperty('secret')
  })

  it('defaults missing event types to an empty allowlist', () => {
    const wire = toSubscriptionWire({
      id: 'sub-2',
      key: 'all',
      url: 'https://example.com/hook',
      description: 'everything',
      event_types: null,
      status: 'paused',
      max_retries: 0,
      failure_threshold: 0,
      consecutive_failures: 0,
      rate_limit_per_minute: 60,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
    })
    expect(wire.eventTypes).toEqual([])
    expect(wire.rateLimitPerMinute).toBe(60)
  })
})

describe('toHealthWire', () => {
  it('maps the EVENT-02 health row including the last error', () => {
    const wire = toHealthWire({
      subscription_id: 'sub-1',
      key: 'orders',
      url: 'https://example.com/hook',
      status: 'disabled',
      consecutive_failures: 10,
      failure_threshold: 10,
      max_retries: 5,
      rate_limit_per_minute: null,
      total_24h: '20',
      delivered_24h: '15',
      failed_24h: '3',
      dead_letter_24h: '2',
      retrying_24h: '1',
      pending_24h: '0',
      success_rate_24h: '0.75',
      last_delivered_at: '2026-09-05T10:00:00Z',
      oldest_pending_at: null,
      last_error: {
        code: 'connection_refused',
        message: 'connect ECONNREFUSED',
        at: '2026-09-05T11:00:00Z',
        delivery_id: 'del-9',
      },
    })
    expect(wire).toMatchObject({
      total24h: 20,
      delivered24h: 15,
      deadLetter24h: 2,
      successRate24h: 0.75,
      lastError: {
        code: 'connection_refused',
        message: 'connect ECONNREFUSED',
        deliveryId: 'del-9',
      },
    })
  })

  it('keeps an empty window and missing error as null, not zero', () => {
    const wire = toHealthWire({
      subscription_id: 'sub-2',
      key: 'quiet',
      url: 'https://example.com/quiet',
      status: 'active',
      consecutive_failures: 0,
      failure_threshold: 10,
      max_retries: 5,
      rate_limit_per_minute: 100,
      total_24h: '0',
      delivered_24h: '0',
      failed_24h: '0',
      dead_letter_24h: '0',
      retrying_24h: '0',
      pending_24h: '0',
      success_rate_24h: null,
      last_delivered_at: null,
      oldest_pending_at: null,
      last_error: null,
    })
    expect(wire.successRate24h).toBeNull()
    expect(wire.lastError).toBeNull()
  })
})

describe('toDeliveryWire', () => {
  it('maps the delivery row with its failure reason', () => {
    const wire = toDeliveryWire({
      id: 'del-1',
      subscription_id: 'sub-1',
      change_event_id: 'evt-1',
      event_type: 'record.created',
      attempt: 3,
      status: 'dead_letter',
      response_status: 500,
      response_body: 'upstream exploded',
      error_code: 'http_500',
      error_message: 'attempt 3 failed with 500',
      replay_of_delivery_id: null,
      next_attempt_at: null,
      delivered_at: null,
      created_at: '2026-09-05T10:00:00Z',
      updated_at: '2026-09-05T12:00:00Z',
    })
    expect(wire).toMatchObject({
      status: 'dead_letter',
      attempt: 3,
      responseStatus: 500,
      errorCode: 'http_500',
      errorMessage: 'attempt 3 failed with 500',
      replayOfDeliveryId: null,
    })
  })
})

describe('describeWebhookAdminError', () => {
  it('maps permission failures to the capability message', () => {
    expect(
      describeWebhookAdminError(
        new Error('permission_denied: integrations.manage required'),
      ),
    ).toMatch(/integrations\.manage/)
    expect(describeWebhookAdminError(new Error('42501: nope'))).toMatch(
      /integrations\.manage/,
    )
  })

  it('maps missing rows and bad input distinctly', () => {
    expect(describeWebhookAdminError(new Error('SB036: gone'))).toMatch(
      /not found/,
    )
    expect(describeWebhookAdminError(new Error('SB034: bad url'))).toMatch(
      /Invalid webhook request/,
    )
    expect(describeWebhookAdminError(new Error('SB033: wrong'))).toMatch(
      /different workspace/,
    )
  })

  it('never returns an empty message', () => {
    expect(describeWebhookAdminError(null)).not.toBe('')
    expect(describeWebhookAdminError(new Error('weird'))).toBe('weird')
  })
})

describe('webhookAdminKeys', () => {
  it('scopes every key by workspace', () => {
    expect(webhookAdminKeys.subscriptions('ws-1')).toContain('ws-1')
    expect(webhookAdminKeys.health('ws-1')).toContain('ws-1')
    expect(
      webhookAdminKeys.deliveries('ws-1', { status: 'dead_letter' }),
    ).toContain('ws-1')
    expect(webhookAdminKeys.health('ws-1', 'sub-1')).not.toEqual(
      webhookAdminKeys.health('ws-1'),
    )
  })
})
