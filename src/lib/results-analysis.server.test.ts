import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type * as RunServer from './code-cells/run.server'
import type { DataClient } from './data-client'
import {
  ANALYSIS_ADD_TOOL,
  ANALYSIS_PROPOSE_TOOL_NAMES,
  ANALYSIS_RUN_TOOL,
} from './results-analysis'

const runPython = vi.hoisted(() => vi.fn())

// oxlint-disable-next-line anti-slop/no-module-mocking -- request-auth opens the database connection at import; nothing here uses a session.
vi.mock('./request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: () => new Response(null, { status: 500 }),
  resolveSessionAuth: async () => ({ ok: false }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the Python runner is a separate service; the analysis code is exercised by the plugin's own tests.
vi.mock('./code-cells/run.server', async (importOriginal) => ({
  ...(await importOriginal<typeof RunServer>()),
  runPython,
}))

const {
  analysisProposalDefs,
  analysisReadDefs,
  buildAnalysisProposal,
  runAnalysisReadTool,
} = await import('./results-analysis.server')

interface RpcParams {
  p_expected_dataset_revision?: number
}

const DATASET = {
  id: 'd1',
  name: 'Compound plate',
  display_id: 'DS-0004',
  revision: 7,
}

const VERSION = {
  id: 'v1',
  label: 'Read 1',
  created_at: '2026-11-15T10:00:00Z',
}

const EXPERIMENT = { id: 'e1', identifier: 'EXP-0145', title: 'Potency' }

const TABLES = {
  datasets: [DATASET],
  dataset_versions: [VERSION],
  records: [EXPERIMENT],
}

const ROWS_DOC = {
  versionId: 'v1',
  datasetId: 'd1',
  label: 'Read 1',
  columns: [
    { key: 'dose_nm', label: 'Dose (nM)', type: 'decimal' },
    { key: 'signal', label: 'Signal', type: 'decimal' },
    { key: 'cmpd', label: 'Compound', type: 'text' },
  ],
  rowCount: 2,
  truncated: false,
  rows: [
    { dose_nm: 1, signal: 10, cmpd: 'A' },
    { dose_nm: 10, signal: 50, cmpd: 'A' },
  ],
}

function context(
  tables: Record<string, unknown[]> = TABLES,
  calls: string[] = [],
): LabToolContext {
  const client: DataClient = {
    list: async <T>(resource: string): Promise<T[]> => {
      const rows = Object.entries(tables).find(([name]) => name === resource)

      // SAFETY: the fixture answers each table the tools read with rows of the shape they decode.
      return (rows ? rows[1] : []) as T[]
    },
    count: async () => 0,
    rpc: async <T>(name: string, params?: RpcParams): Promise<T> => {
      calls.push(`${name} ${JSON.stringify(params)}`)

      if (name === 'snapshot_dataset')
        // SAFETY: the fixture answers snapshot_dataset with the version row it returns.
        return { ...VERSION } as T

      // SAFETY: the other rpc these tools call is dataset_version_rows_json; the fixture is its answer.
      return ROWS_DOC as T
    },
    insert: async <T>(): Promise<T> => {
      // SAFETY: the analysis tools write nothing here.
      return {} as T
    },
    patch: async <T>(): Promise<T[]> => [],
    remove: async () => [],
  }

  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}

const ask = {
  dataset: 'Compound plate',
  kind: 'dose_response' as const,
  x: 'Dose (nM)',
  y: 'Signal',
  group: 'Compound',
}

beforeEach(() => {
  runPython.mockReset()
  runPython.mockResolvedValue({
    rows: [
      { kind: 'result', group: 'A', ec50: 4.2, status: 'fitted' },
      {
        kind: 'figure',
        title: 'Curves',
        figure: 'data:image/svg+xml;base64,AAAA',
      },
    ],
    logs: [],
    runtime: 'image@sha256:x',
    environment: null,
  })
})

describe('results analysis tools', () => {
  it('offers the read to the model and the card to the catalogue', () => {
    expect(analysisReadDefs().map((d) => d.name)).toEqual([
      ANALYSIS_RUN_TOOL.replaceAll('.', '__'),
    ])
    expect(analysisProposalDefs()).toHaveLength(1)

    for (const name of ANALYSIS_PROPOSE_TOOL_NAMES)
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
  })

  it('runs the analysis on the dataset by column label and answers with numbers, not plots', async () => {
    const result = await runAnalysisReadTool(ANALYSIS_RUN_TOOL, ask, context())

    expect(result.isError).toBe(false)
    const body = JSON.parse(result.text)
    expect(body.results).toEqual([
      { kind: 'result', group: 'A', ec50: 4.2, status: 'fitted' },
    ])
    expect(body.figures).toBe(1)
    expect(result.text).not.toContain('base64')

    const [{ source, inputs }] = runPython.mock.calls[0]
    expect(source).toContain(
      'PARAMS = {"kind": "dose_response", "input": "data", "x": "dose_nm", "y": "signal", "group": "cmpd", "labels": {"x": "Dose (nM)", "y": "Signal", "group": "Compound"}}',
    )
    expect(inputs.data).toEqual(ROWS_DOC.rows)
  })

  it('keeps a snapshot first when the dataset has none', async () => {
    const calls: string[] = []

    const result = await runAnalysisReadTool(
      ANALYSIS_RUN_TOOL,
      ask,
      context({ ...TABLES, dataset_versions: [] }, calls),
    )

    expect(result.isError).toBe(false)
    expect(calls[0]).toContain('snapshot_dataset')
    expect(calls[0]).toContain('"p_expected_dataset_revision":7')
    expect(calls[1]).toContain('dataset_version_rows_json')
  })

  it('names the columns when one is wrong', async () => {
    const result = await runAnalysisReadTool(
      ANALYSIS_RUN_TOOL,
      { ...ask, y: 'Absorbance' },
      context(),
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain('There is no column "Absorbance"')
    expect(result.text).toContain('Dose (nM), Signal, Compound')
    expect(runPython).not.toHaveBeenCalled()
  })

  it('asks for the columns a kind needs', async () => {
    const result = await runAnalysisReadTool(
      ANALYSIS_RUN_TOOL,
      { dataset: 'Compound plate', kind: 'compare_groups', y: 'Signal' },
      context(),
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain('needs the group column')
  })

  it('builds a card that runs nothing and carries the code, the version and the draft', async () => {
    const outcome = await buildAnalysisProposal(
      ANALYSIS_ADD_TOOL,
      {
        ...ask,
        title: 'Fit potency',
        summary: 'Fit a curve to the compound plate',
        experiment: 'EXP-0145',
        draftSummary: 'Compound A has an EC50 of 4.2 nM.',
      },
      context(),
    )

    if (!outcome.ok) throw new Error(outcome.message)
    expect(runPython).not.toHaveBeenCalled()
    expect(outcome.proposal.target).toBe('EXP-0145 · Notebook')
    expect(outcome.proposal.action).toMatchObject({
      kind: 'analysis.add_to_notebook',
      recordId: 'e1',
      datasetVersionId: 'v1',
      heading: 'Dose-response fit',
      draftSummary: 'Compound A has an EC50 of 4.2 nM.',
    })
    expect(outcome.proposal.changes.map((c) => c.label)).toEqual([
      'Experiment',
      'Analysis',
      'Adds',
      'Draft summary',
    ])
  })
})
