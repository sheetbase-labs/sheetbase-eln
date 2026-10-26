import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { saveTrailEvidence, trailEvidenceSteps } from './trail-evidence'

describe('trailEvidenceSteps', () => {
  const now = new Date('2026-10-26T10:00:00Z')

  it('lists the pages visited, oldest first, ending at the current page', () => {
    const steps = trailEvidenceSteps(
      [
        {
          href: '/datasets',
          title: 'Datasets',
          leftAt: '2026-10-26T09:30:00.000Z',
        },
      ],
      { href: '/datasets/DS-0311', title: 'DS-0311', identifier: 'DS-0311' },
      now,
    )
    expect(steps).toEqual([
      { href: '/datasets', title: 'Datasets', at: '2026-10-26T09:30:00.000Z' },
      {
        href: '/datasets/DS-0311',
        title: 'DS-0311',
        identifier: 'DS-0311',
        at: '2026-10-26T10:00:00.000Z',
      },
    ])
  })

  it('drops an address outside the app', () => {
    const steps = trailEvidenceSteps(
      [{ href: 'https://elsewhere.example', title: 'x' }],
      { href: '/experiments', title: 'Experiments' },
      now,
    )
    expect(steps.map((step) => step.href)).toEqual(['/experiments'])
  })
})

describe('saveTrailEvidence', () => {
  it('calls the single server procedure', async () => {
    const rpc = vi.fn(async () => ({ id: 't1' }))
    await saveTrailEvidence({ rpc } as unknown as DataClient, {
      recordId: 'r1',
      steps: [{ href: '/a', title: 'A', at: '2026-10-26T10:00:00Z' }],
      note: 'why',
    })
    expect(rpc).toHaveBeenCalledWith('save_trail_evidence', {
      p_record_id: 'r1',
      p_steps: [{ href: '/a', title: 'A', at: '2026-10-26T10:00:00Z' }],
      p_note: 'why',
    })
  })
})
