import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EvidenceDrift,
  EvidenceSignatures,
  driftSummary,
} from './evidence-inspector'
import type { RevisionDrift } from '#/lib/revision-evidence'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notebookDataClient: { list: mocks.list, rpc: mocks.rpc },
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  )

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
    mocks.rpc.mockResolvedValue(drift())
    wrap(<EvidenceDrift revisionId="rev-1" />)
    expect(await screen.findByText('Moved since signing')).toBeTruthy()
    expect(screen.getByText('Record renamed: Old name → New name')).toBeTruthy()
  })
  it('says so when drift could not be read, rather than claiming a match', async () => {
    mocks.rpc.mockRejectedValue(new Error('x'))
    wrap(<EvidenceDrift revisionId="rev-1" />)
    expect(await screen.findByText(/Couldn’t read what has changed/)).toBeTruthy()
    expect(screen.queryByText('Matches signing')).toBeNull()
  })
})

describe('EvidenceSignatures', () => {
  it('lists only the signatures on this revision', async () => {
    mocks.list.mockResolvedValue([
      {
        id: 'sig-a',
        revision_id: 'rev-1',
        signature_meaning: 'author',
        signed_at: '2026-09-01T00:00:00Z',
        signer_user_id: 'u',
        signer_name: 'Ada',
      },
      {
        id: 'sig-b',
        revision_id: 'rev-other',
        signature_meaning: 'author',
        signed_at: '2026-09-02T00:00:00Z',
        signer_user_id: 'u2',
        signer_name: 'Bob',
      },
    ])
    wrap(<EvidenceSignatures recordId="rec-1" revisionId="rev-1" />)
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText('Bob')).toBeNull()
  })
})
