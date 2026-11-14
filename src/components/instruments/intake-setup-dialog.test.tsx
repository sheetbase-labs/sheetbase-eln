/**
 * Setting up an instrument's data intake from its page: how files are read,
 * where the data goes, then the agent download, without typing a key or an ID.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { choose } from '../../../tests/unit/picker'
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

const PROJECT = '22222222-2222-4222-8222-222222222222'
const SCHEMA = '33333333-3333-4333-8333-333333333333'

const requests: Array<{
  path: string
  search: string
  method: string
  body: string
}> = []

const clients: QueryClient[] = []
const unexpected: string[] = []
let converterRefused = false
let converterAdded = false
let parserReadGate: Promise<void> | undefined

const parser = {
  id: 'p1',
  key: 'sheetbase.qpcr-results-csv',
  name: 'qPCR results (CSV)',
  format: 'csv',
  instrument_id: null,
  instruments: null,
  parser_versions: [
    { id: 'v1', version: 1, status: 'approved', signature: { engine: 'x' } },
  ],
}

const transport: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    ),
    init,
  )

  const url = new URL(request.url)
  const body = await request.text()
  requests.push({
    path: url.pathname,
    search: url.search,
    method: request.method,
    body,
  })
  const resource = url.pathname.replace('/api/db/', '')

  if (resource === 'projects')
    return Response.json([
      {
        id: PROJECT,
        title: 'Assay development',
        archived_at: null,
        status: 'active',
      },
    ])

  if (resource === 'rpc/my_project_permissions')
    return Response.json([
      {
        project_id: PROJECT,
        can_view: true,
        can_edit: true,
        can_review: true,
        client_portal: false,
        can_manage: true,
        access_level: 'owner',
      },
    ])

  if (resource === 'dataset_schema_definitions')
    return Response.json([
      {
        id: 'schema',
        key: 'qpcr',
        name: 'qPCR results',
        description: null,
        lifecycle: 'active',
      },
    ])

  if (resource === 'dataset_schema_versions')
    return Response.json([
      {
        id: SCHEMA,
        schema_id: 'schema',
        version: 2,
        lifecycle: 'active',
        published_at: '2026-11-01',
      },
    ])

  if (resource === 'parsers') {
    if (converterAdded) await parserReadGate

    return Response.json(
      converterAdded
        ? [
            parser,
            {
              ...parser,
              id: 'p2',
              key: 'converter.new',
              name: 'New converter',
            },
          ]
        : [parser],
    )
  }

  if (url.pathname === '/api/parsers/converter') {
    if (request.method === 'GET')
      return Response.json({
        converters: [
          {
            key: 'NEW',
            name: 'New software',
            technique: 'Plate reader',
            extensions: 'csv',
            releaseState: 'stable',
          },
        ],
      })

    if (converterRefused)
      return Response.json(
        { error: { code: 'not_permitted', message: 'Not permitted' } },
        { status: 403 },
      )
    converterAdded = true

    return Response.json({
      parserId: 'p2',
      parserVersionId: 'v2',
      key: 'converter.new',
    })
  }

  if (resource === 'datasets') return Response.json([])

  if (resource === 'rpc/ensure_builtin_parsers') return Response.json(null)

  if (resource === 'rpc/register_connector') {
    const args = z
      .object({ p_key: z.string(), p_config: z.record(z.string(), z.json()) })
      .parse(JSON.parse(body))

    return Response.json({ id: 'c1', key: args.p_key, config: args.p_config })
  }

  if (resource === 'rpc/set_instrument_intake_method')
    return Response.json({
      id: 'i1',
      name: 'qPCR bench',
      intake_method: 'filedrop',
    })

  if (url.pathname === '/api/connectors/agent') {
    if (request.method === 'GET')
      return Response.json({
        downloaded: false,
        lastSeenAt: null,
        running: false,
      })

    return new Response('zip', {
      headers: {
        'content-disposition':
          'attachment; filename="sheetbase-agent-qpcr-bench.zip"',
      },
    })
  }

  unexpected.push(request.url)

  return Response.json({ message: 'Unexpected request' }, { status: 500 })
}

vi.stubGlobal('fetch', transport)

const { IntakeSetupDialog } = await import('./intake-setup-dialog')

function bodies(path: string) {
  return requests.flatMap((request) =>
    request.path === path && request.body
      ? [z.json().parse(JSON.parse(request.body))]
      : [],
  )
}

function renderDialog(
  props: Partial<Parameters<typeof IntakeSetupDialog>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  clients.push(client)

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
    requests.length = 0
    unexpected.length = 0
    converterRefused = false
    converterAdded = false
    parserReadGate = undefined
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:http://localhost/agent',
    )
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()

    for (const client of clients.splice(0)) client.clear()
    vi.restoreAllMocks()
    expect(unexpected).toEqual([])
  })
  afterAll(() => vi.unstubAllGlobals())

  it('walks from how files are read, to where they go, to the agent', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(
      await screen.findByRole('radio', { name: /Work it out from each file/ }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await choose(user, /Keep original files in project/, 'Assay development')
    await choose(user, /Dataset structure/, 'qPCR results v2')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    await waitFor(() =>
      expect(bodies('/api/db/rpc/register_connector')).toHaveLength(1),
    )

    const args = bodies('/api/db/rpc/register_connector')[0]

    expect(args).toMatchObject({
      p_key: 'qpcr-bench-ins-3',
      p_connector_type: 'instrument',
      p_parser_id: null,
    })
    // An instrument that wasn't taking files now is.
    expect(bodies('/api/db/rpc/set_instrument_intake_method')).toEqual([
      { p_instrument_id: 'i1', p_intake_method: 'filedrop' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'Download agent' }),
    )
    await waitFor(() =>
      expect(
        bodies('/api/connectors/agent').filter((body) => body !== null),
      ).toContainEqual({
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
    expect(next.hasAttribute('disabled')).toBe(true)
    await user.selectOptions(
      await screen.findByLabelText('Parser'),
      'sheetbase.qpcr-results-csv',
    )
    expect(next.hasAttribute('disabled')).toBe(false)
  })

  it('asks for a project and a dataset structure before saving', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await user.click(
      await screen.findByRole('button', { name: 'Save and continue' }),
    )
    expect(await screen.findAllByText(/Choose a project/)).not.toHaveLength(0)
    expect(bodies('/api/db/rpc/register_connector')).toHaveLength(0)
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

  it('awaits the workspace parser-list refresh before selecting a new converter', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(
      await screen.findByRole('radio', { name: /Always use one parser/ }),
    )
    await screen.findByRole('option', { name: 'qPCR results (CSV)' })

    const readsBefore = requests.filter(
      (request) => request.path === '/api/db/parsers',
    ).length

    let release: (() => void) | undefined
    parserReadGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await user.click(
      screen.getByRole('button', { name: 'Add an Allotrope converter…' }),
    )
    await screen.findByRole('option', { name: 'New software' })
    await user.selectOptions(
      screen.getByLabelText('Instrument software'),
      'NEW',
    )
    await user.click(screen.getByRole('button', { name: 'Add converter' }))
    await waitFor(() =>
      expect(
        requests.filter((request) => request.path === '/api/db/parsers'),
      ).toHaveLength(readsBefore + 1),
    )
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Adding…' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('option', { name: 'New converter' })).toBeNull()
    release?.()
    const option = await screen.findByRole('option', { name: 'New converter' })
    await waitFor(() => expect(option.matches(':checked')).toBe(true))
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(false)
    expect(screen.queryByRole('button', { name: 'Adding…' })).toBeNull()
    expect(bodies('/api/parsers/converter')).toEqual([
      { vendor: 'NEW', instrumentId: 'i1' },
    ])
    expect(
      requests.filter((request) => request.path === '/api/db/parsers').at(-1)
        ?.search,
    ).toContain('workspace_id=eq.w1')
  })

  it('keeps the parser unselected and does not refresh it when converter creation is refused', async () => {
    converterRefused = true
    const user = userEvent.setup()
    renderDialog()
    await user.click(
      await screen.findByRole('radio', { name: /Always use one parser/ }),
    )
    await screen.findByRole('option', { name: 'qPCR results (CSV)' })

    const readsBefore = requests.filter(
      (request) => request.path === '/api/db/parsers',
    ).length

    await user.click(
      screen.getByRole('button', { name: 'Add an Allotrope converter…' }),
    )
    await screen.findByRole('option', { name: 'New software' })
    await user.selectOptions(
      screen.getByLabelText('Instrument software'),
      'NEW',
    )
    await user.click(screen.getByRole('button', { name: 'Add converter' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Add converter' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('option', { name: 'New converter' })).toBeNull()
    expect(
      requests.filter((request) => request.path === '/api/db/parsers'),
    ).toHaveLength(readsBefore)
    expect(bodies('/api/db/rpc/register_connector')).toEqual([])
  })
})
