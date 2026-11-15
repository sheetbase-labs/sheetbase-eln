import { describe, expect, it, vi } from 'vitest'

import { plainDatabaseError } from './assistant-bench'
import {
  failureMessage,
  onActionFailure,
  reportActionFailure,
} from './assistant-failure-feed'

describe('assistant failure feed', () => {
  it('tells the chat once per card', () => {
    const heard = vi.fn()
    const stop = onActionFailure(heard)
    const failure = { id: 'c1', title: 'Create', reason: 'It broke.' }

    reportActionFailure(failure)
    reportActionFailure(failure)
    stop()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(failureMessage(failure)).toContain('It broke.')
  })

  it('says a unique clash in plain words', () => {
    expect(
      plainDatabaseError(
        'duplicate key value violates unique constraint "uq_notebook_templates_workspace_key"',
      ),
    ).toBe('Something with that name or key already exists.')
  })
})
