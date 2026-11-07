import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CampaignRow } from './campaign'

const baybe = vi.hoisted(() => ({
  version: vi.fn<() => Promise<string | null>>(),
  propose: vi.fn(),
}))

vi.mock('#/db/pool.server', () => ({ PooledClient: class {} }))
vi.mock('#/env.server', () => ({ env: {} }))
vi.mock('./baybe.server', () => {
  class BaybeUnavailableError extends Error {}
  return {
    BaybeUnavailableError,
    baybeVersion: baybe.version,
    proposeWithBaybe: baybe.propose,
  }
})

const { proposeForCampaign } = await import('./round-requests.server')
const { BaybeUnavailableError } = await import('./baybe.server')

function campaign(engine: CampaignRow['engine']): CampaignRow {
  return {
    engine,
    factors: [
      { key: 'temp', label: 'Temp', kind: 'continuous', min: 20, max: 40 },
    ],
    objectives: [{ key: 'y', label: 'Y', direction: 'maximise' }],
  } as unknown as CampaignRow
}
const ask = (engine: CampaignRow['engine']) =>
  proposeForCampaign({
    campaign: campaign(engine),
    observations: [],
    batchSize: 3,
    seed: 1,
  })

describe('proposeForCampaign', () => {
  beforeEach(() => {
    baybe.version.mockReset()
    baybe.propose.mockReset()
  })

  it('uses the built-in optimiser when asked to, without touching BayBE', async () => {
    const out = await ask('builtin')
    expect(out).toMatchObject({ engine: 'builtin', version: '1' })
    expect(out.trials).toHaveLength(3)
    expect(baybe.version).not.toHaveBeenCalled()
  })

  it('falls back to the built-in optimiser on auto when the runtime has no BayBE', async () => {
    baybe.version.mockResolvedValue(null)
    expect((await ask('auto')).engine).toBe('builtin')
    expect(baybe.propose).not.toHaveBeenCalled()
  })

  it('uses BayBE on auto when the runtime has it and records its version and image', async () => {
    baybe.version.mockResolvedValue('0.15.0')
    baybe.propose.mockResolvedValue({
      trials: [{ temp: 21 }],
      strategy: 'initial',
      version: '0.15.0',
      runtime: 'sha256:abc',
    })
    expect(await ask('auto')).toMatchObject({
      engine: 'baybe',
      version: '0.15.0',
      digest: 'sha256:abc',
    })
  })

  it('refuses, on baybe, when the runtime has none; falls back on auto when it goes missing', async () => {
    baybe.version.mockResolvedValue('0.15.0')
    baybe.propose.mockRejectedValue(new BaybeUnavailableError('gone'))
    await expect(ask('baybe')).rejects.toThrow(/not available/)
    expect((await ask('auto')).engine).toBe('builtin')
  })
})
