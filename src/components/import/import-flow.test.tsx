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
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DatasetImportRecord,
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportParserSummary,
  ImportReviewResponse,
} from '#/lib/import/types'
import type * as ImportDataModule from '#/lib/import/data'
import type * as DatasetExplorerModule from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import type * as DatasetProductModule from '#/lib/dataset-product'
import type * as ParserSettingsModule from '#/lib/parser-settings'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { ImportRequestError } from '#/lib/import/data'

import {
  ImportMapCheckFlow,
  ImportUploadFlow,
  columnExamples,
  columnNote,
  commitIdempotencyKey,
  initialMappingValues,
  parseImportMapping,
  parseImportSearch,
  serializeImportMapping,
  suggestParserFromFilename,
} from './import-flow'

const importData = vi.hoisted(() => ({
  fetchImportFile: vi.fn(),
  uploadImportFile: vi.fn(),
  resolveImportTarget: vi.fn(),
  reviewImport: vi.fn(),
  commitImport: vi.fn(),
  saveParserMapping: vi.fn(),
  fetchDatasetImports: vi.fn(async (): Promise<DatasetImportRecord[]> => []),
}))

vi.mock('#/lib/import/data', async (importOriginal) => ({
  ...(await importOriginal<typeof ImportDataModule>()),
  ...importData,
}))

vi.mock('#/lib/dataset-explorer-data', async (importOriginal) => ({
  ...(await importOriginal<typeof DatasetExplorerModule>()),
  fetchDatasetSummaries: vi.fn(async () => []),
}))

vi.mock('#/lib/dataset-product', async (importOriginal) => ({
  ...(await importOriginal<typeof DatasetProductModule>()),
  listPublishedDatasetSchemas: vi.fn(async () => []),
}))

vi.mock('#/components/v3/experiments/experiments-data', () => ({
  useExperimentRecords: () => ({ data: [] }),
}))

vi.mock('#/components/v3/instruments/instruments-data', () => ({
  useInstruments: () => ({ data: [] }),
  useLatestCalibrationsByInstrument: () => ({ data: new Map() }),
  calibrationStatus: () => ({ tone: 'none', label: 'Not calibrated' }),
}))

vi.mock('#/lib/parser-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof ParserSettingsModule>()),
  requestParserUpdate: vi.fn(async () => ({ ok: true })),
}))

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }: { to?: unknown; children?: ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.mocked(fetchDatasetSummaries).mockResolvedValue([])
  vi.mocked(listPublishedDatasetSchemas).mockResolvedValue([])
})

function renderFlow(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function dataset(): CanonicalDatasetWire {
  return {
    id: 'ds-1',
    display_id: 'DS-0001',
    name: 'ELISA capsid titre',
    resource_name: 'scientific_rows_1',
    schema_version: 1,
    lifecycle: 'active',
    columns: [
      {
        id: 'field-1',
        field_name: 'raw',
        label: 'Raw',
        display_order: 1,
        logical_type: 'decimal',
        nullable: true,
        unit: { storageUnit: 'NTU' },
        validation: {},
        width: null,
        options: [],
      },
      {
        id: 'field-2',
        field_name: 'dilution',
        label: 'Dilution',
        display_order: 2,
        logical_type: 'text',
        nullable: true,
        unit: null,
        validation: {},
        width: null,
        options: [],
      },
    ],
  }
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
    savedMapping: null,
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
    })
    expect(parseImportSearch({ step: 'upload' })).toEqual({
      step: undefined,
      dataset: undefined,
      experiment: undefined,
      instrument: undefined,
      parser: undefined,
      map: undefined,
    })
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
      sources: [{ source: 'raw', fieldId: 'field-1', unit: null }],
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

describe('ImportUploadFlow', () => {
  it('offers the new-Dataset path when there is nothing to append to', async () => {
    renderFlow(<ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />)
    expect(screen.queryByText(/Create a dataset from a model first/)).toBeNull()
    expect(
      await screen.findByLabelText('Model for the new dataset'),
    ).toBeTruthy()
    expect(screen.getByLabelText('New dataset name')).toBeTruthy()
  })

  it('does not claim the workspace has no Datasets while the list is still loading', async () => {
    vi.mocked(fetchDatasetSummaries).mockReturnValue(
      new Promise<CanonicalDatasetWire[]>(() => {}),
    )
    renderFlow(<ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />)

    expect(await screen.findByText('Reading your Datasets…')).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()
  })

  it('states a failed Dataset read instead of claiming the workspace has none, and retries it', async () => {
    vi.mocked(fetchDatasetSummaries)
      .mockRejectedValueOnce(new Error('The database refused the request.'))
      .mockResolvedValueOnce([dataset()])
    const user = userEvent.setup()
    renderFlow(<ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />)

    expect(
      await screen.findByText('Your Datasets could not be read.'),
    ).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('radio', { name: /Append to a Dataset/ }),
    ).toBeTruthy()
    expect(
      screen.queryByText(/There is no Dataset to append to yet/),
    ).toBeNull()
  })

  it('creates the new Dataset through the shared resolver, then commits to it', async () => {
    vi.mocked(listPublishedDatasetSchemas).mockResolvedValue([
      {
        schemaDefinitionId: 'sd-1',
        schemaVersionId: 'sv-1',
        key: 'elisa',
        name: 'ELISA and turbidity',
        description: null,
        version: 2,
      },
    ])
    importData.resolveImportTarget.mockResolvedValue({
      datasetId: 'ds-new',
      created: true,
    })
    importData.uploadImportFile.mockResolvedValue(
      uploadResponse({ fileId: 'file-1', datasetId: 'ds-new' }),
    )
    const user = userEvent.setup()
    renderFlow(<ImportUploadFlow workspaceId="ws-1" createdByUserId="u-1" />)

    await screen.findByRole('option', { name: /ELISA and turbidity/ })
    await user.selectOptions(
      screen.getByLabelText('Model for the new dataset'),
      'sv-1',
    )
    await user.type(
      screen.getByLabelText('New dataset name'),
      'ELISA capsid titre run 4',
    )
    const file = new File(['Sample,pH\nA,7.4'], 'plate-01.csv', {
      type: 'text/csv',
    })
    await user.upload(screen.getByLabelText('Laboratory file'), file)

    await waitFor(() =>
      expect(importData.resolveImportTarget).toHaveBeenCalledTimes(1),
    )
    expect(importData.resolveImportTarget).toHaveBeenCalledWith(
      expect.anything(),
      {
        mode: 'new',
        workspaceId: 'ws-1',
        schemaVersionId: 'sv-1',
        name: 'ELISA capsid titre run 4',
        createdByUserId: 'u-1',
      },
    )
    const [uploadArgs] = importData.uploadImportFile.mock.calls[0] ?? []
    expect(uploadArgs.datasetId).toBe('ds-new')
    expect(uploadArgs.file.name).toBe('plate-01.csv')
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/import/$importId',
        params: { importId: 'file-1' },
        search: expect.objectContaining({ step: 'map', dataset: 'ds-new' }),
      }),
    )
  })
})

describe('ImportMapCheckFlow', () => {
  it('reloads at the map step with the linked mapping, without reviewing', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1', map: 'raw:field-1' }}
        onSearch={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('table', { name: 'Column mapping' }),
    ).toBeTruthy()
    const raw = screen.getByLabelText<HTMLSelectElement>('Map raw')
    expect(raw.value).toBe('field-1')
    const dilution = screen.getByLabelText<HTMLSelectElement>('Map dilution')
    expect(dilution.value).toBe('')
    expect(importData.reviewImport).not.toHaveBeenCalled()
  })

  it('shows each column’s examples and what the column reads, without reviewing', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1', map: 'raw:field-1' }}
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
    expect(importData.reviewImport).not.toHaveBeenCalled()
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
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    importData.reviewImport.mockResolvedValue(reviewResponse())
    renderFlow(
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
    expect(importData.reviewImport).toHaveBeenCalledTimes(1)
    const [reviewArgs] = importData.reviewImport.mock.calls[0] ?? []
    expect(reviewArgs.fileId).toBe('file-1')
    expect(reviewArgs.datasetId).toBe('ds-1')
    expect(reviewArgs.mapping.sources).toEqual([
      { source: 'raw', fieldId: 'field-1', unit: 'NTU' },
      { source: 'dilution', fieldId: null, unit: null },
    ])
    expect(
      await screen.findByRole('button', { name: 'Import 2 rows' }),
    ).toBeTruthy()
  })

  it('shows a per-import not-found state for an unknown import id', async () => {
    importData.fetchImportFile.mockRejectedValue(
      new ImportRequestError(404, 'not_found', 'Import not found.'),
    )
    renderFlow(
      <ImportMapCheckFlow
        importId="missing"
        search={{ dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    expect(await screen.findByText('This import doesn’t exist')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Import data' })).toBeTruthy()
  })

  it('does not claim the file matched no parser while the target Dataset loads', async () => {
    let resolveDatasets: (rows: CanonicalDatasetWire[]) => void = () => {}
    vi.mocked(fetchDatasetSummaries).mockReturnValue(
      new Promise<CanonicalDatasetWire[]>((resolve) => {
        resolveDatasets = resolve
      }),
    )
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    // The file parsed with a parser; only the Dataset's fields are still on their way,
    // which is no reason to tell the user nothing recognised the file.
    expect(await screen.findByText('Reading the target Dataset…')).toBeTruthy()
    expect(screen.queryByText(/does not match a registered parser/)).toBeNull()

    resolveDatasets([dataset()])
    expect(
      await screen.findByRole('table', { name: 'Column mapping' }),
    ).toBeTruthy()
  })

  it('reviews the file even when saving the mapping as the parser default is refused', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    importData.saveParserMapping.mockRejectedValue(
      new Error('You cannot change this parser.'),
    )
    const onSearch = vi.fn()
    renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1', map: 'raw:field-1' }}
        onSearch={onSearch}
      />,
    )

    await screen.findByRole('table', { name: 'Column mapping' })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(onSearch).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'check' }),
      ),
    )
    expect(importData.saveParserMapping).toHaveBeenCalled()
    expect(
      await screen.findByText(/not saved as this parser’s default/),
    ).toBeTruthy()
    expect(screen.queryByText('Could not review the file.')).toBeNull()
  })

  it('pre-selects the parser suggested by the file name and lets the user override it', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(
      uploadResponse({
        filename: 'TB-02_run12.csv',
        parser: null,
        recognitionMessage: 'This file does not match a registered parser.',
        draftParsers: [
          parserSummary({
            key: 'sheetbase.tb02-turbidity',
            label: 'TB-02 CSV firmware 4',
            parserVersionId: 'parser-version-2',
            status: 'draft',
          }),
          parserSummary({ status: 'draft' }),
        ],
      }),
    )
    const onSearch = vi.fn()
    renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={onSearch}
      />,
    )

    const select = await screen.findByLabelText<HTMLSelectElement>(
      'Parser for this file',
    )
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
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(
      uploadResponse({
        parser: null,
        recognitionMessage:
          'This file’s headers (raw, dilution) match no approved parser.',
      }),
    )
    importData.reviewImport.mockResolvedValue(reviewResponse())
    const { unmount } = renderFlow(
      <ImportMapCheckFlow
        importId="file-1"
        search={{ step: 'map', dataset: 'ds-1' }}
        onSearch={vi.fn()}
      />,
    )

    // The map step is where how to read the file is the open question.
    expect(await screen.findByText('Choose how to read this file')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Rows to import' })).toBeNull()

    unmount()
    renderFlow(
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
    expect(screen.queryByText('Choose how to read this file')).toBeNull()
    expect(screen.getByRole('button', { name: 'Import 2 rows' })).toBeTruthy()
  })
})

describe('a committed import', () => {
  const receipt = {
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
        { source: 'raw', fieldId: 'field-1', unit: 'NTU' },
        { source: 'dilution', fieldId: null, unit: null },
      ],
    },
    snapshot_version_id: 'snap-12345678',
    status: 'committed',
    error_detail: null,
    created_at: '2026-02-01T10:00:00Z',
  }

  it('shows a read-only receipt instead of the map and check steps', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    importData.fetchDatasetImports.mockResolvedValue([receipt])
    renderFlow(
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
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    importData.fetchDatasetImports.mockResolvedValue([receipt])
    importData.uploadImportFile.mockResolvedValue(
      uploadResponse({ fileId: 'file-2' }),
    )
    const user = userEvent.setup()
    renderFlow(
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

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(importData.uploadImportFile.mock.calls[0][0].datasetId).toBe('ds-1')
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { importId: 'file-2' },
        search: {
          step: 'map',
          dataset: 'ds-1',
          experiment: 'exp-1',
          instrument: 'inst-1',
          parser: 'sheetbase.plate-reader-csv',
          map: 'raw:field-1',
        },
      }),
    )
  })

  it('treats a failed import as still open to mapping', async () => {
    vi.mocked(fetchDatasetSummaries).mockResolvedValue([dataset()])
    importData.fetchImportFile.mockResolvedValue(uploadResponse())
    importData.fetchDatasetImports.mockResolvedValue([
      { ...receipt, status: 'failed' },
    ])
    renderFlow(
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
