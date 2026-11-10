import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { t } from '#/copy'
import type { ImportSheetPreview } from '#/lib/import/types'
import {
  handoffGate,
  importHandoffsTestServer,
} from './import-handoffs-test-server'
import { parseImportMapping } from './import-search'
import type { FileColumnsResult } from './file-columns-step'

const http = await importHandoffsTestServer()

// FileColumnsStep's module-level DataClient captures the real URL-adapted fetch.
const { FileColumnsStep } = await import('./file-columns-step')
const { PluginPullPanel } = await import('./plugin-pull-panel')
const clients: QueryClient[] = []
const importKey = ['ui-port', 'import', 'datasets']

const unrelatedKeys = [
  ['datasets', 'canonical'],
  ['records', 'canonical'],
  ['import', 'records', 'other-dataset'],
]

beforeEach(() => {
  http.requests.length = 0
  http.replies.length = 0
  http.unexpected.length = 0
})

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.length = 0
  expect(http.unexpected).toEqual([])
  expect(http.replies).toEqual([])
})

afterAll(() => http.close())

function mount(component: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })

  clients.push(client)

  for (const key of [importKey, ...unrelatedKeys])
    client.setQueryData(key, { retained: key })
  const root = createRootRoute({ component: () => component })

  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return client
}

function unchangedCanonicalCaches(client: QueryClient) {
  for (const key of unrelatedKeys) {
    expect(client.getQueryData(key)).toEqual({ retained: key })
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  }
}

const sheet: ImportSheetPreview = {
  name: 'Plate A',
  sheetNames: ['Plate A', 'Plate B'],
  rowCount: 2,
  headers: ['Titre [mg/mL]', 'Count', 'Sample', 'Omit'],
  sampleRows: [
    { 'Titre [mg/mL]': '1.20', Count: '3', Sample: '0012', Omit: 'discard' },
  ],
  columns: [
    {
      source: 'Titre [mg/mL]',
      name: 'Titre',
      key: 'titre',
      type: 'decimal',
      unit: 'mg/mL',
      examples: ['1.20'],
      emptyCount: 0,
      keep: true,
    },
    {
      source: 'Count',
      name: 'Count',
      key: 'count',
      type: 'integer',
      unit: null,
      examples: ['3'],
      emptyCount: 0,
      keep: true,
    },
    {
      source: 'Sample',
      name: 'Sample',
      key: 'sample',
      type: 'text',
      unit: null,
      examples: ['0012'],
      emptyCount: 0,
      keep: true,
    },
    {
      source: 'Omit',
      name: 'Omit',
      key: 'omit',
      type: 'text',
      unit: null,
      examples: ['discard'],
      emptyCount: 0,
      keep: true,
    },
  ],
}

const structurePath = '/api/db/rpc/create_dataset_structure_from_file'
const datasetPath = '/api/db/datasets'
const pluginPath = '/api/plugins/data'

function creationReplies(ready?: Promise<void>) {
  http.replies.push(
    {
      path: structurePath,
      body: JSON.stringify({
        schema_definition_id: 'schema-1',
        schema_version_id: 'version-1',
      }),
      ready,
    },
    {
      path: datasetPath,
      body: JSON.stringify([
        { id: 'dataset-1', revision: 1, name: 'plate3 readout' },
      ]),
    },
  )
}

function columns(onCreated: (result: FileColumnsResult) => Promise<void>) {
  return mount(
    <FileColumnsStep
      workspaceId="workspace-1"
      createdByUserId="user-1"
      fileId="file-1"
      filename="plate3_readout.xlsx"
      initialSheet={sheet}
      projectId="project-1"
      onBack={() => undefined}
      onCreated={onCreated}
    />,
  )
}

const connector = {
  extensionId: 'extension-1',
  extensionKey: 'instrument',
  extensionName: 'Instrument plugin',
  manifestId: 'instrument',
  manifestVersion: '1.0.0',
  point: 'connectors',
  id: 'plate',
  name: 'plugin.instrument.plate',
  declaration: {
    id: 'plate',
    title: 'Plate readout',
    description: 'Pull a plate',
    hosts: ['instrument.example'],
    parameters: [
      { name: 'plate', type: 'text', label: 'Plate ID', required: true },
    ],
    settings: [
      { name: 'endpoint', label: 'Endpoint', required: true, secret: false },
    ],
    runner: { kind: 'python', entry: 'plate:run' },
    parse: { kind: 'python', entry: 'plate:parse' },
  },
} satisfies Parameters<typeof PluginPullPanel>[0]['connectors'][number]

function pluginReply(status = 200) {
  http.replies.push({
    path: pluginPath,
    status,
    body: JSON.stringify(
      status === 200
        ? {
            columns: ['Sample', 'Titre [mg/mL]'],
            rows: [
              { Sample: '0012', 'Titre [mg/mL]': 1.2 },
              { Sample: 'A,B', 'Titre [mg/mL]': null },
            ],
          }
        : { error: 'Instrument refused the request' },
    ),
  })
}

async function fillConnector() {
  const user = userEvent.setup()
  await user.type(
    await screen.findByRole('textbox', { name: 'Plate ID' }),
    'Plate-7',
  )
  await user.type(screen.getByRole('textbox', { name: 'Endpoint' }), 'lab-a')

  return user
}

describe('FileColumnsStep canonical creation handoff', () => {
  it('preserves scientific fields and UUID mapping, invalidates only the existing import prefix, and locks pending and successful handoffs', async () => {
    const network = handoffGate()
    const callback = handoffGate()
    creationReplies(network.promise)
    const handed: FileColumnsResult[] = []

    const client = columns(async (result) => {
      handed.push(result)
      await callback.promise
    })

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('checkbox', {
        name: t('data.importFlow.fileColumns.keepAria', { name: 'Omit' }),
      }),
    )

    const titreType = screen.getByRole('combobox', {
      name: t('data.importFlow.fileColumns.typeAria', {
        source: 'Titre [mg/mL]',
      }),
    })

    await user.selectOptions(titreType, 'text')
    expect(
      screen.queryByRole('textbox', {
        name: t('data.importFlow.fileColumns.unitAria', {
          source: 'Titre [mg/mL]',
        }),
      }),
    ).toBeNull()
    await user.selectOptions(titreType, 'decimal')
    expect(
      screen
        .getByRole('textbox', {
          name: t('data.importFlow.fileColumns.unitAria', {
            source: 'Titre [mg/mL]',
          }),
        })
        .getAttribute('value'),
    ).toBe('mg/mL')

    const button = screen.getByRole('button', {
      name: t('data.importFlow.fileColumns.create'),
    })

    await user.click(button)
    await waitFor(() => expect(http.requests).toHaveLength(1))
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(http.requests[0]?.path).toBe(structurePath)
    expect(handed).toEqual([])
    network.resolve()
    await waitFor(() => expect(handed).toHaveLength(1))
    expect(button.hasAttribute('disabled')).toBe(true)
    await user.click(button)
    expect(http.requests).toHaveLength(2)
    expect(
      screen
        .getByRole('button', { name: t('data.importFlow.fileColumns.back') })
        .hasAttribute('disabled'),
    ).toBe(true)

    const wire = z
      .strictObject({
        p_workspace_id: z.string(),
        p_name: z.string(),
        p_fields: z.array(
          z.strictObject({
            field_id: z.uuid(),
            key: z.string(),
            label: z.string(),
            logical_type: z.string(),
            nullable: z.boolean(),
            quantity: z
              .object({
                kind: z.string(),
                symbol: z.string(),
                dimension: z.string(),
                storageUnit: z.string(),
              })
              .nullable(),
            display_order: z.number(),
          }),
        ),
      })
      .parse(JSON.parse(http.requests[0]?.body ?? 'null'))

    expect(wire.p_workspace_id).toBe('workspace-1')
    expect(wire.p_name).toBe('plate3 readout')
    expect(new Set(wire.p_fields.map((field) => field.field_id)).size).toBe(3)
    expect(
      wire.p_fields.map(({ field_id, ...field }) => {
        expect(field_id).toMatch(/^[\da-f-]{36}$/)

        return field
      }),
    ).toEqual([
      {
        key: 'titre',
        label: 'Titre',
        logical_type: 'decimal',
        nullable: true,
        quantity: {
          kind: 'quantity',
          symbol: 'mg/mL',
          dimension: 'mg/mL',
          storageUnit: 'mg/mL',
        },
        display_order: 1,
      },
      {
        key: 'count',
        label: 'Count',
        logical_type: 'integer',
        nullable: true,
        quantity: null,
        display_order: 2,
      },
      {
        key: 'sample',
        label: 'Sample',
        logical_type: 'text',
        nullable: true,
        quantity: null,
        display_order: 3,
      },
    ])
    expect(http.requests.map(({ path, method }) => ({ path, method }))).toEqual(
      [
        { path: structurePath, method: 'POST' },
        { path: datasetPath, method: 'POST' },
      ],
    )
    expect(JSON.parse(http.requests[1]?.body ?? 'null')).toEqual({
      workspace_id: 'workspace-1',
      schema_version_id: 'version-1',
      name: 'plate3 readout',
      description: null,
      primary_project_id: 'project-1',
      created_by_user_id: 'user-1',
    })
    expect(handed[0]?.datasetId).toBe('dataset-1')
    expect(handed[0]?.sheet).toBe('Plate A')
    expect(parseImportMapping(handed[0]?.map)).toEqual(
      Object.fromEntries(
        wire.p_fields.map((field, index) => [
          sheet.headers[index],
          field.field_id,
        ]),
      ),
    )
    expect(parseImportMapping(handed[0]?.units)).toEqual({
      'Titre [mg/mL]': 'mg/mL',
      Count: '',
    })
    expect(client.getQueryState(importKey)?.isInvalidated).toBe(true)
    unchangedCanonicalCaches(client)
    await act(async () => {
      callback.resolve()
      await callback.promise
    })
    await user.click(button)
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(http.requests).toHaveLength(2)
    expect(handed).toHaveLength(1)
  })

  it.each(['structure', 'dataset'])(
    'allows retry after %s refusal without calling the handoff',
    async (stage) => {
      if (stage === 'dataset')
        http.replies.push({
          path: structurePath,
          body: JSON.stringify({ schema_version_id: 'version-1' }),
        })
      http.replies.push({
        path: stage === 'structure' ? structurePath : datasetPath,
        status: 403,
        body: JSON.stringify({
          error: { code: 'refused', message: 'Creation refused' },
        }),
      })
      const handed: FileColumnsResult[] = []

      const client = columns(async (result) => {
        handed.push(result)
      })

      const user = userEvent.setup()
      await user.click(
        await screen.findByRole('button', {
          name: t('data.importFlow.fileColumns.create'),
        }),
      )
      expect(await screen.findByText('Creation refused')).toBeTruthy()
      expect(handed).toEqual([])
      expect(client.getQueryState(importKey)?.isInvalidated).toBe(false)
      creationReplies()
      await user.click(
        screen.getByRole('button', {
          name: t('data.importFlow.fileColumns.create'),
        }),
      )
      await waitFor(() => expect(handed).toHaveLength(1))
      expect(screen.queryByText('Creation refused')).toBeNull()
      expect(http.requests).toHaveLength(stage === 'structure' ? 3 : 4)
      unchangedCanonicalCaches(client)
    },
  )

  it('reopens retry when the handoff rejects after successful writes, without claiming rollback', async () => {
    creationReplies()
    const callback = handoffGate()
    const handed: FileColumnsResult[] = []

    const client = columns(async (result) => {
      handed.push(result)

      if (handed.length === 1) await callback.promise
    })

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: t('data.importFlow.fileColumns.create'),
      }),
    )
    await waitFor(() => expect(handed).toHaveLength(1))
    expect(http.requests).toHaveLength(2)
    await act(async () => {
      callback.reject(new Error('Navigation failed'))
      await callback.promise.catch(() => undefined)
    })
    expect(await screen.findByText('Navigation failed')).toBeTruthy()
    expect(client.getQueryState(importKey)?.isInvalidated).toBe(true)
    creationReplies()
    await user.click(
      screen.getByRole('button', {
        name: t('data.importFlow.fileColumns.create'),
      }),
    )
    await waitFor(() => expect(handed).toHaveLength(2))
    expect(http.requests.map((request) => request.path)).toEqual([
      structurePath,
      datasetPath,
      structurePath,
      datasetPath,
    ])
    expect(screen.queryByText('Navigation failed')).toBeNull()
    unchangedCanonicalCaches(client)
  })
})

describe('PluginPullPanel real connector handoff', () => {
  it('validates the first missing parameter then setting without HTTP or cache invalidation', async () => {
    const client = mount(
      <PluginPullPanel connectors={[connector]} onFile={() => undefined} />,
    )

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: t('plugins.import.pull') }),
    )
    expect(
      await screen.findByText(t('plugins.import.needs', { name: 'Plate ID' })),
    ).toBeTruthy()
    await user.type(
      screen.getByRole('textbox', { name: 'Plate ID' }),
      'Plate-7',
    )
    await user.click(
      screen.getByRole('button', { name: t('plugins.import.pull') }),
    )
    expect(
      await screen.findByText(t('plugins.import.needs', { name: 'Endpoint' })),
    ).toBeTruthy()
    expect(http.requests).toEqual([])
    expect(client.getQueryState(importKey)?.isInvalidated).toBe(false)
    unchangedCanonicalCaches(client)
  })

  it('hands a real CSV File to an awaited callback, locks pending pulls, and allows another pull after success', async () => {
    pluginReply()
    const callback = handoffGate()
    const files: File[] = []

    const client = mount(
      <PluginPullPanel
        connectors={[connector]}
        onFile={async (file) => {
          files.push(file)
          await callback.promise
        }}
      />,
    )

    const user = await fillConnector()

    const button = screen.getByRole('button', {
      name: t('plugins.import.pull'),
    })

    await user.click(button)
    await waitFor(() => expect(files).toHaveLength(1))
    const file = files[0]
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('plate-readout.csv')
    expect(file.type).toBe('text/csv')
    expect(await file.text()).toBe('Sample,Titre [mg/mL]\n0012,1.2\n"A,B",\n')
    expect(button.hasAttribute('disabled')).toBe(true)
    await user.click(button)
    expect(http.requests).toHaveLength(1)
    expect(JSON.parse(http.requests[0]?.body ?? 'null')).toEqual({
      kind: 'connector',
      extensionKey: 'instrument',
      connectorId: 'plate',
      parameters: { plate: 'Plate-7' },
      settings: { endpoint: 'lab-a' },
    })
    await act(async () => {
      callback.resolve()
      await callback.promise
    })
    await waitFor(() =>
      expect(client.getMutationCache().getAll()[0]?.state.status).toBe(
        'success',
      ),
    )
    await screen.findByRole('button', { name: t('plugins.import.pull') })
    expect(button.hasAttribute('disabled')).toBe(false)
    pluginReply()
    await user.click(button)
    await waitFor(() => expect(files).toHaveLength(2))
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    expect(files[1]).toBeInstanceOf(File)
    expect(http.requests.map((request) => request.path)).toEqual([
      pluginPath,
      pluginPath,
    ])
    expect(client.getQueryState(importKey)?.isInvalidated).toBe(false)
    unchangedCanonicalCaches(client)
  })

  it.each(['server', 'callback'])(
    'shows %s failure and allows retry without touching canonical caches',
    async (failure) => {
      pluginReply(failure === 'server' ? 403 : 200)
      const files: File[] = []
      const callback = handoffGate()

      const client = mount(
        <PluginPullPanel
          connectors={[connector]}
          onFile={async (file) => {
            files.push(file)

            if (failure === 'callback' && files.length === 1)
              await callback.promise
          }}
        />,
      )

      const user = await fillConnector()
      await user.click(
        screen.getByRole('button', { name: t('plugins.import.pull') }),
      )

      if (failure === 'callback') {
        await waitFor(() => expect(files).toHaveLength(1))
        expect(
          screen
            .getByRole('button', { name: t('plugins.import.pulling') })
            .hasAttribute('disabled'),
        ).toBe(true)
        await act(async () => {
          callback.reject(new Error('Upload handoff failed'))
          await callback.promise.catch(() => undefined)
        })
      }

      const reason =
        failure === 'server'
          ? 'Instrument refused the request'
          : 'Upload handoff failed'

      expect(
        await screen.findByText(t('plugins.import.failed', { reason })),
      ).toBeTruthy()
      expect(files).toHaveLength(failure === 'server' ? 0 : 1)
      pluginReply()
      await user.click(
        screen.getByRole('button', { name: t('plugins.import.pull') }),
      )
      await waitFor(() =>
        expect(files).toHaveLength(failure === 'server' ? 1 : 2),
      )
      expect(
        screen.queryByText(t('plugins.import.failed', { reason })),
      ).toBeNull()
      expect(http.requests.map((request) => request.path)).toEqual([
        pluginPath,
        pluginPath,
      ])
      expect(client.getQueryState(importKey)?.isInvalidated).toBe(false)
      unchangedCanonicalCaches(client)
    },
  )
})
