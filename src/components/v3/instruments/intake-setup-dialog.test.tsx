/**
 * Setting up an instrument's data intake from its page: how files are read,
 * where the data goes, then the agent download, without typing a key or an ID.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IntakeSetupDialog } from './intake-setup-dialog'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const SCHEMA = '33333333-3333-4333-8333-333333333333'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  setMethod: vi.fn(),
}))

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({
    rpc: mocks.rpc,
    list: async (resource: string) =>
      resource === 'projects'
        ? [{ id: PROJECT, title: 'Assay development' }]
        : [],
  }),
}))
vi.mock('#/components/v3/projects/use-writable-projects', () => ({
  useWritableProjects: () => ({
    usable: [{ id: PROJECT, title: 'Assay development' }],
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
}))
vi.mock('#/lib/dataset-product', () => ({
  listPublishedDatasetSchemas: async () => [
    { schemaVersionId: SCHEMA, name: 'qPCR results', version: 2 },
  ],
}))
vi.mock('#/lib/parser-settings', () => ({
  parserSettingsQueryKeys: { list: (id: string) => ['parsers', id] },
  fetchParserSettings: async () => [
    {
      id: 'p1',
      key: 'sheetbase.qpcr-results-csv',
      name: 'qPCR results (CSV)',
      format: 'csv',
      parser_versions: [
        {
          id: 'v1',
          version: 1,
          status: 'approved',
          signature: { engine: 'x' },
        },
      ],
    },
  ],
}))
vi.mock('#/lib/connectors/agent-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadAgent: mocks.download,
  fetchAgentStatus: async () => ({
    downloaded: false,
    lastSeenAt: null,
    running: false,
  }),
}))
vi.mock('#/components/v3/instruments/instruments-data', () => ({
  setInstrumentIntakeMethod: mocks.setMethod,
}))

function renderDialog(
  props: Partial<Parameters<typeof IntakeSetupDialog>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <IntakeSetupDialog
        workspaceId="w1"
        instrument={{ id: 'i1', name: 'qPCR bench', displayId: 'INS-3' }}
        intakeMethod="none"
        connector={null}
        canManage
        onClose={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('IntakeSetupDialog', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.download.mockReset()
    mocks.setMethod.mockReset()
    mocks.rpc.mockImplementation(
      async (_name: string, args: Record<string, unknown>) => ({
        id: 'c1',
        key: args.p_key,
        config: args.p_config,
      }),
    )
    mocks.download.mockResolvedValue('sheetbase-agent-qpcr-bench.zip')
  })
  afterEach(cleanup)

  it('walks from how files are read, to where they go, to the agent', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(
      await screen.findByRole('radio', { name: /Work it out from each file/ }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.selectOptions(
      await screen.findByLabelText(/Keep original files in project/),
      PROJECT,
    )
    await user.selectOptions(screen.getByLabelText(/Dataset structure/), SCHEMA)
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'register_connector',
        expect.anything(),
      ),
    )
    const args = mocks.rpc.mock.calls.find(
      ([name]) => name === 'register_connector',
    )![1]
    expect(args).toMatchObject({
      p_key: 'qpcr-bench-ins-3',
      p_connector_type: 'instrument',
      p_parser_id: null,
    })
    // An instrument that wasn't taking files now is.
    expect(mocks.setMethod).toHaveBeenCalledWith('i1', 'filedrop')

    await user.click(
      await screen.findByRole('button', { name: 'Download agent' }),
    )
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith({
        connectorId: 'c1',
        system: 'windows',
        folder: 'C:\\InstrumentResults',
      }),
    )
    expect(
      await screen.findByText(/Downloaded\. On the instrument computer/),
    ).toBeTruthy()
  })

  it('makes the person choose the parser when it should always be the same one', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(
      await screen.findByRole('radio', { name: /Always use one parser/ }),
    )
    const next = screen.getByRole('button', { name: 'Next' })
    expect((next as HTMLButtonElement).disabled).toBe(true)
    await user.selectOptions(
      await screen.findByLabelText('Parser'),
      'sheetbase.qpcr-results-csv',
    )
    expect((next as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks for a project and a dataset structure before saving', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await user.click(
      await screen.findByRole('button', { name: 'Save and continue' }),
    )
    expect(await screen.findAllByText(/Choose a project/)).not.toHaveLength(0)
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'register_connector',
      expect.anything(),
    )
  })

  it('opens straight on the agent when it’s only a re-download', async () => {
    renderDialog({
      initialStep: 3,
      connector: {
        id: 'c1',
        workspace_id: 'w1',
        key: 'qpcr-bench',
        name: 'qPCR bench',
        connector_type: 'instrument',
        direction: 'inbound',
        status: 'active',
        parser_id: null,
        config: { pickup: { projectId: PROJECT, schemaVersionId: SCHEMA } },
        created_at: '',
        updated_at: '',
      },
    })
    expect(
      await screen.findByRole('button', { name: 'Download agent' }),
    ).toBeTruthy()
    expect(screen.getByText('Change data intake')).toBeTruthy()
  })

  it('points people without access to someone who has it', async () => {
    renderDialog({
      initialStep: 3,
      canManage: false,
      connector: {
        id: 'c1',
        workspace_id: 'w1',
        key: 'k',
        name: 'n',
        connector_type: 'instrument',
        direction: 'inbound',
        status: 'active',
        parser_id: null,
        config: {},
        created_at: '',
        updated_at: '',
      },
    })
    expect(await screen.findByText(/Ask an admin or data steward/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download agent' })).toBeNull()
  })
})
