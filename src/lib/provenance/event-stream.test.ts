import { describe, expect, it } from 'vitest'

import {
  publicEventPage,
  sseFrame,
  streamEventName,
  toCloudEvent,
} from './event-stream'
import type { StreamRow } from './event-stream'

const row = (over: Partial<StreamRow> = {}): StreamRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  sequence: 7,
  entity_type: 'pipeline_reproduction',
  entity_uuid: '22222222-2222-4222-8222-222222222222',
  operation: 'create',
  record_id: null,
  project_id: null,
  actor_user_id: 'u1',
  actor_credential_id: null,
  client_id: null,
  payload: { action: 'reproduced', status: 'matches' },
  created_at: '2026-11-07T10:00:00Z',
  ...over,
})

describe('event stream', () => {
  it('names changes from the catalogue, honouring conditions', () => {
    expect(streamEventName('pipeline_reproduction', 'create', {})).toBe(
      'pipeline.run.reproduced',
    )
    expect(
      streamEventName('lineage_target', 'update', {
        action: 'lineage-delivery-failed',
      }),
    ).toBe('lineage.delivery_failed')
    expect(
      streamEventName('lineage_target', 'update', {
        action: 'lineage-target-saved',
      }),
    ).toBe('lineage.endpoint.updated')
    expect(streamEventName('nothing', 'create', {})).toBeNull()
  })

  it('builds a CloudEvents 1.0 envelope', () => {
    const event = toCloudEvent('ws-1', row())
    expect(event).toMatchObject({
      specversion: '1.0',
      type: 'io.sheetbase.pipeline.run.reproduced',
      source: '/workspaces/ws-1',
      subject: 'pipeline_reproduction/22222222-2222-4222-8222-222222222222',
      sequence: '7',
      time: '2026-11-07T10:00:00.000Z',
    })
    expect(JSON.stringify(event)).not.toContain('entry_hash')
  })

  it('skips changes that are not catalogued and filters by name', () => {
    const page = publicEventPage(
      'ws-1',
      {
        events: [row(), row({ sequence: 8, entity_type: 'nothing' })],
        nextCursor: 8,
        hasMore: false,
        earliest: 1,
        latest: 8,
        expired: false,
        retentionDays: 30,
      },
      new Set(['pipeline.run.reproduced']),
    )

    expect(page.events).toHaveLength(1)
    expect(page.nextCursor).toBe(8)

    const none = publicEventPage(
      'ws-1',
      {
        events: [row()],
        nextCursor: 7,
        hasMore: false,
        earliest: 1,
        latest: 7,
        expired: false,
        retentionDays: 30,
      },
      new Set(['sample.created']),
    )

    expect(none.events).toHaveLength(0)
  })

  it('writes a frame whose id is the cursor', () => {
    const frame = sseFrame(toCloudEvent('ws-1', row())!)
    expect(
      frame.startsWith('id: 7\nevent: pipeline.run.reproduced\ndata: {'),
    ).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('retains captured native payloads and omissions until frame serialization', () => {
    const payload = {
      action: 'reproduced',
      capturedNull: null,
      capturedFalse: false,
      capturedZero: 0,
      omitted: undefined,
      when: new Date('2026-11-07T01:02:03Z'),
      native: new Map([['key', 9]]),
    }

    const event = toCloudEvent('ws-1', row({ payload, sequence: '0007' }))

    expect(event?.data.data).toBe(payload)
    expect(event?.sequence).toBe('7')
    expect(Object.hasOwn(payload, 'omitted')).toBe(true)
    expect(Object.hasOwn(payload, 'absent')).toBe(false)

    if (!event) throw new Error('Expected a catalogued event')

    const frame = sseFrame(event)
    expect(frame).toContain('"capturedNull":null')
    expect(frame).toContain('"capturedFalse":false')
    expect(frame).toContain('"capturedZero":0')
    expect(frame).not.toContain('"omitted"')
    expect(frame).toContain('"when":"2026-11-07T01:02:03.000Z"')
    expect(frame).toContain('"native":{}')
  })
})
