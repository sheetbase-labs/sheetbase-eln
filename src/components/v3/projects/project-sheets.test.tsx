import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectSheets, sheetOrigin } from './project-sheets'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  rename: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('#/lib/notebook-data', () => ({
  formatNotebookDateTime: (iso: string) => iso.slice(0, 10),
}))
vi.mock('#/lib/sheet-instance-data', () => ({
  fetchProjectSheets: (...args: unknown[]) => mocks.fetch(...args),
  renameSheetInstance: (...args: unknown[]) => mocks.rename(...args),
  archiveSheetInstance: (...args: unknown[]) => mocks.archive(...args),
  restoreSheetInstance: (...args: unknown[]) => mocks.restore(...args),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const sheet = (over: Record<string, unknown> = {}) => ({
  id: 'sheet-1',
  name: 'Cell count 14 Oct',
  displayId: 'SH-0007',
  revision: 3,
  notebookRecordId: null,
  sourceDefinitionVersionId: null,
  duplicatedFromInstanceId: null,
  updatedAt: '2026-10-14T09:00:00Z',
  ...over,
})

function renderTab() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectSheets projectId="p-1" />
    </QueryClientProvider>,
  )
}

describe('ProjectSheets', () => {
  it('lists the project’s sheets with their origin', async () => {
    mocks.fetch.mockResolvedValue([
      sheet(),
      sheet({
        id: 'sheet-2',
        name: 'Titre',
        displayId: null,
        sourceDefinitionVersionId: 'v',
      }),
    ])
    renderTab()
    expect(
      (await screen.findAllByText('Cell count 14 Oct')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('From a sheet definition').length,
    ).toBeGreaterThan(0)
    expect(mocks.fetch).toHaveBeenCalledWith('p-1', { archived: false })
  })

  it('renames with the sheet’s current revision', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValue([sheet()])
    mocks.rename.mockResolvedValue(sheet({ name: 'Renamed' }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
    await waitFor(() =>
      expect(mocks.rename).toHaveBeenCalledWith('sheet-1', 3, 'Renamed'),
    )
  })

  it('archives, and restores from the archived view', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValue([sheet()])
    mocks.archive.mockResolvedValue(sheet())
    renderTab()
    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith('sheet-1', 3),
    )

    mocks.fetch.mockResolvedValue([sheet({ id: 'sheet-9', revision: 5 })])
    mocks.restore.mockResolvedValue(sheet())
    await user.click(screen.getByRole('button', { name: 'Show archived' }))
    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith('sheet-9', 5),
    )
  })

  it('says what an empty project needs and offers New sheet', async () => {
    mocks.fetch.mockResolvedValue([])
    renderTab()
    expect(await screen.findByText('No sheets yet')).toBeTruthy()
    expect(
      screen.getAllByRole('link', { name: 'New sheet' }).length,
    ).toBeGreaterThan(0)
  })

  it('names a sheet’s origin in plain words', () => {
    expect(
      sheetOrigin({
        sourceDefinitionVersionId: null,
        duplicatedFromInstanceId: 'x',
      }),
    ).toBe('Copy of another sheet')
    expect(
      sheetOrigin({
        sourceDefinitionVersionId: null,
        duplicatedFromInstanceId: null,
      }),
    ).toBe('Working sheet')
  })
})
