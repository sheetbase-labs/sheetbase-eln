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

afterEach(() => {
  cleanup()
  navigate.mockReset()
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
