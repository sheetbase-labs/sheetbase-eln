// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  buildEventPayload,
  mapEventType,
  matchesFilter,
  STABLE_EVENT_TYPES,
} from './webhook-events'
import type { ChangeEventInput } from './webhook-events'

const baseEvent: ChangeEventInput = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-0000000000aa',
  sequence: 42,
  entityType: 'record',
  entityUuid: '00000000-0000-4000-8000-000000000002',
  operation: 'create',
  recordId: null,
  projectId: null,
  actorUserId: 'user-1',
  actorCredentialId: null,
  clientId: null,
  payload: { name: 'Test Record' },
  createdAt: '2026-01-15T10:30:00.000Z',
}

describe('mapEventType', () => {
  it('maps record create to record.created', () => {
    expect(mapEventType('record', 'create')).toBe('record.created')
  })

  it('maps dataset version create to dataset.versioned', () => {
    expect(mapEventType('dataset_version', 'create')).toBe('dataset.versioned')
  })

  it('maps review_submission create to notebook.submitted', () => {
    expect(mapEventType('review_submission', 'create')).toBe(
      'notebook.submitted',
    )
  })

  it('maps sheet_instance update to sheet_instance.updated', () => {
    expect(mapEventType('sheet_instance', 'update')).toBe(
      'sheet_instance.updated',
    )
  })

  it('maps project archive to project.archived', () => {
    expect(mapEventType('project', 'archive')).toBe('project.archived')
  })

  it('returns null for unmapped entity types', () => {
    expect(mapEventType('storage_movement', 'create')).toBeNull()
    expect(mapEventType('folder', 'update')).toBeNull()
  })

  it('returns null for unmapped operations', () => {
    expect(mapEventType('record', 'quarantine')).toBeNull()
  })

  it('STABLE_EVENT_TYPES contains the expected key events', () => {
    expect(STABLE_EVENT_TYPES).toContain('record.created')
    expect(STABLE_EVENT_TYPES).toContain('dataset.updated')
    expect(STABLE_EVENT_TYPES).toContain('dataset.versioned')
    expect(STABLE_EVENT_TYPES).toContain('notebook.submitted')
    expect(STABLE_EVENT_TYPES).toContain('notebook.signed')
    expect(STABLE_EVENT_TYPES).toContain('sample.received')
    expect(STABLE_EVENT_TYPES).toContain('booking.cancelled')
    expect(STABLE_EVENT_TYPES).toContain('approval.requested')
    expect(STABLE_EVENT_TYPES).toContain('review.decided')
  })

  it('STABLE_EVENT_TYPES are unique', () => {
    expect(new Set(STABLE_EVENT_TYPES).size).toBe(STABLE_EVENT_TYPES.length)
  })
})

describe('mapEventType with a payload', () => {
  it('tells sample operations apart', () => {
    expect(
      mapEventType('sample_event', 'create', { operation: 'receive' }),
    ).toBe('sample.received')
    expect(
      mapEventType('sample_event', 'create', { operation: 'transfer' }),
    ).toBe('sample.moved')
    expect(
      mapEventType('sample_event', 'create', { operation: 'print' }),
    ).toBeNull()
    expect(mapEventType('sample_event', 'create')).toBeNull()
  })

  it('separates a cancelled booking from an edited one', () => {
    expect(mapEventType('calendar_booking', 'create', {})).toBe(
      'booking.created',
    )
    expect(
      mapEventType('calendar_booking', 'update', { status: 'confirmed' }),
    ).toBe('booking.updated')
    expect(
      mapEventType('calendar_booking', 'update', { status: 'cancelled' }),
    ).toBe('booking.cancelled')
    expect(mapEventType('calendar_booking', 'delete', {})).toBeNull()
  })

  it('follows an import through to commit or failure', () => {
    expect(
      mapEventType('dataset_import', 'create', { status: 'preview' }),
    ).toBe('import.created')
    expect(
      mapEventType('dataset_import', 'update', { status: 'committed' }),
    ).toBe('import.committed')
    expect(mapEventType('dataset_import', 'update', { status: 'failed' })).toBe(
      'import.failed',
    )
    expect(
      mapEventType('dataset_import', 'update', { status: 'preview' }),
    ).toBeNull()
  })

  it('maps each approval outcome', () => {
    expect(mapEventType('approval_request', 'create', {})).toBe(
      'approval.requested',
    )
    for (const state of ['approved', 'returned', 'withdrawn']) {
      expect(mapEventType('approval_request', 'update', { state })).toBe(
        `approval.${state}`,
      )
    }
  })
})

describe('record.signed', () => {
  it('is the canonical name for the notebook.signed wire event', () => {
    expect(matchesFilter('notebook.signed', ['record.signed'])).toBe(true)
    expect(matchesFilter('notebook.signed', ['notebook.signed'])).toBe(true)
    expect(matchesFilter('record.signed', ['notebook.signed'])).toBe(true)
    expect(mapEventType('signature', 'create')).toBe('notebook.signed')
  })
})

describe('matchesFilter', () => {
  it('matches when filter is empty (all events)', () => {
    expect(matchesFilter('record.created', [])).toBe(true)
  })

  it('matches when event type is in filter', () => {
    expect(
      matchesFilter('record.created', ['record.created', 'dataset.versioned']),
    ).toBe(true)
  })

  it('does not match when event type is not in filter', () => {
    expect(
      matchesFilter('record.deleted', ['record.created', 'dataset.versioned']),
    ).toBe(false)
  })
})

describe('buildEventPayload', () => {
  it('builds a stable payload with schema version 1', () => {
    const payload = buildEventPayload(baseEvent, 'record.created')
    expect(payload.schemaVersion).toBe('1')
    expect(payload.eventType).toBe('record.created')
    expect(payload.eventId).toBe(baseEvent.id)
    expect(payload.sequence).toBe(42)
    expect(payload.workspaceId).toBe(baseEvent.workspaceId)
    expect(payload.entityUuid).toBe(baseEvent.entityUuid)
    expect(payload.entityType).toBe('record')
    expect(payload.operation).toBe('create')
    expect(payload.payload).toEqual({ name: 'Test Record' })
    expect(payload.createdAt).toBe('2026-01-15T10:30:00.000Z')
  })

  it('preserves null fields', () => {
    const payload = buildEventPayload(baseEvent, 'record.created')
    expect(payload.recordId).toBeNull()
    expect(payload.projectId).toBeNull()
    expect(payload.actorCredentialId).toBeNull()
  })

  it('preserves non-null context fields', () => {
    const event: ChangeEventInput = {
      ...baseEvent,
      recordId: '00000000-0000-4000-8000-000000000003',
      projectId: '00000000-0000-4000-8000-000000000004',
      actorCredentialId: '00000000-0000-4000-8000-000000000005',
    }
    const payload = buildEventPayload(event, 'record.created')
    expect(payload.recordId).toBe('00000000-0000-4000-8000-000000000003')
    expect(payload.projectId).toBe('00000000-0000-4000-8000-000000000004')
    expect(payload.actorCredentialId).toBe(
      '00000000-0000-4000-8000-000000000005',
    )
  })
})
