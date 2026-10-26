import { describe, expect, it, vi } from 'vitest'

import type { ChartSpec } from './chart-spec'
import type { DataClient } from './data-client'
import {
  describeAnalysisChange,
  listAnalysisVersions,
} from './analysis-versions'

const chart = (n: number) => ({ specVersion: n }) as unknown as ChartSpec

describe('describeAnalysisChange', () => {
  it('names added, removed and changed charts', () => {
    expect(describeAnalysisChange([chart(1)], [chart(1), chart(2)])).toBe(
      'Added 1 chart (now 2)',
    )
    expect(describeAnalysisChange([chart(1), chart(2)], [chart(1)])).toBe(
      'Removed 1 chart (now 1)',
    )
    expect(
      describeAnalysisChange([chart(1), chart(2)], [chart(1), chart(3)]),
    ).toBe('Changed chart 2')
    expect(describeAnalysisChange([chart(1)], [chart(1)])).toBe(
      'Re-saved, charts unchanged',
    )
    expect(describeAnalysisChange(null, [chart(1), chart(2)])).toBe(
      '2 charts saved',
    )
  })
})

describe('listAnalysisVersions', () => {
  it('reads the newest first', async () => {
    const list = vi.fn(async (_table: string, _query: string) => [])
    await listAnalysisVersions({ list } as unknown as DataClient, 'v 1')
    expect(list.mock.calls[0]?.[0]).toBe('analysis_view_versions')
    expect(list.mock.calls[0]?.[1]).toContain('view_id=eq.v%201')
    expect(list.mock.calls[0]?.[1]).toContain('order=version.desc')
  })
})
