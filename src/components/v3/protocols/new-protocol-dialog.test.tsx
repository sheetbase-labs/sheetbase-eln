/**
 * J-NBK-04: the Protocols list can start a protocol, which opens on its
 * working document so it can be written and submitted for review.
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

import { NewProtocolDialog } from './new-protocol-dialog'

const PROJECT = '00000000-0000-4000-8000-0000000000a1'
const READ_ONLY = '00000000-0000-4000-8000-0000000000a2'

const nav = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => nav,
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const client = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notebookDataClient: client,
}))

const createBlank = vi.hoisted(() => vi.fn())
vi.mock('#/lib/notebook-create', () => ({
  createBlankExperiment: createBlank,
}))

const perm = {
  can_edit: true,
  can_review: false,
  can_manage: false,
  can_view: true,
  client_portal: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NewProtocolDialog', () => {
  it('creates a protocol_template in an editable project and opens its document', async () => {
    client.list.mockResolvedValue([
      {
        id: READ_ONLY,
        title: 'Aardvark (view only)',
        archived_at: null,
        status: 'active',
      },
      { id: PROJECT, title: 'Bravo', archived_at: null, status: 'active' },
    ])
    client.rpc.mockResolvedValue([
      { project_id: PROJECT, access_level: 'editor', ...perm },
      {
        project_id: READ_ONLY,
        access_level: 'viewer',
        ...perm,
        can_edit: false,
      },
    ])
    createBlank.mockResolvedValue({ id: 'rec-1', identifier: 'PRT-1' })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewProtocolDialog />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'New protocol' }))
    const project = await screen.findByRole('button', { name: /^Project/ })
    await waitFor(() => expect(project.textContent).toContain('Bravo'))
    fireEvent.click(project)
    const dialogs = await screen.findAllByRole('dialog')
    const picker = dialogs[dialogs.length - 1]
    await within(picker).findByRole('option', { name: /Bravo/ })
    expect(
      within(picker).queryByRole('option', { name: /Aardvark/ }),
    ).toBeNull()
    fireEvent.keyDown(picker, { key: 'Escape' })
    fireEvent.change(screen.getByPlaceholderText(/Depth-filter/), {
      target: { value: 'Depth-filter clarification' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create protocol' }))
    await waitFor(() =>
      expect(nav).toHaveBeenCalledWith({
        to: '/records/$recordId/notebook',
        params: { recordId: 'rec-1' },
      }),
    )
    expect(createBlank).toHaveBeenCalledWith(client, {
      projectId: PROJECT,
      title: 'Depth-filter clarification',
      kind: 'protocol_template',
    })
  })
})
