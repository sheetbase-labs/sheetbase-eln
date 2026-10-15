import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  itemLink,
  recordLink,
  reviewNeedsLargerScreen,
  Route,
  rowKey,
} from './inbox'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import { notebookDataClient } from '#/lib/notebook-data'
import type * as router from '@tanstack/react-router'
import type * as workItems from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'
import { itemKey } from '#/lib/work-items/predicate'

const { navigate, items, state, invalidate, seen } = vi.hoisted(() => {
  const navigateMock = vi.fn()
  const invalidateMock = vi.fn()
  const seenKeys: string[] = []
  const workItems: WorkItem[] = [
    {
      kind: 'review_requested',
      recordId: 'record-1',
      identifier: 'EXP-0001',
      title: 'First review',
      projectId: 'project-1',
      reason: 'Review requested',
      dueAt: '2026-10-03T09:00:00.000Z',
      state: 'needs_action',
      createdAt: null,
    },
    {
      kind: 'data_issue',
      recordId: 'record-2',
      identifier: 'DS-0002',
      title: 'Second review',
      projectId: 'project-1',
      reason: 'Flagged value',
      dueAt: '2026-10-03T10:00:00.000Z',
      state: 'needs_action',
      createdAt: null,
    },
  ]
  return {
    navigate: navigateMock,
    invalidate: invalidateMock,
    items: workItems,
    seen: seenKeys,
    state: { error: null as Error | null, loading: false },
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
      <a href={typeof to === 'string' ? to : '#'}>{children}</a>
    ),
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate: invalidate }),
    useSearch: () => ({}),
  }
})

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: vi.fn(async () => seen.map((item_key) => ({ item_key }))),
    rpc: vi.fn(async () => []),
  },
}))

vi.mock('#/lib/work-items/data', async (importOriginal) => {
  const actual = await importOriginal<typeof workItems>()
  return {
    ...actual,
    useWorkItems: () =>
      state.error
        ? {
            data: undefined,
            isLoading: false,
            isError: true,
            isFetching: false,
            error: state.error,
            refetch: vi.fn(),
          }
        : state.loading
          ? { data: undefined, isLoading: true, isError: false }
          : { data: items, isLoading: false, isError: false },
  }
})

const witnessItem: WorkItem = {
  kind: 'witness_requested',
  recordId: 'live-record-1',
  revisionId: 'frozen-revision-2',
  identifier: 'EXP-0003',
  title: 'Witness target',
  projectId: 'project-1',
  reason: 'Witness requested for the frozen revision',
  dueAt: '2026-10-03T11:00:00.000Z',
  state: 'overdue',
  createdAt: null,
  sourceType: 'signature_witness_request',
  sourceId: 'witness-request-3',
}

afterEach(() => {
  cleanup()
  navigate.mockReset()
  invalidate.mockReset()
  state.error = null
  state.loading = false
  seen.length = 0
  items.splice(2)
})

function renderInbox() {
  const Inbox = Route.options.component
  if (!Inbox) throw new Error('inbox route has no component')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ShortcutProvider definitions={[]}>
        <Inbox />
      </ShortcutProvider>
    </QueryClientProvider>,
  )
}

function currentRow() {
  return document.querySelector('[role="listitem"][aria-current]')
}

describe('Inbox needs-action predicate (QA2-Inbox-1)', () => {
  it('counts only unseen items, so a seen item leaves Needs action for Done today', async () => {
    seen.push('review_requested:record-1')
    const { getByRole, queryByRole } = renderInbox()
    // The seen read is async, so the counts settle after it answers.
    await waitFor(() =>
      expect(
        getByRole('tab', { name: /^Needs action/ }).textContent,
      ).toMatch(/1$/),
    )
    expect(getByRole('tab', { name: /^Done today/ }).textContent).toMatch(/1$/)
    expect(queryByRole('button', { name: /First review/ })).toBeNull()
    expect(getByRole('button', { name: /Second review/ })).toBeTruthy()
  })

  it('shows an unknown count, not zero, while the read is outstanding', () => {
    state.loading = true
    const { getByRole, queryByText } = renderInbox()
    expect(getByRole('tab', { name: /^Needs action/ }).textContent).toMatch(
      /—$/,
    )
    expect(getByRole('button', { name: /^Reviews/ }).textContent).toMatch(/—$/)
    expect(queryByText('Loading…')).toBeTruthy()
  })
})

describe('Inbox witness presentation (REV-02)', () => {
  it('uses the exact frozen revision and preserves the witness request identity', () => {
    expect(itemLink(witnessItem)).toEqual({
      to: '/review/$revisionId',
      params: { revisionId: 'frozen-revision-2' },
      search: { signatureMeaning: 'witnessed' },
    })
    expect(rowKey(witnessItem)).toBe('witness-request-3')
    expect(itemKey(witnessItem)).toBe('witness_requested:witness-request-3')
  })

  it.each([undefined, null])(
    'does not infer a frozen revision from the live record when revisionId is %s',
    (revisionId) => {
      expect(itemLink({ ...witnessItem, revisionId })).toEqual({ to: '/inbox' })
    },
  )

  it('lists actionable witnesses in Reviews with review tone and opens the exact signing target', () => {
    items.push(witnessItem)
    const { getByRole, queryByRole } = renderInbox()
    fireEvent.click(getByRole('button', { name: /^Reviews 2$/ }))
    const row = getByRole('button', { name: /Witness target/ })
    expect(row.textContent).toContain('Witness requested')
    expect(row.querySelector('[data-slot="status"] .bg-review')).not.toBeNull()
    fireEvent.click(row)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({
      to: '/review/$revisionId',
      params: { revisionId: 'frozen-revision-2' },
      search: { signatureMeaning: 'witnessed' },
    })
    fireEvent.click(getByRole('tab', { name: /^Following/ }))
    expect(queryByRole('button', { name: /Witness target/ })).toBeNull()
  })
})

describe('MOB-01.2 review items on a phone', () => {
  it('says a larger screen is needed for a review item, and not for a data issue', () => {
    const { getByRole, getByText, queryByText } = renderInbox()
    // The first needs-action row is the review request, and it is selected.
    expect(getByText(/Reviewing and signing need a larger screen/)).toBeTruthy()
    expect(getByText(/Open record/)).toBeTruthy()

    fireEvent.click(getByRole('button', { name: /Second review/ }))
    expect(queryByText(/Reviewing and signing need a larger screen/)).toBeNull()
    expect(queryByText(/Open record/)).toBeNull()
  })

  it('keeps the review surface for the desktop link and the record for the phone', () => {
    expect(reviewNeedsLargerScreen(items[0])).toBe(true)
    expect(reviewNeedsLargerScreen(items[1])).toBe(false)
    expect(recordLink(items[0])).toEqual({
      to: '/records/$recordId',
      params: { recordId: 'record-1' },
    })
    expect(recordLink({ ...items[1], recordId: null })).toEqual({
      to: '/inbox',
    })
  })
})

describe('Inbox list shortcuts (SHELL-03.3)', () => {
  it('uses exact failure source identities and actionable parser/connector targets', () => {
    const fileFailure: WorkItem = {
      ...items[1],
      recordId: null,
      identifier: 'same.csv',
      sourceType: 'dataset_import_file',
      sourceId: 'file-one',
      parserVersionId: 'version-one',
    }
    expect(itemKey(fileFailure)).not.toEqual(
      itemKey({ ...fileFailure, sourceId: 'file-two' }),
    )
    expect(rowKey(fileFailure)).toBe('file-one')
    expect(itemLink(fileFailure)).toEqual({
      to: '/settings/instruments',
      search: { fileId: 'file-one', versionId: 'version-one' },
    })
    expect(
      itemLink({
        ...fileFailure,
        sourceType: 'connector_run',
        sourceId: 'run-one',
        connectorId: 'connector-one',
      }),
    ).toEqual({
      to: '/settings/integrations/$connectorId',
      params: { connectorId: 'connector-one' },
    })
  })

  it('moves the selection with J and K', () => {
    renderInbox()
    expect(currentRow()?.textContent).toContain('First review')
    fireEvent.keyDown(window, { key: 'j' })
    expect(currentRow()?.textContent).toContain('Second review')
    fireEvent.keyDown(window, { key: 'k' })
    expect(currentRow()?.textContent).toContain('First review')
  })

  it('moves the selection with the arrow keys', () => {
    renderInbox()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(currentRow()?.textContent).toContain('Second review')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(currentRow()?.textContent).toContain('First review')
  })

  it('selects with Space and adds another current row with X without moving it', () => {
    const { getAllByRole, getByRole } = renderInbox()
    fireEvent.keyDown(window, { key: ' ' })
    expect(
      getByRole('button', { name: /First review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'x' })
    expect(
      getByRole('button', { name: /First review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    expect(
      getByRole('button', { name: /Second review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    expect(currentRow()?.textContent).toContain('Second review')
    fireEvent.keyDown(window, { key: ' ' })
    expect(
      getByRole('button', { name: /First review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false')
    expect(
      getByRole('button', { name: /Second review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    expect(
      getAllByRole('status').some(
        (status) => status.textContent === '1 selected',
      ),
    ).toBe(true)
    fireEvent.click(getByRole('button', { name: 'Clear selection' }))
    expect(
      getByRole('button', { name: /Second review/ }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false')
  })

  it('opens the selected row with Enter', () => {
    renderInbox()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({
      to: '/records/$recordId',
      params: { recordId: 'record-1' },
    })
  })

  it('focuses the type filter with /', () => {
    renderInbox()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement?.textContent).toContain('All types')
  })

  it('ignores the list shortcuts while typing in a field', () => {
    renderInbox()
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'j' })
    expect(currentRow()?.textContent).toContain('First review')
  })
})

describe('Inbox failure and filter honesty (QA-013, QA-014, QA-015)', () => {
  it('states a failed read instead of presenting it as an empty inbox', () => {
    state.error = new Error('The work list is unavailable')
    const { getByRole, getByText, queryByText } = renderInbox()
    expect(getByText('Couldn’t load your inbox')).toBeTruthy()
    expect(getByText('The work list is unavailable')).toBeTruthy()
    expect(queryByText('Nothing here')).toBeNull()
    expect(getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('offers no type filter that can never match, while the Following tab stays', () => {
    const { getByRole, queryByRole } = renderInbox()
    expect(getByRole('tab', { name: /^Following/ })).toBeTruthy()
    expect(queryByRole('button', { name: /^Following/ })).toBeNull()
  })

  it('refreshes the shell counts when the inbox is marked seen', async () => {
    const { getByRole } = renderInbox()
    fireEvent.click(getByRole('button', { name: 'Mark all seen' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
  })
})

describe('Inbox list matches the active filter (QA3-lists-inbox-1)', () => {
  const laterReview: WorkItem = {
    kind: 'review_requested',
    recordId: 'record-1',
    identifier: 'EXP-0001',
    title: 'First review',
    projectId: 'project-1',
    reason: 'Review requested',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
  }
  // Twelve live data issues share one dataset identifier, so `rowKey` alone is
  // not unique among the rendered siblings.
  const duplicateKeyIssues: WorkItem[] = Array.from({ length: 12 }, (_, n) => ({
    kind: 'data_issue' as const,
    recordId: null,
    identifier: 'DS-0323',
    title: `Data issue ${n}`,
    projectId: 'project-1',
    reason: 'Flagged value',
    dueAt: null,
    state: 'needs_action' as const,
    createdAt: null,
  }))

  it('renders only the rows the active type chip admits', () => {
    const base = items.slice(0, 2)
    items.length = 0
    items.push(...duplicateKeyIssues, laterReview)
    try {
      const { getByRole, queryByRole } = renderInbox()
      // Every row is undated, so the Later bucket is the tab's only group and
      // opens expanded; there is nothing left to expand.
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(13)
      expect(queryByRole('button', { name: /^Later · / })).toBeNull()
      fireEvent.click(getByRole('button', { name: /^Reviews 1$/ }))
      const rows = document.querySelectorAll('[role="listitem"]')
      expect(rows).toHaveLength(1)
      expect(rows[0].textContent).toContain('First review')
      fireEvent.click(getByRole('button', { name: /^Data issues 12$/ }))
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(12)
    } finally {
      items.length = 0
      items.push(...base)
    }
  })
})

describe('Inbox Later bucket default (QA3-lists-inbox-2)', () => {
  it('opens the Later rows when they are the only group the tab renders', () => {
    const base = items.slice(0, 2)
    items.length = 0
    items.push(...base.map((i) => ({ ...i, dueAt: null })))
    try {
      const { getByRole, queryByRole } = renderInbox()
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(2)
      expect(queryByRole('button', { name: /^Later · / })).toBeNull()
      // The bucket can still be collapsed explicitly, and then expanded again.
      fireEvent.click(getByRole('button', { name: 'Collapse' }))
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(0)
      fireEvent.click(getByRole('button', { name: /^Later · 2 items$/ }))
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(2)
    } finally {
      items.length = 0
      items.push(...base)
    }
  })

  it('keeps Later behind its button while a due-dated group is on the tab', () => {
    const base = items.slice(0, 2)
    items.length = 0
    items.push(
      ...base,
      {
        kind: 'data_issue',
        recordId: null,
        identifier: 'DS-0323',
        title: 'Undated flag',
        projectId: 'project-1',
        reason: 'Flagged value',
        dueAt: null,
        state: 'needs_action',
        createdAt: null,
      },
    )
    try {
      const { getByRole } = renderInbox()
      // Today holds the due-dated pair; the undated flag stays behind the
      // bucket's own count.
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(2)
      fireEvent.click(getByRole('button', { name: /^Later · 1 items$/ }))
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(3)
    } finally {
      items.length = 0
      items.push(...base)
    }
  })

  it('states the tab total in the tab group header while Later is collapsed', () => {
    const base = items.slice(0, 2)
    items.length = 0
    items.push(
      ...base.map((i) => ({ ...i, state: 'done_today' as const })),
      ...Array.from({ length: 5 }, (_, n) => ({
        kind: 'data_issue' as const,
        recordId: `record-undated-${n}`,
        identifier: `DS-03${n}`,
        title: `Done and undated ${n}`,
        projectId: 'project-1',
        reason: 'Flagged value',
        dueAt: null,
        state: 'done_today' as const,
        createdAt: null,
      })),
    )
    try {
      const { getByRole } = renderInbox()
      fireEvent.click(getByRole('tab', { name: /^Done today/ }))
      // The tab strip reads 7; the header states the same total, with the
      // undated 5 accounted for by the bucket button below.
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(2)
      expect(
        document.querySelector('[role="list"] [role="presentation"]')
          ?.textContent,
      ).toBe('Done today7')
      expect(
        getByRole('button', { name: /^Later · 5 items$/ }),
      ).toBeTruthy()
    } finally {
      items.length = 0
      items.push(...base)
    }
  })
})

describe('Inbox marking and empty state (QA3-inbox-1, QA3-inbox-2)', () => {
  it('marks only the rows the active filter shows', async () => {
    const rpc = vi.mocked(notebookDataClient.rpc)
    const { getByRole } = renderInbox()
    fireEvent.click(getByRole('button', { name: /^Reviews 1$/ }))
    fireEvent.click(getByRole('button', { name: 'Mark all seen' }))
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('mark_work_items_seen', {
        p_item_keys: ['review_requested:record-1'],
      }),
    )
  })

  it('disables Mark all seen on a tab with nothing to mark', () => {
    const { getByRole } = renderInbox()
    fireEvent.click(getByRole('tab', { name: /^Following/ }))
    expect(
      getByRole('button', { name: 'Mark all seen' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('names the type filter that emptied the list and offers to clear it', () => {
    const { getByRole, getByText } = renderInbox()
    fireEvent.click(getByRole('button', { name: /^Materials 0$/ }))
    expect(getByText('No Materials items in this tab.')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Clear filter' }))
    expect(getByRole('button', { name: /First review/ })).toBeTruthy()
  })

  it('does not claim nothing needs action on the Done today tab', () => {
    const { getByRole, getByText, queryByText } = renderInbox()
    fireEvent.click(getByRole('tab', { name: /^Done today/ }))
    expect(queryByText('Nothing needs your action right now.')).toBeNull()
    expect(
      getByText('Nothing has been marked seen or done today.'),
    ).toBeTruthy()
  })
})

describe('Inbox URL and tab keyboard (QA3-inbox-3, QA3-inbox-4)', () => {
  it('writes the tab into the URL so a reload follows the list', () => {
    const { getByRole } = renderInbox()
    fireEvent.click(getByRole('tab', { name: /^Following/ }))
    const tabCall = navigate.mock.calls[0][0] as {
      to: string
      search: (previous: Record<string, unknown>) => Record<string, unknown>
    }
    expect(tabCall.to).toBe('/inbox')
    expect(tabCall.search({ type: 'reviews' })).toEqual({
      type: undefined,
      tab: 'following',
    })
  })

  it('writes the type chip into the URL', () => {
    const { getByRole } = renderInbox()
    fireEvent.click(getByRole('button', { name: /^Reviews 1$/ }))
    const typeCall = navigate.mock.calls[0][0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>
    }
    expect(typeCall.search({ type: undefined })).toEqual({ type: 'reviews' })
  })

  it('moves between tabs with the arrow keys and roves the tab stop', () => {
    const { getByRole } = renderInbox()
    const needs = getByRole('tab', { name: /^Needs action/ })
    needs.focus()
    fireEvent.keyDown(needs, { key: 'ArrowRight' })
    const following = getByRole('tab', { name: /^Following/ })
    expect(following.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(following)
    expect(needs.getAttribute('tabindex')).toBe('-1')
    expect(following.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(following, { key: 'End' })
    const done = getByRole('tab', { name: /^Done today/ })
    expect(done.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(done, { key: 'ArrowRight' })
    expect(needs.getAttribute('aria-selected')).toBe('true')
  })
})

describe('Inbox header fits the phone width (QA4-inbox-phone)', () => {
  it('keeps both header actions on a row that wraps below `md`', () => {
    const { getByRole, getByText } = renderInbox()
    const row = getByText('Inbox', { selector: 'h1' }).parentElement
    expect(row).not.toBeNull()
    // On one non-wrapping row the title and the two actions could not share a
    // 390px viewport (Mark all seen ended at 408), which clipped the action
    // with no ancestor able to scroll to it. The row wraps instead, so both
    // controls stay on the page rather than being dropped from the affordance
    // set the reference's desktop header shows.
    expect(row!.className).toContain('max-md:flex-wrap')
    // Both actions stay in the wrapping row: "Mark all seen" is a real button,
    // "Notification settings" is a Link-based button (its role comes from Base
    // UI, so the shared Link mock leaves it roleless here).
    expect(row!.contains(getByText('Notification settings'))).toBe(true)
    expect(
      row!.contains(getByRole('button', { name: 'Mark all seen' })),
    ).toBe(true)
  })
})
