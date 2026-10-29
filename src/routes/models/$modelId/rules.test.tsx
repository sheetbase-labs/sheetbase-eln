import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './rules'

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

const mocks = vi.hoisted(() => ({
  createModelRule: vi.fn(),
  removeModelRule: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ modelId: 'contact' }),
    useRouteContext: () => ({ context: { workspace: { id: 'ws' } } }),
  }),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

vi.mock('#/lib/model-rules', () => ({
  createModelRule: (...args: unknown[]) => mocks.createModelRule(...args),
  removeModelRule: (...args: unknown[]) => mocks.removeModelRule(...args),
}))

vi.mock('#/components/v3/models/models-data', () => ({
  useWorkspaceRecordModel: () => ({ data: { name: 'Contact' } }),
  useRecordModelFields: () => ({
    data: [{ fieldName: 'value', label: 'Value' }],
  }),
  useModelRules: () => ({
    data: [
      {
        id: 'rule-1',
        name: 'Range check',
        fieldKeys: ['value'],
        condition: { field: 'value', op: 'gt', value: 10 },
        effect: 'warn',
        message: 'Value is out of range',
      },
    ],
    refetch: mocks.refetch,
  }),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refetch.mockResolvedValue(undefined)
  mocks.createModelRule.mockResolvedValue(undefined)
  mocks.removeModelRule.mockResolvedValue(undefined)
})

const ModelRules = Route.options.component as React.ComponentType

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ModelRules />
    </QueryClientProvider>,
  )
}

describe('model rules', () => {
  it('confirms before removing a rule', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Range check')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.removeModelRule).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }))
    await waitFor(() =>
      expect(mocks.removeModelRule).toHaveBeenCalledWith({}, 'rule-1'),
    )
  })

  it('shows why a refused removal failed', async () => {
    const user = userEvent.setup()
    mocks.removeModelRule.mockRejectedValue(new Error('Rule is in use.'))
    renderScreen()
    await screen.findByText('Range check')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Rule is in use.',
    )
  })
})
