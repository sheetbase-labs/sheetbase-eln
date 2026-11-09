import { describe, expect, it } from 'vitest'

import {
  feedIsLive,
  formatAgo,
  formatReadingValue,
  layoutSeries,
  seriesCsv,
} from './live-feeds-data'
import type { FeedRow, SeriesPoint } from './live-feeds-data'

const NOW = Date.parse('2026-11-05T10:00:00Z')

const point = (minutesAgo: number, avg: number, spread = 0): SeriesPoint => ({
  at: NOW - minutesAgo * 60_000,
  min: avg - spread,
  avg,
  max: avg + spread,
  readings: 10,
})

const feed: FeedRow = {
  id: 'f1',
  ownerId: 'i1',
  instrumentId: 'i1',
  storageUnitId: null,
  storageRoomId: null,
  outOfRangeSince: null,
  name: 'Chamber, rear',
  unit: '°C',
  lowLimit: null,
  highLimit: null,
  limitState: 'ok',
  lastValue: 4.1,
  lastAt: new Date(NOW - 30_000).toISOString(),
  readingCount: 40,
}

describe('formatReadingValue', () => {
  it('keeps enough digits to be useful and no more', () => {
    expect(formatReadingValue(null)).toBe('—')
    expect(formatReadingValue(4.123456)).toBe('4.123')
    expect(formatReadingValue(21.5)).toBe('21.5')
    expect(formatReadingValue(-80.2)).toBe('-80.2')
    expect(formatReadingValue(1234.567)).toBe('1,235')
    expect(formatReadingValue(0)).toBe('0')
  })
})

describe('formatAgo and feedIsLive', () => {
  it('says how long ago, and calls a feed quiet after two minutes', () => {
    expect(formatAgo(null, NOW)).toBe('—')
    expect(formatAgo(feed.lastAt, NOW)).toBe('30 s ago')
    expect(formatAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(
      '5 min ago',
    )
    expect(formatAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe(
      '3 h ago',
    )
    expect(feedIsLive(feed, NOW)).toBe(true)
    expect(
      feedIsLive({ lastAt: new Date(NOW - 5 * 60_000).toISOString() }, NOW),
    ).toBe(false)
    expect(feedIsLive({ lastAt: null }, NOW)).toBe(false)
  })
})

describe('layoutSeries', () => {
  const window = { since: NOW - 60 * 60_000, until: NOW }
  const box = { width: 600, height: 100 }

  it('puts the oldest on the left, the highest at the top and the average on the line', () => {
    const geometry = layoutSeries(
      [point(60, 1), point(30, 3), point(0, 2)],
      window,
      box,
    )

    expect(geometry.x(window.since)).toBe(0)
    expect(geometry.x(window.until)).toBe(600)
    expect(geometry.y(3)).toBeLessThan(geometry.y(1))
    expect(geometry.line.startsWith('M0.0,')).toBe(true)
    expect(layoutSeries([point(0, 2)], window, box).band).toBe('')
  })

  it('draws a band from lowest to highest once there is more than one point', () => {
    const geometry = layoutSeries(
      [point(30, 2, 1), point(0, 2, 1)],
      window,
      box,
    )

    expect(geometry.band.startsWith('M')).toBe(true)
    expect(geometry.band.endsWith('Z')).toBe(true)
  })

  it('stretches the range to include limits and copes with a flat line', () => {
    const flat = layoutSeries([point(0, 5)], window, box)
    expect(flat.yMax).toBeGreaterThan(5)
    expect(flat.yMin).toBeLessThan(5)

    const limited = layoutSeries([point(0, 5), point(5, 5)], window, box, {
      low: 0,
      high: 10,
    })

    expect(limited.yMin).toBeLessThan(0)
    expect(limited.yMax).toBeGreaterThan(10)
  })
})

describe('seriesCsv', () => {
  it('names the measurement with its unit and quotes it', () => {
    const csv = seriesCsv(feed, [point(0, 4.2, 0.1)])
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe(
      'Time,"Chamber, rear (°C) average",minimum,maximum,readings',
    )
    expect(row).toBe(`${new Date(NOW).toISOString()},4.2,4.1,4.3,10`)
  })
})
