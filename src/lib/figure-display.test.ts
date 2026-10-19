import { describe, expect, it } from 'vitest'

import {
  axisRangeProblem,
  legendShown,
  parseRangeBound,
  setAxisBound,
  setAxisTitle,
  setAxisUnit,
  setCaption,
  setLegendPosition,
  setLegendVisible,
} from './figure-display'
import type { ChartSpec } from './chart-spec'

const spec = {
  display: {
    axes: {
      x: { scale: 'linear', label: 'Time' },
      y: { scale: 'linear' },
    },
    series: [],
  },
} as unknown as ChartSpec

describe('figure display controls', () => {
  it('sets and clears an axis title and unit without touching the other axis', () => {
    const titled = setAxisTitle(spec, 'y', ' OD600 ')
    expect(titled.display.axes.y.label).toBe('OD600')
    expect(titled.display.axes.x.label).toBe('Time')
    expect(setAxisTitle(titled, 'y', '  ').display.axes.y.label).toBeUndefined()
    expect(setAxisUnit(spec, 'x', 'h').display.axes.x.unit).toBe('h')
  })

  it('reads a range bound only from a finite number', () => {
    expect(parseRangeBound('1.5')).toBe(1.5)
    expect(parseRangeBound('')).toBeUndefined()
    expect(parseRangeBound('abc')).toBeUndefined()
    expect(setAxisBound(spec, 'y', 'min', '0').display.axes.y.min).toBe(0)
    expect(
      setAxisBound(spec, 'y', 'max', 'x').display.axes.y.max,
    ).toBeUndefined()
  })

  it('names why a range cannot be drawn', () => {
    const inverted = setAxisBound(
      setAxisBound(spec, 'y', 'min', '5'),
      'y',
      'max',
      '2',
    )
    expect(axisRangeProblem(inverted, 'y')).toMatch(/minimum must be below/)
    const log = setAxisBound(
      {
        ...spec,
        display: {
          ...spec.display,
          axes: { ...spec.display.axes, y: { scale: 'log' } },
        },
      },
      'y',
      'min',
      '0',
    )
    expect(axisRangeProblem(log, 'y')).toMatch(/positive range/)
    expect(axisRangeProblem(spec, 'y')).toBeNull()
  })

  it('shows the legend unless the spec hides it', () => {
    expect(legendShown(spec)).toBe(true)
    expect(legendShown(null)).toBe(true)
    expect(legendShown(setLegendVisible(spec, false))).toBe(false)
    expect(legendShown(setLegendPosition(spec, 'hidden'))).toBe(false)
    const bottom = setLegendPosition(spec, 'bottom')
    expect(bottom.display.legend).toEqual({ visible: true, position: 'bottom' })
  })

  it('keeps a trimmed caption and drops a blank one', () => {
    expect(setCaption(spec, ' Fig 1 ').display.caption).toBe('Fig 1')
    expect(setCaption(spec, ' ').display.caption).toBeUndefined()
  })
})
