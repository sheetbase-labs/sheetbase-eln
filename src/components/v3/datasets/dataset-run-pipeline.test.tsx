import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PipelineListRow } from '#/components/v3/pipelines/pipelines-data'

import {
  DatasetRunPipeline,
  pipelinesThatReadADataset,
} from './dataset-run-pipeline'

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], launch: vi.fn() }))

vi.mock('#/components/v3/pipelines/pipelines-data', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  usePipelineRows: () => ({ data: mocks.rows }),
}))
vi.mock('#/components/v3/pipelines/use-run-launcher', () => ({
  useRunLauncher: () => ({
    launch: mocks.launch,
    pending: false,
    dialog: null,
  }),
}))

afterEach(() => {
  cleanup()
  mocks.launch.mockReset()
})

function row(
  key: string,
  lifecycle: string,
  inputs: Array<{ name: string; required: boolean }>,
): PipelineListRow {
  const version = {
    id: `${key}-v1`,
    version: 1,
    lifecycle,
    configuration: { inputs },
  }
  return {
    id: key,
    key,
    name: `Pipeline ${key}`,
    current: version,
  } as unknown as PipelineListRow
}

describe('pipelinesThatReadADataset', () => {
  it('keeps live versions that declare an input and drops the rest', () => {
    const rows = [
      row('reads', 'published', [{ name: 'raw', required: true }]),
      row('no-input', 'published', []),
      row('draft', 'draft', [{ name: 'raw', required: true }]),
    ]
    expect(pipelinesThatReadADataset(rows).map((r) => r.key)).toEqual(['reads'])
  })
})

describe('DatasetRunPipeline', () => {
  function renderIt(latestVersionId: string | null) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <DatasetRunPipeline
          workspaceId="ws"
          latestVersionId={latestVersionId}
        />
      </QueryClientProvider>,
    )
  }

  it('renders nothing when no pipeline reads a dataset', () => {
    mocks.rows = [row('no-input', 'published', [])]
    renderIt('snap-1')
    expect(screen.queryByRole('button', { name: /run pipeline/i })).toBeNull()
  })

  it('starts the first input on the newest snapshot', async () => {
    mocks.rows = [row('reads', 'published', [{ name: 'raw', required: true }])]
    renderIt('snap-1')
    await userEvent.click(screen.getByRole('button', { name: /run pipeline/i }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /Pipeline reads/ }),
    )
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineKey: 'reads',
        initial: { inputVersions: { raw: 'snap-1' } },
      }),
    )
  })

  it('asks for a snapshot first when there is none', async () => {
    mocks.rows = [row('reads', 'published', [{ name: 'raw', required: true }])]
    renderIt(null)
    await userEvent.click(screen.getByRole('button', { name: /run pipeline/i }))
    expect(await screen.findByText(/take a snapshot first/i)).toBeTruthy()
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Pipeline reads/ }),
    )
    expect(mocks.launch).not.toHaveBeenCalled()
  })
})
