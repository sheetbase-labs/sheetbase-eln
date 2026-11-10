import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FigureControls } from './figure-controls'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'

afterEach(cleanup)

const spec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'scatter',
  datasets: [{ datasetId: '11111111-1111-4111-8111-111111111111' }],
  fields: {
    x: { fieldId: '22222222-2222-4222-8222-222222222222' },
    y: { fieldId: '33333333-3333-4333-8333-333333333333' },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  overlays: { errorBars: null },
  display: {
    axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
    series: [],
  },
}

describe('FigureControls', () => {
  it('writes an axis title, unit and range into the spec', () => {
    const onChange = vi.fn<(next: ChartSpec) => void>()
    render(<FigureControls spec={spec} onSpecChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Y-axis title'), {
      target: { value: 'OD600' },
    })
    expect(onChange.mock.calls[0][0].display.axes.y.label).toBe('OD600')
    fireEvent.change(screen.getByLabelText('X-axis unit'), {
      target: { value: 'h' },
    })
    expect(onChange.mock.calls[1][0].display.axes.x.unit).toBe('h')
    fireEvent.change(screen.getByLabelText('Y maximum'), {
      target: { value: '2' },
    })
    expect(onChange.mock.calls[2][0].display.axes.y.max).toBe(2)
  })

  it('writes the legend and caption and flags an impossible range', () => {
    const onChange = vi.fn<(next: ChartSpec) => void>()

    const { rerender } = render(
      <FigureControls spec={spec} onSpecChange={onChange} />,
    )

    fireEvent.change(screen.getByLabelText('Legend position'), {
      target: { value: 'bottom' },
    })
    expect(onChange.mock.calls[0][0].display.legend?.position).toBe('bottom')
    fireEvent.change(screen.getByLabelText('Caption'), {
      target: { value: 'Growth curve' },
    })
    expect(onChange.mock.calls[1][0].display.caption).toBe('Growth curve')

    const bad: ChartSpec = {
      ...spec,
      display: {
        ...spec.display,
        axes: { ...spec.display.axes, y: { scale: 'linear', min: 5, max: 1 } },
      },
    }

    rerender(<FigureControls spec={bad} onSpecChange={onChange} />)
    expect(screen.getByRole('alert').textContent).toMatch(/below the maximum/)
  })

  it('renders finite decimal bounds including zero and clears blank or non-finite input', () => {
    const onChange = vi.fn<(next: ChartSpec) => void>()

    const ranged: ChartSpec = {
      ...spec,
      display: {
        ...spec.display,
        axes: {
          x: { scale: 'linear', min: 0, max: 1.5 },
          y: { scale: 'linear', min: -2.25, max: 4 },
        },
      },
    }

    render(<FigureControls spec={ranged} onSpecChange={onChange} />)

    expect(screen.getByLabelText('X minimum')).toHaveProperty('value', '0')
    expect(screen.getByLabelText('X maximum')).toHaveProperty('value', '1.5')
    expect(screen.getByLabelText('Y minimum')).toHaveProperty('value', '-2.25')
    fireEvent.change(screen.getByLabelText('X minimum'), {
      target: { value: '' },
    })
    expect(onChange.mock.calls[0][0].display.axes.x.min).toBeUndefined()
    fireEvent.change(screen.getByLabelText('X maximum'), {
      target: { value: 'Infinity' },
    })
    expect(onChange.mock.calls[1][0].display.axes.x.max).toBeUndefined()
    expect(ranged.display.axes.x).toEqual({ scale: 'linear', min: 0, max: 1.5 })
  })
})
