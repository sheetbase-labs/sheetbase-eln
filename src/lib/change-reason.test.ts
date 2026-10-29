import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CHANGE_REASON_WINDOW_MS,
  askForChangeReason,
  forgetChangeReason,
  registerChangeReasonAsker,
  rememberChangeReason,
  rememberedChangeReason,
} from './change-reason'

afterEach(() => {
  registerChangeReasonAsker(null)
  forgetChangeReason()
})

describe('change reason', () => {
  it('resolves nothing when nobody can ask', async () => {
    expect(await askForChangeReason()).toBeNull()
  })

  it('asks once for edits that fail together and remembers the answer', async () => {
    const asker = vi.fn(async () => '  Corrected the volume  ')
    registerChangeReasonAsker(asker)
    const [first, second] = await Promise.all([
      askForChangeReason(),
      askForChangeReason(),
    ])
    expect(first).toBe('Corrected the volume')
    expect(second).toBe('Corrected the volume')
    expect(asker).toHaveBeenCalledTimes(1)
    // Later edits are covered without another question.
    expect(await askForChangeReason()).toBe('Corrected the volume')
    expect(asker).toHaveBeenCalledTimes(1)
  })

  it('treats a cancelled or blank answer as no reason, and asks again next time', async () => {
    const asker = vi.fn(async () => null as string | null)
    registerChangeReasonAsker(asker)
    expect(await askForChangeReason()).toBeNull()
    asker.mockResolvedValueOnce('   ')
    expect(await askForChangeReason()).toBeNull()
    expect(rememberedChangeReason()).toBeNull()
    expect(asker).toHaveBeenCalledTimes(2)
  })

  it('stops covering edits after the window', () => {
    rememberChangeReason('Bench sheet', 1000)
    expect(rememberedChangeReason(1000 + CHANGE_REASON_WINDOW_MS)).toBe(
      'Bench sheet',
    )
    expect(rememberedChangeReason(1001 + CHANGE_REASON_WINDOW_MS)).toBeNull()
  })
})
