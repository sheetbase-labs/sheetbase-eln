import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FigureControls } from './figure-controls'
import type { ChartSpec } from '#/lib/chart-spec'

afterEach(cleanup)

const spec = {
  display: {
    axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
    series: [],
  },
} as unknown as ChartSpec

describe('FigureControls', () => {
  it('writes an axis title, unit and range into the spec', () => {
    const onChange = vi.fn()
    render(<FigureControls spec={spec} onSpecChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Y-axis title'), {
      target: { value: 'OD600' },
    })
    expect((onChange.mock.calls[0][0] as ChartSpec).display.axes.y.label).toBe(
      'OD600',
    )
    fireEvent.change(screen.getByLabelText('X-axis unit'), {
      target: { value: 'h' },
    })
    expect((onChange.mock.calls[1][0] as ChartSpec).display.axes.x.unit).toBe(
      'h',
    )
    fireEvent.change(screen.getByLabelText('Y maximum'), {
      target: { value: '2' },
    })
    expect((onChange.mock.calls[2][0] as ChartSpec).display.axes.y.max).toBe(2)
  })

  it('writes the legend and caption and flags an impossible range', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <FigureControls spec={spec} onSpecChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Legend position'), {
      target: { value: 'bottom' },
    })
    expect(
      (onChange.mock.calls[0][0] as ChartSpec).display.legend?.position,
    ).toBe('bottom')
    fireEvent.change(screen.getByLabelText('Caption'), {
      target: { value: 'Growth curve' },
    })
    expect((onChange.mock.calls[1][0] as ChartSpec).display.caption).toBe(
      'Growth curve',
    )
    const bad = {
      display: {
        ...spec.display,
        axes: { ...spec.display.axes, y: { scale: 'linear', min: 5, max: 1 } },
      },
    } as unknown as ChartSpec
    rerender(<FigureControls spec={bad} onSpecChange={onChange} />)
    expect(screen.getByRole('alert').textContent).toMatch(/below the maximum/)
  })
})
