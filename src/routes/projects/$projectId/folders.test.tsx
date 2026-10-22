import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { Route } from './folders'

const { moveRecords } = vi.hoisted(() => ({
  moveRecords: vi.fn().mockResolvedValue(1),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ projectId: 'p1' }),
    useRouteContext: () => ({ context: { user: { id: 'u1' } } }),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('../$projectId', () => ({
  statusLabel: (status: string) => status,
  statusTone: () => 'neutral',
}))
vi.mock('#/components/v3/projects/project-data', () => ({
  useProjectSummary: () => ({ project: { id: 'p1', title: 'Project' } }),
  fetchProjectFolders: async () => [
    { id: 'f1', name: 'First destination', parent_id: null },
    { id: 'f2', name: 'Second destination', parent_id: null },
  ],
  fetchProjectMembers: async () => [{ user_id: 'u1', access_level: 'editor' }],
  createProjectFolder: vi.fn(),
  deleteProjectFolder: vi.fn(),
  renameProjectFolder: vi.fn(),
  moveRecordsToFolder: moveRecords,
}))
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  notebookQueryKeys: { records: (id: string) => ['records', id] },
  fetchRecordsForProject: async () => [
    {
      id: 'r1',
      identifier: 'EXP-001',
      title: 'Notebook',
      kind: 'experiment',
      status: 'draft',
      updatedAt: '2026-10-22',
      folderId: null,
    },
  ],
}))

// Keep both dialogs addressable. Modal focus trapping is not the ownership contract.
vi.mock('#/components/v3/ui/dialog', () => {
  const Content = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <section role="dialog">{children}</section> : null,
    DialogContent: Content,
    DialogBody: Content,
    DialogFooter: Content,
    DialogHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
    DialogClose: Content,
  }
})

afterEach(() => {
  cleanup()
  moveRecords.mockClear()
})

it('moves to the second instance’s destination without reading the first dialog', async () => {
  const Folders = Route.options.component!
  const mount = () =>
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Folders />
      </QueryClientProvider>,
    )
  const first = mount()
  const second = mount()
  for (const instance of [first, second]) {
    fireEvent.click(
      await within(instance.container).findByRole('checkbox', {
        name: 'Select EXP-001',
      }),
    )
    fireEvent.click(
      within(instance.container).getByRole('button', { name: 'Move…' }),
    )
  }
  fireEvent.change(
    within(first.container).getByRole('combobox', {
      name: 'Destination folder',
    }),
    { target: { value: 'f1' } },
  )
  fireEvent.change(
    within(second.container).getByRole('combobox', {
      name: 'Destination folder',
    }),
    { target: { value: 'f2' } },
  )
  fireEvent.click(
    within(second.container).getByRole('button', { name: 'Move' }),
  )
  await waitFor(() =>
    expect(moveRecords).toHaveBeenCalledWith('p1', ['r1'], 'f2'),
  )
  expect(moveRecords).toHaveBeenCalledTimes(1)
  expect(within(first.container).getByRole('dialog')).toBeTruthy()
})
