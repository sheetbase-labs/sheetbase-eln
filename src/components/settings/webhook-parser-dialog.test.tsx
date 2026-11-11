/**
 * Adding a webhook parser: the address must be a web address, and the signing
 * key is shown once with the example service.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'
import type { CreatedWebhookParser } from '#/lib/parser-settings'

const createSchema = z.strictObject({
  action: z.literal('create'),
  name: z.string(),
  format: z.string(),
  url: z.string(),
  instrumentId: z.string().nullable(),
})

const writes: z.infer<typeof createSchema>[] = []
const unexpected: string[] = []
let result: CreatedWebhookParser = {
  parserId: 'p1',
  parserVersionId: 'v1',
  version: 1,
  key: 'acme-qpcr-service',
  secret: 'whsec_abc123',
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (
    url.pathname === '/api/db/instruments' &&
    (!init?.method || init.method === 'GET')
  )
    return Response.json([])

  if (url.pathname === '/api/parsers/webhook' && init?.method === 'POST') {
    writes.push(createSchema.parse(await new Response(init.body).json()))

    return Response.json(result)
  }

  unexpected.push(url.pathname)
  throw new Error(`Unexpected parser request: ${url}`)
})

const { WebhookParserDialog } = await import('./webhook-parser-dialog')
const { dropSharedReads } = await import('#/lib/data-client')

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
  beforeEach(() => {
    writes.length = 0
    unexpected.length = 0
  })
  afterEach(() => {
    cleanup()
    dropSharedReads()
    expect(unexpected).toEqual([])
  })
  afterAll(() => vi.unstubAllGlobals())

  it('waits for a name and a web address', async () => {
    renderDialog()
    const add = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Add parser',
    })
    expect(add.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme qPCR service')
    await userEvent.type(screen.getByLabelText(/^Address/), 'ftp://nope')
    expect(screen.getByText(/starting with http/)).toBeTruthy()
    expect(add.disabled).toBe(true)
  })

  it('shows the signing key once after adding', async () => {
    result = {
      parserId: 'p1',
      parserVersionId: 'v1',
      version: 1,
      key: 'acme-qpcr-service',
      secret: 'whsec_abc123',
    }
    const onCreated = renderDialog()
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme qPCR service')
    await userEvent.type(
      screen.getByLabelText(/^Address/),
      'https://parsers.example.com/qpcr',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add parser' }))
    const key = await screen.findByLabelText<HTMLInputElement>('Signing key')
    expect(key.value).toBe('whsec_abc123')
    expect(writes).toEqual([
      {
        action: 'create',
        name: 'Acme qPCR service',
        format: 'csv',
        url: 'https://parsers.example.com/qpcr',
        instrumentId: null,
      },
    ])
    expect(onCreated).toHaveBeenCalledOnce()
    expect(screen.getByText(/have it approved/)).toBeTruthy()
  })

  it('says so when the parser already had a key', async () => {
    result = {
      parserId: 'p1',
      parserVersionId: 'v2',
      version: 2,
      key: 'acme',
      secret: null,
    }
    renderDialog()
    await userEvent.type(screen.getByLabelText(/^Name/), 'Acme')
    await userEvent.type(screen.getByLabelText(/^Address/), 'https://a.example')
    await userEvent.click(screen.getByRole('button', { name: 'Add parser' }))
    expect(await screen.findByText(/existing one stays/)).toBeTruthy()
    expect(screen.queryByLabelText('Signing key')).toBeNull()
  })
})
