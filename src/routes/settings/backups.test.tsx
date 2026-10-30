import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSettingsAccess } from '#/lib/settings-access'
import type { BackupsOverview } from '#/lib/workspace-backups'

import { Route } from './backups'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  role: { current: 'owner' },
  level: { current: null as 'view' | null },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: {
          id: 'ws',
          name: 'Workspace',
          role: mocks.role.current,
          settingsAccess: mocks.level.current
            ? {
                ...resolveSettingsAccess('admin'),
                backups: mocks.level.current,
              }
            : undefined,
        },
      },
    }),
  }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('#/components/v3/settings/workspace-admins-line', () => ({
  WorkspaceAdminsLine: () => null,
}))
vi.mock('#/lib/workspace-backups', () => ({
  fetchBackupsFn: mocks.overview,
  saveBackupSettingsFn: mocks.save,
  runBackupNowFn: mocks.run,
}))

const succeeded = {
  id: 'b1',
  trigger: 'scheduled' as const,
  status: 'succeeded' as const,
  startedAt: '2026-10-29T03:00:00Z',
  finishedAt: '2026-10-29T03:01:00Z',
  destination: 'database',
  byteSize: 2_500_000,
  sha256: 'a'.repeat(64),
  tableCount: 30,
  rowCount: 1204,
  fileCount: 12,
  missingFileCount: 0,
  error: null,
}

const overview = (over: Partial<BackupsOverview> = {}): BackupsOverview => ({
  settings: { enabled: true, frequency: 'daily', keepCount: 7 },
  backups: [succeeded],
  destination: { name: 's3', separate: true },
  ...over,
})

function renderPage() {
  const Component = Route.options.component
  if (!Component) throw new Error('component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.role.current = 'owner'
  mocks.level.current = null
})

describe('Settings → Backups and export', () => {
  it('offers the export and lists recent backups with a download', async () => {
    mocks.overview.mockResolvedValue(overview())
    renderPage()
    const exportLink = (await screen.findByText('Download export')).closest('a')
    expect(exportLink?.getAttribute('href')).toBe('/api/export/workspace')
    const table = screen.getByRole('table')
    expect(within(table).getByText('Scheduled')).toBeTruthy()
    expect(within(table).getByText('Done')).toBeTruthy()
    expect(within(table).getByText('1,204 rows, 12 files')).toBeTruthy()
    expect(
      screen.getByLabelText(/^Download backup from/).getAttribute('href'),
    ).toBe('/api/export/workspace-backup/b1')
  })

  it('warns when backups sit in the same database, and not when they are apart', async () => {
    mocks.overview.mockResolvedValue(
      overview({ destination: { name: 'database', separate: false } }),
    )
    renderPage()
    expect(await screen.findByText(/they would be lost together/)).toBeTruthy()
    cleanup()
    mocks.overview.mockResolvedValue(overview())
    renderPage()
    await screen.findByText('Scheduled backups')
    expect(screen.queryByText(/they would be lost together/)).toBeNull()
  })

  it('saves a changed schedule', async () => {
    mocks.overview.mockResolvedValue(overview())
    mocks.save.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText('Scheduled backups')
    await userEvent.selectOptions(screen.getByLabelText('How often'), 'weekly')
    const keep = screen.getByLabelText(/Copies to keep/)
    await userEvent.clear(keep)
    await userEvent.type(keep, '14')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(mocks.save).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws',
        enabled: true,
        frequency: 'weekly',
        keepCount: 14,
      },
    })
  })

  it('will not save a number of copies outside 1 to 90', async () => {
    mocks.overview.mockResolvedValue(overview())
    renderPage()
    await screen.findByText('Scheduled backups')
    const keep = screen.getByLabelText(/Copies to keep/)
    await userEvent.clear(keep)
    await userEvent.type(keep, '200')
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save.hasAttribute('disabled')).toBe(true)
  })

  it('makes a backup on request and says when one is already running', async () => {
    mocks.overview.mockResolvedValue(overview())
    mocks.run.mockResolvedValue({ ok: false, reason: 'already_running' })
    renderPage()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Back up now' }),
    )
    expect(mocks.run).toHaveBeenCalledWith({ data: { workspaceId: 'ws' } })
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'A backup is already running',
    )
  })

  it('shows a failed run and a run with missing files', async () => {
    mocks.overview.mockResolvedValue(
      overview({
        backups: [
          {
            ...succeeded,
            id: 'b2',
            status: 'failed',
            error: 'bucket unreachable',
            byteSize: null,
          },
          { ...succeeded, id: 'b3', missingFileCount: 2 },
        ],
      }),
    )
    renderPage()
    expect(await screen.findByText('Failed')).toBeTruthy()
    expect(screen.getByText('Done, 2 files missing')).toBeTruthy()
  })

  it('shows an empty state before the first backup', async () => {
    mocks.overview.mockResolvedValue(overview({ backups: [] }))
    renderPage()
    expect(await screen.findByText('No backups yet')).toBeTruthy()
  })

  it('does not let a role without access open it', async () => {
    mocks.role.current = 'viewer'
    renderPage()
    expect(
      await screen.findByText('Only admins can open backups and export'),
    ).toBeTruthy()
    expect(mocks.overview).not.toHaveBeenCalled()
  })

  it('is read-only for a role that can only view', async () => {
    mocks.role.current = 'admin'
    mocks.level.current = 'view'
    mocks.overview.mockResolvedValue(overview())
    renderPage()
    await screen.findByText('Scheduled backups')
    expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByLabelText('How often').hasAttribute('disabled')).toBe(
      true,
    )
    expect(screen.queryByLabelText(/^Download backup from/)).toBeNull()
  })
})
