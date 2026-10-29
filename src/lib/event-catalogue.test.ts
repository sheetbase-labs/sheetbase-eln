// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  canonicalNameFor,
  CATALOGUE_SCHEMA_VERSION,
  eventByName,
  eventForProducer,
  EVENT_CATALOGUE,
  INTENTIONALLY_EXCLUDED,
  resolveEventAlias,
  toCanonicalEnvelope,
} from './event-catalogue'
import {
  buildEventPayload,
  mapEventType,
  STABLE_EVENT_TYPES,
} from './webhook-events'
import type { ChangeEventInput } from './webhook-events'

/** A payload that satisfies the entry's `when` test, plus the default key. */
function producerPayload(
  when: { key: string; equals?: string; notEquals?: string } | undefined,
): Record<string, unknown> {
  if (!when) return { key: 'value' }
  return {
    key: 'value',
    [when.key]: when.equals ?? `not-${when.notEquals}`,
  }
}

function baseInput(
  entityType: string,
  operation: string,
  payload: Record<string, unknown> = { key: 'value' },
): ChangeEventInput {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-0000000000aa',
    sequence: 7,
    entityType,
    entityUuid: '00000000-0000-4000-8000-000000000002',
    operation,
    recordId: null,
    projectId: null,
    actorUserId: 'user-1',
    actorCredentialId: null,
    clientId: null,
    payload,
    createdAt: '2026-01-15T10:30:00.000Z',
  }
}

describe('catalogue integrity', () => {
  it('canonical names are unique', () => {
    const names = EVENT_CATALOGUE.map((entry) => entry.name).sort()
    expect(names).toEqual(names.filter((n, i) => names.indexOf(n) === i))
  })

  it('wire aliases never collide with a canonical name', () => {
    const canonical = EVENT_CATALOGUE.map((entry) => entry.name)
    const aliases = EVENT_CATALOGUE.map((entry) => entry.wireName).filter(
      (name): name is string => name !== null && !canonical.includes(name),
    )
    for (const alias of aliases) {
      expect(canonical.includes(alias)).toBe(false)
    }
    // The catalogue actually carries table-name-leak aliases today.
    expect(aliases).toContain('sheet_instance.updated')
  })
  it('covers every required family', () => {
    const families = EVENT_CATALOGUE.map((entry) => entry.family)
      .filter((f, i, all) => all.indexOf(f) === i)
      .sort()
    expect(families).toEqual([
      'administration',
      'approval',
      'booking',
      'dataset',
      'import',
      'instrument',
      'notebook',
      'pipeline',
      'record',
      'sample',
      'sheet',
      'storage',
    ])
  })
  it('stable IDs plus actor/provenance are structurally required by the envelope', () => {
    const envelope = toCanonicalEnvelope(
      baseInput('record', 'create'),
      'record.created',
    )
    expect(envelope.id).toBe(baseInput('record', 'create').id)
    expect(envelope.workspaceId).toBe(baseInput('record', 'create').workspaceId)
    expect(envelope.actor).toEqual({
      userId: 'user-1',
      credentialId: null,
      clientId: null,
    })
    expect(envelope.provenance.entityUuid).toBe(
      baseInput('record', 'create').entityUuid,
    )
    expect(envelope.provenance.sequence).toBe(7)
  })
})

describe('catalogue == webhook map drift pin', () => {
  it('every emitted stable type is a catalogue canonical name or documented alias', () => {
    for (const stable of STABLE_EVENT_TYPES) {
      expect(
        eventByName(stable),
        `webhook emits ${stable} with no catalogue entry`,
      ).toBeDefined()
    }
  })

  it('every surfaced catalogue entry is emitted under its documented wire name', () => {
    for (const entry of EVENT_CATALOGUE) {
      if (entry.wireName === null) continue
      expect(STABLE_EVENT_TYPES).toContain(entry.wireName)
    }
  })

  it('every stable entry maps its producer to its wire name', () => {
    for (const entry of EVENT_CATALOGUE) {
      if (entry.status !== 'stable' || entry.producer === null) continue
      expect(
        mapEventType(
          entry.producer.entityType,
          entry.producer.operation,
          producerPayload(entry.producer.when),
        ),
      ).toBe(entry.wireName)
    }
  })

  it('reserved entries have no producer and are never produced', () => {
    for (const entry of EVENT_CATALOGUE) {
      if (entry.status !== 'reserved') continue
      expect(entry.producer).toBeNull()
    }
    // notebook.amended stays mapped defensively but nothing produces it.
    expect(mapEventType('review_submission', 'amend')).toBe('notebook.amended')
  })

  it('provisional entries with producers are intentionally not webhook-surfaced', () => {
    for (const entry of EVENT_CATALOGUE) {
      if (entry.status !== 'provisional' || entry.producer === null) continue
      expect(entry.wireName).toBeNull()
      expect(
        mapEventType(entry.producer.entityType, entry.producer.operation),
      ).toBeNull()
    }
  })

  it('excluded producers are intentionally not webhook-surfaced', () => {
    for (const excluded of INTENTIONALLY_EXCLUDED) {
      if (excluded.operation === '*') continue
      expect(mapEventType(excluded.entityType, excluded.operation)).toBeNull()
    }
  })
})

describe('aliases', () => {
  it('resolves every wire alias to its canonical name', () => {
    expect(resolveEventAlias('sheet_instance.updated')).toBe('sheet.updated')
    expect(resolveEventAlias('sheet_definition.versioned')).toBe(
      'sheet.definition.versioned',
    )
    expect(resolveEventAlias('notebook_template.created')).toBe(
      'notebook.template.created',
    )
  })

  it('leaves canonical and unknown names unchanged', () => {
    expect(resolveEventAlias('sheet.updated')).toBe('sheet.updated')
    expect(resolveEventAlias('record.created')).toBe('record.created')
    expect(resolveEventAlias('future.unknown')).toBe('future.unknown')
  })

  it('canonicalNameFor returns the domain name, not the table-leak alias', () => {
    expect(canonicalNameFor('sheet_instance', 'update')).toBe('sheet.updated')
    expect(canonicalNameFor('dataset_version', 'create')).toBe(
      'dataset.versioned',
    )
    expect(canonicalNameFor('folder', 'create')).toBeNull()
  })

  it('eventForProducer finds entries by producer pair', () => {
    expect(eventForProducer('pipeline_run', 'create')?.name).toBe(
      'pipeline.run.created',
    )
    expect(eventForProducer('api_credential', 'revoke')?.name).toBe(
      'workspace.credential.revoked',
    )
    expect(eventForProducer('block', 'create')).toBeUndefined()
  })
})

describe('canonical envelope per family', () => {
  const familyCases: Array<{
    family: string
    event: string
    entityType: string
    operation: string
  }> = [
    {
      family: 'record',
      event: 'record.created',
      entityType: 'record',
      operation: 'create',
    },
    {
      family: 'dataset',
      event: 'dataset.versioned',
      entityType: 'dataset_version',
      operation: 'create',
    },
    {
      family: 'sheet',
      event: 'sheet.updated',
      entityType: 'sheet_instance',
      operation: 'update',
    },
    {
      family: 'notebook',
      event: 'review.decided',
      entityType: 'review_decision',
      operation: 'create',
    },
    {
      family: 'pipeline',
      event: 'pipeline.run.created',
      entityType: 'pipeline_run',
      operation: 'create',
    },
    {
      family: 'administration',
      event: 'workspace.credential.revoked',
      entityType: 'api_credential',
      operation: 'revoke',
    },
  ]

  for (const { family, event, entityType, operation } of familyCases) {
    it(`carries the full envelope for ${family} (${event})`, () => {
      const envelope = toCanonicalEnvelope(
        baseInput(entityType, operation),
        event,
      )
      expect(envelope.event).toBe(event)
      expect(envelope.schemaVersion).toBe(CATALOGUE_SCHEMA_VERSION)
      expect(envelope.id).toBe('00000000-0000-4000-8000-000000000001')
      expect(envelope.occurredAt).toBe('2026-01-15T10:30:00.000Z')
      expect(envelope.workspaceId).toBe('00000000-0000-4000-8000-0000000000aa')
      expect(envelope.actor.userId).toBe('user-1')
      expect(envelope.provenance).toMatchObject({
        entityType,
        operation,
        entityUuid: '00000000-0000-4000-8000-000000000002',
        sequence: 7,
      })
      expect(envelope.data).toEqual({ key: 'value' })
    })
  }
})

describe('buildEventPayload validates for every produced catalogue entry', () => {
  for (const entry of EVENT_CATALOGUE) {
    if (entry.producer === null) continue
    const wire = entry.wireName
    it(`${entry.name} builds a valid payload`, () => {
      const input = baseInput(
        entry.producer!.entityType,
        entry.producer!.operation,
        producerPayload(entry.producer!.when),
      )
      // Surfaced entries go through the real wire mapping; provisional ones
      // pin the envelope shape the wire will carry when EVENT-03 surfaces them.
      const eventType =
        wire !== null
          ? mapEventType(input.entityType, input.operation, input.payload)
          : entry.name
      expect(eventType).toBe(wire ?? entry.name)
      const payload = buildEventPayload(input, eventType!)
      expect(payload.schemaVersion).toBe('1')
      expect(payload.eventId).toBe(input.id)
      expect(payload.sequence).toBe(input.sequence)
      expect(payload.workspaceId).toBe(input.workspaceId)
      expect(payload.entityUuid).toBe(input.entityUuid)
      expect(payload.actorUserId).toBe('user-1')
      expect(payload.payload).toEqual(input.payload)
      expect(payload.createdAt).toBe(input.createdAt)
    })
  }
})
