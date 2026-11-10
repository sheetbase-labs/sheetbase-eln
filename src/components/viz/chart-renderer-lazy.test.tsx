import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MaterialisedChart } from '#/lib/chart-spec'

import { ChartRenderer } from './chart-renderer'

// The shared test setup swaps the wrapper for its implementation; this file
// checks the wrapper itself.
vi.unmock('#/components/viz/chart-renderer')

afterEach(cleanup)

const emptyChart: MaterialisedChart = {
  state: { kind: 'ok' },
  columns: [],
  rows: [],
  series: [],
  xLabel: '',
  yLabel: '',
  xUnit: undefined,
  yUnit: undefined,
  droppedPoints: 0,
}

describe('ChartRenderer (lazy wrapper)', () => {
  it('holds the plot space, then draws the chart once the renderer loads', async () => {
    const { container } = render(
      <ChartRenderer
        title="Lazy chart"
        spec={null}
        materialised={emptyChart}
        frozen={null}
        loading
        plotHeight={180}
      />,
    )

    const placeholder = container.querySelector<HTMLElement>(
      '[aria-hidden="true"]',
    )

    expect(placeholder).not.toBeNull()
    expect(placeholder?.style.height).toBe('180px')
    expect(
      await screen.findByText('Lazy chart', undefined, { timeout: 10_000 }),
    ).toBeTruthy()
  })
})
