/**
 * QA-138 — the Sections view edits a template's stored configuration into a new
 * version: it adds, moves and removes sections, adds and removes scalar
 * parameters, saves through create_notebook_template_version, and names the
 * failure. The published version stays the one the view renders.
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

import { Route } from './index'
import type * as NotebookTemplateData from '#/lib/notebook-template-data'

const ids = vi.hoisted(() => ({
  template: '00000000-0000-4000-8000-000000000009',
  workspace: '00000000-0000-4000-8000-00000000000a',
  v1: '00000000-0000-4000-8000-000000000001',
  v2: '00000000-0000-4000-8000-000000000002',
  v3: '00000000-0000-4000-8000-000000000003',
  first: '00000000-0000-4000-8000-000000000021',
  second: '00000000-0000-4000-8000-000000000022',
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ templateId: ids.template }),
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const sonner = vi.hoisted(() => ({ toast: vi.fn(), error: vi.fn() }))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(sonner.toast, { error: sonner.error }),
}))

const client = vi.hoisted(() => {
  const noRows: unknown[] = []
  return {
    list: vi.fn(async (_resource: string, _query?: string) => noRows),
    count: vi.fn(async () => 0),
    rpc: vi.fn(async (_name: string, _args?: unknown) => ({})),
  }
})
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
      configuration: unknown,
    ) => {
      const row = await client.rpc('create_notebook_template_version', {
        p_template_id: templateId,
        p_expected_template_revision: expectedTemplateRevision,
        p_configuration: configuration,
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

function configuration(placements: Array<Record<string, unknown>>) {
  return { formatVersion: 1, parameters: [], placements }
}

function versionWire(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

function withVersions(versions: unknown[]) {
  client.list.mockImplementation(async (resource: string) => {
    if (resource === 'notebook_template_versions') return versions
    if (resource === 'notebook_templates') return [templateWire()]
    return []
  })
}

function renderRoute() {
  const Component = Route.options.component as React.ComponentType
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  )
}

function sectionRows() {
  const table = screen.getByRole('table', { name: 'Template sections' })
  return within(table).getAllByRole('row')
}

function addSection(key: string, label: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /Section key/ }), {
    target: { value: key },
  })
  fireEvent.change(screen.getByPlaceholderText('e.g. Pressure and ΔP'), {
    target: { value: label },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
}

afterEach(() => {
  cleanup()
  sonner.toast.mockReset()
  sonner.error.mockReset()
  client.list.mockReset()
  client.rpc.mockReset()
})

describe('Template sections editor', () => {
  it('shows the newest version, then saves an added section', async () => {
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

    // The board lists the newest version's sections, the open draft.
    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByText('First')).toBeTruthy()
    expect(screen.getByText('Draft v2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    addSection('pressure_dp', 'Pressure and ΔP')
    const [first, added] = sectionRows().slice(1)
    expect(within(first).getAllByRole('cell')[0].textContent).toBe('1')
    expect(within(added).getAllByRole('cell')[0].textContent).toBe('2')
    expect(within(added).getByText('Pressure and ΔP')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))

    await waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1))
    expect(client.rpc).toHaveBeenCalledWith(
      'create_notebook_template_version',
      {
        p_template_id: ids.template,
        p_expected_template_revision: 1,
        p_configuration: {
          formatVersion: 1,
          parameters: [],
          placements: [
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
              key: 'pressure_dp',
              label: 'Pressure and ΔP',
            },
          ],
        },
      },
    )
    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith(
        'Saved as v3',
        expect.anything(),
      ),
    )
    // Saving leaves edit mode.
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('moves and removes sections, rewriting the orders as 1..n', async () => {
    withVersions([
      versionWire({
        configuration: configuration([
          placeholder(1, 'first', 'First'),
          placeholder(2, 'second', 'Second'),
        ]),
      }),
    ])
    client.rpc.mockResolvedValue(versionWire({ id: ids.v2, version: 2 }))
    renderRoute()

    await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.click(screen.getByRole('button', { name: 'Move First down' }))
    const [first, second] = sectionRows().slice(1)
    expect(within(first).getAllByRole('cell')[1].textContent).toBe('Second')
    expect(within(second).getAllByRole('cell')[1].textContent).toBe('First')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Second' }))
    expect(sectionRows()).toHaveLength(2)
    expect(screen.queryByText('Second')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))

    await waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1))
    expect(client.rpc).toHaveBeenCalledWith(
      'create_notebook_template_version',
      {
        p_template_id: ids.template,
        p_expected_template_revision: 1,
        p_configuration: {
          formatVersion: 1,
          parameters: [],
          placements: [
            {
              id: ids.first,
              kind: 'section_placeholder',
              order: 1,
              key: 'first',
              label: 'First',
            },
          ],
        },
      },
    )
  })

  it('adds a scalar parameter of the chosen type, then saves it', async () => {
    withVersions([versionWire()])
    client.rpc.mockResolvedValue(versionWire({ id: ids.v2, version: 2 }))
    renderRoute()

    await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.change(screen.getByRole('textbox', { name: /Parameter key/ }), {
      target: { value: 'run_count' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. Sample'), {
      target: { value: 'Run count' },
    })
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'integer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    expect(screen.getByText('Run count')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Run count' }))
    expect(screen.queryByText('Run count')).toBeNull()

    // Re-add a parameter this time, so the payload carries one.
    fireEvent.change(screen.getByRole('textbox', { name: /Parameter key/ }), {
      target: { value: 'sample_id' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. Sample'), {
      target: { value: 'Sample' },
    })
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'integer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))

    await waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1))
    expect(client.rpc).toHaveBeenCalledWith(
      'create_notebook_template_version',
      {
        p_template_id: ids.template,
        p_expected_template_revision: 1,
        p_configuration: {
          formatVersion: 1,
          parameters: [
            {
              id: expect.stringMatching(/^[0-9a-f-]{36}$/),
              key: 'sample_id',
              label: 'Sample',
              required: false,
              type: { kind: 'scalar', valueType: 'integer' },
              constraints: {},
            },
          ],
          placements: [],
        },
      },
    )
  })

  it('surfaces the save failure and stays in edit mode', async () => {
    withVersions([versionWire()])
    client.rpc.mockRejectedValue(new Error('template revision changed'))
    renderRoute()

    await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not save the new version')
    expect(alert.textContent).toContain('template revision changed')
    expect(sonner.toast).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Save new version' }),
    ).toBeTruthy()
  })
})
