import { describe, expect, it } from 'vitest'

import {
  CONNECTOR_SET_TOOL,
  INSTRUMENTS_PROPOSE_TOOL_NAMES,
  INSTRUMENT_ADD_TOOL,
  INSTRUMENT_CALIBRATE_TOOL,
  INSTRUMENT_QUALIFY_TOOL,
  INSTRUMENT_RETIRE_TOOL,
  RUN_CREATE_TOOL,
  RUN_UPDATE_TOOL,
  isInstrumentsAction,
} from './assistant-instruments'
import {
  buildInstrumentsProposal,
  instrumentsProposalDefs,
  isInstrumentsProposalTool,
} from './assistant-instruments.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const INSTRUMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Plate reader',
  display_id: 'INS-0001',
  retired_at: null,
}

const RUN = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Nightly qPCR',
  run_identifier: 'RUN-7',
  status: 'queued',
}

const CONNECTOR = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Lab S3',
  status: 'active',
}

function context(): LabToolContext {
  const client = {
    list: (resource: string) =>
      Promise.resolve(
        resource === 'instruments'
          ? [INSTRUMENT]
          : resource === 'instrument_runs'
            ? [RUN]
            : resource === 'connectors'
              ? [CONNECTOR]
              : [],
      ),
    rpc: () => Promise.resolve([{ user_id: 'u-ada', name: 'Ada Lovelace' }]),
  } as unknown as DataClient

  return {
    client,
    workspaceId: 'w',
    userId: 'u',
    timeZone: 'UTC',
    now: new Date('2026-11-09T10:15:00Z'),
  }
}

const base = { title: 'Do it', summary: 'A card' }

describe('instrument assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of INSTRUMENTS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isInstrumentsProposalTool(name)).toBe(true)
    }

    expect(instrumentsProposalDefs().map((d) => d.name)).toEqual(
      INSTRUMENTS_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes adding an instrument without writing anything', async () => {
    const built = await buildInstrumentsProposal(
      INSTRUMENT_ADD_TOOL,
      { ...base, name: ' Centrifuge ', location: 'Room 2' },
      context(),
    )

    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'instrument.add',
      workspaceId: 'w',
      name: 'Centrifuge',
      location: 'Room 2',
    })
  })

  it('retires an instrument and brings one back', async () => {
    const retire = await buildInstrumentsProposal(
      INSTRUMENT_RETIRE_TOOL,
      { ...base, instrument: 'plate reader' },
      context(),
    )

    expect(retire.ok && retire.proposal.action).toEqual({
      kind: 'instrument.retire',
      instrumentId: INSTRUMENT.id,
      retired: true,
    })
    expect(retire.ok && retire.proposal.target).toBe('Plate reader (INS-0001)')
  })

  it('asks for a sensible calibration interval', async () => {
    const bad = await buildInstrumentsProposal(
      INSTRUMENT_CALIBRATE_TOOL,
      {
        ...base,
        instrument: 'plate reader',
        performedOn: '2026-11-09',
        dueOn: '2026-11-01',
      },
      context(),
    )

    expect(bad.ok).toBe(false)

    const good = await buildInstrumentsProposal(
      INSTRUMENT_CALIBRATE_TOOL,
      {
        ...base,
        instrument: 'plate reader',
        performedOn: '2026-11-09',
        dueOn: '2027-05-09',
      },
      context(),
    )

    expect(good.ok && good.proposal.action).toMatchObject({
      kind: 'instrument.calibrate',
      dueAt: '2027-05-09T00:00:00Z',
    })
  })

  it('qualifies a person by name and takes a qualification away', async () => {
    const grant = await buildInstrumentsProposal(
      INSTRUMENT_QUALIFY_TOOL,
      {
        ...base,
        instrument: 'plate reader',
        person: 'ada',
        validUntil: '2027-01-01',
      },
      context(),
    )

    expect(grant.ok && grant.proposal.action).toMatchObject({
      kind: 'instrument.qualify',
      userId: 'u-ada',
      validUntil: '2027-01-01T00:00:00Z',
    })

    const revoke = await buildInstrumentsProposal(
      INSTRUMENT_QUALIFY_TOOL,
      { ...base, instrument: 'plate reader', person: 'ada', revoke: true },
      context(),
    )

    expect(revoke.ok && revoke.proposal.action).toMatchObject({
      validUntil: null,
    })

    const unknown = await buildInstrumentsProposal(
      INSTRUMENT_QUALIFY_TOOL,
      {
        ...base,
        instrument: 'plate reader',
        person: 'zed',
        validUntil: '2027-01-01',
      },
      context(),
    )

    expect(unknown.ok).toBe(false)

    const noDate = await buildInstrumentsProposal(
      INSTRUMENT_QUALIFY_TOOL,
      { ...base, instrument: 'plate reader', person: 'ada' },
      context(),
    )

    expect(noDate.ok).toBe(false)
  })

  it('records a run and moves an open one on', async () => {
    const created = await buildInstrumentsProposal(
      RUN_CREATE_TOOL,
      { ...base, instrument: 'plate reader', name: 'Plate 4' },
      context(),
    )

    expect(created.ok && created.proposal.action).toMatchObject({
      kind: 'run.create',
      runIdentifier: 'RUN-202611091015',
    })

    const done = await buildInstrumentsProposal(
      RUN_UPDATE_TOOL,
      { ...base, run: 'RUN-7', status: 'completed' },
      context(),
    )

    expect(done.ok && done.proposal.action).toMatchObject({
      kind: 'run.update',
      runId: RUN.id,
      status: 'completed',
    })
  })

  it('pauses a connector, and says when it already is', async () => {
    const paused = await buildInstrumentsProposal(
      CONNECTOR_SET_TOOL,
      { ...base, connector: 'lab s3', status: 'paused' },
      context(),
    )

    expect(paused.ok && paused.proposal.action).toMatchObject({
      kind: 'connector.set',
      status: 'paused',
    })

    const same = await buildInstrumentsProposal(
      CONNECTOR_SET_TOOL,
      { ...base, connector: 'lab s3', status: 'active' },
      context(),
    )

    expect(same.ok).toBe(false)
  })

  it('knows its own actions', () => {
    expect(isInstrumentsAction({ kind: 'run.update' })).toBe(true)
    expect(isInstrumentsAction({ kind: 'qc.acknowledge' })).toBe(false)
  })
})
