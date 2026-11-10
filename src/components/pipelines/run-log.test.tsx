import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { RunLog } from './run-log'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type { PipelineRunLogWire } from '#/lib/pipelines/types'

afterEach(cleanup)

function entry(
  over: Partial<PipelineRunLogWire> & { id: string },
): PipelineRunLogWire {
  return {
    workspace_id: 'w',
    run_id: 'r',
    sequence: 1,
    level: 'info',
    stage: 'python',
    message: 'Python step 1 completed.',
    detail: {},
    at: '2026-10-21T10:11:12Z',
    ...over,
  }
}

describe('pythonLogDetail', () => {
  it('reads only the fields it expects', () => {
    render(
      <RunLog
        logs={[
          entry({
            id: 'mixed',
            detail: {
              logs: ['a', 3, 'b'],
              line: 4,
              step: 'tidy',
              environment: {
                python: '3.12.8',
                packages: { numpy: '2.2.6', bad: 1 },
              },
            },
          }),
        ]}
      />,
    )
    expect(screen.getByText('Python 3.12.8 · numpy 2.2.6')).toBeTruthy()
    expect(screen.getByText('Failed at line 4 of step tidy.')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Python output, tidy' }).textContent,
    ).toBe('a\nb')
  })

  it('says nothing for an entry with no Python detail', () => {
    const { container } = render(
      <RunLog
        logs={[
          entry({ id: 'ordinary', detail: { code: 'transform_failed' } }),
          entry({ id: 'malformed', detail: { logs: 'nope', line: 1.5 } }),
        ]}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('[data-slot="python-log"]')).toBeNull()
  })

  it('preserves own package keys when decoding JSON', () => {
    const detail = pipelineJsonObjectSchema.parse(
      JSON.parse(
        '{"environment":{"python":"3.12.8","packages":{"__proto__":"1.0","numpy":"2.2.6"}},"logs":["kept"]}',
      ),
    )

    render(<RunLog logs={[entry({ id: 'own-key', detail })]} />)
    expect(
      screen.getByText('Python 3.12.8 · __proto__ 1.0, numpy 2.2.6'),
    ).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Python output' }).textContent,
    ).toBe('kept')
  })
})

describe('RunLog', () => {
  it('shows a step’s printed output and the environment it ran in', () => {
    render(
      <RunLog
        logs={[
          entry({
            id: '1',
            detail: {
              step: 'analysis',
              logs: ['loaded 3 rows', 'mean 2.5'],
              environment: { python: '3.12.8', packages: { scipy: '1.15.3' } },
            },
          }),
        ]}
      />,
    )
    expect(screen.getByText('Python 3.12.8 · scipy 1.15.3')).toBeTruthy()
    expect(screen.getByText('Output (2 lines)')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Python output, analysis' })
        .textContent,
    ).toBe('loaded 3 rows\nmean 2.5')
  })

  it('opens the output of a failure and says which line failed', () => {
    const { container } = render(
      <RunLog
        logs={[
          entry({
            id: '1',
            level: 'error',
            stage: 'failure',
            message: 'ZeroDivisionError: division by zero (line 4 of step a)',
            detail: { step: 'analysis', line: 4, logs: ['before'] },
          }),
        ]}
      />,
    )

    expect(screen.getByText('Failed at line 4 of step analysis.')).toBeTruthy()
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
  })

  it('renders script output as text, never as markup', () => {
    render(
      <RunLog
        logs={[
          entry({
            id: '1',
            detail: { logs: ['<img src=x onerror=alert(1)>'] },
          }),
        ]}
      />,
    )
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })

  it('keeps the old empty message', () => {
    render(<RunLog logs={[]} />)
    expect(screen.getByText('No log lines recorded')).toBeTruthy()
  })
})
