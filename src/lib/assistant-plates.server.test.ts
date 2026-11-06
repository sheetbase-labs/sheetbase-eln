import { describe, expect, it } from 'vitest'

import { PLATES_PROPOSE_TOOL_NAMES, isPlatesAction } from './assistant-plates'
import {
  buildPlatesProposal,
  isPlatesProposalTool,
  platesProposalDefs,
} from './assistant-plates.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'
import { defaultAssayConfig } from './plate-assay'

const RUN = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  name: 'Kinase screen 1',
  format: '96_well',
  status: 'analysed',
  qc_status: 'pass',
  config: defaultAssayConfig(),
  results: null,
  wells: [
    { wellCode: 'A1', role: 'negative_control' },
    { wellCode: 'A2', role: 'positive_control' },
    { wellCode: 'A3', role: 'sample', sampleLabel: 'SMP-0001', volumeUl: 5 },
    { wellCode: 'A4', role: 'blank' },
  ],
}

function context(rows: Array<Record<string, unknown>>): LabToolContext {
  const seen: string[] = []
  const client = {
    list: (resource: string, query = '') => {
      seen.push(`${resource}${query}`)
      return Promise.resolve(resource === 'plate_runs' ? rows : [])
    },
  } as unknown as DataClient
  return {
    client,
    workspaceId: 'w',
    userId: 'u',
    timeZone: 'UTC',
  }
}

describe('plates assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of PLATES_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isPlatesProposalTool(name)).toBe(true)
    }
    expect(platesProposalDefs().map((d) => d.name)).toEqual(
      PLATES_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes analysing a run found by its number', async () => {
    const built = await buildPlatesProposal(
      'sheetbase.plate.analyse',
      { title: 'Analyse', summary: 's', run: 'PLR-0007' },
      context([RUN]),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'plate.analyse',
      runId: RUN.id,
    })
    expect(built.ok && built.proposal.target).toContain('PLR-0007')
  })

  it('says when no run matches and when several do', async () => {
    const none = await buildPlatesProposal(
      'sheetbase.plate.analyse',
      { title: 'a', summary: 's', run: 'nothing' },
      context([]),
    )
    expect(none).toMatchObject({ ok: false })
    const many = await buildPlatesProposal(
      'sheetbase.plate.analyse',
      { title: 'a', summary: 's', run: 'kinase' },
      context([RUN, { ...RUN, id: 'x', number: 8, name: 'Kinase screen 2' }]),
    )
    expect(many.ok).toBe(false)
    expect(!many.ok && many.message).toContain('PLR-0008')
  })

  it('proposes a worklist with the transfers it would make', async () => {
    const built = await buildPlatesProposal(
      'sheetbase.worklist.create',
      {
        title: 'Worklist',
        summary: 's',
        run: 'PLR-0007',
        format: 'opentrons',
        volumeUl: 10,
      },
      context([RUN]),
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'worklist.create',
      runId: RUN.id,
      format: 'opentrons',
      mode: 'stamp',
      volumeUl: 10,
    })
    const transfers = built.ok
      ? built.proposal.changes.find((c) => c.label === 'Transfers')
      : null
    // Blank wells are left out: three wells get a transfer.
    expect(transfers?.after).toMatch(/^3 from/)
  })

  it('will not propose a worklist when no well has a volume', async () => {
    const built = await buildPlatesProposal(
      'sheetbase.worklist.create',
      { title: 'w', summary: 's', run: 'PLR-0007' },
      context([{ ...RUN, wells: [{ wellCode: 'A1', role: 'sample' }] }]),
    )
    expect(built).toMatchObject({ ok: false })
  })

  it('recognises its own actions', () => {
    expect(isPlatesAction({ kind: 'plate.analyse' })).toBe(true)
    expect(isPlatesAction({ kind: 'booking.create' })).toBe(false)
  })
})
