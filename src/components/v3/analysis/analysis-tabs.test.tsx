import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChartSpec } from '#/lib/chart-spec'
import { AnalysisTabs } from './analysis-document'

const chart = (n: number) =>
  ({
    specVersion: n,
    type: 'line',
    datasets: [],
    fields: { y: { fieldId: 'y' } },
    filters: [],
    transformations: [],
    typeParams: {},
    display: { axes: { x: {}, y: { label: 'Y' } }, series: [] },
    overlays: { errorBars: null },
  }) as unknown as ChartSpec

afterEach(cleanup)

describe('AnalysisTabs versions', () => {
  it('lists earlier saves and restores one', () => {
    const onRestore = vi.fn()
    render(
      <AnalysisTabs
        charts={[chart(1), chart(2)]}
        dataset={null}
        diagnostics={null}
        version={3}
        updatedAt="2026-10-26T10:00:00Z"
        earlier={[
          { version: 2, charts: [chart(1)], saved_at: '2026-10-25T09:00:00Z' },
          { version: 1, charts: [chart(1)], saved_at: '2026-10-24T09:00:00Z' },
        ]}
        onRestore={onRestore}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Versions/ }))
    expect(screen.getByText('Added 1 chart (now 2)')).toBeTruthy()
    expect(screen.getByText('Saved 25 Oct 2026')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Restore as new version')[0])
    expect(onRestore).toHaveBeenCalledWith([chart(1)])
  })

  it('says when nothing earlier is kept yet', () => {
    render(
      <AnalysisTabs
        charts={[chart(1)]}
        dataset={null}
        diagnostics={null}
        version={1}
        updatedAt="2026-10-26T10:00:00Z"
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Versions/ }))
    expect(screen.getByText(/No earlier saves yet/)).toBeTruthy()
  })
})
