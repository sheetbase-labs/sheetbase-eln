/**
 * Adding a webhook parser: the address must be a web address, and the signing
 * key is shown once with the example service.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebhookParserDialog } from './webhook-parser-dialog'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('#/lib/parser-settings', () => ({
  parserSettingsQueryKeys: { list: (id: string) => ['parsers', id] },
  createWebhookParser: mocks.create,
}))
vi.mock('#/components/v3/instruments/instruments-data', () => ({
  useInstruments: () => ({ data: [] }),
}))

function renderDialog(onCreated = vi.fn()) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <WebhookParserDialog
        workspaceId="w1"
        onClose={() => undefined}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  )
  return onCreated
}

describe('WebhookParserDialog', () => {
  beforeEach(() => mocks.create.mockReset())
  afterEach(cleanup)

  it('waits for a name and a web address', async () => {
    renderDialog()
    const add = screen.getByRole('button', { name: 'Add parser' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme qPCR service')
    await userEvent.type(screen.getByLabelText(/^Address/), 'ftp://nope')
    expect(screen.getByText(/starting with http/)).toBeTruthy()
    expect((add as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the signing key once after adding', async () => {
    mocks.create.mockResolvedValue({
      parserId: 'p1',
      parserVersionId: 'v1',
      version: 1,
      key: 'acme-qpcr-service',
      secret: 'whsec_abc123',
    })
    const onCreated = renderDialog()
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme qPCR service')
    await userEvent.type(
      screen.getByLabelText(/^Address/),
      'https://parsers.example.com/qpcr',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add parser' }))
    const key = await screen.findByLabelText('Signing key')
    expect((key as HTMLInputElement).value).toBe('whsec_abc123')
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Acme qPCR service',
      format: 'csv',
      url: 'https://parsers.example.com/qpcr',
      instrumentId: null,
    })
    expect(onCreated).toHaveBeenCalledOnce()
    expect(screen.getByText(/ask QA to approve/)).toBeTruthy()
  })

  it('says so when the parser already had a key', async () => {
    mocks.create.mockResolvedValue({
      parserId: 'p1',
      parserVersionId: 'v2',
      version: 2,
      key: 'acme',
      secret: null,
    })
    renderDialog()
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme')
    await userEvent.type(screen.getByLabelText(/^Address/), 'https://a.example')
    await userEvent.click(screen.getByRole('button', { name: 'Add parser' }))
    expect(await screen.findByText(/existing one stays/)).toBeTruthy()
    expect(screen.queryByLabelText('Signing key')).toBeNull()
  })
})
