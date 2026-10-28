/**
 * The New experiment form: starting is the checkbox's job. Choosing a protocol
 * version pins the version on start; on its own it must leave a draft.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FORM_READ_TIMEOUT_MS, Route } from './new'

const NewExperimentRoute = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
const notebookCreate = vi.hoisted(() => ({
  createBlankExperiment: vi.fn(),
  applyExperimentSetup: vi.fn(),
  insertPinnedProtocol: vi.fn(),
}))
const navigate = vi.hoisted(() => vi.fn())
const order = vi.hoisted(() => [] as string[])
const acknowledgeProtocolVersion = vi.hoisted(() => vi.fn())
const search = vi.hoisted((): { current: Record<string, string> } => ({
  current: {},
}))
const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useSearch: () => search.current,
    options: config,
  }),
  useNavigate: () => navigate,
  redirect: (options: unknown) => options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

vi.mock('#/lib/notebook-create', () => notebookCreate)
vi.mock('#/lib/controlled-protocols', () => ({ acknowledgeProtocolVersion }))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: sonner.toast,
  Toaster: () => null,
}))

const PROTOCOL_VERSION = {
  id: 'pv-1',
  protocol_record_id: 'proto-1',
  version: 2,
}

const PROTOCOL = {
  id: 'proto-1',
  identifier: 'PRT-1',
  title: 'Protocol A',
}

const WRITABLE_PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const READ_ONLY_PROJECT_ID = '00000000-0000-4000-8000-000000000002'

function assignment(project_id: string, can_edit: boolean) {
  return {
    project_id,
    access_level: can_edit ? 'owner' : 'viewer',
    can_view: true,
    can_edit,
    can_review: false,
    can_manage: can_edit,
    client_portal: false,
  }
}

function project(id: string, title: string, archived = false) {
  return {
    id,
    title,
    archived_at: archived ? '2026-09-25T08:40:00.000Z' : null,
    status: archived ? 'complete' : 'in_progress',
  }
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {React.createElement(NewExperimentRoute)}
    </QueryClientProvider>,
  )
}

/** Fill the form, choose the effective protocol version, and submit. */
async function submitForm(
  user: UserEvent,
  { start = false, acknowledge = start } = {},
) {
  await screen.findByRole('option', { name: 'Project A' })
  // The create button stays disabled until project access resolves.
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: /^Project/ })
        .disabled,
    ).toBe(false),
  )
  await user.type(
    screen.getByRole('textbox', { name: /^Title/ }),
    'AAV9 stability',
  )
  await user.click(screen.getByRole('button', { name: 'A protocol' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: /^Protocol version to follow/ }),
    PROTOCOL_VERSION.id,
  )
  if (start) {
    await user.click(
      screen.getByRole('checkbox', { name: /Start the experiment now/ }),
    )
    if (acknowledge) {
      await user.click(
        screen.getByRole('checkbox', { name: /I have read this protocol/ }),
      )
    }
  }
  await user.click(
    screen.getByRole('button', {
      name: start ? 'Create and start' : 'Create draft',
    }),
  )
}

function rpcNames() {
  return dataClient.rpc.mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
  order.length = 0
  acknowledgeProtocolVersion.mockReset()
  acknowledgeProtocolVersion.mockResolvedValue({})
  notebookCreate.createBlankExperiment.mockResolvedValue({
    id: 'rec-1',
    identifier: 'EXP-0001',
  })
  notebookCreate.applyExperimentSetup.mockResolvedValue(undefined)
  notebookCreate.insertPinnedProtocol.mockResolvedValue(undefined)
  dataClient.list.mockImplementation(async (resource: string, query = '') => {
    if (resource === 'projects')
      return [project(WRITABLE_PROJECT_ID, 'Project A')]
    if (resource === 'protocol_versions') return [PROTOCOL_VERSION]
    if (resource === 'records') {
      if (query.includes('protocol_template')) return [PROTOCOL]
      if (query.includes('metadata_version')) return [{ metadata_version: 1 }]
      return []
    }
    return []
  })
  dataClient.rpc.mockImplementation(async (name: string) => {
    if (name === 'workspace_members_list') return []
    if (name === 'my_project_permissions')
      return [assignment(WRITABLE_PROJECT_ID, true)]
    return undefined
  })
})

afterEach(() => {
  search.current = {}
  cleanup()
  vi.clearAllMocks()
})

describe('new experiment', () => {
  it('links the sample handed over by the page that opened the form', async () => {
    search.current = { sample: 'smp-1' }
    const base = dataClient.list.getMockImplementation()!
    dataClient.list.mockImplementation(async (resource: string, query = '') =>
      resource === 'records' && query.includes('id=eq.smp-1')
        ? [{ id: 'smp-1', identifier: 'SMP-0001', title: 'Lysate' }]
        : base(resource, query),
    )
    const user = userEvent.setup()
    renderForm()
    expect(await screen.findByText(/SMP-0001/)).toBeTruthy()
    await submitForm(user)

    await waitFor(() =>
      expect(notebookCreate.applyExperimentSetup).toHaveBeenCalledWith(
        dataClient,
        'rec-1',
        expect.objectContaining({ sampleRecordId: 'smp-1' }),
      ),
    )
  })

  it('leaves a draft when a protocol version is chosen but Start now is unticked', async () => {
    const user = userEvent.setup()
    renderForm()
    await submitForm(user)

    await waitFor(() =>
      expect(notebookCreate.createBlankExperiment).toHaveBeenCalled(),
    )
    expect(notebookCreate.applyExperimentSetup).toHaveBeenCalledWith(
      dataClient,
      'rec-1',
      expect.objectContaining({ protocolRecordId: 'proto-1' }),
    )
    expect(rpcNames()).not.toContain('start_experiment')
  })

  it('starts with the pinned version when Start now is ticked', async () => {
    const user = userEvent.setup()
    renderForm()
    await submitForm(user, { start: true })

    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'start_experiment',
        expect.objectContaining({ p_protocol_version_id: 'pv-1' }),
      ),
    )
  })

  it('acknowledges the protocol version before creating anything when starting', async () => {
    acknowledgeProtocolVersion.mockImplementation(async () => {
      order.push('acknowledge')
    })
    notebookCreate.createBlankExperiment.mockImplementation(async () => {
      order.push('create')
      return { id: 'rec-1', identifier: 'EXP-0001' }
    })
    const user = userEvent.setup()
    renderForm()
    await submitForm(user, { start: true })

    await waitFor(() => expect(order).toEqual(['acknowledge', 'create']))
    expect(acknowledgeProtocolVersion).toHaveBeenCalledWith(
      dataClient,
      PROTOCOL_VERSION.id,
    )
  })

  it('does not create a draft when the protocol version is not acknowledged', async () => {
    const user = userEvent.setup()
    renderForm()
    await submitForm(user, { start: true, acknowledge: false })

    expect(
      await screen.findByText(/Acknowledge the protocol version/),
    ).toBeTruthy()
    expect(notebookCreate.createBlankExperiment).not.toHaveBeenCalled()
  })

  it('defaults to a project the account can edit and marks view-only projects', async () => {
    dataClient.list.mockImplementation(async (resource: string) => {
      if (resource === 'projects')
        return [
          project(READ_ONLY_PROJECT_ID, 'A view-only project'),
          project(WRITABLE_PROJECT_ID, 'B edit project'),
        ]
      return []
    })
    dataClient.rpc.mockImplementation(async (name: string) => {
      if (name === 'my_project_permissions')
        return [
          assignment(READ_ONLY_PROJECT_ID, false),
          assignment(WRITABLE_PROJECT_ID, true),
        ]
      return undefined
    })
    renderForm()

    const select = await screen.findByRole<HTMLSelectElement>('combobox', {
      name: /^Project/,
    })
    await waitFor(() => expect(select.value).toBe(WRITABLE_PROJECT_ID))

    const viewOnly = screen.getByRole<HTMLOptionElement>('option', {
      name: /A view-only project/,
    })
    expect(viewOnly.disabled).toBe(true)
    expect(viewOnly.textContent).toContain('read-only')
  })

  it('never defaults to an archived project and says why it is unusable', async () => {
    dataClient.list.mockImplementation(async (resource: string) => {
      if (resource === 'projects')
        return [
          project(READ_ONLY_PROJECT_ID, 'A archived project', true),
          project(WRITABLE_PROJECT_ID, 'B edit project'),
        ]
      return []
    })
    dataClient.rpc.mockImplementation(async (name: string) => {
      if (name === 'my_project_permissions')
        return [
          assignment(READ_ONLY_PROJECT_ID, true),
          assignment(WRITABLE_PROJECT_ID, true),
        ]
      return undefined
    })
    renderForm()

    const select = await screen.findByRole<HTMLSelectElement>('combobox', {
      name: /^Project/,
    })
    await waitFor(() => expect(select.value).toBe(WRITABLE_PROJECT_ID))

    const archived = screen.getByRole<HTMLOptionElement>('option', {
      name: /A archived project/,
    })
    expect(archived.disabled).toBe(true)
    expect(archived.textContent).toContain('archived')
  })

  it('states the access failure instead of hanging when the permission read never settles', async () => {
    vi.useFakeTimers()
    try {
      dataClient.rpc.mockImplementation((name: string) =>
        name === 'my_project_permissions'
          ? new Promise(() => {})
          : Promise.resolve(undefined),
      )
      renderForm()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FORM_READ_TIMEOUT_MS + 1000)
      })

      // The gate settles: the loading copy is gone and the failure is stated
      // with a retry, and the form is usable rather than inert.
      expect(
        screen.queryByText(/Checking which projects you can write to/),
      ).toBeNull()
      expect(
        screen.getByText(/Couldn’t check which projects you can write to/),
      ).toBeDefined()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: /^Project/ })
          .disabled,
      ).toBe(false)
      expect(
        screen.getByRole('button', {
          name: 'Create draft',
        }),
      ).toHaveProperty('disabled', false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('states the project-list failure instead of hanging when that read never settles', async () => {
    vi.useFakeTimers()
    try {
      dataClient.list.mockImplementation(() => new Promise(() => {}))
      renderForm()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FORM_READ_TIMEOUT_MS + 1000)
      })

      expect(screen.queryByText(/Loading the projects/)).toBeNull()
      expect(screen.getByText(/Couldn’t load the project list/)).toBeDefined()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
      // Nothing to choose, so the create stays unavailable — and says so.
      expect(
        screen.getByRole('button', {
          name: 'Create draft',
        }),
      ).toHaveProperty('disabled', true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the server refusal inline and in a toast when the create is denied', async () => {
    notebookCreate.createBlankExperiment.mockRejectedValue(
      new Error(
        'new row violates row-level security policy "records_live_insert" for table "records"',
      ),
    )
    const user = userEvent.setup()
    renderForm()
    await submitForm(user)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('permission')
    expect(alert.textContent).toContain('edit access')
    expect(sonner.toast.error).toHaveBeenCalledWith(
      expect.stringContaining('permission'),
    )
    expect(navigate).not.toHaveBeenCalled()
  })
})
