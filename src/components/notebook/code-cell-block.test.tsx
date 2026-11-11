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
import { renderToString } from 'react-dom/server'
import { ZodError } from 'zod'

import type { CodeCellOutput } from '#/lib/code-cells/code-cell'
import type { NotebookBlock } from '#/lib/notebook-data'
import { CodeCellBlockEditor, CodeCellBlockPreview } from './code-cell-block'
import { GateBlockView } from './gates'

afterEach(cleanup)

const output = {
  runId: 'run-1',
  reference: 'CC-0004',
  status: 'ok',
  ranAt: '2026-11-09T12:00:00Z',
  columns: ['count', 'accepted', 'metadata', 'missing'],
  rows: [
    {
      count: 5.75,
      accepted: false,
      metadata: { instrument: 'TB-02' },
      missing: null,
    },
  ],
  rowCount: 1,
  truncated: false,
  source: 'select * from samples',
  language: 'sql',
  sourceDigest: 'sha256:source',
  outputDigest: 'sha256:result',
  runtime: 'postgres-sandbox',
  inputs: [],
} satisfies CodeCellOutput

describe('persisted notebook output boundaries', () => {
  it('renders numeric, boolean, structured and missing code-cell values without coercing objects', () => {
    render(
      <CodeCellBlockPreview
        payload={{ source: output.source, language: 'sql', output }}
      />,
    )

    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .flatMap((row) => within(row).getAllByRole('cell'))

    expect(cells.map((cell) => cell.textContent)).toEqual([
      '5.75',
      'false',
      '{"instrument":"TB-02"}',
      '',
    ])
    expect(screen.getByText('CC-0004')).toBeTruthy()
  })

  it('rejects malformed stored run evidence instead of presenting it as an empty result', () => {
    expect(() =>
      renderToString(
        <CodeCellBlockPreview
          payload={{ output: { ...output, rows: 'not rows' } }}
        />,
      ),
    ).toThrow(ZodError)
  })

  it('rejects a recognized gate kind without its required target fields', () => {
    expect(() =>
      renderToString(
        <GateBlockView
          payload={{
            conditions: [{ kind: 'plugin_check', extensionKey: 'lab-checks' }],
          }}
        />,
      ),
    ).toThrow(ZodError)
  })
})

it('keeps an edited input focused when an earlier input is removed, without persisting editor keys', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  queryClient.setQueryData(['code-cell', 'dataset-versions'], [])

  const original = {
    language: 'python',
    source: 'output = samples',
    inputs: [
      { alias: 'samples', datasetVersionId: 'version-a' },
      { alias: 'samples', datasetVersionId: 'version-b' },
    ],
  }

  const save = vi.fn(async (_payload: NotebookBlock['payload']) => ({
    ok: true,
  }))

  const ui = (payload: NotebookBlock['payload']) => (
    <QueryClientProvider client={queryClient}>
      <CodeCellBlockEditor
        block={{ id: 'cell-1', recordId: 'record-1', payload }}
        save={save}
      />
    </QueryClientProvider>
  )

  const { rerender } = render(ui(original))
  const secondName = screen.getAllByRole('textbox', { name: 'Name' })[1]
  secondName.focus()
  fireEvent.change(secondName, { target: { value: 'control' } })
  // A remote refresh must not erase a name that has not blurred/saved yet.
  rerender(ui({ ...original, source: 'remote output' }))
  expect(secondName).toHaveProperty('value', 'control')
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
  expect(screen.getByRole('textbox', { name: 'Name' })).toBe(secondName)
  expect(document.activeElement).toBe(secondName)
  expect(
    screen.getByRole('combobox', { name: 'Dataset version' }),
  ).toHaveProperty('value', 'version-b')
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      language: 'python',
      source: original.source,
      inputs: [{ alias: 'control', datasetVersionId: 'version-b' }],
      output: null,
    }),
  )
})
