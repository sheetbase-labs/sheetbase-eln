import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PythonPackagesEditor, PythonStepEditor } from './python-editor'
import type { PythonStepEditorProps } from './python-editor'
import type { PythonContract } from '#/lib/pipelines/python'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CODE =
  'def transform(inputs, parameters):\n    return inputs["readings"]\n'

function props(
  over: Partial<PythonStepEditorProps> = {},
): PythonStepEditorProps {
  return {
    label: 'Transform',
    statement: CODE,
    onStatementChange: vi.fn(),
    contract: undefined,
    onContractChange: vi.fn(),
    inputs: [{ name: 'readings', required: true }],
    parameters: [
      { name: 'dose', type: 'integer', required: false, default: 5 },
    ],
    hasPrevious: false,
    ...over,
  }
}

describe('PythonStepEditor feedback', () => {
  it('asks for a transform function', () => {
    render(<PythonStepEditor {...props({ statement: 'x = 1' })} />)
    expect(
      screen.getByRole('list', { name: 'Transform checks' }).textContent,
    ).toContain('Define transform(inputs, parameters)')
  })

  it('warns about a package the runtime does not have', () => {
    render(
      <PythonStepEditor
        {...props({
          statement: `import sklearn\n${CODE}`,
          runtime: { available: true, packages: { numpy: '2.2.6' } },
        })}
      />,
    )
    expect(screen.getByText(/“sklearn” isn’t installed/)).toBeTruthy()
  })

  it('offers a starter only while the code is still a starter', () => {
    const onStatementChange = vi.fn()
    const { rerender } = render(
      <PythonStepEditor {...props({ statement: '', onStatementChange })} />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Transform start from declared inputs',
      }),
    )
    const written = onStatementChange.mock.calls[0][0] as string
    expect(written).toContain('readings = pd.DataFrame(inputs["readings"])')
    expect(written).toContain('dose = parameters["dose"]')
    rerender(<PythonStepEditor {...props({ onStatementChange })} />)
    expect(
      screen.queryByRole('button', {
        name: 'Transform start from declared inputs',
      }),
    ).toBeNull()
  })
})

describe('PythonStepEditor contract', () => {
  it('adds an output column to the contract', () => {
    const onContractChange = vi.fn()
    render(<PythonStepEditor {...props({ onContractChange })} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Transform output column' }),
    )
    expect(onContractChange).toHaveBeenCalledWith({
      output: { columns: [{ name: '', type: 'text' }] },
    })
  })

  it('edits and removes columns, and drops an emptied contract', () => {
    const onContractChange = vi.fn()
    const contract: PythonContract = {
      output: { columns: [{ name: 'mean', type: 'decimal' }] },
    }
    render(<PythonStepEditor {...props({ contract, onContractChange })} />)
    fireEvent.change(screen.getByLabelText('Transform output column 1 type'), {
      target: { value: 'integer' },
    })
    expect(onContractChange).toHaveBeenLastCalledWith({
      output: { columns: [{ name: 'mean', type: 'integer' }] },
    })
    fireEvent.click(
      screen.getByLabelText('Transform output column 1 can’t be empty'),
    )
    expect(onContractChange).toHaveBeenLastCalledWith({
      output: { columns: [{ name: 'mean', type: 'decimal', nullable: false }] },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Transform output column 1' }),
    )
    expect(onContractChange).toHaveBeenLastCalledWith(undefined)
  })

  it('declares input columns per input, and for previous when there is one', () => {
    const onContractChange = vi.fn()
    render(
      <PythonStepEditor {...props({ hasPrevious: true, onContractChange })} />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Add Transform input previous column',
      }),
    )
    expect(onContractChange).toHaveBeenCalledWith({
      inputs: { previous: [{ name: '', type: 'text' }] },
    })
    expect(
      screen.getByRole('button', {
        name: 'Add Transform input readings column',
      }),
    ).toBeTruthy()
  })
})

describe('PythonStepEditor test run', () => {
  const ok = {
    ok: true,
    rows: [{ mean: 1.5, day: '2026-01-01' }],
    rowCount: 1,
    truncated: false,
    columns: [
      { name: 'mean', type: 'decimal', nullable: false },
      { name: 'day', type: 'date', nullable: false },
    ],
    logs: ['loaded'],
    runtime: 'r@sha256:x',
    environment: { python: '3.12.8', packages: { numpy: '2.2.6' } },
    durationMs: 120,
  }

  it('sends the code, the parsed sample, parameters and packages, and shows the result', async () => {
    const fetchMock = vi.fn(async () => Response.json(ok))
    vi.stubGlobal('fetch', fetchMock)
    const onContractChange = vi.fn()
    render(
      <PythonStepEditor
        {...props({ onContractChange, requirements: ['numpy==2.2.6'] })}
      />,
    )
    fireEvent.change(screen.getByLabelText('Transform sample for readings'), {
      target: { value: 'value\n1\n2' },
    })
    fireEvent.change(screen.getByLabelText('Transform test value for dose'), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Transform run test' }))
    expect(await screen.findByText(/1 row in 120 ms/)).toBeTruthy()
    expect(screen.getByText(/Python 3.12.8 · numpy 2.2.6/)).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Transform test output' }).textContent,
    ).toBe('loaded')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/pipelines/python-test')
    expect(JSON.parse(init.body as string)).toEqual({
      statement: CODE,
      inputs: { readings: [{ value: 1 }, { value: 2 }] },
      parameters: { dose: 7 },
      requirements: ['numpy==2.2.6'],
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Transform use result as output contract',
      }),
    )
    expect(onContractChange).toHaveBeenCalledWith({
      output: { columns: ok.columns },
    })
  })

  it('shows the failing line and the step’s output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: false,
          error: 'ZeroDivisionError: division by zero',
          code: 'transform_failed',
          logs: ['before'],
          line: 2,
          durationMs: 9,
        }),
      ),
    )
    render(<PythonStepEditor {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transform run test' }))
    expect(await screen.findByText('Failed at line 2')).toBeTruthy()
    expect(screen.getByText('ZeroDivisionError: division by zero')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Transform test output' }).textContent,
    ).toBe('before')
  })

  it('does not call the runner for a sample it cannot read', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<PythonStepEditor {...props()} />)
    fireEvent.change(screen.getByLabelText('Transform sample for readings'), {
      target: { value: '[1, 2]' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Transform run test' }))
    expect(screen.getByText(/readings: Use a list of row objects/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a refusal from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Too many test runs.' }, { status: 429 }),
      ),
    )
    render(<PythonStepEditor {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transform run test' }))
    await waitFor(() =>
      expect(screen.getByText('Too many test runs.')).toBeTruthy(),
    )
  })
})

describe('PythonPackagesEditor', () => {
  it('turns lines into pinned requirements, ignoring comments', () => {
    const onChange = vi.fn()
    render(<PythonPackagesEditor requirements={[]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Python package requirements'), {
      target: { value: 'scipy==1.15.3  # stats\n\nnumpy==2.2.6' },
    })
    expect(onChange).toHaveBeenLastCalledWith(['scipy==1.15.3', 'numpy==2.2.6'])
  })

  it('names an unpinned line and a package the runtime does not have', () => {
    render(
      <PythonPackagesEditor
        requirements={['scipy>=1', 'numpy==9.9.9', 'pandas==2.2.3']}
        onChange={vi.fn()}
        runtime={{
          available: true,
          runtime: 'registry.local/py@sha256:abc',
          python: '3.12.8',
          packages: { numpy: '2.2.6', pandas: '2.2.3' },
        }}
      />,
    )
    expect(screen.getByLabelText('Pinned Python runtime').textContent).toBe(
      'registry.local/py@sha256:abc',
    )
    expect(screen.getByText(/isn’t pinned/)).toBeTruthy()
    expect(
      screen.getByText(
        'numpy==9.9.9 was requested but this runtime has 2.2.6.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/Installed in this runtime \(Python 3.12.8\)/),
    ).toBeTruthy()
  })
})
