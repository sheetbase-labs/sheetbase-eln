/**
 * MOB-02.4 — the evidence view on a phone.
 *
 * The desktop page is a three-column order/block/content table plus an
 * inspector that carries the integrity facts. Below the phone breakpoint the
 * same frozen revision is one column: the blocks stack as wrapping rows, the
 * hash is stated inline, and creating an amendment — a desktop job — is
 * replaced by a sentence that says so rather than a silently missing button.
 *
 * jsdom cannot evaluate the media queries, so the phone rendering path is
 * proved the way `app-shell.test.tsx` proves the phone shell: the phone-only
 * elements carry `md:hidden` and the desktop-only ones `max-md:hidden`.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EvidencePage } from './$revisionId'

const mocks = vi.hoisted(() => {
  const revision = {
    id: 'rev-0001',
    record_id: 'rec-0001',
    structure_version: 2,
    metadata_version: 1,
    metadata_snapshot: {
      title: 'Harvest timing study',
      identifier: 'EXP-0133',
    },
    block_snapshot: [
      {
        id: 'blk-1',
        type: 'text',
        payload: { text: 'Harvest timing: 48, 72 and 96 h' },
        payload_schema_version: 1,
        order: 1,
        version: 1,
      },
      {
        id: 'blk-2',
        type: 'measurement',
        payload: { text: 'H96 genome titre 7.3 × 10¹⁰' },
        payload_schema_version: 1,
        order: 2,
        version: 1,
      },
    ],
    integrity_algorithm: 'sha256',
    integrity_digest: 'c'.repeat(64),
    reason: 'Initial submission',
    superseded_by_revision_id: null,
    created_at: '2026-09-19T06:00:00.000Z',
    created_by_user_id: 'user-1',
    frozenSheetEvidence: [],
  }
  const record = {
    id: 'rec-0001',
    projectId: null,
    kind: 'experiment',
    identifier: 'EXP-0133',
    title: 'Harvest timing study',
    status: 'signed',
    tags: [],
    structureVersion: 2,
    metadataVersion: 1,
    createdAt: '2026-09-01T06:00:00.000Z',
    updatedAt: '2026-09-19T06:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user-1',
    updatedByUserId: null,
    properties: {},
    lockedAt: '2026-09-19T06:00:00.000Z',
    lockedByRevisionId: 'rev-0001',
  }
  return {
    revision,
    record,
    fetchRevisionRow: vi.fn(),
    fetchRecord: vi.fn(),
    createAmendment: vi.fn(),
    toast: vi.fn(),
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ revisionId: 'rev-0001' }),
    useRouteContext: () => ({}),
  }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(String(value)))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

// The route reads these three data modules; no UI component it imports does, so
// each is stubbed whole rather than spread over the real module.
vi.mock('#/lib/review-workspace', () => ({
  reviewWorkspaceDataClient: {},
  fetchRevisionRow: mocks.fetchRevisionRow,
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  fetchRecord: mocks.fetchRecord,
}))

vi.mock('#/lib/sign-002', () => ({
  sign002DataClient: {},
  createAmendment: mocks.createAmendment,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: mocks.toast,
  Toaster: () => null,
}))

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <EvidencePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.fetchRevisionRow.mockResolvedValue(mocks.revision)
  mocks.fetchRecord.mockResolvedValue(mocks.record)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('evidence page — phone rendering (MOB-02.4)', () => {
  it('replaces the desktop order/block/content table with one readable column', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Frozen revision content' })

    // The wide table stays a desktop affordance.
    const table = screen.getByRole('table', {
      name: 'Frozen revision content',
    })
    // The grid owns the breakpoint, so the hidden-at-phone class sits on its
    // wrapper rather than the table's immediate parent.
    expect(table.closest('[class*="max-md:hidden"]')).not.toBeNull()

    // The phone column carries the same frozen blocks, as wrapping rows.
    const phoneColumn = screen.getByRole('list', {
      name: 'Frozen revision content',
    })
    expect(phoneColumn.className).toContain('md:hidden')
    for (const item of within(phoneColumn).getAllByRole('listitem'))
      expect(item.className).toContain('min-h-14')
    within(phoneColumn).getByText('Harvest timing: 48, 72 and 96 h')
    within(phoneColumn).getByText('H96 genome titre 7.3 × 10¹⁰')
    within(phoneColumn).getByText('text')
    within(phoneColumn).getByText('measurement')
  })

  it('states the integrity facts in the phone column instead of only in the inspector', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Frozen revision content' })

    const phoneHash = screen.getByText('Hash verified when signed')
    expect(phoneHash.closest('div')?.className).toContain('md:hidden')
    within(phoneHash.closest('div') as HTMLElement).getByText(
      `sha256 · ${'c'.repeat(64)}`,
    )

    // The inspector is a sheet on a phone, so its copy of the hash is folded
    // away; the page shows it once, inline.
    const inspector = document.querySelector(
      'aside[aria-label="Evidence package"]',
    )
    expect(inspector).not.toBeNull()
    const inspectorHash = within(inspector as HTMLElement).getByText(
      'Verified when signed',
    )
    expect(inspectorHash.closest('div')?.className).toContain('max-md:hidden')
  })

  it('says the amendment needs a desktop rather than hiding the action', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Frozen revision content' })

    const amend = screen.getByRole('button', { name: 'Create amendment' })
    expect(amend.className).toContain('max-md:hidden')
    expect(
      screen.getByText(/Creating an amendment needs a desktop/),
    ).toBeTruthy()
    // Opening the live record stays reachable at either width.
    expect(
      screen.getByRole('button', { name: 'Open live record' }),
    ).toBeTruthy()
  })
})

describe('evidence page — package export (DATA-02)', () => {
  it('reports a refused package instead of replacing the page with the error body', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderPage()
      await screen.findByRole('table', { name: 'Frozen revision content' })

      fireEvent.click(
        screen.getByRole('button', { name: 'Export evidence package' }),
      )

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          'Could not export the evidence package',
          { description: 'This revision has no exportable package.' },
        ),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/export/revision/rev-0001/package',
      )
      // The evidence is still on screen; the failure did not navigate away.
      expect(
        screen.getByRole('table', { name: 'Frozen revision content' }),
      ).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('evidence page — heading outline (frames a11y)', () => {
  it('descends one level at a time: the page H1, then the inspector sections at H2', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Frozen revision content' })

    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)))
    expect(levels[0]).toBe(1)
    expect(levels.filter((level) => level === 1)).toHaveLength(1)
    levels.slice(1).forEach((level, index) => {
      expect(level - levels[index]).toBeLessThanOrEqual(1)
    })
    for (const name of ['Integrity', 'Revision', 'Amendments']) {
      expect(
        screen.getAllByRole('heading', { level: 2, name }).length,
      ).toBeGreaterThan(0)
    }
  })
})
