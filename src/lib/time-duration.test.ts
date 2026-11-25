import { describe, expect, it } from 'vitest'

import {
  coerceTimeOrDurationInput,
  displayTimeOrDuration,
  formatDuration,
  formatTimeOfDay,
  parseDuration,
  parseTimeOfDay,
} from './time-duration'

describe('time of day', () => {
  it.each([
    ['9:10', '09:10:00'],
    ['09:10', '09:10:00'],
    [' 23:59:59 ', '23:59:59'],
    ['00:00', '00:00:00'],
    ['2:05 pm', '14:05:00'],
    ['12:00am', '00:00:00'],
    ['12 pm', '12:00:00'],
  ])('reads %s as %s', (input, stored) => {
    expect(parseTimeOfDay(input)).toBe(stored)
  })

  it.each(['09:010', '24:00', '9', '9.30', '13:60', '13:00 pm', 'noon', ''])(
    'refuses %s',
    (input) => {
      expect(parseTimeOfDay(input)).toBeNull()
    },
  )

  it('shows whole minutes without seconds', () => {
    expect(formatTimeOfDay('09:10:00')).toBe('09:10')
    expect(formatTimeOfDay('09:10:30')).toBe('09:10:30')
  })
})

describe('duration', () => {
  it.each([
    ['2 h 30 min', 9000],
    ['2h30m', 9000],
    ['90 min', 5400],
    ['1.5 h', 5400],
    ['45 s', 45],
    ['10 sec', 10],
    ['1 d 2 h', 93_600],
    ['2 hours, 5 minutes', 7500],
    ['500 ms', 0.5],
    ['1:30', 5400],
    ['0:00:45', 45],
    ['PT2H30M', 9000],
    ['P1D', 86_400],
  ])('reads %s as %d seconds', (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds)
  })

  it.each(['90', '-5 min', '2 parsecs', 'h', 'PT', '', 'two hours'])(
    'refuses %s',
    (input) => {
      expect(parseDuration(input)).toBeNull()
    },
  )

  it('takes stored seconds as they are, zero or more', () => {
    expect(parseDuration(90)).toBe(90)
    expect(parseDuration(0)).toBe(0)
    expect(parseDuration(-1)).toBeNull()
    expect(parseDuration(Number.NaN)).toBeNull()
  })

  it.each([
    [0, '0 s'],
    [45, '45 s'],
    [600, '10 min'],
    [9000, '2 h 30 min'],
    [93_690, '1 d 2 h 1 min 30 s'],
    [0.5, '0.5 s'],
  ])('shows %d seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text)
  })

  it('reads back what it shows', () => {
    for (const seconds of [45, 600, 9000, 93_690])
      expect(parseDuration(formatDuration(seconds))).toBe(seconds)
  })
})

describe('typed input', () => {
  it('turns typed text into the stored value and leaves the rest for validation', () => {
    expect(coerceTimeOrDurationInput('time', '9:5')).toBe('9:5')
    expect(coerceTimeOrDurationInput('time', '9:05')).toBe('09:05:00')
    expect(coerceTimeOrDurationInput('duration', '10 min')).toBe(600)
    expect(coerceTimeOrDurationInput('duration', '10')).toBe('10')
    expect(coerceTimeOrDurationInput('duration', 30)).toBe(30)
  })

  it('shows stored values the way people read them', () => {
    expect(displayTimeOrDuration('time', '14:05:00')).toBe('14:05')
    expect(displayTimeOrDuration('duration', 5400)).toBe('1 h 30 min')
    expect(displayTimeOrDuration('duration', null)).toBe('')
  })
})
