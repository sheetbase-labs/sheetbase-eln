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
import type * as ModelCreate from '#/components/models/model-create-dialog'
import type * as ModelsData from '#/components/models/models-data'
import type { ModelRow } from '#/components/models/models-data'
import type * as SchemaDefinitionRpc from '#/lib/dataset-schema-definition-rpc'
import { DataClientError } from '#/lib/data-client'

/** The router state the route selects from: the path it is showing. */
interface MockRouterState {
  location: { pathname: string }
}

/** The search the models board reads: a create detour, and where to go back to. */
interface ModelsSearch {
  create?: true
  returnTo?: string
}

/** The props the route hands the create dialog, as the dialog declares them. */
type ModelDialogProps = Parameters<typeof ModelCreate.ModelCreateDialog>[0]

/** The search a board navigation carries: the words typed, the tab, the row selected. */
interface BoardSearch {
  q?: string
  tab?: string
  selected?: string
}

/** What the doubles record between renders: the dialog's props and the page's search. */
interface SeenState {
  dialog: ModelDialogProps | null
  search: ModelsSearch
}

/** The rows the model list double answers with. */
interface RowsState {
  value: ModelRow[]
}

/** What the route navigates with: the board, with the row it made selected. */
interface ModelsNavigation {
  to: string
  search?: (search: { q?: string }) => BoardSearch
}

/** The route owns the create flow: whether the control is offered at all (the
 * RPC's `schema.edit` requirement), and what a create does afterwards. The
 * dialog's own validation lives in its component test. */
const { navigate, toast, createDatasetSchemaDefinition, ctx, seen, rows } =
  vi.hoisted(() => {
    const searchDefault: ModelsSearch = {}

    const seenState: SeenState = { dialog: null, search: searchDefault }

    const rowState: RowsState = { value: [] }

    return {
      navigate: vi.fn(async (_target: ModelsNavigation) => undefined),
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
      seen: seenState,
      rows: rowState,
    }
  })

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time, so this suite renders the route component directly and supplies the router context and search the shell would.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <TOptions,>(config: TOptions) => ({
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
    to?: string
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a href={to ?? '#'} onClick={onClick}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  redirect: <TOptions,>(options: TOptions) => options,
  useNavigate: () => navigate,
  useRouterState: <TSelected,>({
    select,
  }: {
    select: (state: MockRouterState) => TSelected
  }) => select({ location: { pathname: '/models' } }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The board's model list is a database read; this double supplies the rows the screen renders so the create flow can be driven without one.
vi.mock('#/components/models/models-data', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelsData>()),
  useModels: () => ({ data: rows.value, isLoading: false }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Member names are a database read the create flow does not assert; the double answers no names.
vi.mock('#/components/projects/project-data', () => ({
  useWorkspaceMemberNames: () => ({ data: undefined }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Creating a schema definition is a server RPC; the double records the call the route makes.
vi.mock('#/lib/dataset-schema-definition-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof SchemaDefinitionRpc>()),
  createDatasetSchemaDefinition,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The dialog is replaced by a double that records its props, so the suite asserts what the route hands it rather than the dialog's own markup.
vi.mock('#/components/models/model-create-dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelCreate>()),
  ModelCreateDialog: (props: ModelDialogProps) => {
    seen.dialog = props

    return props.open ? <div data-testid="model-create-dialog" /> : null
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Sonner mounts its own portal and store; the assertions read the toast calls, not the markup.
vi.mock('#/components/ui/sonner', () => ({ toast }))

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
  it('opens the model in the pane, beside on Alt-click, and leaves modified links native', () => {
    const open = vi.fn()
    renderRoute({ open })
    const link = screen.getByRole('link', { name: 'Cell bank' })
    // A plain click is the link's own: the pane navigates to the model.
    expect(fireEvent.click(link)).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(fireEvent.click(link, { altKey: true })).toBe(false)
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
        'Your role can’t create models. Ask an admin or data steward.',
      ),
    ).toBeTruthy()
  })

  it('opens the dialog, then creates through the RPC and selects the new row', async () => {
    renderRoute()
    await act(async () => {
      screen.getByRole('button', { name: 'New model' }).click()
    })
    expect(seen.dialog?.open).toBe(true)

    const onCreate = seen.dialog?.onCreate
    await act(async () => {
      onCreate?.({
        key: 'cell_bank_reading',
        name: 'Cell bank reading',
        description: null,
        kind: 'dataset',
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
    const [target] = navigate.mock.calls[0]

    expect(target.to).toBe('/models')
    expect(target.search?.({ q: 'cell' })).toEqual({
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
    const onCreate = seen.dialog?.onCreate
    await act(async () => {
      onCreate?.({
        key: 'cell_bank',
        name: 'Cell bank',
        description: null,
        kind: 'dataset',
      })
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
    const onCreate = seen.dialog?.onCreate
    await act(async () => {
      onCreate?.({
        key: 'reading',
        name: 'Reading',
        description: null,
        kind: 'dataset',
      })
    })
    await waitFor(() => expect(toast).toHaveBeenCalled())

    const options = toast.mock.calls[0][1]

    expect(options?.action?.label).toBe('Back to what you were doing')
    options?.action?.onClick()
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/datasets/new?model=def-new',
    })
  })
})
