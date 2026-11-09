import { describe, expect, it } from 'vitest'

import { chartRange, openBreaches, zoneOf } from './run-qc'
import type { QcPointRow } from './run-qc'

const point = (over: Partial<QcPointRow>): QcPointRow =>
  ({
    value: 10,
    z: 0,
    violations: [],
    excluded: false,
    acknowledged_at: null,
    ...over,
  }) as QcPointRow

describe('zoneOf', () => {
  it('has no zone without limits', () => {
    expect(zoneOf({ z: null, violations: [] })).toBe('none')
  })
  it('is the centre within 2 SD and a warning beyond', () => {
    expect(zoneOf({ z: 1.9, violations: [] })).toBe('centre')
    expect(zoneOf({ z: -2.4, violations: [] })).toBe('warn')
  })
  it('is out when any rule broke', () => {
    expect(zoneOf({ z: 0.2, violations: ['10x'] })).toBe('out')
  })
})

describe('chartRange', () => {
  it('spans the ±3 SD lines and ticks each SD', () => {
    const r = chartRange({ mean: 100, sd: 5 }, [point({ value: 101 })])
    expect(r.lo).toBeLessThan(85)
    expect(r.hi).toBeGreaterThan(115)
    expect(r.ticks).toEqual([85, 90, 95, 100, 105, 110, 115])
  })
  it('grows to hold a point far outside the lines', () => {
    const r = chartRange({ mean: 100, sd: 5 }, [point({ value: 140 })])
    expect(r.hi).toBeGreaterThan(140)
  })
  it('falls back to the data and never collapses', () => {
    const r = chartRange({ mean: null, sd: null }, [point({ value: 7 })])
    expect(r.hi).toBeGreaterThan(r.lo)
    expect(r.ticks).toHaveLength(3)
  })
})

describe('openBreaches', () => {
  it('keeps broken, unacknowledged, included points', () => {
    const broken = point({ violations: ['1-3s'] })

    const rows = [
      broken,
      point({ violations: ['1-3s'], acknowledged_at: '2026-11-07T00:00:00Z' }),
      point({ violations: ['1-3s'], excluded: true }),
      point({}),
    ]

    expect(openBreaches(rows)).toEqual([broken])
  })
})
