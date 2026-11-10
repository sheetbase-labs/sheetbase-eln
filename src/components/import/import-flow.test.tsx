/**
 * R5-SURF-04 — an import is addressable, resumable and can create a Dataset.
 *
 * These cover the flow's URL contract (the reload-at-step parse and the
 * mapping/parser pins), the per-import not-found state, the new-Dataset branch
 * resolving through the same target resolver the append branch uses, and the
 * filename parser suggestion the user can override.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { z } from 'zod'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { choose } from '../../../tests/unit/picker'

import type {
  DatasetImportRecord,
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportParserSummary,
  ImportReviewResponse,
} from '#/lib/import/types'
import { dropSharedReads } from '#/lib/data-client'
import type { ImportSearch } from './import-search'
import {
  parseImportSearch,
  parseImportMapping,
  serializeImportMapping,
} from './import-search'
import {
  columnExamples,
  columnNote,
  commitIdempotencyKey,
  initialMappingValues,
  suggestDatasetFromFilename,
  suggestParserFromFilename,
} from './import-flow-data'
import { importFlowTestServer } from './import-flow-test-server'

const http = await importFlowTestServer()

const { ImportMapCheckFlow, ImportUploadFlow } = await import('./import-flow')

const clients: QueryClient[] = []
const datasetGates: (() => void)[] = []

let location: () => { pathname: string; search: unknown } = () => {
  throw new Error('Render a flow first')
}

afterEach(async () => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  datasetGates.splice(0).forEach((release) => release())
  await http.idle()
  dropSharedReads()
  expect(http.unexpected).toEqual([])
})

afterAll(async () => {
  await http.close()
})

beforeEach(() => {
  http.requests.length = 0
  http.unexpected.length = 0
  Object.assign(http.state, {
    datasets: false,
    schemas: false,
    experiments: [],
    datasetReady: undefined,
    datasetFailure: false,
    file: () => uploadResponse(),
    upload: uploadResponse(),
    review: reviewResponse(),
    receipts: [],
    missingFile: false,
    refuseMapping: false,
  })
})

async function renderFlow(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  clients.push(client)
  const root = createRootRoute({ component: () => ui })

  const fallback = createRoute({
    getParentRoute: () => root,
    path: '$',
    validateSearch: (search) => search,
  })

  const router = createRouter({
    routeTree: root.addChildren([fallback]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  location = () => router.state.location

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function parserSummary(
  overrides: Partial<ImportParserSummary> = {},
): ImportParserSummary {
  return {
    key: 'sheetbase.plate-reader-csv',
    label: 'Plate reader CSV',
    format: 'csv',
    version: 2,
    confidence: 1,
    parserId: 'parser-1',
    parserVersionId: 'parser-version-1',
    status: 'approved',
    ...overrides,
  }
}

function uploadResponse(
  overrides: Partial<ImportFileUploadResponse> = {},
): ImportFileUploadResponse {
  return {
    ok: true,
    fileId: 'file-1',
    filename: 'plate-01.csv',
    mediaType: 'text/csv',
    byteSize: 2048,
    checksum: 'a'.repeat(64),
    format: 'csv',
    datasetId: 'ds-1',
    parsed: true,
    parser: parserSummary(),
    sheet: {
      name: 'Sheet 1',
      headers: ['raw', 'dilution'],
      sampleRows: [{ raw: '1.2', dilution: '1:10' }],
      rowCount: 2,
      sheetNames: ['Sheet 1'],
    },
    savedMapping: {
      sources: [
        { source: 'raw', fieldId: 'field-1', unit: 'NTU', sourceUnit: 'NTU' },
      ],
    },
    ...overrides,
  }
}

function reviewResponse(): ImportReviewResponse {
  return {
    ok: true,
    expectedRevision: 1,
    schemaVersionId: 'sv-1',
    summary: {
      total: 2,
      added: 2,
      planned: 0,
      new: 2,
      flagged: 0,
      skipped: 0,
    },
    rows: [
      {
        index: 1,
        outcome: 'new',
        plannedKey: null,
        plannedRowId: null,
        flags: [],
        values: { raw: '1.2' },
      },
    ],
    columns: [
      {
        source: 'raw',
        fieldId: 'field-1',
        fieldLabel: 'Raw',
        unit: 'NTU',
        examples: ['1.2'],
        status: 'mapped',
        note: '',
      },
    ],
    errors: [],
  }
}

describe('import URL contract', () => {
  it('accepts an empty search and discards malformed optional pins', () => {
    expect(parseImportSearch({})).toEqual({})
    expect(
      parseImportSearch({
        step: 42,
        dataset: null,
        experiment: [],
        instrument: {},
        parser: false,
        map: 123,
        sheet: '',
        units: [],
        project: false,
        returnTo: 42,
      }),
    ).toEqual({
      step: undefined,
      dataset: undefined,
      experiment: undefined,
      instrument: undefined,
      parser: undefined,
      map: undefined,
      sheet: undefined,
      units: undefined,
      project: undefined,
      returnTo: undefined,
    })
  })

  it('keeps only the pins it knows and drops anything else', () => {
    expect(
      parseImportSearch({
        step: 'check',
        dataset: 'ds-1',
        experiment: 'exp-1',
        instrument: 'inst-1',
        parser: 'sheetbase.plate-reader-csv',
        map: 'raw:field-1',
        junk: 'ignored',
        step2: 'nope',
      }),
    ).toEqual({
      step: 'check',
      dataset: 'ds-1',
      experiment: 'exp-1',
      instrument: 'inst-1',
      parser: 'sheetbase.plate-reader-csv',
      map: 'raw:field-1',
      project: undefined,
      returnTo: undefined,
    })
    expect(parseImportSearch({ step: 'upload' })).toEqual({
      step: undefined,
      dataset: undefined,
      experiment: undefined,
      instrument: undefined,
      parser: undefined,
      map: undefined,
      project: undefined,
      returnTo: undefined,
    })
  })

  it('keeps the shared create-context pins and refuses an off-site returnTo', () => {
    expect(
      parseImportSearch({ project: 'p-1', returnTo: '/experiments/e-1' }),
    ).toMatchObject({ project: 'p-1', returnTo: '/experiments/e-1' })
    expect(
      parseImportSearch({ returnTo: 'https://example.com/x' }).returnTo,
    ).toBeUndefined()
  })

  it('round-trips a mapping, including headers with separators', () => {
    const values = { raw: 'field-1', 'ntu, out': 'field-2', skipped: '' }
    const encoded = serializeImportMapping(values)
    expect(parseImportMapping(encoded)).toEqual({
      raw: 'field-1',
      'ntu, out': 'field-2',
    })
    expect(parseImportMapping('broken')).toEqual({})
    expect(parseImportMapping(undefined)).toEqual({})
  })

  it('treats a linked mapping as authoritative for every header', () => {
    const fields = [
      {
        id: 'field-1',
        label: 'Raw',
        logicalType: 'decimal',
        nullable: true,
        kind: 'dataset-field' as const,
      },
    ]

    const saved: ImportMappingDocument = {
      sources: [
        { source: 'raw', fieldId: 'field-1', unit: null },
        { source: 'raw', fieldId: 'field-2', unit: 'NTU' },
      ],
    }

    expect(
      initialMappingValues(['raw', 'dilution'], fields, saved, {}),
    ).toEqual({ raw: 'field-1', dilution: '' })
    expect(
      initialMappingValues(['raw', 'dilution'], fields, saved, {
        dilution: 'field-1',
      }),
    ).toEqual({ raw: '', dilution: 'field-1' })
  })

  it('keeps one commit key per file, target and mapping', () => {
    const mapping: ImportMappingDocument = {
      sources: [{ source: 'raw', fieldId: 'field-1', unit: 'NTU' }],
    }

    const first = commitIdempotencyKey('file-1', 'ds-1', mapping)
    expect(commitIdempotencyKey('file-1', 'ds-1', mapping)).toBe(first)
    expect(commitIdempotencyKey('file-1', 'ds-2', mapping)).not.toBe(first)
    expect(
      commitIdempotencyKey('file-1', 'ds-1', {
        sources: [{ source: 'raw', fieldId: 'field-2', unit: null }],
      }),
    ).not.toBe(first)
  })
})

describe('filename parser suggestion', () => {
  const options = [
    parserSummary(),
    parserSummary({
      key: 'sheetbase.tb02-turbidity',
      label: 'TB-02 CSV firmware 4',
      parserVersionId: 'parser-version-2',
      status: 'draft',
    }),
  ]

  it('suggests the parser whose label names the file', () => {
    expect(suggestParserFromFilename('TB-02_run12.csv', options)?.key).toBe(
      'sheetbase.tb02-turbidity',
    )
  })

  it('suggests nothing when the file name names no parser', () => {
    expect(suggestParserFromFilename('mystery-export.csv', options)).toBeNull()
  })
})

describe('dataset suggestion from a file name', () => {
  const datasets = [
    { id: 'a', display_id: 'DS-0001', name: 'ELISA capsid titre' },
    { id: 'b', display_id: 'DS-0002', name: 'Ambr 250 daily reading' },
  ]

  it('suggests the dataset whose name words appear in the file name', () => {
    expect(
      suggestDatasetFromFilename('ELISA-capsid-titre_run4.csv', datasets)?.id,
    ).toBe('a')
  })

  it('suggests the dataset whose ID appears in the file name', () => {
    expect(
      suggestDatasetFromFilename('DS-0002 export.xlsx', datasets)?.id,
    ).toBe('b')
  })

  it('suggests nothing when no dataset stands out', () => {
    expect(suggestDatasetFromFilename('plate-01.csv', datasets)).toBeNull()
    expect(suggestDatasetFromFilename('titre.csv', datasets)).toBeNull()
  })
})

describe('ImportUploadFlow', () => {
  it('takes the file first, suggests a dataset from its name, then uploads on confirmation', async () => {
    http.state.datasets = true
    http.state.upload = uploadResponse({ fileId: 'file-9', datasetId: 'ds-1' })
    const user = userEvent.setup()
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )

    await screen.findByRole('radio', { name: /Add to an existing dataset/ })
    await screen.findByRole('button', { name: 'Import into dataset' })

    const file = new File(['Sample,pH\nA,7.4'], 'ELISA-capsid-titre_run4.csv', {
      type: 'text/csv',
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Laboratory file')).toHaveProperty(
        'disabled',
        false,
      ),
    )
    await user.upload(screen.getByLabelText('Laboratory file'), file)

    // Nothing is stored yet: the dataset is only suggested.
    expect(http.matching('/api/import/files')).toEqual([])
    expect(
      screen.getByText(
        'Suggested from the file name. Change it if it’s wrong.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Import into dataset' }).textContent,
    ).toContain('ELISA capsid titre')

    await user.click(
      await screen.findByRole('button', { name: 'Upload and continue' }),
    )
    await waitFor(() =>
      expect(http.matching('/api/import/files')).toHaveLength(1),
    )
    expect(
      http
        .matching('/api/import/files')
        .at(0)
        ?.url.searchParams.get('datasetId'),
    ).toBe('ds-1')
    expect(http.matching('/api/import/files').at(0)?.body).toBe(
      'Sample,pH\nA,7.4',
    )
    expect(http.matching('/api/import/files').at(0)?.filename).toBe(
      'ELISA-capsid-titre_run4.csv',
    )
  })

  it('offers the new-Dataset path when there is nothing to append to', async () => {
    http.state.schemas = true
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )
    expect(screen.queryByText(/Create a dataset from a model first/)).toBeNull()
    expect(
      await screen.findByLabelText('Dataset structure for the new dataset'),
    ).toBeTruthy()
    expect(screen.getByLabelText('New dataset name')).toBeTruthy()
  })

  it('makes a table from the file when nothing exists yet', async () => {
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )
    expect(
      await screen.findByRole('radio', {
        name: /Make a new dataset from this file/,
      }),
    ).toBeTruthy()
    expect(screen.queryByLabelText('New dataset name')).toBeNull()
  })

  it('does not claim the workspace has no Datasets while the list is still loading', async () => {
    let release: () => void = () => {
      throw new Error('Dataset gate not initialized')
    }

    http.state.datasetReady = new Promise<void>((resolve) => {
      release = resolve
      datasetGates.push(resolve)
    })

    const { unmount } = await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )

    expect(await screen.findByText('Reading your datasets…')).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()
    unmount()
    release()
  })

  it('states a failed Dataset read instead of claiming the workspace has none, and retries it', async () => {
    http.state.datasetFailure = true
    http.state.datasets = true
    const user = userEvent.setup()
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )

    expect(
      await screen.findByText('Your datasets couldn’t be read'),
    ).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('radio', { name: /Add to an existing dataset/ }),
    ).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()
    expect(
      http
        .matching('/api/db/datasets', 'GET')
        .map((request) => request.url.pathname + request.url.search),
    ).toEqual([
      '/api/db/datasets?lifecycle=eq.active&order=created_at.desc',
      '/api/db/datasets?lifecycle=eq.active&order=created_at.desc',
    ])
  })

  it('creates the new Dataset through the shared resolver, then commits to it', async () => {
    http.state.schemas = true
    http.state.upload = uploadResponse({
      fileId: 'file-1',
      datasetId: 'ds-new',
    })
    const user = userEvent.setup()
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )

    await choose(user, /^Dataset structure/, /ELISA and turbidity/)
    await user.type(
      screen.getByLabelText('New dataset name'),
      'ELISA capsid titre run 4',
    )

    const file = new File(['Sample,pH\nA,7.4'], 'plate-01.csv', {
      type: 'text/csv',
    })

    await user.upload(screen.getByLabelText('Laboratory file'), file)

    await waitFor(() => expect(location().pathname).toBe('/import/file-1'))
    expect(http.matching('/api/db/datasets')).toHaveLength(1)
    expect(http.matching('/api/db/datasets').at(0)?.body).toBe(
      JSON.stringify({
        workspace_id: 'ws-1',
        schema_version_id: 'sv-1',
        name: 'ELISA capsid titre run 4',
        description: null,
        primary_project_id: null,
        created_by_user_id: 'u-1',
      }),
    )
    const upload = http.matching('/api/import/files').at(0)
    expect(upload?.url.searchParams.get('datasetId')).toBe('ds-new')
    expect(upload?.filename).toBe('plate-01.csv')
    expect(upload?.body).toBe('Sample,pH\nA,7.4')
    expect(location().search).toMatchObject({ step: 'map', dataset: 'ds-new' })
    expect(
      http.requests.findIndex(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname === '/api/db/datasets',
      ),
    ).toBeLessThan(
      http.requests.findIndex(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname === '/api/import/files',
      ),
    )
  })
})

describe('ImportUploadFlow context', () => {
  async function importNewDataset(ui: ReactNode) {
    http.state.schemas = true
    http.state.upload = uploadResponse({
      fileId: 'file-1',
      datasetId: 'ds-new',
    })
    const user = userEvent.setup()
    await renderFlow(ui)
    await choose(user, /^Dataset structure/, /ELISA and turbidity/)
    await user.type(screen.getByLabelText('New dataset name'), 'Run 4')

    return user
  }

  it('gives a Dataset made for an experiment that experiment’s project', async () => {
    http.state.experiments = [
      { id: 'exp-1', identifier: 'EXP-1', title: 'Titre', project_id: 'prj-9' },
    ]

    const user = await importNewDataset(
      <ImportUploadFlow
        workspaceId="ws-1"
        createdByUserId="u-1"
        initialExperimentId="exp-1"
      />,
    )

    await user.upload(
      screen.getByLabelText('Laboratory file'),
      new File(['a,b\n1,2'], 'x.csv', { type: 'text/csv' }),
    )
    await waitFor(() =>
      expect(http.matching('/api/db/datasets')).toHaveLength(1),
    )
    expect(http.matching('/api/db/datasets').at(0)?.body).toContain(
      '"primary_project_id":"prj-9"',
    )
  })

  it('prefers the project the page named, and carries it and returnTo to the next step', async () => {
    http.state.experiments = [
      { id: 'exp-1', identifier: 'EXP-1', title: 'Titre', project_id: 'prj-9' },
    ]

    const user = await importNewDataset(
      <ImportUploadFlow
        workspaceId="ws-1"
        createdByUserId="u-1"
        initialExperimentId="exp-1"
        initialProjectId="prj-2"
        returnTo="/experiments/exp-1/data/datasets"
      />,
    )

    await user.upload(
      screen.getByLabelText('Laboratory file'),
      new File(['a,b\n1,2'], 'x.csv', { type: 'text/csv' }),
    )
    await waitFor(() => expect(location().pathname).toBe('/import/file-1'))
    expect(http.matching('/api/db/datasets').at(0)?.body).toContain(
      '"primary_project_id":"prj-2"',
    )
    expect(location().search).toMatchObject({
      project: 'prj-2',
      returnTo: '/experiments/exp-1/data/datasets',
    })
  })

  it('keeps an embedded import in its notebook and passes the retained file to its host', async () => {
    const onUploaded = vi.fn().mockResolvedValue(undefined)
    http.state.experiments = [
      { id: 'exp-1', identifier: 'EXP-1', title: 'Titre', project_id: 'prj-9' },
    ]

    const user = await importNewDataset(
      <ImportUploadFlow
        workspaceId="ws-1"
        createdByUserId="u-1"
        initialExperimentId="exp-1"
        onUploaded={onUploaded}
      />,
    )

    expect(screen.getByLabelText('Link to experiment')).toHaveProperty(
      'disabled',
      true,
    )
    await user.upload(
      screen.getByLabelText('Laboratory file'),
      new File(['a,b\n1,2'], 'x.csv', { type: 'text/csv' }),
    )
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({
          dataset: 'ds-new',
          experiment: 'exp-1',
          step: 'map',
        }),
      ),
    )
    expect(location().pathname).toBe('/')
  })

  it('Cancel goes back to the page the import was started from', async () => {
    await renderFlow(
      <ImportUploadFlow
        workspaceId="ws-1"
        createdByUserId="u-1"
        returnTo="/samples/s-1"
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Cancel' }).getAttribute('href'),
    ).toBe('/samples/s-1')
  })

  it('Cancel falls back to the experiment, then the Datasets list', async () => {
    const { unmount } = await renderFlow(
      <ImportUploadFlow
        workspaceId="ws-1"
        createdByUserId="u-1"
        initialExperimentId="exp-1"
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Cancel' }).getAttribute('href'),
    ).toBe('/experiments/exp-1')
    unmount()
    await renderFlow(
      <ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />,
    )
    expect(
      screen.getByRole('button', { name: 'Cancel' }).getAttribute('href'),
    ).toBe('/datasets')
  })
})

describe('ImportMapCheckFlow', () => {
  it('requires a worksheet and source-unit declaration, then pins both in the resumable review', async () => {
    http.state.datasets = true
    http.state.file = (url) =>
      uploadResponse({
        savedMapping: {
          sources: [{ source: 'raw', fieldId: 'field-1', unit: 'NTU' }],
        },
        sheet: {
          name: url.searchParams.get('sheetName') ?? 'Cover',
          headers: ['raw', 'dilution'],
          sampleRows: [{ raw: '12.75', dilution: '1:10' }],
          rowCount: 1,
          sheetNames: ['Cover', 'Measurements'],
        },
      })
    let latest: ImportSearch = { dataset: 'ds-1' }

    function Flow() {
      const [search, setSearch] = useState(latest)

      return (
        <ImportMapCheckFlow
          importId="file-1"
          search={search}
          onSearch={(next) => {
            latest = next
            setSearch(next)
          }}
        />
      )
    }

    const user = userEvent.setup()
    const { unmount } = await renderFlow(<Flow />)
    await screen.findByLabelText('Worksheet')
    expect(screen.queryByRole('table', { name: 'Column mapping' })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Worksheet'), 'Measurements')

    const unit = z
      .instanceof(HTMLInputElement)
      .parse(await screen.findByLabelText('Source unit for raw'))

    expect(unit.value).toBe('') // The old target-unit label is not a source declaration.
    expect(
      screen.getByRole('button', {
        name: /^Import \d+ rows$/,
      }),
    ).toHaveProperty('disabled', true)
    await user.type(unit, 'g/L')
    expect(
      await screen.findByText(
        /source unit g\/L does not match storage unit NTU/,
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: /^Import \d+ rows$/,
      }),
    ).toHaveProperty('disabled', true)
    await user.clear(unit)
    await user.type(unit, 'NTU')
    // The map step shows the rows its mapping produces, beside the mapping.
    await screen.findByRole('table', { name: 'Rows to import' })
    expect(latest).toMatchObject({
      sheet: 'Measurements',
      units: 'raw:NTU,dilution:',
    })
    expect(
      JSON.parse(http.matching('/api/import/review').at(-1)?.body ?? 'null'),
    ).toMatchObject({
      sheetName: 'Measurements',
      mapping: {
        sheetName: 'Measurements',
        sources: [
          expect.objectContaining({ source: 'raw', sourceUnit: 'NTU' }),
          expect.anything(),
        ],
      },
    })
    unmount()
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={latest}
        onSearch={vi.fn()}
      />,
    )
    expect(
      await screen.findByRole('table', { name: 'Rows to import' }),
    ).toBeTruthy()
  })

  it('reloads at the map step with the linked mapping, without reviewing', async () => {
    http.state.datasets = true
    // A valid, fully declared map reviews automatically. Keep this map-only
    // scenario explicitly awaiting its source-unit declaration instead.
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{
          step: 'map',
          dataset: 'ds-1',
          map: 'raw:field-1',
          units: 'raw:',
        }}
        onSearch={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('table', { name: 'Column mapping' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Map raw')).toHaveProperty('value', 'field-1')
    expect(screen.getByLabelText('Map dilution')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Source unit for raw')).toHaveProperty(
      'value',
      '',
    )
    expect(http.matching('/api/import/review')).toEqual([])
  })

  it('shows each column’s examples and what the column reads, without reviewing', async () => {
    http.state.datasets = true
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{
          step: 'map',
          dataset: 'ds-1',
          map: 'raw:field-1',
          units: 'raw:',
        }}
        onSearch={vi.fn()}
      />,
    )

    const mapping = await screen.findByRole('table', { name: 'Column mapping' })
    expect(mapping.textContent).toContain('Example values')
    expect(mapping.textContent).toContain('Note')
    expect(mapping.textContent).toContain('1.2')
    // `raw` is mapped, so its note says how much of the file it reads;
    // `dilution` is not, so its note says why it is left out.
    expect(mapping.textContent).toContain('Matched 1 of 2')
    expect(mapping.textContent).toContain('No matching field')
    expect(http.matching('/api/import/review')).toEqual([])
  })

  it('takes a column’s examples from the first three non-empty of the first six rows', () => {
    const rows = [
      { titre: '5.2' },
      { titre: '' },
      { titre: '4.8' },
      { titre: '   ' },
      { titre: '3.9' },
      { titre: '7.1' },
      { titre: '5.4' },
    ]

    expect(columnExamples('titre', rows)).toEqual(['5.2', '4.8', '3.9'])
    expect(columnExamples('missing', rows)).toEqual([])
  })

  it('notes a mapped column with how much of the first six rows it reads', () => {
    const rows = [{ titre: '5.2' }, { titre: '' }, { titre: '4.8' }]
    expect(columnNote('titre', rows, 4, true)).toBe('Matched 2 of 4')
    expect(columnNote('titre', rows, 9, true)).toBe('Matched 2 of 6')
    expect(columnNote('titre', rows, 4, false)).toBe('No matching field')
  })

  it('reloads at the check step and recomputes the review on the server', async () => {
    http.state.datasets = true
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'check', dataset: 'ds-1', map: 'raw:field-1' }}
        onSearch={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('table', { name: 'Rows to import' }),
    ).toBeTruthy()
    expect(await screen.findByText('Will add')).toBeTruthy()
    expect(http.matching('/api/import/review')).toHaveLength(1)
    expect(
      JSON.parse(http.matching('/api/import/review').at(0)?.body ?? 'null'),
    ).toEqual({
      fileId: 'file-1',
      datasetId: 'ds-1',
      parserKey: 'sheetbase.plate-reader-csv',
      parserVersionId: 'parser-version-1',
      sheetName: 'Sheet 1',
      mapping: {
        sheetName: 'Sheet 1',
        sources: [
          { source: 'raw', fieldId: 'field-1', unit: 'NTU', sourceUnit: 'NTU' },
          { source: 'dilution', fieldId: null, unit: null, sourceUnit: null },
        ],
      },
    })
    expect(
      await screen.findByRole('button', { name: 'Import 2 rows' }),
    ).toBeTruthy()
  })

  it('shows a per-import not-found state for an unknown import id', async () => {
    http.state.missingFile = true
    await renderFlow(
      <ImportMapCheckFlow
        importId="missing"
        search={{ dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    expect(await screen.findByText('This import doesn’t exist')).toBeTruthy()
    expect(http.matching('/api/import/files', 'GET').at(0)?.url.search).toBe(
      '?fileId=missing&datasetId=ds-1',
    )
    expect(
      screen.getByRole('button', { name: 'Import data' }).getAttribute('href'),
    ).toBe('/import')
  })

  it('does not claim the file matched no parser while the target Dataset loads', async () => {
    let resolveDatasets: () => void = () => {
      throw new Error('Dataset gate not initialized')
    }

    http.state.datasets = true
    http.state.datasetReady = new Promise<void>((resolve) => {
      resolveDatasets = resolve
      datasetGates.push(resolve)
    })
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    // The file parsed with a parser; only the Dataset's fields are still on their way,
    // which is no reason to tell the user nothing recognised the file.
    expect(await screen.findByText('Reading the target dataset…')).toBeTruthy()
    expect(screen.queryByText(/does not match a registered parser/)).toBeNull()

    resolveDatasets()
    expect(
      await screen.findByRole('table', { name: 'Column mapping' }),
    ).toBeTruthy()
  })

  it('reviews the file even when saving the mapping as the parser default is refused', async () => {
    http.state.datasets = true
    http.state.refuseMapping = true
    const onSearch = vi.fn()
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1', map: 'raw:field-1' }}
        onSearch={onSearch}
      />,
    )

    await screen.findByRole('table', { name: 'Column mapping' })

    const importButton = await screen.findByRole('button', {
      name: 'Import 2 rows',
    })

    await waitFor(() => expect(importButton).toHaveProperty('disabled', false))
    await userEvent.setup().click(importButton)

    await waitFor(() =>
      expect(http.matching('/api/import/commit')).toHaveLength(1),
    )
    expect(http.matching('/api/db/rpc/save_parser_mapping')).toHaveLength(1)

    const mapping: ImportMappingDocument = {
      sheetName: 'Sheet 1',
      sources: [
        { source: 'raw', fieldId: 'field-1', unit: 'NTU', sourceUnit: 'NTU' },
        { source: 'dilution', fieldId: null, unit: null, sourceUnit: null },
      ],
    }

    expect(
      JSON.parse(
        http.matching('/api/db/rpc/save_parser_mapping').at(0)?.body ?? 'null',
      ),
    ).toEqual({
      p_parser_id: 'parser-1',
      p_target_key: 'dataset:ds-1',
      p_mapping: mapping,
    })
    expect(
      JSON.parse(http.matching('/api/import/commit').at(0)?.body ?? 'null'),
    ).toEqual({
      fileId: 'file-1',
      datasetId: 'ds-1',
      mapping,
      parserKey: 'sheetbase.plate-reader-csv',
      parserId: 'parser-1',
      parserVersionId: 'parser-version-1',
      experimentRecordId: null,
      instrumentId: null,
      sheetName: 'Sheet 1',
      idempotencyKey: commitIdempotencyKey('file-1', 'ds-1', mapping),
    })

    const writePaths = http.requests
      .filter((request) => request.method === 'POST')
      .map((request) => request.url.pathname)

    expect(writePaths.indexOf('/api/import/review')).toBeLessThan(
      writePaths.indexOf('/api/db/rpc/save_parser_mapping'),
    )
    expect(writePaths.indexOf('/api/db/rpc/save_parser_mapping')).toBeLessThan(
      writePaths.indexOf('/api/import/commit'),
    )
    expect(
      await screen.findByText(/not saved as this parser’s default/),
    ).toBeTruthy()
    expect(screen.queryByText('Could not review the file.')).toBeNull()
  })

  it('pre-selects the parser suggested by the file name and lets the user override it', async () => {
    http.state.datasets = true
    http.state.file = () =>
      uploadResponse({
        filename: 'TB-02_run12.csv',
        parser: null,
        recognitionMessage: 'This file doesn’t match a registered parser.',
        draftParsers: [
          parserSummary({
            key: 'sheetbase.tb02-turbidity',
            label: 'TB-02 CSV firmware 4',
            parserVersionId: 'parser-version-2',
            status: 'draft',
          }),
          parserSummary({ status: 'draft' }),
        ],
      })
    const onSearch = vi.fn()
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={onSearch}
      />,
    )

    const select = z
      .instanceof(HTMLSelectElement)
      .parse(await screen.findByLabelText('Parser for this file'))

    await waitFor(() => expect(select.value).toBe('sheetbase.tb02-turbidity'))
    expect(
      screen.getByText(/Suggested from the file name: TB-02 CSV firmware 4/),
    ).toBeTruthy()

    await userEvent.setup().selectOptions(select, 'sheetbase.plate-reader-csv')
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ parser: 'sheetbase.plate-reader-csv' }),
    )
  })

  it('reads the file one way at the review step, and keeps the choice on the map step', async () => {
    http.state.datasets = true
    http.state.file = () =>
      uploadResponse({
        parser: null,
        recognitionMessage:
          'This file’s headers (raw, dilution) match no approved parser.',
      })

    const { unmount } = await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    // The map step is where how to read the file is the open question.
    expect(
      await screen.findByText('This file doesn’t match a registered parser'),
    ).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Rows to import' })).toBeNull()

    unmount()
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'check', dataset: 'ds-1', map: 'raw:field-1' }}
        onSearch={vi.fn()}
      />,
    )

    // The review step reads the rows the mapping produces: the rows the Import
    // button counts are on screen, and the file is not also said to be unreadable.
    expect(
      await screen.findByRole('table', { name: 'Rows to import' }),
    ).toBeTruthy()
    expect(
      screen.queryByText('This file doesn’t match a registered parser'),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Import 2 rows' })).toBeTruthy()
  })
})

describe('a committed import', () => {
  const receipt: DatasetImportRecord = {
    id: 'imp-1',
    dataset_id: 'ds-1',
    experiment_record_id: 'exp-1',
    instrument_id: 'inst-1',
    parser_id: 'parser-1',
    parser_version_id: 'parser-version-1',
    file_id: 'file-1',
    connector_run_id: null,
    imported_row_ids: ['r1', 'r2'],
    parser_provenance: {
      key: 'sheetbase.plate-reader-csv',
      name: 'Plate reader CSV',
      version: 2,
    },
    source_provenance: { filename: 'plate-01.csv' },
    outcome: { added: 2 },
    mapping: {
      sources: [
        { source: 'raw', fieldId: 'field-1', unit: 'NTU', sourceUnit: 'NTU' },
        { source: 'dilution', fieldId: null, unit: null },
      ],
    },
    snapshot_version_id: 'snap-12345678',
    status: 'committed',
    error_detail: null,
    created_at: '2026-02-01T10:00:00Z',
  }

  it('shows a read-only receipt instead of the map and check steps', async () => {
    http.state.datasets = true
    http.state.receipts = [receipt]
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    expect(await screen.findByText('This import is committed')).toBeTruthy()
    expect(screen.getByText('plate-01.csv')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Mapping used' })).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Column mapping' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Import / })).toBeNull()
  })

  it('uploads a corrected file with the old settings carried over', async () => {
    http.state.datasets = true
    http.state.receipts = [receipt]
    http.state.upload = uploadResponse({ fileId: 'file-2' })
    const user = userEvent.setup()
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    await screen.findByText('This import is committed')
    await user.upload(
      screen.getByLabelText('Corrected file'),
      new File(['raw\n1.3'], 'plate-01-fixed.csv', { type: 'text/csv' }),
    )

    await waitFor(() => expect(location().pathname).toBe('/import/file-2'))
    expect(
      http
        .matching('/api/import/files')
        .at(0)
        ?.url.searchParams.get('datasetId'),
    ).toBe('ds-1')
    expect(http.matching('/api/import/files').at(0)?.filename).toBe(
      'plate-01-fixed.csv',
    )
    expect(http.matching('/api/import/files').at(0)?.body).toBe('raw\n1.3')
    expect(location().search).toEqual({
      step: 'map',
      dataset: 'ds-1',
      experiment: 'exp-1',
      instrument: 'inst-1',
      parser: 'sheetbase.plate-reader-csv',
      map: 'raw:field-1',
      units: 'raw:NTU',
      returnTo: '/experiments/exp-1/notebook',
    })
  })

  it('treats a failed import as still open to mapping', async () => {
    http.state.datasets = true
    http.state.receipts = [{ ...receipt, status: 'failed' }]
    await renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )
    expect(
      await screen.findByRole('table', { name: 'Column mapping' }),
    ).toBeTruthy()
    expect(screen.queryByText('This import is committed')).toBeNull()
  })
})
