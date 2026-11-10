import { describe, expect, it } from 'vitest'

import type { ChartSpec } from './chart-spec'
import { createDataClient } from './data-client'
import {
  describeAnalysisChange,
  listAnalysisVersions,
} from './analysis-versions'

/** A chart the schema accepts, distinguished only by its spec version. */
const savedChart: ChartSpec = {
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: '3f2b8f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b' }],
  fields: {
    x: { fieldId: 'c1' },
    y: { fieldId: 'c2' },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: {
      x: { label: 'Time', scale: 'linear' },
      y: { label: 'Titre', scale: 'linear' },
    },
    series: [],
  },
  overlays: { errorBars: null },
}

const chart = (n: number) => ({ ...savedChart, specVersion: n })

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
    const urls: URL[] = []

    const client = createDataClient(async (input, init) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(new URL(input, 'http://app.test'), init)

      urls.push(new URL(request.url))

      return Response.json([])
    })

    await listAnalysisVersions(client, 'v 1')
    expect(urls[0]?.pathname).toBe('/api/db/analysis_view_versions')
    expect(urls[0]?.search).toContain('view_id=eq.v%201')
    expect(urls[0]?.search).toContain('order=version.desc')
  })
})
