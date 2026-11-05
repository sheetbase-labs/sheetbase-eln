import { describe, expect, it } from 'vitest'

import type { SampleEvent, SampleRecord } from '#/lib/samples'
import {
  canDisposeSample,
  canQuarantineSample,
  canReleaseSample,
  canWithdrawSample,
  describeReleaseChecks,
  describeSampleState,
  isTerminalSampleStatus,
} from './sample-state'

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: 's-1',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC, lot P-117',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 3,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T11:20:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: {},
    customFields: {},
    lockedAt: null,
    lockedByRevisionId: null,
    sampleType: 'Plasmid',
    quantity: 12.5,
    quantityUnit: 'mg',
    storageLocation: 'F-3',
    barcode: null,
    lowStockThreshold: null,
    notes: null,
    holdCondition: null,
    holdStartedAt: null,
    holdDurationDays: null,
    holdUntil: null,
    allowedUseExperimentIds: null,
    quarantineReason: null,
    quarantinedAt: null,
    disposalReason: null,
    disposedAt: null,
    releasedAt: null,
    releaseChecks: null,
    ...overrides,
  }
}

function event(overrides: Partial<SampleEvent> = {}): SampleEvent {
  return {
    id: 'e-1',
    recordId: 's-1',
    operation: 'consume',
    quantityDelta: -12.5,
    quantityBefore: 12.5,
    quantityAfter: 0,
    quantityUnit: 'mg',
    fromLocation: null,
    toLocation: null,
    actorUserId: 'u-9',
    purposeRecordId: null,
    notes: 'AEX resin screen',
    createdAt: '2026-09-11T10:40:00.000Z',
    ...overrides,
  }
}

describe('describeSampleState', () => {
  it('returns null for a normal lifecycle state', () => {
    expect(describeSampleState(sample())).toBeNull()
  })

  it('states the quarantine date and reason from stored data', () => {
    const state = describeSampleState(
      sample({
        status: 'quarantined',
        quarantinedAt: '2026-09-16T11:20:00.000Z',
        quarantineReason: 'Endotoxin result pending from QC (EXP-0129)',
      }),
    )
    expect(state?.kind).toBe('quarantined')
    expect(state?.tone).toBe('warn')
    expect(state?.title).toBe('In quarantine since 16 Sep 2026.')
    expect(state?.body).toContain('Endotoxin result pending from QC')
    expect(state?.body).toContain('authorised releaser')
  })

  it('does not invent a quarantine reason', () => {
    const state = describeSampleState(sample({ status: 'quarantined' }))
    expect(state?.title).toBe('In quarantine.')
    expect(state?.body).toContain('No quarantine reason recorded.')
  })

  it('names the hold window for a past-hold sample', () => {
    const state = describeSampleState(
      sample({
        status: 'hold_exceeded',
        createdAt: '2026-09-17T14:10:00.000Z',
        holdCondition: '2–8 °C',
        holdDurationDays: 7,
      }),
    )
    expect(state?.kind).toBe('hold_exceeded')
    expect(state?.tone).toBe('bad')
    expect(state?.title).toBe(
      'Hold limit passed on 24 Sep 2026 (7 days at 2–8 °C).',
    )
    expect(state?.body).toBe('Remaining volume can’t be withdrawn.')
  })

  it('states the allowed-use exception from real data', () => {
    const state = describeSampleState(
      sample({
        status: 'hold_exceeded',
        holdUntil: '2026-09-24',
        allowedUseExperimentIds: ['exp-131'],
      }),
    )
    expect(state?.body).toBe(
      'Remaining volume can only be used by 1 explicitly allowed experiment.',
    )
  })

  it('reports an expired sample with its expiry date', () => {
    const state = describeSampleState(
      sample({ status: 'expired', holdUntil: '2026-09-10' }),
    )
    expect(state?.kind).toBe('expired')
    expect(state?.title).toBe('Expired on 10 Sep 2026.')
  })

  it('reports the consumed date and actor from the event stream', () => {
    const state = describeSampleState(sample({ status: 'consumed' }), {
      events: [event()],
      userName: (id) => (id === 'u-9' ? 'Gareth P.' : null),
    })
    expect(state?.kind).toBe('consumed')
    expect(state?.tone).toBe('info')
    expect(state?.title).toBe('Fully used on 11 Sep 2026 by Gareth P.')
    expect(state?.body).toContain('AEX resin screen')
    expect(state?.body).toContain('lineage and audit')
  })

  it('stays truthful when no consume event is available', () => {
    const state = describeSampleState(sample({ status: 'consumed' }))
    expect(state?.title).toBe('Fully used.')
  })

  it('reports disposal date and reason', () => {
    const state = describeSampleState(
      sample({
        status: 'disposed',
        disposedAt: '2026-09-26T09:00:00.000Z',
        disposalReason: 'Hold limit passed',
      }),
    )
    expect(state?.kind).toBe('disposed')
    expect(state?.title).toBe('Disposed on 26 Sep 2026.')
    expect(state?.body).toContain('Hold limit passed')
  })
})

describe('sample action capabilities', () => {
  it('mirrors the sample.release role gate', () => {
    for (const role of ['owner', 'admin', 'steward', 'scientist', 'reviewer'])
      expect(canReleaseSample(role)).toBe(true)
    for (const role of ['member', 'analyst', 'viewer', null, undefined])
      expect(canReleaseSample(role)).toBe(false)
  })

  it('mirrors the quarantine/dispose scientific role gate', () => {
    for (const role of ['owner', 'admin', 'steward', 'scientist'])
      expect(canQuarantineSample(role) && canDisposeSample(role)).toBe(true)
    for (const role of ['reviewer', 'member', 'analyst', 'viewer'])
      expect(canQuarantineSample(role) || canDisposeSample(role)).toBe(false)
  })

  it('blocks withdrawal in attention and terminal states', () => {
    for (const status of ['available', 'reserved', 'frozen'])
      expect(canWithdrawSample(status)).toBe(true)
    for (const status of [
      'quarantined',
      'hold_exceeded',
      'expired',
      'consumed',
      'disposed',
    ])
      expect(canWithdrawSample(status)).toBe(false)
  })

  it('treats consumed and disposed as terminal', () => {
    expect(isTerminalSampleStatus('consumed')).toBe(true)
    expect(isTerminalSampleStatus('disposed')).toBe(true)
    expect(isTerminalSampleStatus('available')).toBe(false)
  })
})

describe('describeReleaseChecks', () => {
  it('summarises all-pass and partial snapshots', () => {
    expect(describeReleaseChecks({ ruleCount: 3, failedCount: 0 })).toBe(
      'All 3 checks passed',
    )
    expect(describeReleaseChecks({ ruleCount: 3, failedCount: 1 })).toBe(
      '2 of 3 passed',
    )
  })

  it('returns null when no snapshot is stored', () => {
    expect(describeReleaseChecks(null)).toBeNull()
    expect(describeReleaseChecks({})).toBeNull()
  })
})
