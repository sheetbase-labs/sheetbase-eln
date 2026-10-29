/**
 * Files an instrument sent that couldn’t be read are listed with their reason,
 * and can be tried again, tried with another parser, or dismissed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IntakeClientError } from '#/lib/connectors/intake-client'
import { IntakeProblems } from './intake-problems'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  postIntake: vi.fn(),
  problems: [] as unknown[],
}))

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock('#/lib/parser-settings', () => ({
  parserSettingsQueryKeys: { list: (id: string) => ['parsers', id] },
  fetchParserSettings: async () => [
    {
      id: 'p1',
      key: 'qpcr',
      name: 'qPCR export',
      parser_versions: [{ id: 'v1', version: 1, status: 'approved' }],
    },
    {
      id: 'p2',
      key: 'draft-only',
      name: 'Draft only',
      parser_versions: [{ id: 'v2', version: 1, status: 'draft' }],
    },
  ],
}))
vi.mock('#/lib/connectors/intake-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchIntakeProblems: async () => mocks.problems,
  postIntake: mocks.postIntake,
  dismissIntakeProblem: (_client: unknown, id: string) =>
    mocks.rpc('resolve_intake_failure', { id }),
}))

const problem = {
  id: 'f1',
  connector_id: 'c1',
  instrument_id: 'i1',
  file_name: 'run-12.csv',
  source: 'agent',
  code: 'parser_unrecognised',
  message: 'This file isn’t in the shape qPCR export reads.',
  parser_key: 'qpcr',
  file_record_id: 'r1',
  attempts: 2,
  created_at: '2026-10-29T09:00:00Z',
  last_attempt_at: '2026-10-29T09:30:00Z',
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <IntakeProblems workspaceId="w1" instrumentId="i1" canManage />
    </QueryClientProvider>,
  )
}

describe('IntakeProblems', () => {
  beforeEach(() => {
    mocks.problems = [problem]
    mocks.rpc.mockReset()
    mocks.postIntake.mockReset()
  })
  afterEach(cleanup)

  it('shows the file, the reason and how often it was tried', async () => {
    renderList()
    expect(await screen.findByText('run-12.csv')).toBeTruthy()
    expect(screen.getByText('Not in the format this parser reads')).toBeTruthy()
    expect(screen.getByText(/2 attempts/)).toBeTruthy()
    expect(screen.getByText(/Sent by the folder agent/)).toBeTruthy()
  })

  it('renders nothing when every file was read', async () => {
    mocks.problems = []
    const { container } = renderList()
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('tries the file again and says what landed', async () => {
    mocks.postIntake.mockResolvedValue({ rowCount: 12 })
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try run-12.csv again' }),
    )
    expect(mocks.postIntake).toHaveBeenCalledWith({
      kind: 'retry',
      failureId: 'f1',
      parserKey: null,
    })
    expect(
      await screen.findByText('run-12.csv imported: 12 rows.'),
    ).toBeTruthy()
  })

  it('offers only approved parsers when choosing another', async () => {
    mocks.postIntake.mockResolvedValue({ rowCount: 3 })
    renderList()
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Use a different parser for run-12.csv',
      }),
    )
    const picker = await screen.findByLabelText('Parser for run-12.csv')
    expect(screen.getByRole('option', { name: 'qPCR export' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Draft only' })).toBeNull()
    await userEvent.selectOptions(picker, 'qpcr')
    await userEvent.click(
      screen.getByRole('button', { name: 'Try with this parser' }),
    )
    expect(mocks.postIntake).toHaveBeenCalledWith({
      kind: 'retry',
      failureId: 'f1',
      parserKey: 'qpcr',
    })
  })

  it('shows the newest reason when trying again still fails', async () => {
    mocks.postIntake.mockRejectedValue(
      new IntakeClientError(
        'parser_not_approved',
        'qPCR export isn’t approved yet.',
        'f1',
      ),
    )
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try run-12.csv again' }),
    )
    expect(await screen.findByText('Parser isn’t approved yet')).toBeTruthy()
  })

  it('shows five rows and the rest on request', async () => {
    mocks.problems = Array.from({ length: 8 }, (_, i) => ({
      ...problem,
      id: `f${i}`,
      file_name: `run-${i}.csv`,
    }))
    renderList()
    await screen.findByText('run-0.csv')
    expect(screen.queryByText('run-5.csv')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 8' }))
    expect(screen.getByText('run-7.csv')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('run-5.csv')).toBeNull()
  })

  it('dismisses a problem', async () => {
    mocks.rpc.mockResolvedValue({})
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss run-12.csv' }),
    )
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_intake_failure', {
      id: 'f1',
    })
  })
})
