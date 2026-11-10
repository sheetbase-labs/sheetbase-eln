import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { AuditVerificationStatus } from '#/lib/audit-verification-status'

let respond: () => Promise<Response> = async () => Response.json(null)

const transport = vi.fn<typeof fetch>(() => respond())

vi.stubGlobal('fetch', transport)

const { AuditCheckLine } = await import('./audit-check-line')
const { dropSharedReads } = await import('#/lib/data-client')
const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  dropSharedReads()

  for (const [input, init] of transport.mock.calls) {
    expect(input).toBe('/api/db/rpc/audit_verification_status')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{}')
  }

  transport.mockClear()
  respond = async () => Response.json(null)
})

afterAll(() => vi.unstubAllGlobals())

function show(note?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  clients.push(client)

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AuditCheckLine note={note} />
      </QueryClientProvider>,
    ),
  }
}

const checked: Omit<AuditVerificationStatus, 'ok'> = {
  checkedAt: '2026-10-29T22:45:00Z',
  entriesChecked: 1656,
  signaturesChecked: 2,
  firstBadRevisionId: null,
}

describe('AuditCheckLine', () => {
  it('says when the signatures and audit trail were last found intact', async () => {
    respond = async () =>
      Response.json({ ...checked, ok: true } satisfies AuditVerificationStatus)
    show('Bound to version 1.')
    await userEvent.hover(
      await screen.findByRole('button', { name: 'About these signatures' }),
    )
    expect(
      await screen.findByText(/verified intact, last checked/),
    ).toBeTruthy()
    expect(screen.getByText('Bound to version 1.')).toBeTruthy()
  })

  it('warns when the latest check failed', async () => {
    respond = async () =>
      Response.json({ ...checked, ok: false } satisfies AuditVerificationStatus)
    show()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /check of the signatures and audit trail failed/,
    )
  })

  it('does not claim a check that has not run', async () => {
    respond = async () => Response.json(null)
    show()
    await userEvent.hover(
      await screen.findByRole('button', { name: 'About these signatures' }),
    )
    expect(await screen.findByText(/haven’t been checked yet/)).toBeTruthy()
  })

  it('says nothing when the status cannot be read', async () => {
    respond = async () =>
      Response.json(
        { error: { code: 'denied', message: 'denied' } },
        { status: 403 },
      )
    const { container, client } = show()
    await waitFor(() =>
      expect(client.getQueryState(['audit-verification'])?.status).toBe(
        'error',
      ),
    )
    expect(container.textContent).toBe('')
  })

  it('does not announce an unchecked or intact result while the read is pending', async () => {
    let release: ((response: Response) => void) | undefined

    const response = new Promise<Response>((resolve) => {
      release = resolve
    })

    respond = () => response
    const { container } = show()
    await waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(container.textContent).toBe('')
    release?.(Response.json(null))
    expect(
      await screen.findByRole('button', { name: 'About these signatures' }),
    ).toBeTruthy()
  })
})
