import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Toaster, toast } from '#/components/ui/sonner'

const bodySchema = z.record(z.string(), z.json())
const writes: { rpc: string; body: z.infer<typeof bodySchema> }[] = []
const unexpected: string[] = []
let noSettings = false
let failGeneral = false

const row = {
  workspaces: { name: 'Process Development' }, site: 'Cambridge', timezone: 'Europe/London', date_format: 'd MMM yyyy', number_format: 'decimal',
  publication_approval_required: false, allow_offline_editing: true, require_change_reason: false, lock_on_sign: true, regulated_lab: false,
  id_prefixes: { experiment: 'EXP' },
}

const saveRpcs = new Set(['update_workspace_name', 'update_workspace_general', 'update_workspace_id_prefixes', 'update_workspace_publication_policy', 'update_workspace_settings', 'set_regulated_lab'])

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
  const resource = url.pathname.replace('/api/db/', '')

  if (resource === 'workspace_settings' && (!init?.method || init.method === 'GET')) return Response.json(noSettings ? [] : [row])

  if (resource === 'scheduler_settings' && (!init?.method || init.method === 'GET')) return Response.json([])

  if (resource === 'rpc/record_id_counters' && init?.method === 'POST') return Response.json([])
  const rpc = resource.replace('rpc/', '')

  if (resource.startsWith('rpc/') && saveRpcs.has(rpc) && init?.method === 'POST') {
    writes.push({ rpc, body: bodySchema.parse(await new Response(init.body).json()) })

    if (rpc === 'update_workspace_general' && failGeneral) return Response.json({ error: { code: 'denied', message: 'Could not save the time zone.' } }, { status: 403 })

    return Response.json(null)
  }

  unexpected.push(`${init?.method ?? 'GET'} ${url}`)
  throw new Error(`Unexpected general settings request: ${url}`)
})

const { SettingsGeneral } = await import('./settings-general')
const { dropSharedReads } = await import('#/lib/data-client')

function renderSection(workspaceName?: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SettingsGeneral workspaceId="ws-1" workspaceName={workspaceName} />
      <Toaster />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  toast.dismiss()
  dropSharedReads()
  expect(unexpected).toEqual([])
  unexpected.length = 0
  writes.length = 0
  noSettings = false
  failGeneral = false
})

afterAll(() => vi.unstubAllGlobals())

describe('SettingsGeneral', () => {
  it('loads the workspace settings and saves them', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByDisplayValue('Process Development')).toBeTruthy()
    expect(screen.getByDisplayValue('Cambridge')).toBeTruthy()

    const toggle = screen.getByRole('checkbox', {
      name: /Require approval before publishing dataset versions/,
    })

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    // EXP-05.5: offline editing is a workspace-wide switch.
    const offline = screen.getByRole('checkbox', {
      name: /Allow offline editing on this workspace’s devices/,
    })

    expect(offline.getAttribute('aria-checked')).toBe('true')
    await user.click(offline)
    expect(offline.getAttribute('aria-checked')).toBe('false')

    // Locking on approval and asking for a reason are real switches now.
    const lock = screen.getByRole('checkbox', {
      name: /Lock a record once it is approved and signed/,
    })

    expect(lock.getAttribute('aria-checked')).toBe('true')
    await user.click(lock)

    const reason = screen.getByRole('checkbox', {
      name: /Ask for a reason when a saved value changes/,
    })

    expect(reason.getAttribute('aria-checked')).toBe('false')
    await user.click(reason)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_general', body: expect.objectContaining({ p_workspace_id: 'ws-1', p_site: 'Cambridge' }) }),
    )
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_settings', body: { p_workspace_id: 'ws-1', p_require_change_reason: true, p_lock_on_sign: false } }),
    )
    expect(writes).toContainEqual({ rpc: 'update_workspace_name', body: { p_workspace_id: 'ws-1', p_name: 'Process Development' } })
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_publication_policy', body: { p_workspace_id: 'ws-1', p_required: true } }),
    )
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_settings', body: { p_workspace_id: 'ws-1', p_allow_offline_editing: false } }),
    )
    expect(await screen.findByText('Settings saved')).toBeTruthy()
  })

  it('turns the regulated-lab rules on, and only writes them when they changed', async () => {
    const user = userEvent.setup()
    renderSection()

    const regulated = await screen.findByRole('checkbox', {
      name: /This is a regulated lab/,
    })

    expect(regulated.getAttribute('aria-checked')).toBe('false')
    await user.click(regulated)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'set_regulated_lab', body: { p_workspace_id: 'ws-1', p_regulated: true } }),
    )
  })

  it('does not confirm a save that failed', async () => {
    failGeneral = true
    const user = userEvent.setup()
    renderSection()

    await user.type(await screen.findByLabelText('Site'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Could not save the time zone.'),
    ).toBeTruthy()
    expect(screen.queryByText('Settings saved')).toBeNull()
  })

  it('refuses a time zone that is not a real IANA zone', async () => {
    const user = userEvent.setup()
    renderSection()
    const timezone = await screen.findByLabelText<HTMLInputElement>('Time zone')

    const saveButton = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })

    expect(saveButton().disabled).toBe(true)

    await user.clear(timezone)
    await user.type(timezone, 'Mars/Olympus')
    expect(screen.getByText(/valid IANA time zone/i)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    expect(timezone.getAttribute('aria-invalid')).toBe('true')

    // Restoring the stored zone clears the error; the form is unchanged, so
    // there is still nothing to save.
    await user.clear(timezone)
    await user.type(timezone, 'Europe/London')
    expect(screen.queryByText(/valid IANA time zone/i)).toBeNull()
    expect(saveButton().disabled).toBe(true)
    expect(writes).toEqual([])
  })

  it('requires the workspace name rather than skipping the rename silently', async () => {
    const user = userEvent.setup()
    renderSection()

    const saveButton = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })

    const name =
      await screen.findByLabelText<HTMLInputElement>('Workspace name')

    // Empty the field through its input, as the audit did, with another
    // change pending so Save is otherwise available.
    await user.type(name, 'X')
    await user.clear(name)
    expect(name.value).toBe('')
    await user.type(screen.getByLabelText('Site'), '!')
    expect(screen.getByText('Enter a workspace name.')).toBeTruthy()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(saveButton().disabled).toBe(true)

    await user.type(name, 'Process Development 2')
    expect(screen.queryByText('Enter a workspace name.')).toBeNull()
    expect(saveButton().disabled).toBe(false)
    await user.click(saveButton())
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_name', body: { p_workspace_id: 'ws-1', p_name: 'Process Development 2' } }),
    )
  })

  it('enables Save only once a field has changed', async () => {
    renderSection()
    await screen.findByDisplayValue('Process Development')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })
        .disabled,
    ).toBe(true)
    await userEvent.type(screen.getByLabelText('Site'), '!')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })
        .disabled,
    ).toBe(false)
  })

  it('treats a cleared record-ID prefix as unchanged', async () => {
    const user = userEvent.setup()
    renderSection()

    const saveButton = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })

    await screen.findByDisplayValue('Process Development')
    const prefix = screen.getByLabelText<HTMLInputElement>('sample prefix')
    expect(saveButton().disabled).toBe(true)

    // Type then clear: nothing differs from the stored map, so Save goes
    // quiet again rather than staying enabled forever.
    await user.type(prefix, 'QA2X')
    expect(saveButton().disabled).toBe(false)
    await user.clear(prefix)
    expect(prefix.value).toBe('')
    expect(saveButton().disabled).toBe(true)
    expect(writes).toEqual([])
  })
  it('starts a workspace that has never saved settings from its name and the defaults', async () => {
    // The settings row is written by the first save, so a workspace that
    // skipped setup reads none.
    noSettings = true
    const user = userEvent.setup()
    renderSection('Fixture Workspace')
    expect(await screen.findByDisplayValue('Fixture Workspace')).toBeTruthy()
    expect(screen.queryByText('Enter a workspace name.')).toBeNull()
    expect(screen.getByDisplayValue('Europe/London')).toBeTruthy()

    const save = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Save changes',
    })

    expect(save.disabled).toBe(true)
    await user.type(screen.getByLabelText('Site'), 'Cambridge')
    expect(save.disabled).toBe(false)
    await user.click(save)
    await waitFor(() =>
      expect(writes).toContainEqual({ rpc: 'update_workspace_general', body: expect.objectContaining({ p_workspace_id: 'ws-1', p_site: 'Cambridge' }) }),
    )
  })
})
