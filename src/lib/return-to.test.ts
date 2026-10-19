import { describe, expect, it } from 'vitest'

import {
  reopenTaskFromSearch,
  reopenTaskOf,
  returnLabel,
  withReopen,
} from './return-to'

describe('withReopen', () => {
  it('adds the task to a path', () => {
    expect(withReopen('/records/r1', 'submit')).toBe(
      '/records/r1?reopen=submit',
    )
  })

  it('keeps the search the path already has and replaces an earlier task', () => {
    expect(withReopen('/records/r1?tab=notes&reopen=sign', 'submit')).toBe(
      '/records/r1?tab=notes&reopen=submit',
    )
  })
})

describe('reopenTaskFromSearch', () => {
  it('reads only the tasks a page can reopen', () => {
    expect(reopenTaskFromSearch({ reopen: 'submit' })).toBe('submit')
    expect(reopenTaskFromSearch({ reopen: 'sign' })).toBe('sign')
    expect(reopenTaskFromSearch({ reopen: 'delete' })).toBeUndefined()
    expect(reopenTaskFromSearch(undefined)).toBeUndefined()
  })
})

describe('reopenTaskOf and returnLabel', () => {
  it('names the way back after the task that was left', () => {
    expect(reopenTaskOf('/records/r1?reopen=submit')).toBe('submit')
    expect(returnLabel('/records/r1?reopen=submit')).toBe('Back to Submit')
    expect(returnLabel('/records/r1?reopen=sign')).toBe('Back to Sign')
  })

  it('falls back to a plain label, and ignores a path that leaves the app', () => {
    expect(returnLabel('/models')).toBe('Back to what you were doing')
    expect(reopenTaskOf('https://example.com/?reopen=submit')).toBeNull()
    expect(reopenTaskOf(undefined)).toBeNull()
  })
})
