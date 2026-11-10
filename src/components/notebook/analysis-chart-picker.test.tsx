import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropSharedReads } from '#/lib/data-client'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'

import { choose } from '../../../tests/unit/picker'

import { AnalysisChartPicker } from './analysis-chart-picker'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let views: AnalysisViewWire[] = []
let resultName = ''
let refusal: string | null = null

function view(name: string): AnalysisViewWire {
  return {
    id: 'v1',
    workspace_id: 'ws-1',
    owner_user_id: 'u1',
    name,
    display_id: null,
    version: 1,
    charts: [],
    source_revisions: [],
    export_settings: null,
    created_at: '2026-11-09T00:00:00Z',
    updated_at: '2026-11-09T00:00:00Z',
  }
}

beforeEach(() => {
  dropSharedReads()
  views = []
  refusal = null
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/analysis_views') return Response.json(views)

    if (url.pathname !== '/api/db/rpc/compose_analysis_definition')
      throw new Error(`Unexpected request: ${url.pathname}`)

    return refusal
      ? Response.json(
          { error: { code: 'validation_error', message: refusal } },
          { status: 400 },
        )
      : Response.json({
          id: 'd2',
          workspace_id: 'ws-1',
          owner_user_id: 'u1',
          name: resultName,
          version: 1,
          definition: {},
          source_revisions: [],
          created_at: '2026-11-09T00:00:00Z',
          updated_at: '2026-11-09T00:00:00Z',
        })
  })
})

function mount(
  statistic: { id: string; name: string } | null,
  onComposed = vi.fn(),
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnalysisChartPicker statistic={statistic} onComposed={onComposed} />
    </QueryClientProvider>,
  )

  return onComposed
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AnalysisChartPicker', () => {
  it('adds a saved chart beside the chosen statistic', async () => {
    const user = userEvent.setup()
    views = [view('Dose response')]
    resultName = 'Recovery with Dose response'
    const onComposed = mount({ id: 'd1', name: 'Recovery' })
    await choose(user, /^Saved chart/, 'Dose response')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    await waitFor(() => expect(onComposed).toHaveBeenCalled())
    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/compose_analysis_definition',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_chart_view_id: 'v1',
          p_statistic_definition_id: 'd1',
          p_name: 'Recovery with Dose response',
        }),
      }),
    )
  })

  it('uses the chart on its own when there is no statistic', async () => {
    const user = userEvent.setup()
    views = [view('Dose response')]
    resultName = 'Dose response'
    mount(null)
    await choose(user, /^Saved chart/, 'Dose response')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/compose_analysis_definition',
        expect.objectContaining({
          body: JSON.stringify({
            p_chart_view_id: 'v1',
            p_statistic_definition_id: null,
            p_name: 'Dose response',
          }),
        }),
      ),
    )
  })

  it('says where to build a chart when none is saved, and names a refusal', async () => {
    const user = userEvent.setup()
    views = []
    mount(null)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Saved chart/ }).textContent,
      ).toContain('No saved charts'),
    )
    cleanup()

    dropSharedReads()
    views = [view('Other data')]
    refusal = 'the chart must read the dataset the analysis reads'
    mount({ id: 'd1', name: 'Recovery' })
    await choose(user, /^Saved chart/, 'Other data')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/must read the dataset/)).toBeTruthy()
  })
})
