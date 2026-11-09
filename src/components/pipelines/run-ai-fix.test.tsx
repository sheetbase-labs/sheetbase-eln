import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunAiFix } from './run-ai-fix'
import type { PipelineConfig } from '#/lib/pipelines/config'

const mocks = vi.hoisted(() => ({
  usePageAi: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('#/lib/use-page-ai', () => ({ usePageAi: mocks.usePageAi }))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

vi.mock('#/lib/pipelines/data', () => ({
  createPipelineDefinitionVersion: mocks.create,
  updatePipelineDefinitionVersionDraft: mocks.update,
}))

vi.mock('#/components/ui/sonner', () => ({ toast: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

const runConfig: PipelineConfig = {
  configVersion: 1,
  parameters: [],
  inputs: [{ name: 'readings', required: true }],
  transform: { language: 'sql', statement: 'select * from readingz' },
  output: { mode: 'none', datasetLabel: 'x' },
}

const reply = JSON.stringify({
  explanation: 'The table name has a typo.',
  fix: {
    target: 'transform',
    language: 'sql',
    statement: 'select * from readings',
  },
})

function ai(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    live: true,
    workspaceId: 'ws-1',
    run: vi.fn().mockResolvedValue({ status: 'ok', text: reply }),
    ...overrides,
  }
}

function view(draft?: {
  id: string
  revision: number
  configuration: Record<string, unknown>
}) {
  const client = new QueryClient()

  return render(
    <QueryClientProvider client={client}>
      <RunAiFix
        pipelineId="p-1"
        errorCode="transform_failed"
        errorMessage="relation does not exist"
        logLines={['relation "readingz" does not exist']}
        failedStep="transform"
        runConfig={runConfig}
        draft={draft as never}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RunAiFix', () => {
  it('renders nothing when AI is off or only the built-in model is connected', () => {
    mocks.usePageAi.mockReturnValue(ai({ available: false, live: false }))
    expect(view().container.innerHTML).toBe('')
    cleanup()
    mocks.usePageAi.mockReturnValue(ai({ live: false }))
    expect(view().container.innerHTML).toBe('')
  })

  it('explains, then Apply creates a draft when none exists', async () => {
    mocks.usePageAi.mockReturnValue(ai())
    mocks.create.mockResolvedValue({})
    view()
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    expect(await screen.findByText('The table name has a typo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    const call = mocks.create.mock.calls[0]?.[1]
    expect(call.definitionId).toBe('p-1')
    expect(call.configuration.transform.statement).toBe(
      'select * from readings',
    )
    expect(mocks.update).not.toHaveBeenCalled()
    expect(await screen.findByText(/nothing is published/i)).toBeTruthy()
  })

  it('Apply updates the existing draft with its revision', async () => {
    mocks.usePageAi.mockReturnValue(ai())
    mocks.update.mockResolvedValue({})
    view({ id: 'd-1', revision: 3, configuration: runConfig as never })
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    await screen.findByText('The table name has a typo.')
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({
      versionId: 'd-1',
      expectedRevision: 3,
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('Dismiss removes the card without writing', async () => {
    mocks.usePageAi.mockReturnValue(ai())
    const { container } = view()
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    await screen.findByText('The table name has a typo.')
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container.innerHTML).toBe('')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('shows a failure and lets the person ask again', async () => {
    mocks.usePageAi.mockReturnValue(
      ai({
        run: vi.fn().mockResolvedValue({ status: 'error', message: 'down' }),
      }),
    )
    view()
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('down')
    expect(screen.getByRole('button', { name: /ask again/i })).toBeTruthy()
  })
})
