/**
 * The worker runs inside the container; these tests run the same file with the
 * host's Python so the contract and the failure report are checked without Docker.
 * They are skipped when the host has no Python with pandas and NumPy.
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const WORKER = 'docker/pipeline-python/worker.py'

const available =
  spawnSync('python3', ['-c', 'import pandas, numpy']).status === 0

function run(job: Record<string, unknown>) {
  const result = spawnSync('python3', ['-I', WORKER], {
    input: JSON.stringify(job),
    encoding: 'utf8',
  })
  return {
    status: result.status,
    body: JSON.parse(result.stdout) as Record<string, unknown>,
  }
}

const installed = () => {
  const out = run({ mode: 'inspect' }).body.environment as {
    python: string
    packages: Record<string, string>
  }
  return out
}

const frame = (body: string) =>
  `import pandas as pd\ndef transform(inputs, parameters):\n${body}`

describe.skipIf(!available)('pipeline Python worker', () => {
  it('returns rows, logs and the environment of the declared packages', () => {
    const numpy = installed().packages.numpy
    const { status, body } = run({
      statement: frame('    print("hello")\n    return [{"a": 1}]'),
      inputs: {},
      parameters: {},
      requirements: [`numpy==${numpy}`],
    })
    expect(status).toBe(0)
    expect(body.rows).toEqual([{ a: 1 }])
    expect(body.logs).toEqual(['hello'])
    expect(body.environment).toMatchObject({ packages: { numpy } })
  })

  it('reports the line and the logs of a step that failed', () => {
    const { status, body } = run({
      statement: frame('    print("before")\n    return 1 / 0'),
      inputs: {},
      parameters: {},
    })
    expect(status).toBe(1)
    expect(body.error).toBe('ZeroDivisionError: division by zero')
    expect(body.logs).toEqual(['before'])
    expect(body.line).toBe(4)
  })

  it('reports the line of a syntax error', () => {
    const { body } = run({
      statement: 'def transform(i, p:\n  pass',
      inputs: {},
      parameters: {},
    })
    expect(body.line).toBe(1)
  })

  it('stops recording an over-long log instead of failing the step', () => {
    const { status, body } = run({
      statement: frame('    print("x" * 200000)\n    return [{"a": 1}]'),
      inputs: {},
      parameters: {},
    })
    expect(status).toBe(0)
    const logs = body.logs as string[]
    expect(logs.join('\n').length).toBeLessThan(64 * 1024)
    expect(logs.at(-1)).toBe('[log truncated at 64 KiB]')
  })

  it('refuses a requirement the image does not provide', () => {
    const { status, body } = run({
      statement: frame('    return []'),
      inputs: {},
      parameters: {},
      requirements: ['numpy==0.0.1', 'no-such-package==1.0'],
    })
    expect(status).toBe(1)
    expect(body.error).toContain('numpy==0.0.1 was requested')
    expect(body.error).toContain('no-such-package==1.0 is not in this runtime')
    expect(body.error).toContain('ask an administrator')
  })

  it('enforces the output contract, naming each problem', () => {
    const { status, body } = run({
      statement: frame('    return pd.DataFrame({"a": ["x"], "b": [1]})'),
      inputs: {},
      parameters: {},
      contract: {
        output: {
          columns: [
            { name: 'a', type: 'integer' },
            { name: 'c', type: 'text' },
          ],
        },
      },
    })
    expect(status).toBe(1)
    const message = body.error as string
    expect(message).toContain('Output column "c" is missing')
    expect(message).toContain(
      'Output column "a" expects integer but row 1 has "x"',
    )
    expect(message).toContain('undeclared column "b"')
  })

  it('accepts the declared output, dates and NumPy types included', () => {
    const { status, body } = run({
      statement: frame(
        '    import numpy as np\n    return pd.DataFrame({"n": np.array([1, 2]), "day": pd.to_datetime(["2026-01-01", "2026-01-02"]), "mean": [0.5, "1.5"]})',
      ),
      inputs: {},
      parameters: {},
      contract: {
        output: {
          columns: [
            { name: 'n', type: 'integer' },
            { name: 'day', type: 'timestamp' },
            { name: 'mean', type: 'decimal' },
          ],
        },
      },
    })
    expect(status).toBe(0)
    expect(body.rows).toHaveLength(2)
  })

  it('checks an empty DataFrame for its columns, and allows extras when told to', () => {
    const empty = run({
      statement: frame('    return pd.DataFrame({"a": []})'),
      inputs: {},
      parameters: {},
      contract: { output: { columns: [{ name: 'b', type: 'text' }] } },
    })
    expect(empty.body.error).toContain('Output column "b" is missing')
    const extras = run({
      statement: frame('    return [{"a": 1, "b": 2}]'),
      inputs: {},
      parameters: {},
      contract: {
        output: {
          columns: [{ name: 'a', type: 'integer' }],
          additionalColumns: true,
        },
      },
    })
    expect(extras.status).toBe(0)
  })

  it('checks the input columns before the code runs', () => {
    const { status, body } = run({
      statement: frame('    print("never")\n    return []'),
      inputs: { readings: [{ value: 'abc' }] },
      parameters: {},
      contract: {
        inputs: { readings: [{ name: 'value', type: 'integer' }] },
      },
    })
    expect(status).toBe(1)
    expect(body.error).toContain(
      'Input "readings" column "value" expects integer but row 1 has "abc"',
    )
    expect(body.logs).toEqual([])
  })

  it('enforces not-null on a declared column', () => {
    const { body } = run({
      statement: frame('    return [{"a": None}]'),
      inputs: {},
      parameters: {},
      contract: {
        output: { columns: [{ name: 'a', type: 'text', nullable: false }] },
      },
    })
    expect(body.error).toContain('declared not null')
  })

  it('still refuses NaN rather than turning it into null', () => {
    const { status, body } = run({
      statement: frame('    return [{"a": float("nan")}]'),
      inputs: {},
      parameters: {},
    })
    expect(status).toBe(1)
    expect(String(body.error)).toContain('ValueError')
  })
})
