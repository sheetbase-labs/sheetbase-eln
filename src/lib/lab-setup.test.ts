import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import { fetchLabSetupSkipped, skipLabSetup } from './lab-setup'

const WS = '00000000-0000-4000-8000-0000000003a1'

function clientReturning(rows: unknown[]) {
  return Object.assign(createDataClient(), {
    list: vi.fn(async () => rows),
    rpc: vi.fn(async () => null),
  })
}

describe('fetchLabSetupSkipped', () => {
  it('is true when this person skipped setup for the workspace', async () => {
    const client = clientReturning([
      { preferences: { labSetupSkipped: { [WS]: true } } },
    ])

    expect(await fetchLabSetupSkipped(client, WS)).toBe(true)
  })

  it('is false for another workspace, an empty row or no row', async () => {
    const other = clientReturning([
      { preferences: { labSetupSkipped: { 'other-ws': true } } },
    ])

    expect(await fetchLabSetupSkipped(other, WS)).toBe(false)
    expect(
      await fetchLabSetupSkipped(clientReturning([{ preferences: {} }]), WS),
    ).toBe(false)
    expect(await fetchLabSetupSkipped(clientReturning([]), WS)).toBe(false)
  })
})

describe('skipLabSetup', () => {
  it('records the skip through the RPC', async () => {
    const client = clientReturning([])
    await skipLabSetup(client, WS)
    expect(client.rpc).toHaveBeenCalledWith('skip_lab_setup', {
      p_workspace_id: WS,
    })
  })
})
