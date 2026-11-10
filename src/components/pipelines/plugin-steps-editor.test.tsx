import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArgumentField } from './plugin-steps-editor'
import { pluginStepSources } from './plugin-step-sources'

afterEach(cleanup)

describe('plugin step table sources', () => {
  it('offers the previous result, inputs, analysis and earlier steps in order', () => {
    expect(
      pluginStepSources({
        hasPrevious: true,
        transformRuns: true,
        inputs: [{ name: 'readings' }],
        earlier: ['cleaned'],
      }).map((source) => source.ref),
    ).toEqual([
      'previous',
      'inputs.readings',
      'steps.analysis',
      'steps.cleaned',
    ])
    expect(
      pluginStepSources({
        hasPrevious: false,
        transformRuns: false,
        inputs: [{ name: 'readings' }],
        earlier: [],
      }).map((source) => source.ref),
    ).toEqual(['inputs.readings'])
  })

  it('writes the chosen table as a reference rather than a scalar', () => {
    const onChange = vi.fn()

    render(
      <ArgumentField
        input={{
          name: 'readings',
          type: 'json',
          required: true,
          nullable: false,
        }}
        isTable
        value={{ $ref: 'previous' }}
        parameters={[]}
        tableSources={pluginStepSources({
          hasPrevious: true,
          transformRuns: false,
          inputs: [{ name: 'readings' }],
          earlier: [],
        })}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Readings' }), {
      target: { value: 'inputs.readings' },
    })
    expect(onChange).toHaveBeenCalledWith({ $ref: 'inputs.readings' })
  })
})
