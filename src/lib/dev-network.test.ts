import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearDevRequests,
  devFetch,
  noSimulation,
  parseNetworkSettings,
  setDevNetwork,
  setDevNetworkActive,
  summariseRequests,
} from './dev-network'

afterEach(() => {
  setDevNetworkActive(false)
  setDevNetwork(noSimulation)
  clearDevRequests()
})

describe('parseNetworkSettings', () => {
  it('falls back to no simulation for bad input', () => {
    expect(parseNetworkSettings(null)).toEqual(noSimulation)
    expect(parseNetworkSettings('{nope')).toEqual(noSimulation)
    expect(parseNetworkSettings('{"latencyMs":-5,"failRate":3}')).toEqual(
      noSimulation,
    )
  })
})

describe('summariseRequests', () => {
  it('counts failures and averages timings', () => {
    const base = { method: 'GET', path: '/x', simulated: false }
    expect(
      summariseRequests([
        { id: 1, status: 200, ms: 100, ...base },
        { id: 2, status: 503, ms: 300, ...base },
      ]),
    ).toEqual({ count: 2, failed: 1, averageMs: 200, slowestMs: 300 })
  })
})

describe('devFetch', () => {
  const ok = () => Promise.resolve(new Response('[]', { status: 200 }))

  it('is a pass-through while the toolbar is inactive', async () => {
    const fetchImpl = vi.fn(ok)
    setDevNetwork({ offline: true })
    const response = await devFetch(fetchImpl, '/api/db/x', {})
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails every request while offline', async () => {
    const fetchImpl = vi.fn(ok)
    setDevNetworkActive(true)
    setDevNetwork({ offline: true })
    await expect(devFetch(fetchImpl, '/api/db/x', {})).rejects.toBeInstanceOf(
      TypeError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('answers a simulated failure with a 503 and never reaches the server', async () => {
    const fetchImpl = vi.fn(ok)
    setDevNetworkActive(true)
    setDevNetwork({ failRate: 1 })
    const response = await devFetch(fetchImpl, '/api/db/x', {})
    expect(response.status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
