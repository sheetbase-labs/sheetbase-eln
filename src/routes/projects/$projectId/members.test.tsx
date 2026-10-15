import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './members'

const mocks = vi.hoisted(() => ({
  fetchProjectMembers: vi.fn(),
  fetchWorkspaceMemberIdentities: vi.fn(),
  removeProjectMember: vi.fn(),
  setProjectMember: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useRouteContext: () => ({ context: { user: { id: 'gareth' } } }),
  }),
}))

vi.mock('#/components/v3/projects/project-data', () => ({
  useProjectSummary: () => ({
    project: { id: 'project-1', leadUserId: 'gareth', leadName: 'Gareth P.' },
    query: { isLoading: false },
  }),
  fetchProjectMembers: (...args: unknown[]) => mocks.fetchProjectMembers(...args),
  fetchWorkspaceMemberIdentities: (...args: unknown[]) =>
    mocks.fetchWorkspaceMemberIdentities(...args),
  removeProjectMember: (...args: unknown[]) =>
    mocks.removeProjectMember(...args),
  setProjectMember: (...args: unknown[]) => mocks.setProjectMember(...args),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fetchProjectMembers.mockResolvedValue([
    {
      user_id: 'u-mei',
      name: 'Mei L.',
      access_level: 'editor',
      workspace_role: 'member',
      project_role: null,
      is_lead: false,
      added_at: '2026-01-01T00:00:00Z',
    },
  ])
  mocks.fetchWorkspaceMemberIdentities.mockResolvedValue([])
  mocks.removeProjectMember.mockResolvedValue(undefined)
  mocks.setProjectMember.mockResolvedValue(undefined)
})

const ProjectMembers = Route.options.component as React.ComponentType

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProjectMembers />
    </QueryClientProvider>,
  )
}

describe('project members', () => {
  it('confirms before removing someone from the project', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Mei L.')
    await user.click(
      screen.getByRole('button', { name: 'Change access for Mei L.' }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Remove from project' }),
    )
    expect(mocks.removeProjectMember).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole('button', { name: 'Remove from project' }),
    )
    await waitFor(() =>
      expect(mocks.removeProjectMember).toHaveBeenCalledWith(
        'project-1',
        'u-mei',
      ),
    )
  })

  it('offers the access levels the table and help copy describe', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Mei L.')
    await user.click(
      screen.getByRole('button', { name: 'Change access for Mei L.' }),
    )
    for (const level of ['Editor', 'Reviewer', 'Viewer']) {
      expect(await screen.findByRole('menuitem', { name: level })).toBeTruthy()
    }
    await user.click(screen.getByRole('menuitem', { name: 'Reviewer' }))
    await waitFor(() =>
      expect(mocks.setProjectMember).toHaveBeenCalledWith(
        'project-1',
        'u-mei',
        'reviewer',
      ),
    )
  })
})
