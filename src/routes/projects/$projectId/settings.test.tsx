import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './settings'

const mocks = vi.hoisted(() => ({
  archivedAt: null as string | null,
  update: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useRouteContext: () => ({
      context: {
        user: { id: 'gareth' },
        workspace: { id: 'ws', role: 'member' },
      },
    }),
  }),
}))
vi.mock('#/components/v3/projects/project-data', () => ({
  PROJECTS_KEY: ['projects'],
  workspaceMemberQueryKeys: { identities: ['workspace-members'] },
  fetchWorkspaceMemberIdentities: async () => [
    { user_id: 'gareth', name: 'Gareth' },
    { user_id: 'mei', name: 'Mei' },
  ],
  projectDataClient: {
    list: async (table: string) =>
      table === 'clients'
        ? [{ id: 'client-17', code: 'CL-017', name: 'Client 17' }]
        : [],
    rpc: vi.fn(),
  },
  updateProjectDetails: (...args: unknown[]) => mocks.update(...args),
  useProjectSummary: () => ({
    project: {
      id: 'project-1',
      revision: '7',
      title: 'AAV9 transfer',
      clientId: 'client-17',
      clientCode: 'CL-017',
      modality: 'AAV9',
      stage: 'Tech transfer',
      leadUserId: 'gareth',
      defaultReviewerUserId: 'mei',
      agreementReference: 'AGR-17',
      startedOn: '2026-08-03',
      archivedAt: mocks.archivedAt,
    },
    query: {},
  }),
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.archivedAt = null
})
function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Project settings component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

describe('PROJ-01 typed settings replacement', () => {
  it('changing only the title preserves loaded client, modality, lead, reviewer and start date', async () => {
    const user = userEvent.setup()
    renderRoute()
    await screen.findByRole('option', { name: /Client 17/ })
    const title = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(title)
    await user.type(title, 'Renamed project')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'project-1', revision: '7' }),
        {
          title: 'Renamed project',
          clientId: 'client-17',
          modality: 'AAV9',
          stage: 'Tech transfer',
          leadUserId: 'gareth',
          defaultReviewerUserId: 'mei',
          agreementReference: 'AGR-17',
          startedOn: '2026-08-03',
        },
      ),
    )
  })

  it('an archived project cannot submit details through the settings controls', async () => {
    mocks.archivedAt = '2026-09-01T12:00:00Z'
    renderRoute()
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByRole('textbox', { name: 'Name' }).closest('fieldset'),
    ).toHaveProperty('disabled', true)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
