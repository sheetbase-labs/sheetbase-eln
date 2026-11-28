import { describe, expect, it } from 'vitest'
import { statusTone, statusWord } from './status-words'

describe('statusWord', () => {
  it('never shows a stored key', () => {
    expect(statusWord('active')).toBe('Active')
    expect(statusWord('in_review')).toBe('In review')
    expect(statusWord('under-review')).toBe('In review')
    expect(statusWord('on_hold')).toBe('On hold')
    expect(statusWord('awaiting_qc_sign_off')).toBe('Awaiting qc sign off')
    expect(statusWord(null)).toBe('—')
  })

  it('gives every status a ring', () => {
    expect(statusTone('approved')).toBe('ok')
    expect(statusTone('in_review')).toBe('review')
    expect(statusTone('failed')).toBe('bad')
    expect(statusTone('something_new')).toBe('none')
  })
})
