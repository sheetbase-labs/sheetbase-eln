import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'
import { Toaster, toast } from '#/components/ui/sonner'
import type { WorkspaceSettingsWire } from '#/lib/workspace-admin'

const settings: WorkspaceSettingsWire = {
  id: 'settings-1',
  workspace_id: 'ws-1',
  registration_mode: 'open',
  review_workflow_enabled: false,
  review_workflow_config: {},
  signature_policy: {},
  audit_retention_days: 365,
  integration_settings: {},
  instrument_gate_mode: 'warn',
  created_by_user_id: 'user-1',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

const writeSchema = z.object({
  p_workspace_id: z.string(),
  p_mode: z.enum(['off', 'warn', 'block']),
})

const writes: z.infer<typeof writeSchema>[] = []
let refused = false

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname === '/api/db/workspace_settings') {
    expect(url.searchParams.get('workspace_id')).toBe('eq.ws-1')

    return Response.json([settings])
  }

  if (url.pathname === '/api/db/rpc/set_instrument_gate_mode') {
    expect(init?.method).toBe('POST')
    const write = writeSchema.parse(await new Response(init?.body).json())
    writes.push(write)

    if (refused)
      return Response.json({ message: 'Permission denied.' }, { status: 403 })
    settings.instrument_gate_mode = write.p_mode

    return Response.json(null)
  }

  throw new Error(`Unexpected instrument setting request: ${url}`)
})

const { InstrumentGateSetting } = await import('./instrument-gate-setting')
const { dropSharedReads } = await import('#/lib/data-client')

beforeEach(() => {
  settings.instrument_gate_mode = 'warn'
  writes.length = 0
  refused = false
})

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  toast.dismiss()
  cleanup()
  dropSharedReads()
})

function renderSetting(canManage: boolean) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstrumentGateSetting workspaceId="ws-1" canManage={canManage} />
      <Toaster />
    </QueryClientProvider>,
  )
}

describe('InstrumentGateSetting', () => {
  it('shows the current rule and saves a different one', async () => {
    const user = userEvent.setup()
    renderSetting(true)

    const select = screen.getByLabelText<HTMLSelectElement>(
      'When an instrument isn’t ready',
    )

    expect(select.value).toBe('warn')
    expect(screen.getByText(/marked with what was wrong/)).toBeTruthy()

    await user.selectOptions(select, 'block')

    await waitFor(() =>
      expect(writes).toEqual([{ p_workspace_id: 'ws-1', p_mode: 'block' }]),
    )
    expect(select.value).toBe('block')
    expect(await screen.findByText('Instrument rule saved')).toBeTruthy()
  })

  it('is read-only for someone who cannot manage instruments', () => {
    renderSetting(false)
    expect(
      screen.getByLabelText<HTMLSelectElement>('When an instrument isn’t ready')
        .disabled,
    ).toBe(true)
    expect(writes).toEqual([])
  })

  it('restores the saved mode and reports a refused write', async () => {
    refused = true
    const user = userEvent.setup()
    renderSetting(true)

    const select = screen.getByLabelText<HTMLSelectElement>(
      'When an instrument isn’t ready',
    )

    await user.selectOptions(select, 'off')
    expect(await screen.findByText('Permission denied.')).toBeTruthy()
    await waitFor(() => expect(select.value).toBe('warn'))
    expect(writes).toEqual([{ p_workspace_id: 'ws-1', p_mode: 'off' }])
  })
})
