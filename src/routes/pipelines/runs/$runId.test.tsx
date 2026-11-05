import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$runId'

const pipelines = vi.hoisted(() => ({
  usePipelineIdForRun: vi.fn(),
}))

vi.mock('#/components/pipelines/pipelines-data', () => pipelines)

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
      refetch: vi.fn(),
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
      data: null,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<RunRedirect />)

    expect(screen.getByText('Run not found')).toBeTruthy()
    expect(screen.getByText('This run wasn’t found.')).toBeTruthy()
    expect(
      screen.getByText('Back to pipelines').closest('a')?.getAttribute('href'),
    ).toBe('/pipelines')
  })

  it('reports a failed lookup and offers a retry', () => {
    const refetch = vi.fn()
    pipelines.usePipelineIdForRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('The run could not be read.'),
      refetch,
    })
    render(<RunRedirect />)

    expect(screen.getByText('Run unavailable')).toBeTruthy()
    expect(screen.getByText('Couldn’t load run.')).toBeTruthy()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalled()
  })
})
