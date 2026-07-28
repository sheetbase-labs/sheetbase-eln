/** OPS-006 pure unit tests for instrument monitor adapters and helpers. */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TOKENS,
  INGESTION_STATUS_LABELS,
  INGESTION_STATUS_TOKENS,
  PLATE_WELL_CODES,
  QC_CHECK_LABELS,
  QC_CHECK_TOKENS,
  RUN_STATUS_LABELS,
  RUN_STATUS_TOKENS,
  STAGE_STATUS_LABELS,
  STAGE_STATUS_TOKENS,
  createPlateSnapshotObservation,
  createQcCheckObservation,
  createQpcrFixtureStream,
  createStageObservations,
  describeInstrumentMonitorError,
  parseAmplificationCurve,
  parseWellCode,
  toInstrument,
  toInstrumentObservation,
  toInstrumentPlateSnapshot,
  toInstrumentQcCheck,
  toInstrumentRawFile,
  toInstrumentRun,
  toInstrumentRunLink,
  toInstrumentRunStage,
  wellCode,
} from './instrument-monitor'
import type {
  ConnectionStatus,
  IngestionStatus,
  InstrumentObservationWire,
  InstrumentPlateSnapshotWire,
  InstrumentQcCheckWire,
  InstrumentRawFileWire,
  InstrumentRunLinkWire,
  InstrumentRunStageWire,
  InstrumentRunWire,
  InstrumentWire,
  ObservationType,
  QcCheckType,
  RunStatus,
  StageStatus,
} from './instrument-monitor'

const created = '2026-01-01T00:00:00.000Z'
const updated = '2026-01-02T00:00:00.000Z'

describe('wire to domain mappers', () => {
  it('maps an instrument', () => {
    const wire: InstrumentWire = {
      id: 'instrument-1',
      workspace_id: 'workspace-1',
      name: 'Cycler',
      instrument_type: 'qpcr',
      model: 'Q1',
      serial_number: 'SN-1',
      vendor: 'Acme',
      connection_status: 'connected',
      last_connected_at: updated,
      config: { channel: 'FAM' },
      position: 2,
      created_at: created,
      updated_at: updated,
      created_by_user_id: 'user-1',
      updated_by_user_id: 'user-2',
    }
    expect(toInstrument(wire)).toEqual({
      id: 'instrument-1',
      workspaceId: 'workspace-1',
      name: 'Cycler',
      instrumentType: 'qpcr',
      model: 'Q1',
      serialNumber: 'SN-1',
      vendor: 'Acme',
      connectionStatus: 'connected',
      lastConnectedAt: updated,
      config: { channel: 'FAM' },
      position: 2,
      createdAt: created,
      updatedAt: updated,
      createdByUserId: 'user-1',
      updatedByUserId: 'user-2',
    })
  })

  it('maps an instrument run', () => {
    const wire: InstrumentRunWire = {
      id: 'run-1',
      workspace_id: 'workspace-1',
      instrument_id: 'instrument-1',
      project_id: 'project-1',
      name: 'Run 1',
      run_identifier: 'RUN-001',
      protocol_name: 'Standard',
      status: 'running',
      progress_percent: 42,
      plate_format: '96',
      started_at: created,
      completed_at: null,
      estimated_duration_seconds: 3600,
      elapsed_seconds: 1200,
      operator: 'Ada',
      error_message: null,
      metadata_version: 3,
      queue_position: 1,
      tags: ['demo'],
      created_at: created,
      updated_at: updated,
      created_by_user_id: 'user-1',
      updated_by_user_id: 'user-2',
    }
    expect(toInstrumentRun(wire)).toEqual({
      id: 'run-1',
      workspaceId: 'workspace-1',
      instrumentId: 'instrument-1',
      projectId: 'project-1',
      name: 'Run 1',
      runIdentifier: 'RUN-001',
      protocolName: 'Standard',
      status: 'running',
      progressPercent: 42,
      plateFormat: '96',
      startedAt: created,
      completedAt: null,
      estimatedDurationSeconds: 3600,
      elapsedSeconds: 1200,
      operator: 'Ada',
      errorMessage: null,
      metadataVersion: 3,
      queuePosition: 1,
      tags: ['demo'],
      createdAt: created,
      updatedAt: updated,
      createdByUserId: 'user-1',
      updatedByUserId: 'user-2',
    })
  })

  it('maps a run stage', () => {
    const wire: InstrumentRunStageWire = {
      id: 'stage-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      name: 'Cycling',
      stage_type: 'cycling',
      position: 2,
      status: 'running',
      cycle_count: 40,
      current_cycle: 12,
      target_temperature: 60,
      started_at: created,
      completed_at: null,
      duration_seconds: 2400,
      config: { rampRate: 2 },
      created_at: created,
      updated_at: updated,
    }
    expect(toInstrumentRunStage(wire)).toEqual({
      id: 'stage-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      name: 'Cycling',
      stageType: 'cycling',
      position: 2,
      status: 'running',
      cycleCount: 40,
      currentCycle: 12,
      targetTemperature: 60,
      startedAt: created,
      completedAt: null,
      durationSeconds: 2400,
      config: { rampRate: 2 },
      createdAt: created,
      updatedAt: updated,
    })
  })

  it('maps an observation', () => {
    const wire: InstrumentObservationWire = {
      id: 'observation-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      stage_id: 'stage-1',
      source_id: 'source-1',
      observation_type: 'telemetry',
      source_timestamp: created,
      ingestion_status: 'processed',
      payload: { cycle: 1 },
      error_detail: null,
      ingested_at: updated,
    }
    expect(toInstrumentObservation(wire)).toEqual({
      id: 'observation-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      stageId: 'stage-1',
      sourceId: 'source-1',
      observationType: 'telemetry',
      sourceTimestamp: created,
      ingestionStatus: 'processed',
      payload: { cycle: 1 },
      errorDetail: null,
      ingestedAt: updated,
    })
  })

  it('maps a plate snapshot', () => {
    const wire: InstrumentPlateSnapshotWire = {
      id: 'snapshot-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      observation_id: 'observation-1',
      plate_format: '96',
      wells: { A1: { status: 'amplified' } },
      captured_at: updated,
      cycle_number: 40,
      created_at: created,
    }
    expect(toInstrumentPlateSnapshot(wire)).toEqual({
      id: 'snapshot-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      observationId: 'observation-1',
      plateFormat: '96',
      wells: { A1: { status: 'amplified' } },
      capturedAt: updated,
      cycleNumber: 40,
      createdAt: created,
    })
  })

  it('maps a QC check', () => {
    const wire: InstrumentQcCheckWire = {
      id: 'qc-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      check_name: 'Control',
      check_type: 'pass',
      message: 'Good',
      detail: { ct: 20 },
      checked_at: updated,
      created_at: created,
    }
    expect(toInstrumentQcCheck(wire)).toEqual({
      id: 'qc-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      checkName: 'Control',
      checkType: 'pass',
      message: 'Good',
      detail: { ct: 20 },
      checkedAt: updated,
      createdAt: created,
    })
  })

  it('maps a raw file', () => {
    const wire: InstrumentRawFileWire = {
      id: 'raw-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      file_id: 'file-1',
      filename: 'run.csv',
      media_type: 'text/csv',
      size_bytes: 123,
      storage_key: 'runs/run.csv',
      checksum: 'abc',
      ingestion_status: 'complete',
      error_detail: null,
      received_at: updated,
      created_at: created,
    }
    expect(toInstrumentRawFile(wire)).toEqual({
      id: 'raw-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      fileId: 'file-1',
      filename: 'run.csv',
      mediaType: 'text/csv',
      sizeBytes: 123,
      storageKey: 'runs/run.csv',
      checksum: 'abc',
      ingestionStatus: 'complete',
      errorDetail: null,
      receivedAt: updated,
      createdAt: created,
    })
  })

  it('maps a run link', () => {
    const wire: InstrumentRunLinkWire = {
      id: 'link-1',
      workspace_id: 'workspace-1',
      run_id: 'run-1',
      linked_record_id: 'record-1',
      linked_record_identifier: 'EXP-1',
      linked_record_title: 'Experiment',
      link_type: 'experiment',
      created_at: created,
    }
    expect(toInstrumentRunLink(wire)).toEqual({
      id: 'link-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      linkedRecordId: 'record-1',
      linkedRecordIdentifier: 'EXP-1',
      linkedRecordTitle: 'Experiment',
      linkType: 'experiment',
      createdAt: created,
    })
  })
})

describe('well helpers', () => {
  it('formats and parses well codes', () => {
    expect(wellCode('A', 1)).toBe('A1')
    expect(wellCode('H', 12)).toBe('H12')
    expect(parseWellCode('A1')).toEqual({ row: 'A', col: 1 })
  })

  it('contains all 96 plate wells', () => {
    expect(PLATE_WELL_CODES).toHaveLength(96)
    expect(new Set(PLATE_WELL_CODES).size).toBe(96)
  })
})

describe('qPCR adapter helpers', () => {
  it('groups fluorescence readings into cycle-ordered canonical payloads', () => {
    expect(
      parseAmplificationCurve([
        { cycle: 2, well: 'A1', fluorescence: 0.3 },
        { cycle: 1, well: 'A1', fluorescence: 0.1 },
        { cycle: 1, well: 'B2', fluorescence: 0.2 },
        { cycle: 2, well: 'B2', fluorescence: 0.4 },
      ]),
    ).toEqual([
      {
        cycle: 1,
        readings: [
          { well: 'A1', fluorescence: 0.1 },
          { well: 'B2', fluorescence: 0.2 },
        ],
      },
      {
        cycle: 2,
        readings: [
          { well: 'A1', fluorescence: 0.3 },
          { well: 'B2', fluorescence: 0.4 },
        ],
      },
    ])
  })

  it('creates start and complete observations for every stage', () => {
    const observations = createStageObservations([
      {
        name: 'Cycling',
        stageType: 'cycling',
        startedAt: created,
        completedAt: updated,
        cycleCount: 40,
        targetTemperature: 60,
      },
    ])
    expect(observations).toEqual([
      {
        source_id: 'qpcr-stage-1-start',
        observation_type: 'stage_start',
        source_timestamp: created,
        payload: {
          name: 'Cycling',
          stageType: 'cycling',
          cycleCount: 40,
          targetTemperature: 60,
        },
      },
      {
        source_id: 'qpcr-stage-1-complete',
        observation_type: 'stage_complete',
        source_timestamp: updated,
        payload: { name: 'Cycling', stageType: 'cycling' },
      },
    ])
  })

  it('creates a plate snapshot observation with well statuses', () => {
    const wells = { A1: { status: 'amplified' }, A2: { status: 'blank' } }
    expect(createPlateSnapshotObservation(wells, 40)).toEqual({
      observation_type: 'plate_snapshot',
      payload: { plateFormat: '96', cycle: 40, wells },
    })
  })

  it('creates a QC result observation', () => {
    const checks = [
      {
        name: 'Control amplified',
        checkType: 'pass' as const,
        message: 'Within range',
        detail: { ct: 20.1 },
      },
    ]
    expect(createQcCheckObservation(checks)).toEqual({
      observation_type: 'qc_result',
      payload: { checks },
    })
  })
})

describe('qPCR fixture stream', () => {
  it('provides a complete, valid observation stream', () => {
    const stream = createQpcrFixtureStream()
    const types: ObservationType[] = [
      'telemetry',
      'stage_start',
      'stage_complete',
      'run_start',
      'run_complete',
      'run_fail',
      'plate_snapshot',
      'qc_result',
      'status_change',
      'heartbeat',
    ]
    const telemetry = stream.filter(
      (item) => item.observation_type === 'telemetry',
    )

    expect(stream.some((item) => item.observation_type === 'run_start')).toBe(
      true,
    )
    expect(
      stream.some((item) => item.observation_type === 'run_complete'),
    ).toBe(true)
    expect(stream.some((item) => item.observation_type === 'stage_start')).toBe(
      true,
    )
    expect(
      stream.some((item) => item.observation_type === 'stage_complete'),
    ).toBe(true)
    expect(telemetry.length).toBeGreaterThan(1)
    expect(new Set(stream.map((item) => item.source_id)).size).toBe(
      stream.length,
    )
    expect(stream.every((item) => item.source_timestamp.length > 0)).toBe(true)
    expect(stream.every((item) => types.includes(item.observation_type))).toBe(
      true,
    )
    expect(
      telemetry.every(
        (item) =>
          Array.isArray(item.payload.readings) &&
          item.payload.readings.every(
            (reading) =>
              typeof (reading as { fluorescence?: unknown }).fluorescence ===
              'number',
          ),
      ),
    ).toBe(true)
  })
})

describe('describeInstrumentMonitorError', () => {
  it.each([
    ['SB033', 'The selected item belongs to a different workspace.'],
    ['SB034', 'The instrument was not found.'],
    ['SB039', 'The instrument run was not found.'],
    ['SB042', 'The instrument run is not running.'],
    ['SB043', 'The supplied input is invalid.'],
    ['42501', 'You do not have access to this instrument monitor.'],
  ])('maps DataClientError code %s', (code, message) => {
    expect(
      describeInstrumentMonitorError(
        new DataClientError(code, 'server text', 400),
      ),
    ).toBe(message)
  })

  it('preserves the server message for an unknown DataClientError code', () => {
    expect(
      describeInstrumentMonitorError(
        new DataClientError('UNKNOWN', 'Unexpected server response', 500),
      ),
    ).toBe('Unexpected server response')
  })

  it('uses a safe default for a generic error', () => {
    expect(describeInstrumentMonitorError(new Error('internal detail'))).toBe(
      'Could not complete the instrument monitor operation. Try again.',
    )
  })
})

describe('status tokens and labels', () => {
  it.each([
    [
      [
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
      ] satisfies RunStatus[],
      RUN_STATUS_TOKENS,
      RUN_STATUS_LABELS,
    ],
    [
      ['connected', 'disconnected', 'error'] satisfies ConnectionStatus[],
      CONNECTION_STATUS_TOKENS,
      CONNECTION_STATUS_LABELS,
    ],
    [
      [
        'pending',
        'running',
        'completed',
        'skipped',
        'failed',
      ] satisfies StageStatus[],
      STAGE_STATUS_TOKENS,
      STAGE_STATUS_LABELS,
    ],
    [
      ['pass', 'warning', 'fail', 'info'] satisfies QcCheckType[],
      QC_CHECK_TOKENS,
      QC_CHECK_LABELS,
    ],
    [
      [
        'received',
        'processed',
        'failed',
        'duplicate',
      ] satisfies IngestionStatus[],
      INGESTION_STATUS_TOKENS,
      INGESTION_STATUS_LABELS,
    ],
  ])(
    'has a token and label for every union member',
    (statuses, tokens, labels) => {
      expect(Object.keys(tokens).sort()).toEqual([...statuses].sort())
      expect(Object.keys(labels).sort()).toEqual([...statuses].sort())
      const tokenRecord: Record<string, string> = tokens
      const labelRecord: Record<string, string> = labels
      expect(
        statuses.every((status) => tokenRecord[status] && labelRecord[status]),
      ).toBe(true)
    },
  )
})
