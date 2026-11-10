import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InputsEditor } from './inputs-editor'
import type { DatasetVersionChoice, SchemaFieldInfo } from './pipelines-data'
import type { PipelineInput } from '#/lib/pipelines/config'

afterEach(cleanup)

function EditableInputs({ onInsert }: { onInsert: (text: string) => void }) {
  const [inputs, setInputs] = useState<PipelineInput[]>([
    { name: 'source', required: true },
    { name: '', required: true },
    { name: '', required: true },
  ])

  return (
    <InputsEditor
      inputs={inputs}
      onChange={(next) => setInputs([...next])}
      onInsert={onInsert}
    />
  )
}

function renderInputs(onInsert: (text: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })

  client.setQueryData(['ui-port', 'pipelines', 'dataset-version-choices'], [
    {
      id: 'version-a',
      label: 'Readings v1',
      schemaId: 'schema-a',
      schemaName: 'Readings',
    },
  ] satisfies DatasetVersionChoice[])
  client.setQueryData(['ui-port', 'pipelines', 'version-fields', 'version-a'], [
    { key: 'dose', label: 'Dose', type: 'decimal', required: true },
  ] satisfies SchemaFieldInfo[])

  return render(
    <QueryClientProvider client={client}>
      <EditableInputs onInsert={onInsert} />
    </QueryClientProvider>,
  )
}

describe('InputsEditor row identity', () => {
  it('keeps focus and the selected example through renames and sibling removal', () => {
    const onInsert = vi.fn<(text: string) => void>()
    renderInputs(onInsert)
    const name = screen.getByLabelText<HTMLInputElement>('Input 3 name')

    const example = screen.getByLabelText<HTMLSelectElement>(
      'Input 3 example dataset',
    )

    fireEvent.change(example, { target: { value: 'version-a' } })
    expect(
      screen.getByLabelText<HTMLSelectElement>('Input 3 expected schema').value,
    ).toBe('schema-a')
    name.focus()
    fireEvent.change(name, { target: { value: 'readings' } })
    expect(screen.getByLabelText('Input 3 name')).toBe(name)
    expect(document.activeElement).toBe(name)
    expect(example.value).toBe('version-a')
    fireEvent.change(screen.getByLabelText('Input 2 name'), {
      target: { value: 'other' },
    })
    name.setSelectionRange(2, 5)
    fireEvent.click(screen.getByRole('button', { name: 'Remove input 1' }))

    expect(screen.getByLabelText('Input 2 name')).toBe(name)
    expect(document.activeElement).toBe(name)
    expect(name.selectionStart).toBe(2)
    expect(name.selectionEnd).toBe(5)
    expect(screen.getByLabelText('Input 2 example dataset')).toBe(example)
    expect(example.value).toBe('version-a')
    expect(
      screen.getByLabelText<HTMLSelectElement>('Input 1 example dataset').value,
    ).toBe('')
    fireEvent.click(
      within(
        screen.getByRole('group', {
          name: 'Columns of the example for readings',
        }),
      ).getByRole('button'),
    )
    expect(onInsert).toHaveBeenCalledWith('readings.dose')
  })

  it('does not transfer a removed row example to an inserted sibling', () => {
    renderInputs(vi.fn())
    const survivor = screen.getByLabelText('Input 2 name')
    fireEvent.change(screen.getByLabelText('Input 1 example dataset'), {
      target: { value: 'version-a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove input 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))

    expect(screen.getByLabelText('Input 1 name')).toBe(survivor)

    for (const position of [1, 2, 3]) {
      expect(
        screen.getByLabelText<HTMLSelectElement>(
          `Input ${position} example dataset`,
        ).value,
      ).toBe('')
    }

    expect(
      screen.queryByRole('group', { name: /Columns of the example/ }),
    ).toBeNull()
  })
})
