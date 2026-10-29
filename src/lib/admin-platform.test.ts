/** ADMIN-03 — platform health attention builders and quota context. */
import { describe, expect, it } from 'vitest'

import {
  SCHEDULE_VALIDATED_SCALE,
  buildAttentionItems,
  findIncompatibleExtensionKeys,
  resolveQuotaContext,
  resolveSeatLimit,
  usageWarnLevel,
} from './admin-platform'
import type { AttentionCounts } from './admin-platform'

const zeroCounts: AttentionCounts = {
  failedPipelineRuns: 0,
  failedConnectorRuns: 0,
  deadLetterDeliveries: 0,
  webhookRetryDebt: 0,
  autoDisabledEndpoints: 0,
  failingEndpoints: 0,
  staleRunningRuns: 0,
  connectorsMissingSecrets: 0,
  overdueSchedules: 0,
  expiredCredentials: 0,
  expiringCredentials: 0,
  staleCredentials: 0,
  disabledConnectors: 0,
  disabledExtensions: 0,
}

describe('buildAttentionItems', () => {
  it('returns no items when every count is zero', () => {
    expect(buildAttentionItems(zeroCounts, [])).toEqual([])
  })

  it('links failed for good webhooks to endpoint health with the runbook', () => {
    const items = buildAttentionItems(
      { ...zeroCounts, deadLetterDeliveries: 2 },
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      level: 'warning',
      category: 'webhook_deliveries',
      link: '/admin/webhooks',
      runbook: 'observability',
    })
    expect(items[0]?.message).toMatch(/failed for good/)
  })

  it('warns on retry debt and auto-disabled endpoints separately', () => {
    const items = buildAttentionItems(
      { ...zeroCounts, webhookRetryDebt: 3, autoDisabledEndpoints: 1 },
      [],
    )
    const categories = items.map((item) => item.category)
    expect(categories).toEqual(['webhook_retry_debt', 'webhook_endpoints'])
    expect(items[1]).toMatchObject({
      link: '/admin/webhooks',
      runbook: 'observability',
    })
  })

  it('routes credential warnings to rotation with the security runbook', () => {
    const items = buildAttentionItems(
      { ...zeroCounts, expiredCredentials: 1, expiringCredentials: 2 },
      [],
    )
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item).toMatchObject({
        level: 'warning',
        category: 'api_credentials',
        link: '/admin/api-credentials',
        runbook: 'security',
      })
    }
    expect(items[0]?.message).toMatch(/expired/)
    expect(items[1]?.message).toMatch(/within 30 days/)
  })

  it('reports stale credentials as info, not warning', () => {
    const items = buildAttentionItems(
      { ...zeroCounts, staleCredentials: 1 },
      [],
    )
    expect(items[0]).toMatchObject({
      level: 'info',
      category: 'api_credentials',
      link: '/admin/api-credentials',
    })
  })

  it('names incompatible extensions and truncates long lists', () => {
    const keys = ['a', 'b', 'c', 'd']
    const items = buildAttentionItems(zeroCounts, keys)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      level: 'warning',
      category: 'extensions',
      link: '/admin/extensions',
      runbook: 'administration',
    })
    expect(items[0]?.message).toMatch(/\(a, b, c, …\)/)
    expect(items[0]?.message).not.toMatch(/, d/)
  })
  it('gives every item a corrective-action link', () => {
    const items = buildAttentionItems(
      {
        ...zeroCounts,
        failedPipelineRuns: 1,
        failedConnectorRuns: 1,
        deadLetterDeliveries: 1,
        webhookRetryDebt: 1,
        autoDisabledEndpoints: 1,
        failingEndpoints: 1,
        staleRunningRuns: 1,
        connectorsMissingSecrets: 1,
        overdueSchedules: 1,
        expiredCredentials: 1,
        expiringCredentials: 1,
        staleCredentials: 1,
        disabledConnectors: 1,
        disabledExtensions: 1,
      },
      ['ext-a'],
    )
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.link).toMatch(/^\/admin\//)
    }
  })
})

describe('findIncompatibleExtensionKeys', () => {
  it('reports installs whose declared range the app violates', () => {
    expect(
      findIncompatibleExtensionKeys(
        [{ key: 'ext-a', compatible_with: '>=1.0.0 <2.0.0' }],
        '2.0.0',
      ),
    ).toEqual(['ext-a'])
  })

  it('stays silent without a declared range', () => {
    expect(
      findIncompatibleExtensionKeys(
        [{ key: 'ext-a', compatible_with: null }],
        '9.9.9',
      ),
    ).toEqual([])
  })

  it('stays silent when the app version is unavailable', () => {
    expect(
      findIncompatibleExtensionKeys(
        [{ key: 'ext-a', compatible_with: '>=1.0.0 <2.0.0' }],
        'local',
      ),
    ).toEqual([])
  })
})

describe('workspace quota context', () => {
  it('reports no configured byte quota rather than a theatre number', () => {
    expect(resolveQuotaContext(undefined)).toEqual({
      byteLimit: null,
      atLimitBehaviour: null,
    })
  })

  it('keeps the schedule threshold as guidance, not a quota', () => {
    expect(SCHEDULE_VALIDATED_SCALE).toBe(100)
  })
})

describe('R5-CONFIG-01 configured plan limits', () => {
  it('builds a quota context from configuration and drops behaviour without a limit', () => {
    expect(resolveQuotaContext(10_000, 'uploads are rejected')).toEqual({
      byteLimit: 10_000,
      atLimitBehaviour: 'uploads are rejected',
    })
    expect(resolveQuotaContext(null, 'uploads are rejected')).toEqual({
      byteLimit: null,
      atLimitBehaviour: null,
    })
    expect(resolveSeatLimit(undefined, 'no new members')).toEqual({
      seatLimit: null,
      atLimitBehaviour: null,
    })
  })

  it('warns at 80% and 90% only when a limit is configured', () => {
    expect(usageWarnLevel(79, 100)).toBeNull()
    expect(usageWarnLevel(80, 100)).toBe('warning')
    expect(usageWarnLevel(89, 100)).toBe('warning')
    expect(usageWarnLevel(90, 100)).toBe('danger')
    expect(usageWarnLevel(150, 100)).toBe('danger')
    // Unmeasured / unlimited figures never get a threshold.
    expect(usageWarnLevel(5, null)).toBeNull()
    expect(usageWarnLevel(5, 0)).toBeNull()
  })
})
