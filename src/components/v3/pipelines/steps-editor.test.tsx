import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParametersEditor } from './parameters-editor'
import { StepsEditor } from './steps-editor'
import type { PipelineStep } from '#/lib/pipelines/config'

afterEach(cleanup)

describe('ParametersEditor', () => {
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

  it('turns on a confirm that asks a named person', () => {
    const onChange = vi.fn()
    render(
      <StepsEditor
        steps={steps}
        members={{ 'u-1': 'Ada Lovelace' }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Step 2 waits for a person'))
    const next = onChange.mock.calls[0][0] as PipelineStep[]
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
    expect(
      screen.getByLabelText<HTMLSelectElement>('Step 1 asked person').value,
    ).toBe('u-1')
    expect(
      screen.getByLabelText<HTMLSelectElement>('Step 1 no answer').value,
    ).toBe('fail')
  })

  it('moves and removes steps', () => {
    const onChange = vi.fn()
    render(<StepsEditor steps={steps} members={{}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect((onChange.mock.calls[0][0] as PipelineStep[])[0].name).toBe(
      'publish',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
    expect(onChange.mock.calls[1][0]).toHaveLength(1)
  })
})
