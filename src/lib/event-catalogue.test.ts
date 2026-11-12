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
import type { ChangeEventInput, ChangeEventPayload } from './webhook-events'
import { DATASET_EVENT_FIXTURES } from '../features/datasets/events.fixture'
import { PIPELINE_SIMPLE_EVENT_FIXTURES } from '../features/pipeline-simple/events.fixture'

/** A payload that satisfies the entry's `when` test, plus the default key. */
function producerPayload(
  when: { key: string; equals?: string; notEquals?: string } | undefined,
): ChangeEventPayload {
  if (!when) return { key: 'value' }

  return {
    key: 'value',
    [when.key]: when.equals ?? `not-${when.notEquals}`,
  }
}

function baseInput(
  entityType: string,
  operation: string,
  payload: ChangeEventPayload = { key: 'value' },
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
      'compliance',
      'dataset',
      'import',
      'instrument',
      'inventory',
      'notebook',
      'order',
      'people',
      'pipeline',
      'record',
      'report',
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
    expect(canonicalNameFor('block', 'create')).toBeNull()
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

/** Lab features: the change event each one rides on and the name it gets. */
const LAB_EVENTS: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: ChangeEventPayload
}> = [
  {
    name: 'reagent.order.requested',
    entityType: 'material',
    operation: 'update',
    payload: { action: 'reorder-requested' },
  },
  {
    name: 'reagent.order.placed',
    entityType: 'material',
    operation: 'update',
    payload: { action: 'reorder-ordered' },
  },
  {
    name: 'reagent.order.received',
    entityType: 'material',
    operation: 'update',
    payload: { action: 'reorder-received' },
  },
  {
    name: 'reagent.order.cancelled',
    entityType: 'material',
    operation: 'update',
    payload: { action: 'reorder-cancelled' },
  },
  {
    name: 'stocktake.completed',
    entityType: 'stocktake',
    operation: 'update',
    payload: { status: 'completed' },
  },
  {
    name: 'shipment.sent',
    entityType: 'shipment',
    operation: 'update',
    payload: { event: 'sent' },
  },
  {
    name: 'shipment.in_transit',
    entityType: 'shipment',
    operation: 'update',
    payload: { event: 'in_transit' },
  },
  {
    name: 'shipment.received',
    entityType: 'shipment',
    operation: 'update',
    payload: { event: 'received' },
  },
  {
    name: 'shipment.cancelled',
    entityType: 'shipment',
    operation: 'update',
    payload: { event: 'cancelled' },
  },
  {
    name: 'request.submitted',
    entityType: 'request',
    operation: 'create',
    payload: {},
  },
  {
    name: 'request.decided',
    entityType: 'request',
    operation: 'update',
    payload: {},
  },
  {
    name: 'legal_hold.created',
    entityType: 'workspace_settings',
    operation: 'create',
    payload: { effect: 'legal_hold' },
  },
  {
    name: 'legal_hold.released',
    entityType: 'workspace_settings',
    operation: 'update',
    payload: { effect: 'legal_hold_released' },
  },
  {
    name: 'retention.applied',
    entityType: 'workspace_settings',
    operation: 'update',
    payload: { effect: 'retention_applied' },
  },
  {
    name: 'sample.edited',
    entityType: 'sample_event',
    operation: 'create',
    payload: { operation: 'edit' },
  },
  {
    name: 'sample.archived',
    entityType: 'sample_event',
    operation: 'create',
    payload: { operation: 'archive' },
  },
  {
    name: 'sample.restored',
    entityType: 'sample_event',
    operation: 'create',
    payload: { operation: 'restore' },
  },
  {
    name: 'sample.label_printed',
    entityType: 'sample_event',
    operation: 'create',
    payload: { operation: 'print' },
  },
  {
    name: 'storage.position.quarantined',
    entityType: 'storage_position',
    operation: 'update',
    payload: { status: 'quarantined' },
  },
  {
    name: 'storage.position.missing',
    entityType: 'storage_position',
    operation: 'update',
    payload: { status: 'missing' },
  },
  {
    name: 'sample.reserved',
    entityType: 'sample_reservation',
    operation: 'create',
    payload: { state: 'active' },
  },
  {
    name: 'sample.reservation_cancelled',
    entityType: 'sample_reservation',
    operation: 'update',
    payload: { state: 'cancelled' },
  },
  {
    name: 'storage.site.created',
    entityType: 'storage_site',
    operation: 'create',
    payload: {},
  },
  {
    name: 'storage.room.created',
    entityType: 'storage_room',
    operation: 'create',
    payload: {},
  },
  {
    name: 'storage.unit.created',
    entityType: 'storage_unit',
    operation: 'create',
    payload: {},
  },
  {
    name: 'storage.shelf.created',
    entityType: 'storage_shelf',
    operation: 'create',
    payload: {},
  },
  {
    name: 'storage.rack.created',
    entityType: 'storage_rack',
    operation: 'create',
    payload: {},
  },
  {
    name: 'storage.box.created',
    entityType: 'storage_box',
    operation: 'create',
    payload: {},
  },
  {
    name: 'sample.workflow.advanced',
    entityType: 'sample_workflow_run',
    operation: 'update',
    payload: { change: 'advanced' },
  },
  {
    name: 'sample.workflow.enrolled',
    entityType: 'sample_workflow_run',
    operation: 'update',
    payload: { change: 'enrolled' },
  },
  {
    name: 'sample.workflow.left',
    entityType: 'sample_workflow_run',
    operation: 'update',
    payload: { change: 'left' },
  },
  {
    name: 'incident.reported',
    entityType: 'incident',
    operation: 'create',
    payload: {},
  },
  {
    name: 'registry.entry.created',
    entityType: 'registry_entry',
    operation: 'create',
    payload: {},
  },
  {
    name: 'instrument.reading.out_of_limits',
    entityType: 'instrument_feed',
    operation: 'update',
    payload: { limitState: 'high' },
  },
  {
    name: 'instrument.reading.back_in_range',
    entityType: 'instrument_feed',
    operation: 'update',
    payload: { limitState: 'ok' },
  },
  {
    name: 'record.assigned',
    entityType: 'record_assignment',
    operation: 'update',
    payload: {},
  },
  {
    name: 'step.completed',
    entityType: 'step_completion',
    operation: 'create',
    payload: {},
  },
  {
    name: 'step.reopened',
    entityType: 'step_completion',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'step.result_added',
    entityType: 'step_result',
    operation: 'create',
    payload: {},
  },
  {
    name: 'compound.lot_added',
    entityType: 'compound_lot',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.series_member_added',
    entityType: 'experiment_series_member',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.series_member_removed',
    entityType: 'experiment_series_member',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'plate_run.created',
    entityType: 'plate_run',
    operation: 'create',
    payload: {},
  },
  {
    name: 'plate_run.analysed',
    entityType: 'plate_run',
    operation: 'update',
    payload: { change: 'analysed' },
  },
  {
    name: 'plate_run.archived',
    entityType: 'plate_run',
    operation: 'update',
    payload: { change: 'archived' },
  },
  {
    name: 'plate_worklist.created',
    entityType: 'plate_worklist',
    operation: 'create',
    payload: {},
  },
  {
    name: 'plate_worklist.completed',
    entityType: 'plate_worklist',
    operation: 'update',
    payload: { change: 'completed' },
  },
  {
    name: 'experiment.part_created',
    entityType: 'experiment_part',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_opened',
    entityType: 'part_opened',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_completed',
    entityType: 'part_completion',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_reopened',
    entityType: 'part_completion',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'instrument.run.converted',
    entityType: 'instrument_run_document',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.gate_opened',
    entityType: 'gate_opening',
    operation: 'create',
    payload: {},
  },
  {
    name: 'qc.violation',
    entityType: 'qc_violation',
    operation: 'create',
    payload: {},
  },
  {
    name: 'qc.back_in_control',
    entityType: 'qc_series',
    operation: 'update',
    payload: { change: 'back_in_control' },
  },
  {
    name: 'instrument.job.queued',
    entityType: 'instrument_job',
    operation: 'create',
    payload: {},
  },
  {
    name: 'instrument.job.staged',
    entityType: 'instrument_job',
    operation: 'update',
    payload: { change: 'staged' },
  },
  {
    name: 'instrument.job.started',
    entityType: 'instrument_job',
    operation: 'update',
    payload: { change: 'started' },
  },
  {
    name: 'instrument.job.completed',
    entityType: 'instrument_job',
    operation: 'update',
    payload: { change: 'completed' },
  },
  {
    name: 'instrument.job.failed',
    entityType: 'instrument_job',
    operation: 'update',
    payload: { change: 'failed' },
  },
  {
    name: 'instrument.job.cancelled',
    entityType: 'instrument_job',
    operation: 'update',
    payload: { change: 'cancelled' },
  },
  {
    name: 'schedule.proposed',
    entityType: 'schedule_proposal',
    operation: 'create',
    payload: {},
  },
  {
    name: 'schedule.accepted',
    entityType: 'schedule_proposal',
    operation: 'update',
    payload: { change: 'accepted' },
  },
  {
    name: 'schedule.dismissed',
    entityType: 'schedule_proposal',
    operation: 'update',
    payload: { change: 'dismissed' },
  },
  {
    name: 'code_cell.run',
    entityType: 'code_cell_run',
    operation: 'create',
    payload: {},
  },
  {
    name: 'code_cell.reproduced',
    entityType: 'code_cell_run',
    operation: 'update',
    payload: { change: 'reproduced' },
  },
  {
    name: 'instrument.created',
    entityType: 'instrument',
    operation: 'create',
    payload: {},
  },
  {
    name: 'instrument.updated',
    entityType: 'instrument',
    operation: 'update',
    payload: { effect: 'renamed_or_moved' },
  },
  {
    name: 'instrument.retired',
    entityType: 'instrument_state',
    operation: 'update',
    payload: { effect: 'retired' },
  },
  {
    name: 'instrument.reinstated',
    entityType: 'instrument_state',
    operation: 'update',
    payload: { effect: 'reinstated' },
  },
  {
    name: 'instrument.out_of_service',
    entityType: 'instrument_state',
    operation: 'update',
    payload: { effect: 'out_of_service' },
  },
  {
    name: 'instrument.back_in_service',
    entityType: 'instrument_state',
    operation: 'update',
    payload: { effect: 'back_in_service' },
  },
  {
    name: 'instrument.calibrated',
    entityType: 'instrument_calibration',
    operation: 'create',
    payload: {},
  },
  {
    name: 'instrument.qualification_set',
    entityType: 'instrument_qualification',
    operation: 'update',
    payload: {},
  },
  {
    name: 'instrument.qualification_revoked',
    entityType: 'instrument_qualification',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'instrument.qualification_requested',
    entityType: 'instrument_qualification_request',
    operation: 'create',
    payload: {},
  },
  {
    name: 'instrument.qualification_request_closed',
    entityType: 'instrument_qualification_request',
    operation: 'update',
    payload: { status: 'dismissed' },
  },
  {
    name: 'resource.created',
    entityType: 'calendar_resource',
    operation: 'create',
    payload: { resource_type: 'room' },
  },
  {
    name: 'connector.created',
    entityType: 'connector',
    operation: 'create',
    payload: {},
  },
  {
    name: 'connector.updated',
    entityType: 'connector',
    operation: 'update',
    payload: {},
  },
  {
    name: 'connector.run.started',
    entityType: 'connector_run',
    operation: 'create',
    payload: {},
  },
  {
    name: 'connector.run.completed',
    entityType: 'connector_run',
    operation: 'update',
    payload: { status: 'succeeded' },
  },
  {
    name: 'connector.run.failed',
    entityType: 'connector_run',
    operation: 'update',
    payload: { status: 'failed' },
  },
  {
    name: 'parser.created',
    entityType: 'parser',
    operation: 'create',
    payload: {},
  },
  {
    name: 'parser.version.created',
    entityType: 'parser_version',
    operation: 'create',
    payload: {},
  },
  {
    name: 'parser.version.approved',
    entityType: 'parser_version',
    operation: 'update',
    payload: { status: 'approved' },
  },
  {
    name: 'experiment.gate_overridden',
    entityType: 'gate_override',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_signed',
    entityType: 'part_signoff',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_countersigned',
    entityType: 'part_countersign',
    operation: 'create',
    payload: {},
  },
  {
    name: 'experiment.part_amended',
    entityType: 'part_amendment',
    operation: 'create',
    payload: {},
  },
  {
    name: 'study.workstream.created',
    entityType: 'study_workstream',
    operation: 'create',
    payload: {},
  },
  {
    name: 'study.workstream.updated',
    entityType: 'study_workstream',
    operation: 'update',
    payload: {},
  },
  {
    name: 'study.workstream.deleted',
    entityType: 'study_workstream',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'study.task.created',
    entityType: 'study_task',
    operation: 'create',
    payload: {},
  },
  {
    name: 'study.task.updated',
    entityType: 'study_task',
    operation: 'update',
    payload: {},
  },
  {
    name: 'study.task.deleted',
    entityType: 'study_task',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'study.deliverable.created',
    entityType: 'study_deliverable',
    operation: 'create',
    payload: {},
  },
  {
    name: 'study.deliverable.updated',
    entityType: 'study_deliverable',
    operation: 'update',
    payload: {},
  },
  {
    name: 'study.deliverable.deleted',
    entityType: 'study_deliverable',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'study.plan.snapshotted',
    entityType: 'study_plan_snapshot',
    operation: 'create',
    payload: {},
  },
  {
    name: 'report.created',
    entityType: 'report_definition',
    operation: 'create',
    payload: {},
  },
  {
    name: 'report.updated',
    entityType: 'report_definition',
    operation: 'update',
    payload: {},
  },
  {
    name: 'report.generated',
    entityType: 'report_generation',
    operation: 'create',
    payload: {},
  },
  {
    name: 'plate_design.created',
    entityType: 'plate_design',
    operation: 'create',
    payload: {},
  },
  {
    name: 'plate_design.updated',
    entityType: 'plate_design',
    operation: 'update',
    payload: {},
  },
  {
    name: 'plate_layout_template.created',
    entityType: 'plate_layout_template',
    operation: 'create',
    payload: {},
  },
  {
    name: 'plate_layout_template.updated',
    entityType: 'plate_layout_template',
    operation: 'update',
    payload: {},
  },
  {
    name: 'analysis_view.created',
    entityType: 'analysis_view',
    operation: 'create',
    payload: {},
  },
  {
    name: 'analysis_view.updated',
    entityType: 'analysis_view',
    operation: 'update',
    payload: {},
  },
  {
    name: 'analysis_view.deleted',
    entityType: 'analysis_view',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'model.created',
    entityType: 'record_model',
    operation: 'create',
    payload: {},
  },
  {
    name: 'model.updated',
    entityType: 'record_model',
    operation: 'update',
    payload: {},
  },
  {
    name: 'model.field.created',
    entityType: 'record_field_definition',
    operation: 'create',
    payload: { change: 'definition' },
  },
  {
    name: 'model.field.updated',
    entityType: 'record_field_definition',
    operation: 'update',
    payload: { change: 'definition' },
  },
  {
    name: 'model.version.created',
    entityType: 'record_model_version',
    operation: 'create',
    payload: {},
  },
  {
    name: 'model.version.published',
    entityType: 'record_model_version',
    operation: 'update',
    payload: { effect: 'published' },
  },
  {
    name: 'comment.created',
    entityType: 'comment',
    operation: 'create',
    payload: {},
  },
  {
    name: 'comment.resolved',
    entityType: 'comment',
    operation: 'resolve',
    payload: {},
  },
  {
    name: 'comment.reopened',
    entityType: 'comment',
    operation: 'reopen',
    payload: {},
  },
  {
    name: 'protocol.version.created',
    entityType: 'protocol_version',
    operation: 'create',
    payload: {},
  },
  {
    name: 'protocol.version.updated',
    entityType: 'protocol_version',
    operation: 'update',
    payload: {},
  },
  {
    name: 'protocol.deviation.updated',
    entityType: 'protocol_deviation',
    operation: 'update',
    payload: {},
  },
  {
    name: 'protocol.training.assigned',
    entityType: 'protocol_training',
    operation: 'create',
    payload: {},
  },
  {
    name: 'protocol.training.removed',
    entityType: 'protocol_training',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'protocol.acknowledged',
    entityType: 'protocol_acknowledgement',
    operation: 'create',
    payload: {},
  },
  {
    name: 'file.uploaded',
    entityType: 'file',
    operation: 'create',
    payload: {},
  },
  {
    name: 'file.version.added',
    entityType: 'file',
    operation: 'update',
    payload: {},
  },
  {
    name: 'file.quarantined',
    entityType: 'file',
    operation: 'quarantine',
    payload: {},
  },
  {
    name: 'file.deleted',
    entityType: 'file',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'file.restored',
    entityType: 'file',
    operation: 'restore',
    payload: {},
  },
  {
    name: 'model.field.option.created',
    entityType: 'model_field_option',
    operation: 'create',
    payload: {},
  },
  {
    name: 'model.field.option.updated',
    entityType: 'model_field_option',
    operation: 'update',
    payload: {},
  },
  {
    name: 'model.rule.created',
    entityType: 'model_rule',
    operation: 'create',
    payload: {},
  },
  {
    name: 'model.rule.updated',
    entityType: 'model_rule',
    operation: 'update',
    payload: {},
  },
  {
    name: 'model.rule.removed',
    entityType: 'model_rule',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'model.link_rule.set',
    entityType: 'model_relationship_rule',
    operation: 'update',
    payload: {},
  },
  {
    name: 'model.link_rule.removed',
    entityType: 'model_relationship_rule',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'model.version.discarded',
    entityType: 'record_model_version',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'sheet.definition.version.published',
    entityType: 'sheet_definition_version',
    operation: 'update',
    payload: { lifecycle: 'published' },
  },
  {
    name: 'sheet.definition.version.retired',
    entityType: 'sheet_definition_version',
    operation: 'update',
    payload: { lifecycle: 'retired' },
  },
  {
    name: 'notebook.template.version.published',
    entityType: 'notebook_template_version',
    operation: 'update',
    payload: { lifecycle: 'published' },
  },
  {
    name: 'notebook.template.version.retired',
    entityType: 'notebook_template_version',
    operation: 'update',
    payload: { lifecycle: 'retired' },
  },
  {
    name: 'record.alias.added',
    entityType: 'record_alias',
    operation: 'create',
    payload: {},
  },
  {
    name: 'record.alias.removed',
    entityType: 'record_alias',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'label.template.created',
    entityType: 'label_template',
    operation: 'create',
    payload: {},
  },
  {
    name: 'label.template.updated',
    entityType: 'label_template',
    operation: 'update',
    payload: {},
  },
]

describe('lab feature events', () => {
  it.each([
    ...LAB_EVENTS,
    ...DATASET_EVENT_FIXTURES,
    ...PIPELINE_SIMPLE_EVENT_FIXTURES,
  ])(
    '$name is delivered from $entityType/$operation',
    ({ name, entityType, operation, payload }) => {
      expect(mapEventType(entityType, operation, payload)).toBe(name)
      const entry = eventByName(name)
      expect(entry?.status).toBe('stable')
      expect(entry?.consumers.webhook).toBe(true)
    },
  )

  it('lists every lab-01 catalogue entry here, so none is added unpinned', () => {
    const pinned = [
      ...LAB_EVENTS,
      ...DATASET_EVENT_FIXTURES,
      ...PIPELINE_SIMPLE_EVENT_FIXTURES,
    ]
      .map((event) => event.name)
      .sort()

    const catalogued = EVENT_CATALOGUE.filter(
      (entry) => entry.introducedIn === 'lab-01',
    )
      .map((entry) => entry.name)
      .sort()

    expect(catalogued).toEqual(pinned)
  })

  it('keeps a changed payload from claiming another event', () => {
    expect(mapEventType('material', 'update', { action: 'other' })).toBeNull()
    expect(mapEventType('workspace_settings', 'update', {})).toBeNull()
    expect(
      mapEventType('stocktake', 'update', { status: 'cancelled' }),
    ).toBeNull()
  })
})

/** The directory-sync events SCIM-01 delivers, with a payload that matches each. */
const SCIM_EVENTS: Array<{
  name: string
  entityType: string
  operation: string
  payload: ChangeEventPayload
}> = [
  {
    name: 'workspace.scim_token.created',
    entityType: 'scim_token',
    operation: 'create',
    payload: {},
  },
  {
    name: 'workspace.scim_token.revoked',
    entityType: 'scim_token',
    operation: 'revoke',
    payload: {},
  },
  {
    name: 'member.provisioned',
    entityType: 'scim_user',
    operation: 'create',
    payload: { action: 'scim-user-provisioned' },
  },
  {
    name: 'member.directory_updated',
    entityType: 'scim_user',
    operation: 'update',
    payload: { action: 'scim-user-updated' },
  },
  {
    name: 'member.reactivated',
    entityType: 'scim_user',
    operation: 'update',
    payload: { action: 'scim-user-reactivated' },
  },
  {
    name: 'member.deprovisioned',
    entityType: 'scim_user',
    operation: 'suspend',
    payload: { action: 'scim-user-deprovisioned', openWork: 3 },
  },
  {
    name: 'workspace.scim_group.created',
    entityType: 'scim_group',
    operation: 'create',
    payload: {},
  },
  {
    name: 'workspace.scim_group.updated',
    entityType: 'scim_group',
    operation: 'update',
    payload: {},
  },
  {
    name: 'workspace.scim_group.deleted',
    entityType: 'scim_group',
    operation: 'delete',
    payload: {},
  },
]

describe('directory sync events', () => {
  it.each(SCIM_EVENTS)(
    '$name is delivered from $entityType/$operation',
    ({ name, entityType, operation, payload }) => {
      expect(mapEventType(entityType, operation, payload)).toBe(name)
      const entry = eventByName(name)
      expect(entry?.status).toBe('stable')
      expect(entry?.consumers.webhook).toBe(true)
    },
  )

  it('lists every scim-01 catalogue entry here, so none is added unpinned', () => {
    const pinned = SCIM_EVENTS.map((event) => event.name).sort()

    const catalogued = EVENT_CATALOGUE.filter(
      (entry) => entry.introducedIn === 'scim-01',
    )
      .map((entry) => entry.name)
      .sort()

    expect(catalogued).toEqual(pinned)
  })

  it('does not claim a change it cannot name', () => {
    expect(mapEventType('scim_user', 'update', { action: 'other' })).toBeNull()
  })
})
