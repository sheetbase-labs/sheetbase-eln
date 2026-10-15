import { describe, expect, it } from 'vitest'

import {
  auditEventMatchesCategory,
  auditEventsPageSchema,
  auditHistoryCategories,
  auditLinkFor,
  auditKnockOnEvents,
  describeAuditEvent,
  fetchAllAuditEvents,
  fetchRecordAuditHistory,
  groupAuditEvents,
  groupAuditEventsByDay,
  auditEventsCsv,
  timelineToAuditEvents,
} from './audit-history'
import type { AuditEventWire } from './audit-history'
import { createDataClient } from './data-client'

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
  it('renders captured rich text with the canonical plaintext reader and preserves full reference values', () => {
    const prose = (text: string) => ({
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    })
    const reference = '12000000-0000-4000-8000-000000000091'
    const captured = event({
      entityType: 'block',
      payload: {
        type: 'rich_text',
        changes: {
          payload: { from: prose('Flux 120 LMH'), to: prose('Flux 100 LMH') },
          reference: { from: null, to: reference },
        },
      },
    })
    expect(describeAuditEvent(captured).changes).toEqual([
      {
        label: 'Text',
        kind: 'changed',
        from: 'Flux 120 LMH',
        to: 'Flux 100 LMH',
      },
      { label: 'reference', kind: 'added', from: undefined, to: reference },
    ])
    expect(auditEventsCsv([captured])).toContain(reference)
    expect(captured.payload.changes).toEqual({
      payload: { from: prose('Flux 120 LMH'), to: prose('Flux 100 LMH') },
      reference: { from: null, to: reference },
    })
  })

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
    expect(title).toMatchObject({
      kind: 'changed',
      from: 'Baseline Notebook',
      to: 'Renamed Notebook',
    })
    const status = described.changes.find((c) => c.label === 'Status')
    expect(status).toMatchObject({
      kind: 'changed',
      from: 'Draft',
      to: 'Complete',
    })
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
    expect(described.changes[0]).toMatchObject({
      label: 'Definition version',
      from: 'v1',
      to: 'v2',
    })
  })

  it('preserves captured scientific field changes without a metadata allowlist', () => {
    const described = describeAuditEvent(
      event({
        entityType: 'sheet_instance',
        payload: {
          changes: {
            'Load (L/m²)': { from: '125.000', to: '150.000' },
            'sample-ids': { from: ['sample-C', 'sample-A'], to: ['sample-D'] },
            'negative-control': { from: -2.5, to: 0 },
            'missing-unit': { from: null, to: 'NTU' },
            malformed: {},
            array: [{ from: 1, to: 2 }],
          },
        },
      }),
    )
    expect(described.changes).toEqual([
      { label: 'Load (L/m²)', kind: 'changed', from: '125.000', to: '150.000' },
      {
        label: 'sample-ids',
        kind: 'changed',
        from: '["sample-C","sample-A"]',
        to: '["sample-D"]',
      },
      { label: 'negative-control', kind: 'changed', from: '-2.5', to: '0' },
      { label: 'missing-unit', kind: 'added', from: undefined, to: 'NTU' },
    ])
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

  it('names a block by its kind, never by its opaque internal id', () => {
    // A block event carries no title, only its type; the internal uuid names
    // nothing to a reader, so the subject reads as the block kind instead.
    const described = describeAuditEvent(
      event({
        entityType: 'block',
        entityUuid: '3b0d350e-0000-4000-8000-000000000000',
        payload: {
          blockId: '3b0d350e-0000-4000-8000-000000000000',
          type: 'rich_text',
        },
      }),
    )
    expect(described.subject).toBe('Notebook block (Text)')
    expect(described.subject).not.toContain('3b0d350e')
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
      event({
        entityType: 'revision',
        payload: { reason: 'amend', revisionId: 'r-2' },
      }),
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

describe('experiment history presentation', () => {
  it('loads a descending immutable prefix across pages without losing older entries', async () => {
    const args: unknown[] = []
    const pages = [
      {
        formatVersion: 1,
        events: [event({ id: 'newer', sequence: 12 })],
        hasMore: true,
        nextCursor: 12,
      },
      {
        formatVersion: 1,
        events: [event({ id: 'older', sequence: 7 })],
        hasMore: false,
        nextCursor: 7,
      },
    ]
    const client = createDataClient(async (_request, init) => {
      args.push(JSON.parse(String(init?.body)))
      return Response.json(pages.shift())
    })
    const result = await fetchRecordAuditHistory(client, 'record-1')
    expect(result.snapshotBefore).toBe(13)
    expect(result.events.map((entry) => entry.id)).toEqual(['newer', 'older'])
    expect(args).toEqual([
      {
        p_entity_type: null,
        p_operation: null,
        p_actor_user_id: null,
        p_from: null,
        p_to: null,
        p_search: null,
        p_object: 'record-1',
        p_before_sequence: null,
        p_limit: 200,
      },
      {
        p_entity_type: null,
        p_operation: null,
        p_actor_user_id: null,
        p_from: null,
        p_to: null,
        p_search: null,
        p_object: 'record-1',
        p_before_sequence: 12,
        p_limit: 200,
      },
    ])
  })

  it('walks a whole selection to its end, sending the search term to the server', async () => {
    const args: unknown[] = []
    const pages = [
      {
        formatVersion: 1,
        events: [event({ id: 'newer', sequence: 12 })],
        hasMore: true,
        nextCursor: 12,
      },
      {
        formatVersion: 1,
        events: [event({ id: 'older', sequence: 7 })],
        hasMore: false,
        nextCursor: 7,
      },
    ]
    const client = createDataClient(async (_request, init) => {
      args.push(JSON.parse(String(init?.body)))
      return Response.json(pages.shift())
    })

    const events = await fetchAllAuditEvents(client, {
      search: 'quarantine',
      limit: 2,
    })

    expect(events.map((entry) => entry.sequence)).toEqual([12, 7])
    expect(args).toEqual([
      {
        p_entity_type: null,
        p_operation: null,
        p_actor_user_id: null,
        p_from: null,
        p_to: null,
        p_search: 'quarantine',
        p_object: null,
        p_before_sequence: null,
        p_limit: 2,
      },
      {
        p_entity_type: null,
        p_operation: null,
        p_actor_user_id: null,
        p_from: null,
        p_to: null,
        p_search: 'quarantine',
        p_object: null,
        p_before_sequence: 12,
        p_limit: 2,
      },
    ])
  })

  it('refuses a cursor that does not advance instead of repeating the page forever', async () => {
    const stalled = () => ({
      formatVersion: 1,
      events: [event({ id: 'same', sequence: 12 })],
      hasMore: true,
      nextCursor: 12,
    })
    const client = createDataClient(async () => Response.json(stalled()))

    await expect(fetchAllAuditEvents(client)).rejects.toThrow(
      'Invalid audit continuation cursor.',
    )
  })

  it('derives effects only through source-event identity, never session, revision or time proximity', () => {
    const source = event({
      id: 'source',
      payload: { sessionId: 'same-session', inputRevision: 4 },
    })
    const linked = event({ id: 'linked', payload: { sourceEventId: 'source' } })
    const multipleInputs = event({
      id: 'batch',
      payload: { sourceEventIds: ['other', 'source'] },
    })
    const unrelated = event({ id: 'unrelated', payload: source.payload })
    expect(
      auditKnockOnEvents(source, [source, unrelated, linked, multipleInputs]),
    ).toEqual([linked, multipleInputs])
  })

  it('filters by captured block type and change fields, not object names or neighboring events', () => {
    const events = [
      event({
        id: 'rich-text',
        entityType: 'block',
        payload: { type: 'rich_text' },
      }),
      event({ id: 'sheet', entityType: 'block', payload: { type: 'sheet' } }),
      event({
        id: 'mixed-metadata',
        payload: {
          changes: {
            title: { from: 'Text A', to: 'Text B' },
            status: { from: 'draft', to: 'in_progress' },
          },
        },
      }),
      event({ id: 'file', entityType: 'file' }),
      event({ id: 'comment', entityType: 'comment' }),
      event({ id: 'signature', entityType: 'signature' }),
      event({
        id: 'unknown',
        entityType: 'future_entity',
        payload: { name: 'Signed file' },
      }),
    ]
    expect(
      Object.fromEntries(
        auditHistoryCategories.map((category) => [
          category,
          events
            .filter((entry) => auditEventMatchesCategory(entry, category))
            .map((entry) => entry.id),
        ]),
      ),
    ).toEqual({
      all: [
        'rich-text',
        'sheet',
        'mixed-metadata',
        'file',
        'comment',
        'signature',
        'unknown',
      ],
      data: ['sheet'],
      text: ['rich-text', 'mixed-metadata'],
      status: ['mixed-metadata'],
      files: ['file'],
      comments: ['comment'],
      signatures: ['signature'],
    })
  })

  it('rejects malformed audit pages rather than treating unavailable history as empty', () => {
    const page = {
      formatVersion: 1,
      events: [event({})],
      hasMore: false,
      nextCursor: 1,
    }
    expect(auditEventsPageSchema.parse(page)).toEqual(page)
    expect(
      auditEventsPageSchema.safeParse({
        ...page,
        hasMore: true,
        nextCursor: null,
      }).success,
    ).toBe(false)
    expect(
      auditEventsPageSchema.safeParse({
        ...page,
        events: [event({ createdAt: 'not a date' })],
      }).success,
    ).toBe(false)
  })

  it('groups by workspace day across UTC midnight without reordering events', () => {
    const events = [
      event({ id: 'latest', createdAt: '2026-09-25T00:10:00Z' }),
      event({ id: 'previous-utc-day', createdAt: '2026-09-24T23:15:00Z' }),
      event({ id: 'earlier', createdAt: '2026-09-24T22:55:00Z' }),
    ]
    expect(groupAuditEventsByDay(events, 'Europe/London')).toEqual([
      {
        label: 'Friday 25 September 2026',
        events: [events[0], events[1]],
      },
      { label: 'Thursday 24 September 2026', events: [events[2]] },
    ])
    expect(
      groupAuditEventsByDay(events, 'UTC').map((day) => day.events),
    ).toEqual([[events[0]], [events[1], events[2]]])
  })

  it('exports only supplied events and preserves captured values, quoting and provenance', () => {
    const selected = event({
      sequence: 29,
      actorName: 'Ada, Scientist',
      payload: {
        changes: { 'Load (L/m²)': { from: '125.000', to: '150.000' } },
        reason: 'Run sheet says "150"\nnot 125',
      },
    })
    expect(auditEventsCsv([selected])).toBe(
      'time,sequence,actor,action,object,field,old_value,new_value,reason,client_id,payload\r\n' +
        '2026-08-26T10:00:00.000000Z,29,"Ada, Scientist",updated,Record 00000000,Load (L/m²),125.000,150.000,"Run sheet says ""150""\nnot 125",,"{""changes"":{""Load (L/m²)"":{""from"":""125.000"",""to"":""150.000""}},""reason"":""Run sheet says \\""150\\""\\nnot 125""}"\r\n',
    )
    expect(auditEventsCsv([])).toBe(
      'time,sequence,actor,action,object,field,old_value,new_value,reason,client_id,payload\r\n',
    )
  })
})

describe('auditLinkFor deep links', () => {
  it('links records by stable record ID without project placement', () => {
    const link = auditLinkFor(
      event({ entityType: 'record', entityUuid: 'record-1', projectId: null }),
    )
    expect(link).toEqual({ href: '/records/record-1', label: 'Open record' })
  })

  it('links review events to the frozen revision workspace', () => {
    const link = auditLinkFor(
      event({
        entityType: 'signature',
        payload: { revisionId: 'rev-9' },
      }),
    )
    expect(link).toEqual({ href: '/review/rev-9', label: 'Open review' })
  })

  it('links sheet instances to their canonical surface', () => {
    const link = auditLinkFor(
      event({ entityType: 'sheet_instance', entityUuid: 'sheet-1' }),
    )
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
    expect(auditLinkFor(mapped[1])?.href).toBe('/review/rev-1')
  })
})
