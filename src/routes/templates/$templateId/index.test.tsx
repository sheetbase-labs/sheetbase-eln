/**
 * A template reads like the notebook it makes: its blocks drawn as an
 * experiment draws them, its parts along the top, and no raw keys. Edits made
 * on the page, or in the parts and settings dialogs, collect in a draft that
 * saves through create_notebook_template_version as a new version.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { createFileRoute as createRoute } from '@tanstack/react-router'
import type { notebookTemplateDataClient as templateClient } from '#/lib/notebook-template-data'

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'

import { Route } from './index'
import { extensionQueryKeys } from '#/lib/extensions/client'
import type * as NotebookTemplateData from '#/lib/notebook-template-data'
import type * as Router from '@tanstack/react-router'

const ids = vi.hoisted(() => ({
  template: '00000000-0000-4000-8000-000000000009',
  workspace: '00000000-0000-4000-8000-00000000000a',
  v1: '00000000-0000-4000-8000-000000000001',
  v2: '00000000-0000-4000-8000-000000000002',
  v3: '00000000-0000-4000-8000-000000000003',
  first: '00000000-0000-4000-8000-000000000021',
  second: '00000000-0000-4000-8000-000000000022',
  third: '00000000-0000-4000-8000-000000000023',
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the route builds its route object from createFileRoute at import time, so the router's factories are the only seam a unit test has; the route's own options are what the test renders.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  createFileRoute:
    () => (options: Parameters<ReturnType<typeof createRoute>>[0]) => ({
      options,
      useParams: () => ({ templateId: ids.template }),
      useRouteContext: () => ({
        context: { workspace: { id: 'ws-1', role: 'admin' } },
      }),
    }),
}))

const sonner = vi.hoisted(() => ({ toast: vi.fn(), error: vi.fn() }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the screen reports failures through the shared toaster; this suite asserts those calls without mounting the real sonner portal.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(sonner.toast, { error: sonner.error }),
}))

const client = vi.hoisted(() => {
  const noRows: unknown[] = []

  return {
    list: vi.fn(async (_resource: string, _query?: string) => noRows),
    count: vi.fn(async () => 0),
    rpc: vi.fn(
      async (
        _name: string,
        _args?: Parameters<(typeof templateClient)['rpc']>[1],
      ) => ({}),
    ),
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- template reads and writes need a database; the module's mappers stay real so the screen renders rows shaped exactly as it sees them in production.
vi.mock('#/lib/notebook-template-data', async (importOriginal) => {
  const actual = await importOriginal<typeof NotebookTemplateData>()

  return {
    ...actual,
    notebookTemplateDataClient: client,
    // createNotebookTemplateVersion calls its own module's client, so the mock
    // answers the RPC itself, with the argument names the real helper sends.
    createNotebookTemplateVersion: async (
      templateId: string,
      expectedTemplateRevision: number,
      configurationInput: Parameters<
        typeof actual.createNotebookTemplateVersion
      >[2],
    ) => {
      const row = await client.rpc('create_notebook_template_version', {
        p_template_id: templateId,
        p_expected_template_revision: expectedTemplateRevision,
        p_configuration: configurationInput,
      })

      return actual.notebookTemplateVersionFromWire(row)
    },
  }
})

function templateWire() {
  return {
    id: ids.template,
    workspace_id: ids.workspace,
    key: 'depth_filter',
    name: 'Depth-filter clarification screen',
    description: null,
    display_id: 'TPL-006',
    lifecycle: 'active',
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
  }
}

function placeholder(order: number, key: string, label: string) {
  return {
    id: order === 1 ? ids.first : ids.second,
    kind: 'section_placeholder',
    order,
    key,
    label,
  }
}

/** A template configuration as the endpoint stores it. */
interface ConfigurationWire {
  formatVersion: number
  parameters: unknown[]
  parts?: readonly unknown[]
  placements: readonly unknown[]
}

/** A procedure step placement as the endpoint stores it. */
interface StepWire {
  id: string
  kind: string
  order: number
  blockType: string
  payload: { text: string; stepNumber: number }
  partId?: string
}

function configuration(
  placements: readonly unknown[],
  parts?: readonly unknown[],
) {
  const config: ConfigurationWire = {
    formatVersion: 1,
    parameters: [],
    placements,
  }

  if (parts) config.parts = parts

  return config
}

const partIds = {
  treat: '00000000-0000-4000-8000-000000000031',
  verify: '00000000-0000-4000-8000-000000000032',
}

function text(order: number, id: string, heading: string, body: string) {
  return {
    id,
    kind: 'narrative',
    order,
    blockType: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: heading }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: body }] },
        ],
      },
    },
  }
}

function step(order: number, id: string, body: string, partId?: string) {
  const placement: StepWire = {
    id,
    kind: 'narrative',
    order,
    blockType: 'procedure_step',
    payload: { text: body, stepNumber: order },
  }

  if (partId) placement.partId = partId

  return placement
}

/** One stored template version as the endpoint returns it. */
interface TemplateVersionRow {
  id: string
  template_id: string
  version: number
  lifecycle: string
  configuration_format_version: number
  configuration: ReturnType<typeof configuration>
  revision: number
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
  published_at: string | null
  published_by_user_id: string | null
  reason: string | null
  signed_by_user_id: string | null
  signed_meaning: string | null
  signed_at: string | null
  retired_at: string | null
  retired_by_user_id: string | null
}

function templateVersionRow(): TemplateVersionRow {
  return {
    id: ids.v1,
    template_id: ids.template,
    version: 1,
    lifecycle: 'draft',
    configuration_format_version: 1,
    configuration: configuration([]),
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: null,
    published_by_user_id: null,
    reason: null,
    signed_by_user_id: null,
    signed_meaning: null,
    signed_at: null,
    retired_at: null,
    retired_by_user_id: null,
  }
}

function versionWire(
  overrides: Partial<ReturnType<typeof templateVersionRow>> = {},
) {
  return { ...templateVersionRow(), ...overrides }
}

function withVersions(versions: unknown[]) {
  client.list.mockImplementation(async (resource: string) => {
    if (resource === 'notebook_template_versions') return versions

    if (resource === 'notebook_templates') return [templateWire()]

    return []
  })
}

function renderRoute() {
  // SAFETY: the route declares `component` in its options, so the option holds the screen component this suite renders.
  const Component = Route.options.component as React.ComponentType

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  queryClient.setQueryData([...extensionQueryKeys.extensions, 'points'], [])

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <Component />
      </RouterContextProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  sonner.toast.mockReset()
  sonner.error.mockReset()
  client.list.mockReset()
  client.rpc.mockReset()
})

function savedConfiguration() {
  const call = client.rpc.mock.calls.find(
    ([name]) => name === 'create_notebook_template_version',
  )

  if (!call) throw new Error('The draft was not saved')

  // SAFETY: the RPC is called with the helper's named arguments.
  return (call[1] as { p_configuration: ReturnType<typeof configuration> })
    .p_configuration
}

describe('Template notebook', () => {
  it('draws the blocks themselves, with no raw keys or kinds', async () => {
    withVersions([
      versionWire({
        configuration: configuration([
          text(1, ids.first, 'Objective', 'Find the benzonase dose.'),
          step(2, ids.third, 'Add benzonase at 50 U/mL'),
          placeholder(3, 'pressure_dp', 'Pressure and ΔP'),
        ]),
      }),
    ])
    renderRoute()

    expect(await screen.findByText('Find the benzonase dose.')).toBeTruthy()
    expect(screen.getByText('Add benzonase at 50 U/mL')).toBeTruthy()
    expect(screen.getByText('Pressure and ΔP')).toBeTruthy()

    const page = document.body.textContent

    for (const raw of [
      'rich_text',
      'procedure_step',
      'narrative block',
      'pressure_dp',
    ]) {
      expect(page).not.toContain(raw)
    }
  })

  it('shows one part at a time, picked from the parts strip', async () => {
    withVersions([
      versionWire({
        configuration: configuration(
          [
            step(1, ids.first, 'Treat the harvest', partIds.treat),
            step(2, ids.second, 'Run the DNA assay', partIds.verify),
          ],
          [
            { id: partIds.treat, title: 'Treat', dayOffset: 0 },
            { id: partIds.verify, title: 'Verify', dayOffset: 1 },
          ],
        ),
      }),
    ])
    renderRoute()

    const strip = await screen.findByRole('navigation', {
      name: 'Parts of this template',
    })

    expect(within(strip).getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Treat the harvest')).toBeTruthy()
    expect(screen.queryByText('Run the DNA assay')).toBeNull()

    fireEvent.click(within(strip).getByRole('button', { name: /2\. Verify/ }))

    expect(await screen.findByText('Run the DNA assay')).toBeTruthy()
    expect(screen.queryByText('Treat the harvest')).toBeNull()
  })

  it('says where the template stands in plain words', async () => {
    withVersions([
      versionWire({
        id: ids.v1,
        version: 1,
        lifecycle: 'published',
        published_at: '2026-01-02T00:00:00.000Z',
      }),
      versionWire({ id: ids.v2, version: 2 }),
    ])
    renderRoute()

    // The inspector names the version the page shows.
    expect(await screen.findByText(/Draft\s+v2/)).toBeTruthy()
  })

  it('adds a named section, then saves the draft as a new version', async () => {
    withVersions([
      versionWire({
        id: ids.v1,
        version: 1,
        lifecycle: 'published',
        published_at: '2026-01-02T00:00:00.000Z',
        configuration: configuration([placeholder(1, 'first', 'First')]),
      }),
      versionWire({
        id: ids.v2,
        version: 2,
        configuration: configuration([placeholder(1, 'first', 'First')]),
      }),
    ])
    client.rpc.mockResolvedValue(versionWire({ id: ids.v3, version: 3 }))
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit parts' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Pressure and ΔP'), {
      target: { value: 'Pressure and ΔP' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Save as draft v3' }),
    )

    await waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1))
    expect(savedConfiguration().placements).toEqual([
      {
        id: ids.first,
        kind: 'section_placeholder',
        order: 1,
        key: 'first',
        label: 'First',
      },
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        kind: 'section_placeholder',
        order: 2,
        // The key follows the name; nobody types one.
        key: 'pressure_and_p',
        label: 'Pressure and ΔP',
      },
    ])
    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith(
        'Saved as v3',
        expect.anything(),
      ),
    )
  })

  it('adds a setting asked when the template is used', async () => {
    withVersions([versionWire()])
    client.rpc.mockResolvedValue(versionWire({ id: ids.v2, version: 2 }))
    renderRoute()

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit what’s asked when used',
      }),
    )
    fireEvent.change(screen.getByPlaceholderText('e.g. Sample'), {
      target: { value: 'Run count' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
      target: { value: 'integer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    expect(screen.getAllByText('Run count').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft v2' }))

    await waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1))
    expect(savedConfiguration().parameters).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        key: 'run_count',
        label: 'Run count',
        required: false,
        type: { kind: 'scalar', valueType: 'integer' },
        constraints: {},
      },
    ])
  })

  it('names a failed save and keeps the edits', async () => {
    withVersions([versionWire()])
    client.rpc.mockRejectedValue(new Error('template revision changed'))
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit parts' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Pressure and ΔP'), {
      target: { value: 'Notes' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft v2' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t save the new version')
    expect(alert.textContent).toContain('template revision changed')
    expect(sonner.toast).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Save as draft v2' }),
    ).toBeTruthy()
  })
})
