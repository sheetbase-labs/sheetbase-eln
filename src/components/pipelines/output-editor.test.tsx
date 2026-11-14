import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OutputEditor } from './output-editor'
import { choose } from '../../../tests/unit/picker'

const clients = new Set<QueryClient>()

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.clear()
})

function show(overrides: Partial<ComponentProps<typeof OutputEditor>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  clients.add(client)
  client.setQueryData(['ui-port', 'pipelines', 'output-targets'], {
    datasets: [
      {
        id: 'dataset-1',
        name: 'Readings',
        displayId: 'DS-0001',
        schemaVersionId: 'schema-1',
      },
    ],
    schemaVersions: [{ id: 'schema-1', label: 'Readings v1' }],
  })
  client.setQueryData(
    ['ui-port', 'pipelines', 'schema-fields', 'schema-1'],
    [{ key: 'mean', label: 'Mean', type: 'decimal', required: true }],
  )

  const props: ComponentProps<typeof OutputEditor> = {
    value: {
      mode: 'create',
      datasetName: 'Results',
      schemaVersionId: 'schema-1',
      datasetId: 'dataset-1',
      datasetLabel: 'Weekly',
      fieldMapping: null,
    },
    onChange: vi.fn(),
    resultColumns: ['average'],
    fieldErrors: {},
    ...overrides,
  }

  const view = render(<OutputEditor {...props} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })

  return {
    props,
    client,
    rerender: (next: Partial<ComponentProps<typeof OutputEditor>>) =>
      view.rerender(<OutputEditor {...props} {...next} />),
  }
}

describe('OutputEditor', () => {
  it('edits mappings, reports mismatches, accepts a fit and clears the mapping', () => {
    const { props, rerender } = show()

    expect(
      screen.getByText(
        'No result column feeds mean. 1 column (average) matches no field.',
      ),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Result column for mean'), {
      target: { value: 'average' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({
      fieldMapping: { average: 'mean' },
    })
    rerender({ value: { ...props.value, fieldMapping: { average: 'mean' } } })
    expect(
      screen.getByText(
        'The columns of the last run (average) fit this dataset structure.',
      ),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear column matching' }),
    )
    expect(props.onChange).toHaveBeenLastCalledWith({ fieldMapping: null })
  })

  it('keeps create errors and clears mappings when the schema changes', async () => {
    const user = userEvent.setup()
    const { props } = show({ fieldErrors: { datasetName: 'Choose a name' } })

    expect(screen.getByText('Choose a name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Dataset name'), {
      target: { value: 'New results' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({
      datasetName: 'New results',
    })
    await choose(user, 'Dataset schema version', 'Choose a schema version')
    expect(props.onChange).toHaveBeenLastCalledWith({
      schemaVersionId: '',
      fieldMapping: null,
    })
  })

  it('shows append fields from the selected dataset and clears mappings when it changes', async () => {
    const user = userEvent.setup()
    const { props, rerender } = show()

    rerender({ value: { ...props.value, mode: 'append' } })
    expect(screen.queryByLabelText('Dataset name')).toBeNull()
    expect(screen.getByLabelText('Dataset').textContent).toContain(
      'DS-0001 · Readings',
    )
    expect(screen.getByLabelText('Result column for mean')).toBeTruthy()
    await choose(user, /^Dataset$/, 'Choose a dataset')
    expect(props.onChange).toHaveBeenLastCalledWith({
      datasetId: '',
      fieldMapping: null,
    })
    rerender({ value: { ...props.value, mode: 'none' } })
    expect(screen.queryByLabelText('Result column for mean')).toBeNull()
    expect(screen.queryByLabelText('Dataset version label')).toBeNull()
  })

  it('retains the no-result guidance and empty-schema state', () => {
    const { client, props, rerender } = show({ resultColumns: [] })

    expect(
      screen.getByText(
        'Run the pipeline once and its result columns are suggested here and checked against these fields.',
      ),
    ).toBeTruthy()
    client.setQueryData(
      ['ui-port', 'pipelines', 'schema-fields', 'empty-schema'],
      [],
    )
    rerender({ value: { ...props.value, schemaVersionId: 'empty-schema' } })
    expect(screen.getByText('This schema has no active fields')).toBeTruthy()
    expect(screen.queryByLabelText('Result column for mean')).toBeNull()
  })
})
