import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import { INSTRUMENT_SETUP_PROPOSE_TOOL_NAMES } from './cards'
import { runInstrumentSetupAction } from './cards-run'
import {
  buildInstrumentSetupProposal,
  instrumentSetupProposalDefs,
  isInstrumentSetupProposalTool,
} from './cards.server'
import { assistant } from './assistant'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; anything not listed is empty. */
function context(tables: Record<string, core.util.JSONType[]>): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(tables[urlOf(input).pathname.split('/').at(-1) ?? ''] ?? [])

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
    now: new Date('2026-11-26T10:00:00Z'),
  }
}

const reader = {
  id: 'i1',
  name: 'Plate reader',
  display_id: 'INS-0004',
  location: null,
  instrument_type: 'plate_reader',
  retired_at: null,
  out_of_service_at: null,
}

describe('the instrument set-up cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      instrumentSetupProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...INSTRUMENT_SETUP_PROPOSE_TOOL_NAMES])

    for (const name of INSTRUMENT_SETUP_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
      expect(isInstrumentSetupProposalTool(name)).toBe(true)
    }
  })

  it('finds an instrument by its INS number and cancels its open job', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.instrument.cancel_job',
      { ...base, instrument: 'ins-0004' },
      context({
        instruments: [reader],
        instrument_jobs: [{ id: 'j9', number: 9, status: 'running' }],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.target).toBe('Plate reader (INS-0004)')

    expect(result.proposal.action).toEqual({
      kind: 'instrument.job_cancel',
      params: { p_job_id: 'j9' },
      openHref: '/instruments',
    })
  })

  it('asks which job when an instrument has two open', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.instrument.cancel_job',
      { ...base, instrument: 'Plate reader' },
      context({
        instruments: [reader],
        instrument_jobs: [
          { id: 'j9', number: 9, status: 'running' },
          { id: 'j8', number: 8, status: 'queued' },
        ],
      }),
    )

    expect(result.ok).toBe(false)

    if (!result.ok) expect(result.message).toContain('Job 9')
  })

  it('queues a planned worklist by its WL number', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.instrument.queue_job',
      { ...base, instrument: 'INS-0004', worklist: 'WL-0003', note: 'Plate 2' },
      context({
        instruments: [reader],
        plate_worklists: [{ id: 'w3', number: 3, name: 'Normalise' }],
      }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.action.params).toEqual({
      p_instrument_id: 'i1',
      p_worklist_id: 'w3',
      p_note: 'Plate 2',
    })
  })

  it('says so when no instrument matches, rather than guessing', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.instrument.set_gate_mode',
      { ...base, mode: 'block' },
      context({}),
    )

    // The gate mode names no instrument, so it always builds.
    expect(result.ok).toBe(true)

    const missing = await buildInstrumentSetupProposal(
      'sheetbase.instrument.clear_robot',
      { ...base, instrument: 'Nothing' },
      context({ instruments: [] }),
    )

    expect(missing.ok).toBe(false)
  })

  it('refuses a limit pair the wrong way round', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.instrument.set_feed_limits',
      { ...base, instrument: 'INS-0004', feed: 'Temp', low: 8, high: 2 },
      context({
        instruments: [reader],
        instrument_feeds: [
          { id: 'f1', name: 'Temp', unit: '°C', low_limit: 2, high_limit: 8 },
        ],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('copies a booking to a new time on the person’s clock', async () => {
    const id = '3f1c2b9e-8f6d-4a37-9c1e-6a0b6e0c1d11'

    const result = await buildInstrumentSetupProposal(
      'sheetbase.booking.duplicate',
      {
        ...base,
        bookingId: id,
        start: '2026-12-01T09:00',
        end: '2026-12-01T11:00',
      },
      context({ calendar_bookings: [{ id, title: 'qPCR run' }] }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.action.params).toEqual({
      p_booking_id: id,
      p_starts_at: '2026-12-01T09:00:00.000Z',
      p_ends_at: '2026-12-01T11:00:00.000Z',
      p_title: 'qPCR run',
    })
  })

  it('adds a converter parser, naming the instrument it is for', async () => {
    const result = await buildInstrumentSetupProposal(
      'sheetbase.parser.create_converter',
      {
        ...base,
        key: 'gen5',
        name: 'Gen5 export',
        format: 'xlsx',
        version: 1,
        vendor: 'AGILENT_GEN5',
        instrument: 'INS-0004',
      },
      context({ instruments: [reader] }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.action.params).toMatchObject({
      p_key: 'gen5',
      p_vendor: 'AGILENT_GEN5',
      p_instrument_id: 'i1',
    })
  })

  it('runs only the function the kind names, whatever the card carries', async () => {
    const rpc = vi.fn().mockResolvedValue(undefined)

    const result = await runInstrumentSetupAction(
      { rpc },
      {
        kind: 'instrument.job_cancel',
        params: { p_job_id: 'j9' },
        openHref: '/instruments',
      },
    )

    expect(rpc).toHaveBeenCalledWith('cancel_instrument_job', {
      p_job_id: 'j9',
    })

    expect(result).toEqual({ openHref: '/instruments' })
    expect(assistant.isAction({ kind: 'instrument.job_cancel' })).toBe(true)
    expect(assistant.isAction({ kind: 'records.create' })).toBe(false)
  })
})
