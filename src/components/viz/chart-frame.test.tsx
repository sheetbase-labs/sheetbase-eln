import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ChartFrame } from './chart-frame'

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('ChartFrame', () => {
  it('renders the title, subtitle and live badge', () => {
    render(
      <ChartFrame title="Assay trend" subtitle="Vector genome copy number">
        <svg />
      </ChartFrame>,
    )
    expect(screen.getByText('Assay trend')).toBeTruthy()
    expect(screen.getByText('Vector genome copy number')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('renders a snapshot badge when mode=snapshot', () => {
    render(
      <ChartFrame title="Trend" mode="snapshot">
        <svg />
      </ChartFrame>,
    )
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('exposes the alt text as an sr-only description associated with the figure', () => {
    render(
      <ChartFrame
        title="Trend"
        alt="Line chart of copy number over 14 days, lot A rising from 1e6 to 1e8."
      >
        <svg />
      </ChartFrame>,
    )
    expect(
      screen.getByText(
        'Line chart of copy number over 14 days, lot A rising from 1e6 to 1e8.',
      ),
    ).toBeTruthy()
    const figure = screen.getByRole('figure')
    expect(figure.tagName).toBe('FIGURE')
  })

  it('renders provenance and legend', () => {
    render(
      <ChartFrame
        title="Trend"
        provenance="Source: Stability assay · 2025-07-14"
        legend={<span>lot A</span>}
      >
        <svg />
      </ChartFrame>,
    )
    expect(screen.getByText(/Source: Stability assay/)).toBeTruthy()
    expect(screen.getByText('lot A')).toBeTruthy()
  })

  it('renders a loading state and no chart content', () => {
    render(
      <ChartFrame title="Trend" loading>
        <svg data-testid="chart" />
      </ChartFrame>,
    )
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })
})
