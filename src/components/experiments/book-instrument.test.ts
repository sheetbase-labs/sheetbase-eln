import { describe, expect, it } from 'vitest'

import { bookInstrumentLink } from './book-instrument'

describe('bookInstrumentLink', () => {
  it('opens the schedule booking form for this experiment and returns to it', () => {
    expect(bookInstrumentLink('exp-1')).toEqual({
      to: '/schedule',
      search: { experiment: 'exp-1', returnTo: '/experiments/exp-1' },
    })
  })
})
