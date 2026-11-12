import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParametersEditor } from './parameters-editor'
import { StepsEditor } from './steps-editor'
import type { PipelineParameter } from '#/lib/pipelines/config'
import type { PipelineViewStep as PipelineStep } from '#/lib/pipelines/config-view'
import { extensionQueryKeys } from '#/lib/extensions/client'

function render(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })

  client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])

  return renderView(node, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

afterEach(cleanup)

function EditableParameters() {
  const [parameters, setParameters] = useState<PipelineParameter[]>([
    { name: '', type: 'text', required: false },
    { name: '', type: 'text', required: false },
  ])

  return <ParametersEditor parameters={parameters} onChange={setParameters} />
}

function EditableSteps({ initial }: { initial: PipelineStep[] }) {
  const [steps, setSteps] = useState(initial)

  return <StepsEditor steps={steps} members={{}} onChange={setSteps} />
}

describe('ParametersEditor', () => {
  it('keeps the edited input and focus when its name changes and a sibling is removed', () => {
    render(<EditableParameters />)
    const name = screen.getByLabelText<HTMLInputElement>('Parameter 2 name')

    const defaultInput = screen.getByLabelText<HTMLInputElement>(
      'Parameter 2 default',
    )

    name.focus()
    fireEvent.change(name, { target: { value: 'dose' } })
    expect(screen.getByLabelText('Parameter 2 name')).toBe(name)
    expect(document.activeElement).toBe(name)
    fireEvent.change(defaultInput, { target: { value: 'five' } })
    name.setSelectionRange(1, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove parameter 1' }))

    expect(screen.getByLabelText('Parameter 1 name')).toBe(name)
    expect(document.activeElement).toBe(name)
    expect(name.selectionStart).toBe(1)
    expect(name.selectionEnd).toBe(3)
    expect(screen.getByLabelText('Parameter 1 default')).toBe(defaultInput)
    expect(defaultInput.value).toBe('five')
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    expect(screen.getByLabelText('Parameter 1 name')).toBe(name)
    expect(screen.getByLabelText('Parameter 2 name')).not.toBe(name)
  })

  it('keeps a controlled row mounted when its owner rejects an edit', () => {
    const parameters: PipelineParameter[] = [
      { name: 'dose', type: 'text', required: false },
    ]

    render(<ParametersEditor parameters={parameters} onChange={vi.fn()} />)
    const name = screen.getByLabelText<HTMLInputElement>('Parameter 1 name')
    name.focus()
    fireEvent.change(name, { target: { value: 'rejected' } })

    expect(screen.getByLabelText('Parameter 1 name')).toBe(name)
    expect(name.value).toBe('dose')
    expect(document.activeElement).toBe(name)
  })

  it('adds a parameter and locks the default of a required one', () => {
    const onChange = vi.fn()

    const { rerender } = render(
      <ParametersEditor parameters={[]} onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    expect(onChange.mock.calls[0][0]).toHaveLength(1)

    rerender(
      <ParametersEditor
        parameters={[{ name: 'dose', type: 'integer', required: true }]}
        onChange={onChange}
      />,
    )
    expect(
      screen.getByLabelText('Parameter 1 default').hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('StepsEditor', () => {
  const steps: PipelineStep[] = [
    { name: 'clean', language: 'sql', statement: 'select 1' },
    { name: 'publish', language: 'sql', statement: 'select 2' },
  ]

  it('retains row controls through rename propagation, movement and sibling removal', () => {
    render(
      <EditableSteps
        initial={[
          { name: 'source', language: 'sql', statement: 'select 1' },
          {
            name: 'target',
            language: 'sql',
            statement: 'select 2',
            confirm: { fields: [], askedUserIds: [], skipSteps: ['source'] },
          },
        ]}
      />,
    )
    const code = screen.getByLabelText<HTMLTextAreaElement>('Step 2 code')
    const name = screen.getByLabelText<HTMLInputElement>('Step 2 name')
    const skips = screen.getByLabelText<HTMLSelectElement>('Step 2 skips')
    name.focus()
    fireEvent.change(name, { target: { value: 'renamed_target' } })
    expect(screen.getByLabelText('Step 2 name')).toBe(name)
    expect(document.activeElement).toBe(name)
    fireEvent.change(screen.getByLabelText('Step 1 name'), {
      target: { value: 'renamed_source' },
    })
    expect(screen.getByLabelText('Step 2 code')).toBe(code)
    expect(screen.getByLabelText('Step 2 skips')).toBe(skips)
    expect(skips.value).toBe('renamed_source')
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }))

    expect(screen.getByLabelText('Step 1 name')).toBe(name)
    expect(screen.getByLabelText('Step 1 code')).toBe(code)
    code.focus()
    code.setSelectionRange(1, 4)
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
    expect(screen.getByLabelText('Step 1 code')).toBe(code)
    expect(document.activeElement).toBe(code)
    expect(code.selectionStart).toBe(1)
    expect(code.selectionEnd).toBe(4)
    expect(screen.getByLabelText('Step 1 skips')).toBe(skips)
    expect(skips.selectedOptions).toHaveLength(0)
    expect(skips.options).toHaveLength(0)
  })

  it('swaps an untouched SQL starter for Python and keeps written code', () => {
    const onChange = vi.fn<(steps: PipelineStep[]) => void>()
    render(
      <StepsEditor
        steps={[
          { name: 'a', language: 'sql', statement: 'select * from previous' },
          { name: 'b', language: 'sql', statement: 'select 42' },
        ]}
        members={{}}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Step 1 language'), {
      target: { value: 'python' },
    })
    const first = onChange.mock.calls[0][0]
    expect(first[0].language).toBe('python')
    expect(first[0].statement).toContain('def transform(inputs, parameters)')
    fireEvent.change(screen.getByLabelText('Step 2 language'), {
      target: { value: 'python' },
    })
    const second = onChange.mock.calls[1][0]
    expect(second[1].statement).toBe('select 42')
  })

  it('gives a Python step the editor, and keeps its contract on that step', () => {
    const onChange = vi.fn<(steps: PipelineStep[]) => void>()

    const python: PipelineStep[] = [
      {
        name: 'tidy',
        language: 'python',
        statement: 'def transform(inputs, parameters):\n    return []\n',
      },
    ]

    render(
      <StepsEditor
        steps={python}
        members={{}}
        onChange={onChange}
        python={{
          inputs: [{ name: 'readings', required: true }],
          parameters: [],
          transformRuns: true,
        }}
      />,
    )
    // The first step reads the transform's result as `previous`.
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Step 1 input previous column' }),
    )
    const next = onChange.mock.calls[0][0]
    expect(next[0].contract).toEqual({
      inputs: { previous: [{ name: '', type: 'text' }] },
    })
    expect(screen.getByLabelText('Step 1 code')).toBeTruthy()
  })

  it('turns on a confirm that asks a named person', () => {
    const onChange = vi.fn<(steps: PipelineStep[]) => void>()
    render(
      <StepsEditor
        steps={steps}
        members={{ 'u-1': 'Ada Lovelace' }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Step 2 waits for a person'))
    const next = onChange.mock.calls[0][0]
    expect(next[1].confirm?.askedUserIds).toEqual(['u-1'])
    expect(next[0]).not.toHaveProperty('confirm')
  })

  it('shows who is asked and what happens if nobody answers', () => {
    render(
      <StepsEditor
        steps={[
          {
            ...steps[0],
            confirm: {
              fields: [{ key: 'note', label: 'Note', type: 'text' }],
              askedUserIds: ['u-1'],
              noAnswer: 'fail',
            },
          },
        ]}
        members={{ 'u-1': 'Ada Lovelace' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Step 1 asked person').textContent).toBe(
      'Ada Lovelace',
    )
    expect(
      screen.getByLabelText<HTMLSelectElement>('Step 1 no answer').value,
    ).toBe('fail')
  })

  it('moves and removes steps', () => {
    const onChange = vi.fn<(steps: PipelineStep[]) => void>()
    render(<StepsEditor steps={steps} members={{}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(onChange.mock.calls[0][0][0].name).toBe('publish')
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
    expect(onChange.mock.calls[1][0]).toHaveLength(1)
  })
})
