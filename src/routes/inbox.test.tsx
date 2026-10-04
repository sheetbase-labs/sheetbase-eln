import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { itemKey, itemLink, Route, rowKey } from './inbox'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import type * as router from '@tanstack/react-router'
import type * as workItems from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'

const { navigate, items } = vi.hoisted(() => {
  const navigateMock = vi.fn()
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
  return { navigate: navigateMock, items: workItems }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
      <a href={typeof to === 'string' ? to : '#'}>{children}</a>
    ),
    useNavigate: () => navigate,
  }
})

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: vi.fn(async () => []),
    rpc: vi.fn(async () => []),
  },
}))

vi.mock('#/lib/work-items/data', async (importOriginal) => {
  const actual = await importOriginal<typeof workItems>()
  return { ...actual, useWorkItems: () => ({ data: items, isLoading: false }) }
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
