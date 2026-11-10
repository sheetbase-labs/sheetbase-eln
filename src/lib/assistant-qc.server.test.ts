import { describe, expect, it } from 'vitest'

import {
  QC_ACKNOWLEDGE_TOOL,
  QC_PROPOSE_TOOL_NAMES,
  QC_SET_BASELINE_TOOL,
  isQcAction,
} from './assistant-qc'
import {
  buildQcProposal,
  isQcProposalTool,
  qcProposalDefs,
} from './assistant-qc.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'

/** One qc_points fixture row: the JSON the read returns. */
interface QcPointFixture {
  id?: string
  series_id?: string
  value?: number
  at?: string
  violations?: string[]
  z?: number | null
  acknowledged_at?: string | null
}

const SERIES = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Qubit 4 standard 1',
  mean: 100,
  sd: 4,
  state: 'out_of_control',
}

function context(breaches: QcPointFixture[] = []): LabToolContext {
  const client: DataClient = Object.assign(createDataClient(), {
    list: (resource: string) =>
      Promise.resolve(
        resource === 'qc_series'
          ? [SERIES]
          : resource === 'qc_points'
            ? breaches
            : [],
      ),
  })

  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}

const base = { title: 'Set limits', summary: 'Limits for the standard' }

describe('quality control assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of QC_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isQcProposalTool(name)).toBe(true)
    }

    expect(qcProposalDefs().map((d) => d.name)).toEqual(
      QC_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes limits from a mean and SD', async () => {
    const built = await buildQcProposal(
      QC_SET_BASELINE_TOOL,
      { ...base, series: 'qubit 4', mean: 102, sd: 3 },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'qc.set_baseline',
      seriesId: SERIES.id,
      limits: { mean: 102, sd: 3 },
    })
    expect(isQcAction(built.proposal.action ?? { kind: '' })).toBe(true)
  })

  it('proposes limits from the first points', async () => {
    const built = await buildQcProposal(
      QC_SET_BASELINE_TOOL,
      { ...base, series: 'qubit 4', firstN: 20 },
      context(),
    )

    expect(built.ok && built.proposal.action).toMatchObject({
      limits: { firstN: 20 },
    })
  })

  it('asks for limits when none were given', async () => {
    const built = await buildQcProposal(
      QC_SET_BASELINE_TOOL,
      { ...base, series: 'qubit 4' },
      context(),
    )

    expect(built.ok).toBe(false)
  })

  it('acknowledges every open breach with the note', async () => {
    const built = await buildQcProposal(
      QC_ACKNOWLEDGE_TOOL,
      { ...base, series: 'qubit 4', note: 'Lamp replaced', exclude: true },
      context([
        { id: 'p1', value: 120, at: '2026-11-01', violations: ['1-3s'] },
        { id: 'p2', value: 119, at: '2026-11-02', violations: ['2-2s'] },
      ]),
    )

    expect(built.ok && built.proposal.action).toEqual({
      kind: 'qc.acknowledge',
      pointIds: ['p1', 'p2'],
      note: 'Lamp replaced',
      exclude: true,
    })
  })

  it('has nothing to acknowledge when no breach is open', async () => {
    const built = await buildQcProposal(
      QC_ACKNOWLEDGE_TOOL,
      { ...base, series: 'qubit 4', note: 'ok' },
      context([]),
    )

    expect(built.ok).toBe(false)
  })
})
