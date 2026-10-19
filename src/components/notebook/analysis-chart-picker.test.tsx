import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AnalysisChartPicker } from './analysis-chart-picker'

const mocks = vi.hoisted(() => ({
  views: vi.fn(),
  compose: vi.fn(),
}))

vi.mock('#/lib/analysis-studio-data', () => ({
  analysisStudioDataClient: {},
  fetchAnalysisViews: (...a: unknown[]) => mocks.views(...a),
}))
vi.mock('#/lib/analysis-definitions-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analysisDefinitionsDataClient: {},
  composeAnalysisDefinition: (...a: unknown[]) => mocks.compose(...a),
}))

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
    mocks.views.mockResolvedValue([{ id: 'v1', name: 'Dose response' }])
    mocks.compose.mockResolvedValue({
      id: 'd2',
      name: 'Recovery with Dose response',
    })
    const onComposed = mount({ id: 'd1', name: 'Recovery' })
    await screen.findByRole('option', { name: 'Dose response' })
    await user.selectOptions(screen.getByLabelText('Saved chart'), 'v1')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    await waitFor(() => expect(onComposed).toHaveBeenCalled())
    expect(mocks.compose).toHaveBeenCalledWith(
      {},
      {
        chartViewId: 'v1',
        statisticDefinitionId: 'd1',
        name: 'Recovery with Dose response',
      },
    )
  })

  it('uses the chart on its own when there is no statistic', async () => {
    const user = userEvent.setup()
    mocks.views.mockResolvedValue([{ id: 'v1', name: 'Dose response' }])
    mocks.compose.mockResolvedValue({ id: 'd2', name: 'Dose response' })
    mount(null)
    await screen.findByRole('option', { name: 'Dose response' })
    await user.selectOptions(screen.getByLabelText('Saved chart'), 'v1')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    await waitFor(() =>
      expect(mocks.compose.mock.calls[0][1]).toMatchObject({
        statisticDefinitionId: null,
        name: 'Dose response',
      }),
    )
  })

  it('says where to build a chart when none is saved, and names a refusal', async () => {
    const user = userEvent.setup()
    mocks.views.mockResolvedValue([])
    mount(null)
    expect(
      await screen.findByRole('option', { name: /No saved charts/ }),
    ).toBeTruthy()
    cleanup()

    mocks.views.mockResolvedValue([{ id: 'v1', name: 'Other data' }])
    mocks.compose.mockRejectedValue(
      new Error('the chart must read the dataset the analysis reads'),
    )
    mount({ id: 'd1', name: 'Recovery' })
    await screen.findByRole('option', { name: 'Other data' })
    await user.selectOptions(screen.getByLabelText('Saved chart'), 'v1')
    await user.click(screen.getByRole('button', { name: 'Add chart' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/must read the dataset/)).toBeTruthy()
  })
})
