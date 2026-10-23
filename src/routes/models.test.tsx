import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './models'
import { WorkspaceNavigationContext } from '#/components/workspace/workspace-navigation'
import type { WorkspaceNavigation } from '#/components/workspace/workspace-navigation'
import type * as ModelCreate from '#/components/v3/models/model-create-dialog'
import type { ModelRow } from '#/components/v3/models/models-data'
import { DataClientError } from '#/lib/data-client'

/** The route owns the create flow: whether the control is offered at all (the
 * RPC's `schema.edit` requirement), and what a create does afterwards. The
 * dialog's own validation lives in its component test. */
const { navigate, toast, createDatasetSchemaDefinition, ctx, seen, rows } =
  vi.hoisted(() => {
    const searchDefault: { create?: true; returnTo?: string } = {}
    return {
      navigate: vi.fn(async () => undefined),
      toast: Object.assign(vi.fn(), { error: vi.fn() }),
      createDatasetSchemaDefinition: vi.fn(async () => ({
        schema_definition_id: 'def-new',
        schema_version_id: 'ver-new',
      })),
      ctx: {
        value: {
          user: { id: 'user-1', name: 'Gareth P.', email: 'g@test.invalid' },
          workspace: { id: 'ws-1', slug: 'dev', name: 'Dev', role: 'owner' },
        },
      },
      seen: {
        dialog: null as null | Record<string, unknown>,
        search: searchDefault,
      },
      rows: { value: [] as ModelRow[] },
    }
  })

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({ context: ctx.value }),
    useSearch: () => seen.search,
    options: config,
  }),
  Link: ({
    children,
    to,
    onClick,
  }: {
    children?: React.ReactNode
    to?: unknown
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  redirect: (options: unknown) => options,
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/models' } }),
}))

vi.mock('#/components/v3/models/models-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModels: () => ({ data: rows.value, isLoading: false }),
}))

vi.mock('#/components/v3/projects/project-data', () => ({
  useWorkspaceMemberNames: () => ({ data: undefined }),
}))

vi.mock('#/lib/dataset-schema-definition-rpc', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createDatasetSchemaDefinition,
}))

vi.mock(
  '#/components/v3/models/model-create-dialog',
  async (importOriginal) => ({
    ...(await importOriginal<typeof ModelCreate>()),
    ModelCreateDialog: (props: Record<string, unknown>) => {
      seen.dialog = props
      return props.open ? <div data-testid="model-create-dialog" /> : null
    },
  }),
)

vi.mock('#/components/v3/ui/sonner', () => ({ toast }))

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    kind: 'dataset',
    id: 'def-1',
    key: 'cell_bank',
    name: 'Cell bank',
    description: null,
    lifecycle: 'active',
    display_id: 'MDL-0012',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    created_by_user_id: null,
    versions: [],
    latestVersion: null,
    publishedVersion: null,
    fieldCount: 3,
    datasetCount: 1,
    ...overrides,
  }
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  ctx.value.workspace.role = 'owner'
  seen.dialog = null
  seen.search = {}
  rows.value = [model()]
})

function renderRoute(workspace: WorkspaceNavigation | null = null) {
  const Component = Route.options.component
  if (!Component) throw new Error('Models route component required')
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkspaceNavigationContext value={workspace}>
        <Component />
      </WorkspaceNavigationContext>
    </QueryClientProvider>,
  )
}

describe('models route create flow', () => {
  it('opens the actual model page beside and leaves modified links native', () => {
    const open = vi.fn()
    renderRoute({ open })
    const link = screen.getByRole('link', { name: 'Cell bank' })
    expect(fireEvent.click(link)).toBe(false)
    expect(open).toHaveBeenCalledWith('/models/def-1', {
      beside: true,
      title: 'Cell bank',
    })
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.click(link, { [modifier]: true })).toBe(true)
    }
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Model details')).toBeNull()
  })

  it('offers New model to a role that holds schema.edit', () => {
    renderRoute()
    expect(screen.getByRole('button', { name: 'New model' })).toBeTruthy()
  })

  it('does not offer the control to a role the server would refuse, and says why', () => {
    ctx.value.workspace.role = 'member'
    renderRoute()
    expect(screen.queryByRole('button', { name: 'New model' })).toBeNull()
    expect(
      screen.getByText(
        'Your workspace role cannot create models. Ask a workspace owner, admin or steward, or ask them to make you one.',
      ),
    ).toBeTruthy()
  })

  it('opens the dialog, then creates through the RPC and selects the new row', async () => {
    renderRoute()
    await act(async () => {
      screen.getByRole('button', { name: 'New model' }).click()
    })
    expect(seen.dialog?.open).toBe(true)

    const onCreate = seen.dialog?.onCreate as (input: unknown) => void
    await act(async () => {
      onCreate({
        key: 'cell_bank_reading',
        name: 'Cell bank reading',
        description: null,
      })
    })

    await waitFor(() =>
      expect(createDatasetSchemaDefinition).toHaveBeenCalledWith(
        expect.anything(),
        {
          workspaceId: 'ws-1',
          key: 'cell_bank_reading',
          name: 'Cell bank reading',
          description: null,
        },
      ),
    )
    expect(toast).toHaveBeenCalledWith(
      'Model “Cell bank reading” created',
      expect.objectContaining({ description: expect.any(String) }),
    )
    // The new definition is a draft: the board lands on All with its row
    // selected, so the row it just created is the one on screen.
    const [target] = navigate.mock.calls[0] as unknown as [
      {
        to: string
        search: (s: Record<string, unknown>) => Record<string, unknown>
      },
    ]
    expect(target.to).toBe('/models')
    expect(target.search({ q: 'cell' })).toEqual({
      q: 'cell',
      tab: undefined,
      selected: 'def-new',
    })
  })

  it('reports the server’s refusal in the dialog instead of closing it', async () => {
    createDatasetSchemaDefinition.mockRejectedValueOnce(
      new DataClientError(
        'SB071',
        'invalid Dataset Schema Definition metadata',
        400,
      ),
    )
    renderRoute()
    await act(async () => {
      screen.getByRole('button', { name: 'New model' }).click()
    })
    const onCreate = seen.dialog?.onCreate as (input: unknown) => void
    await act(async () => {
      onCreate({ key: 'cell_bank', name: 'Cell bank', description: null })
    })
    await waitFor(() =>
      expect(seen.dialog?.error).toBe(
        'invalid Dataset Schema Definition metadata',
      ),
    )
    expect(seen.dialog?.open).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('models route detours (Phase 4)', () => {
  it('opens the create dialog when a page sends the person here to make a model', () => {
    seen.search = { create: true, returnTo: '/datasets/new' }
    renderRoute()
    expect(seen.dialog?.open).toBe(true)
  })

  it('does not open the dialog for a role that cannot create', () => {
    ctx.value.workspace.role = 'member'
    seen.search = { create: true }
    renderRoute()
    expect(seen.dialog?.open).toBeFalsy()
  })

  it('offers the way back after creating, carrying the new model', async () => {
    seen.search = { returnTo: '/datasets/new' }
    renderRoute()
    expect(
      screen.getByRole('link', { name: 'Back to what you were doing' }),
    ).toBeTruthy()
    await act(async () => {
      screen.getByRole('button', { name: 'New model' }).click()
    })
    const onCreate = seen.dialog?.onCreate as (input: unknown) => void
    await act(async () => {
      onCreate({ key: 'reading', name: 'Reading', description: null })
    })
    await waitFor(() => expect(toast).toHaveBeenCalled())
    const options = toast.mock.calls[0][1] as {
      action: { label: string; onClick: () => void }
    }
    expect(options.action.label).toBe('Back to what you were doing')
    options.action.onClick()
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/datasets/new?model=def-new',
    })
  })
})
