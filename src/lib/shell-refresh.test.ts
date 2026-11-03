import { describe, expect, it, vi } from 'vitest'

import { registerShellRefresh, requestShellRefresh } from './shell-refresh'

describe('shell refresh', () => {
  it('reaches the host that registered, until it unregisters', () => {
    const refresh = vi.fn()
    const stop = registerShellRefresh(refresh)
    requestShellRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
    requestShellRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
