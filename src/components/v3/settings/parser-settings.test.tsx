/**
 * J-INS-04 / J-INS-06 — the parser page reached from a failed import tells a
 * person without edit rights who can act, and lets an approver get back to the
 * import they were fixing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParserSettings } from './parser-settings'

const state = vi.hoisted(() => ({
  status: 'approved',
  requestedAt: undefined as string | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, string | undefined>
    children: React.ReactNode
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to,
    )
    const query = new URLSearchParams(
      Object.entries(search ?? {}).filter(
        (entry): entry is [string, string] => entry[1] != null,
      ),
    ).toString()
    return <a href={query ? `${path}?${query}` : path}>{children}</a>
  },
}))
vi.mock('#/lib/data-client', () => ({ createDataClient: () => ({}) }))
vi.mock('#/lib/import/data', () => ({ uploadImportFile: vi.fn() }))
vi.mock('#/components/v3/instruments/instruments-data', () => ({
  useInstruments: () => ({ data: [] }),
}))
vi.mock('./instrument-parser-table', () => ({
  InstrumentParserTable: () => null,
}))
vi.mock('#/lib/parser-settings', () => ({
  parserSettingsQueryKeys: {
    list: (id: string) => ['parsers', id],
    files: (id: string) => ['parser-files', id],
  },
  fetchParserSettings: async () => [
    {
      id: 'p1',
      key: 'plate-export',
      name: 'Plate export',
      format: 'csv',
      instrument_id: null,
      instruments: null,
      parser_versions: [
        {
          id: 'v1',
          version: 1,
          status: state.status,
          signature: {},
          mapping: {},
          test_result: null,
          validated_at: null,
          approved_at: null,
          approved_by_user_id: null,
        },
      ],
    },
  ],
  fetchParserTestFiles: async () => [
    {
      id: 'file-1',
      filename: 'plate-7.csv',
      checksum: 'abc',
      parser_failure: {
        message: 'Unrecognised headers',
        requestedAt: state.requestedAt,
      },
    },
  ],
  approveParserVersion: vi.fn(),
  createParserDraft: vi.fn(),
  validateParserVersion: vi.fn(),
}))

afterEach(() => {
  cleanup()
  state.status = 'approved'
  state.requestedAt = undefined
})

function renderSettings(role: string, versionId?: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ParserSettings
        workspaceId="ws-1"
        role={role}
        fileId="file-1"
        versionId={versionId}
      />
    </QueryClientProvider>,
  )
}

describe('parser settings opened from a failed import', () => {
  it('tells a plain member who can act and links back to the import', async () => {
    state.status = 'draft'
    renderSettings('member')

    expect(
      await screen.findByText(/plate-7\.csv could not be read/),
    ).toBeTruthy()
    expect(
      screen.getByText(/Ask a workspace admin or schema editor/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Back to the import' })
        .getAttribute('href'),
    ).toBe('/import/file-1?step=map')
  })

  it('says when an admin has already been asked', async () => {
    state.status = 'draft'
    state.requestedAt = '2026-10-17T10:00:00Z'
    renderSettings('member')

    expect(
      await screen.findByText(/already with them in their Inbox/),
    ).toBeTruthy()
  })

  it('offers the approver a link that resumes the original import', async () => {
    renderSettings('admin', 'v1')

    const resume = await screen.findByRole('link', {
      name: 'Resume the import',
    })
    expect(resume.getAttribute('href')).toBe(
      '/import/file-1?step=map&parser=plate-export',
    )
  })

  it('does not offer to resume before the parser is approved', async () => {
    state.status = 'draft'
    renderSettings('admin', 'v1')

    await screen.findByText(/plate-7\.csv could not be read/)
    expect(screen.queryByRole('link', { name: 'Resume the import' })).toBeNull()
  })
})
