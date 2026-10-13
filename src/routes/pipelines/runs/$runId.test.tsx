import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$runId'

const pipelines = vi.hoisted(() => ({
  usePipelineIdForRun: vi.fn(),
}))

vi.mock('#/components/v3/pipelines/pipelines-data', () => pipelines)

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useParams: () => ({ runId: 'run-1' }),
  }),
  Navigate: ({
    to,
    params,
  }: {
    to: string
    params?: Record<string, string>
  }) => (
    <div
      data-testid="navigate"
      data-to={to}
      data-params={JSON.stringify(params ?? {})}
    />
  ),
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

const RunRedirect = Route.options.component as React.ComponentType

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('legacy /pipelines/runs/$runId alias', () => {
  it('forwards a resolvable run to its pipeline', () => {
    pipelines.usePipelineIdForRun.mockReturnValue({
      data: 'pipe-1',
      isLoading: false,
      isError: false,
      error: null,
    })
    render(<RunRedirect />)

    const navigate = screen.getByTestId('navigate')
    expect(navigate.dataset.to).toBe('/pipelines/$pipelineId/runs/$runId')
    expect(JSON.parse(navigate.dataset.params ?? '{}')).toEqual({
      pipelineId: 'pipe-1',
      runId: 'run-1',
    })
  })

  it('says a missing run is not found and links back to Pipelines', () => {
    pipelines.usePipelineIdForRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    })
    render(<RunRedirect />)

    expect(screen.getByText('Run not found')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Pipelines' }).getAttribute('href'),
    ).toBe('/pipelines')
  })

  it('reports a failed lookup instead of rendering nothing', () => {
    pipelines.usePipelineIdForRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('The run could not be read.'),
    })
    render(<RunRedirect />)

    expect(screen.getByText('Run unavailable')).toBeTruthy()
    expect(screen.getByText('The run could not be read.')).toBeTruthy()
  })
})
