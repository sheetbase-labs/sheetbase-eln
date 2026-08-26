import { describe, expect, it } from 'vitest'

import {
  auditLinkFor,
  describeAuditEvent,
  groupAuditEvents,
  timelineToAuditEvents,
} from './audit-history'
import type { AuditEventWire } from './audit-history'

function event(overrides: Partial<AuditEventWire>): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-26T10:00:00.000000Z',
    entityType: 'record',
    entityUuid: '00000000-0000-4000-8000-000000000001',
    operation: 'update',
    recordId: null,
    projectId: '10000000-0000-4000-8000-000000000009',
    actorUserId: 'actor-1',
    actorName: 'Ada Scientist',
    actorCredentialId: null,
    clientId: null,
    payload: {},
    ...overrides,
  }
}

describe('describeAuditEvent', () => {
  it('renders semantic before/after chips for captured changes', () => {
    const described = describeAuditEvent(
      event({
        entityType: 'record',
        payload: {
          title: 'Renamed Notebook',
          changedMetadata: true,
          changes: {
            title: { from: 'Baseline Notebook', to: 'Renamed Notebook' },
            status: { from: 'draft', to: 'complete' },
          },
        },
      }),
    )
    expect(described.action).toBe('updated')
    const title = described.changes.find((c) => c.label === 'Title')
    expect(title).toMatchObject({ kind: 'changed', from: 'Baseline Notebook', to: 'Renamed Notebook' })
    const status = described.changes.find((c) => c.label === 'Status')
    expect(status).toMatchObject({ kind: 'changed', from: 'Draft', to: 'Complete' })
  })

  it('renders version numbers as v-prefixed values', () => {
    const described = describeAuditEvent(
      event({
        entityType: 'sheet_instance',
        payload: {
          name: 'Dilution Grid',
          changes: { definitionVersion: { from: 1, to: 2 } },
        },
      }),
    )
    expect(described.action).toBe('upgraded definition')
    expect(described.changes[0]).toMatchObject({ label: 'Definition version', from: 'v1', to: 'v2' })
  })

  it('never fabricates before/after values the event did not capture', () => {
    const described = describeAuditEvent(
      event({
        entityType: 'record',
        payload: { title: 'Some Notebook', changedMetadata: true },
      }),
    )
    expect(described.changes).toHaveLength(0)
    expect(described.subject).toBe('Record Some Notebook')
  })

  it('describes review decisions through their decision value', () => {
    const described = describeAuditEvent(
      event({
        entityType: 'review_decision',
        payload: { decision: 'request_changes', revisionId: 'r-1' },
      }),
    )
    expect(described.action).toBe('requested changes on review')
  })

  it('describes amendment revisions distinctly', () => {
    const described = describeAuditEvent(
      event({ entityType: 'revision', payload: { reason: 'amend', revisionId: 'r-2' } }),
    )
    expect(described.action).toBe('opened amendment revision')
  })
})

describe('groupAuditEvents correlation', () => {
  it('groups credential rotation halves through explicit payload ids only', () => {
    const oldId = '20000000-0000-4000-8000-000000000001'
    const newId = '20000000-0000-4000-8000-000000000002'
    const revoke = event({
      id: oldId,
      sequence: 7,
      entityType: 'api_credential',
      entityUuid: oldId,
      operation: 'revoke',
      payload: { name: 'svc', rotatedToCredentialId: newId },
    })
    const create = event({
      id: newId,
      sequence: 8,
      entityType: 'api_credential',
      entityUuid: newId,
      operation: 'create',
      payload: { name: 'svc', rotatedFromCredentialId: oldId },
    })
    const unrelated = event({
      sequence: 9,
      entityType: 'record',
      operation: 'create',
    })

    const groups = groupAuditEvents([unrelated, revoke, create])
    expect(groups).toHaveLength(2)
    const rotation = groups.find((g) => g.related.length > 0)
    expect(rotation?.primary.id).toBe(oldId)
    expect(rotation?.related.map((e) => e.id)).toEqual([newId])
  })

  it('does not group events that merely share a timestamp', () => {
    const a = event({ id: 'a', entityType: 'record', operation: 'create' })
    const b = event({ id: 'b', entityType: 'dataset', operation: 'create' })
    const groups = groupAuditEvents([a, b])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.related.length === 0)).toBe(true)
  })
})

describe('auditLinkFor deep links', () => {
  it('links review events to the frozen revision workspace', () => {
    const link = auditLinkFor(
      event({
        entityType: 'signature',
        payload: { revisionId: 'rev-9' },
      }),
    )
    expect(link).toEqual({ href: '/reviews/rev-9', label: 'Open review' })
  })

  it('links sheet instances to their canonical surface', () => {
    const link = auditLinkFor(event({ entityType: 'sheet_instance', entityUuid: 'sheet-1' }))
    expect(link?.href).toBe('/sheets/sheet-1')
  })

  it('returns null when no canonical surface exists', () => {
    expect(auditLinkFor(event({ entityType: 'storage_box' }))).toBeNull()
  })
})

describe('timelineToAuditEvents adapter', () => {
  it('maps SIGN-002 timeline rows onto the shared shape', () => {
    const mapped = timelineToAuditEvents([
      {
        type: 'change_event',
        id: 'ce-1',
        seq: 12,
        ts: '2026-08-26T10:00:00Z',
        eventType: 'record',
        operation: 'lock',
        actorUserId: 'actor-1',
        title: 'record lock',
        payload: { revisionId: 'r-1', lockedAt: 't' },
      },
      {
        type: 'revision',
        id: 'rev-1',
        seq: null,
        ts: '2026-08-26T11:00:00Z',
        actorUserId: 'actor-2',
        title: 'revision amend',
        reason: 'amend',
        integrityDigest: 'ab'.repeat(32),
      },
    ])
    expect(mapped[0].entityType).toBe('record')
    expect(mapped[0].operation).toBe('lock')
    expect(mapped[0].payload.revisionId).toBe('r-1')
    expect(mapped[1].entityType).toBe('revision')
    expect(mapped[1].payload.reason).toBe('amend')
    expect(auditLinkFor(mapped[1])?.href).toBe('/reviews/rev-1')
  })
})
