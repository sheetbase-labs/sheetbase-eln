import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { driftSummary } from './evidence-drift'
import type { RevisionDrift } from '#/lib/revision-evidence'
import type { SignatureWire } from '#/lib/signatures'

let respond: () => Promise<Response> = async () => Response.json([])

const transport = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(
    input instanceof Request ? input.url : input,
    'http://localhost',
  )

  if (url.pathname === '/api/db/rpc/audit_verification_status') {
    return Response.json(null)
  }

  return respond()
})

vi.stubGlobal('fetch', transport)

const { EvidenceDrift, EvidenceSignatures } =
  await import('./evidence-inspector')

const { dropSharedReads } = await import('#/lib/data-client')
const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  dropSharedReads()

  for (const [input, init] of transport.mock.calls) {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/rpc/audit_verification_status') {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{}')
    } else if (url.pathname === '/api/db/rpc/revision_drift') {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe(JSON.stringify({ p_revision_id: 'rev-1' }))
    } else {
      expect(url.pathname).toBe('/api/db/signatures')
      expect(init?.method).toBe('GET')
      expect(url.searchParams.get('record_id')).toBe('eq.rec-1')
      expect(url.searchParams.get('order')).toBe('signed_at.asc,id.asc')
    }
  }

  transport.mockClear()
  respond = async () => Response.json([])
})

afterAll(() => vi.unstubAllGlobals())

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  clients.push(client)

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function signature(
  overrides: Partial<SignatureWire> & { id: string },
): SignatureWire {
  return {
    workspace_id: 'workspace',
    submission_id: 'submission',
    record_id: 'rec-1',
    revision_id: 'rev-1',
    signature_meaning: 'authored',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'u',
    signer_session_id: 'session',
    signer_role: 'author',
    auth_method: 'password',
    confirmation_phrase: 'Ada',
    signed_at: '2026-09-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    signer_name: 'Ada',
    ...overrides,
  }
}

const drift = (over: Partial<RevisionDrift> = {}): RevisionDrift => ({
  revisionId: 'rev-1',
  recordId: 'rec-1',
  signedAt: '2026-09-01T00:00:00Z',
  record: {
    recordId: 'rec-1',
    identifier: 'EXP-1',
    signedTitle: 'Old name',
    currentTitle: 'New name',
    renamed: true,
  },
  datasets: [],
  instruments: [],
  commentsAfterSigning: 2,
  drifted: true,
  ...over,
})

describe('driftSummary', () => {
  it('names each thing that moved', () => {
    const lines = driftSummary(
      drift({
        instruments: [
          {
            instrumentId: 'i',
            displayId: null,
            signedName: 'A',
            currentName: 'B',
            renamed: true,
          },
        ],
      }),
    )

    expect(lines).toEqual([
      'Record renamed: Old name → New name',
      'Instrument renamed: A → B',
      '2 comments added after signing',
    ])
  })
  it('says nothing when nothing moved', () => {
    expect(
      driftSummary(
        drift({
          record: { ...drift().record, renamed: false },
          commentsAfterSigning: 0,
          drifted: false,
        }),
      ),
    ).toEqual([])
  })
})

describe('EvidenceDrift', () => {
  it('shows the drift read', async () => {
    respond = async () => Response.json(drift())
    wrap(<EvidenceDrift revisionId="rev-1" />)
    expect(await screen.findByText('Moved since signing')).toBeTruthy()
    expect(screen.getByText('Record renamed: Old name → New name')).toBeTruthy()
  })
  it('says so when drift could not be read, rather than claiming a match', async () => {
    respond = async () =>
      Response.json(
        { error: { code: 'denied', message: 'denied' } },
        { status: 403 },
      )
    wrap(<EvidenceDrift revisionId="rev-1" />)
    expect(
      await screen.findByText(/Couldn’t read what has changed/),
    ).toBeTruthy()
    expect(screen.queryByText('Matches signing')).toBeNull()
  })

  it('does not claim a match while drift is pending, then reports an unchanged revision', async () => {
    let release: ((response: Response) => void) | undefined

    const response = new Promise<Response>((resolve) => {
      release = resolve
    })

    respond = () => response
    wrap(<EvidenceDrift revisionId="rev-1" />)
    await waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(screen.queryByText('Matches signing')).toBeNull()
    expect(screen.queryByText('Moved since signing')).toBeNull()
    release?.(
      Response.json(
        drift({
          record: { ...drift().record, renamed: false },
          commentsAfterSigning: 0,
          drifted: false,
        }),
      ),
    )
    expect(await screen.findByText('Matches signing')).toBeTruthy()
    expect(screen.queryByText('Record renamed: Old name → New name')).toBeNull()
  })
})

describe('EvidenceSignatures', () => {
  it('lists only the signatures on this revision', async () => {
    respond = async () =>
      Response.json([
        signature({ id: 'sig-a' }),
        signature({
          id: 'sig-b',
          revision_id: 'rev-other',
          signed_at: '2026-09-02T00:00:00Z',
          signer_user_id: 'u2',
          signer_name: 'Bob',
        }),
      ])
    wrap(<EvidenceSignatures recordId="rec-1" revisionId="rev-1" />)
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText('Bob')).toBeNull()
  })

  it('reports a refused signatures read without claiming there are no signatures', async () => {
    respond = async () =>
      Response.json(
        { error: { code: 'denied', message: 'denied' } },
        { status: 403 },
      )
    wrap(<EvidenceSignatures recordId="rec-1" revisionId="rev-1" />)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Couldn’t load the signatures',
    )
    expect(screen.queryByText('No signatures yet')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps a pending signatures read distinct from an empty result', async () => {
    let release: ((response: Response) => void) | undefined

    const response = new Promise<Response>((resolve) => {
      release = resolve
    })

    respond = () => response
    wrap(<EvidenceSignatures recordId="rec-1" revisionId="rev-1" />)
    expect(screen.getByText('Loading signatures…')).toBeTruthy()
    expect(screen.queryByText('No signatures yet')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    release?.(Response.json([]))
    expect(await screen.findByText('No signatures yet')).toBeTruthy()
  })
})
