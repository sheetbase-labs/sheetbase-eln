import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { parseExtensionManifest } from '#/lib/extensions/manifest'
import { ExtensionAnalysisSection } from './extension-analysis'
import {
  buildExtensionChart,
  extensionAnalysisNumber,
  readExtensionAnalysisResult,
} from './extension-analysis-result'
import type { ExtensionAnalysisOutcome } from './extension-analysis-result'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const dataset: CanonicalDatasetSource = {
  datasetId: 'dataset-1',
  workspaceId: 'workspace-1',
  name: 'Readings',
  schemaVersionId: 'schema-1',
  schemaVersionNumber: 1,
  revision: 4,
  columns: [
    { id: 'reading', label: 'Reading', logicalType: 'decimal', unit: null },
  ],
}

const result: ExtensionAnalysisOutcome = {
  columns: [{ name: 'value', type: 'number' }],
  rows: [{ value: 0 }, { value: 0 }, { value: null }],
  chart: null,
  durationMs: 12,
}

function renderRunner(responses: Response[]) {
  const manifest = parseExtensionManifest({
    id: 'acme.statistics',
    name: 'Statistics',
    version: '1.0.0',
    source: 'https://plugins.example/statistics.tgz',
    capabilities: [],
    scopes: ['datasets:read'],
    contributions: {
      'analysis-kinds': [
        {
          id: 'summarise',
          title: 'Summarise',
          inputs: [
            { name: 'input', label: 'Input', type: 'number', required: true },
          ],
          runner: { kind: 'python', entry: 'stats:summarise' },
          result: { columns: result.columns },
        },
      ],
    },
  })

  const bodies: Array<{
    kind: 'analysis'
    rows: Array<{ input: number | null }>
  }> = []

  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    ).pathname

    if (path === '/api/db/extensions' && init?.method === 'GET') {
      return Response.json([
        {
          id: 'extension-1',
          key: 'statistics',
          name: 'Statistics',
          status: 'enabled',
          manifest,
          disabled_points: [],
        },
      ])
    }

    if (path === '/api/plugins/run' && init?.method === 'POST') {
      bodies.push(
        z
          .object({
            kind: z.literal('analysis'),
            rows: z.array(z.object({ input: z.number().nullable() })),
          })
          .parse(JSON.parse(z.string().parse(init.body))),
      )
      const response = responses.shift()

      if (!response) throw new Error('Unexpected extra runner request')

      return response
    }

    throw new Error(`Unexpected ${init?.method} ${path}`)
  }

  vi.stubGlobal('fetch', fetcher)

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <ExtensionAnalysisSection
        dataset={dataset}
        rows={[{ reading: ' 2.5 ' }, { reading: '' }, { reading: 0 }]}
        truncated={false}
        dataClient={createDataClient(fetcher)}
      />
    </QueryClientProvider>,
  )

  return { bodies, user: userEvent.setup() }
}

describe('extension calculation result boundary', () => {
  it('preserves finite numeric conversion without coercing blank, null or booleans', () => {
    expect(
      [' 2.5 ', 0, -4, '', ' ', 'Infinity', null, true, undefined].map(
        extensionAnalysisNumber,
      ),
    ).toEqual([2.5, 0, -4, null, null, null, null, null, null])
  })

  it('retains declared chart grouping, categorical positions and zero values', () => {
    const built = buildExtensionChart({
      ...result,
      columns: [
        { name: 'label', type: 'text' },
        { name: 'value', type: 'number' },
        { name: 'group', type: 'text' },
      ],
      rows: [
        { label: 'A', value: 0, group: 'first' },
        { label: 'B', value: 7, group: 'second' },
        { label: 'C', value: 2, group: 'first' },
      ],
      chart: { type: 'bar', x: 'label', y: 'value', group: 'group' },
    })

    expect(
      built?.materialised.series.map(({ identifier, points }) => ({
        identifier,
        points,
      })),
    ).toEqual([
      {
        identifier: 'first',
        points: [
          { x: 1, y: 0, yError: null, label: 'A' },
          { x: 2, y: 2, yError: null, label: 'C' },
        ],
      },
      {
        identifier: 'second',
        points: [{ x: 1, y: 7, yError: null, label: 'B' }],
      },
    ])
  })

  it('rejects malformed successful responses and preserves HTTP refusal text', async () => {
    await expect(
      readExtensionAnalysisResult(
        Response.json({ ...result, rows: [{ value: {} }] }),
      ),
    ).rejects.toThrow()
    await expect(
      readExtensionAnalysisResult(
        Response.json({ error: 'Runner unavailable' }, { status: 503 }),
      ),
    ).rejects.toThrow('Runner unavailable')
  })

  it('renders duplicate rows and replaces the entire ephemeral result on a second run', async () => {
    const { bodies, user } = renderRunner([
      Response.json(result),
      Response.json({ ...result, rows: [{ value: 19 }] }),
    ])

    await user.click(await screen.findByRole('button', { name: 'Summarise' }))
    await user.selectOptions(screen.getByLabelText('Input'), 'reading')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    const first = await screen.findByRole('table', { name: 'Summarise' })
    expect(within(first).getAllByRole('row')).toHaveLength(4)
    expect(within(first).getAllByText('0')).toHaveLength(2)
    expect(within(first).getByText('—')).toBeTruthy()
    expect(bodies).toEqual([
      {
        kind: 'analysis',
        rows: [{ input: 2.5 }, { input: null }, { input: 0 }],
      },
    ])

    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(await within(first).findByText('19')).toBeTruthy()
    expect(within(first).getAllByRole('row')).toHaveLength(2)
    expect(within(first).queryByText('0')).toBeNull()
  })

  it('renders an HTTP refusal instead of a plausible result table', async () => {
    const { user } = renderRunner([
      Response.json({ error: 'Runner unavailable' }, { status: 503 }),
    ])

    await user.click(await screen.findByRole('button', { name: 'Summarise' }))
    await user.selectOptions(screen.getByLabelText('Input'), 'reading')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Runner unavailable',
    )
    expect(screen.queryByRole('table')).toBeNull()
  })
})
