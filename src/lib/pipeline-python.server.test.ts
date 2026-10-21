import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PipelinePythonError,
  executePythonTransform,
  getPythonRuntime,
  getPythonRuntimeInfo,
} from './pipeline-python.server'

const runtime = `ghcr.io/example/python@sha256:${'a'.repeat(64)}`
const job = {
  statement: 'def transform(inputs, parameters): return inputs["data"]',
  inputs: { data: [{ value: '0.000000001', time: '2026-01-01T00:00:00Z' }] },
  parameters: { scale: 2 },
}
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubEnv('PIPELINE_PYTHON_RUNNER_URL', 'http://runner:8080')
  vi.stubEnv('PIPELINE_PYTHON_RUNNER_TOKEN', 'test-token-'.repeat(4))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('isolated Python client', () => {
  it('sends only named inputs, code and parameters and preserves typed values and runtime provenance', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        rows: job.inputs.data,
        logs: ['Processed one row'],
        runtime,
      }),
    )
    const result = await executePythonTransform(job)
    expect(result).toEqual({
      rows: job.inputs.data,
      logs: ['Processed one row'],
      runtime,
      // PIPE-04.1: the step declared no artefact key, so it returned no files.
      files: [],
      usage: {
        inputBytes: Buffer.byteLength(JSON.stringify(job)),
        outputBytes: Buffer.byteLength(
          JSON.stringify({
            rows: job.inputs.data,
            logs: ['Processed one row'],
            runtime,
          }),
        ),
        rows: 1,
        cells: 2,
      },
    })
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://runner:8080/execute')
    expect(JSON.parse(request.body)).toEqual(job)
    expect(request.redirect).toBe('error')
    expect(request.headers.Authorization).toBe(
      `Bearer ${'test-token-'.repeat(4)}`,
    )
  })
  it('fails closed without runner configuration', async () => {
    vi.stubEnv('PIPELINE_PYTHON_RUNNER_TOKEN', '')
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'runner_unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects URLs with embedded credentials and rejects non-finite input', async () => {
    vi.stubEnv('PIPELINE_PYTHON_RUNNER_URL', 'http://user:secret@runner')
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'runner_unavailable',
    })
    vi.stubEnv('PIPELINE_PYTHON_RUNNER_URL', 'http://runner')
    await expect(
      executePythonTransform({ ...job, parameters: { scale: Infinity } }),
    ).rejects.toThrow('finite JSON')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects combined inputs beyond the total row limit', async () => {
    await expect(
      executePythonTransform({
        ...job,
        inputs: {
          a: Array.from({ length: 60_000 }, () => ({})),
          b: Array.from({ length: 60_000 }, () => ({})),
        },
      }),
    ).rejects.toMatchObject({
      code: 'input_too_large',
      message: expect.stringMatching(/120000 rows.*100000 row/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('names the measured size when the request payload exceeds the limit', async () => {
    await expect(
      executePythonTransform({
        ...job,
        parameters: { blob: 'x'.repeat(33 * 1024 * 1024) },
      }),
    ).rejects.toMatchObject({
      code: 'input_too_large',
      message: expect.stringMatching(/33\.0 MiB.*32\.0 MiB limit/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects unpinned runtime and malformed row output', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ rows: [], logs: [], runtime: 'python:latest' }),
    )
    await expect(executePythonTransform(job)).rejects.toThrow('pinned runtime')
    fetchMock.mockResolvedValueOnce(
      Response.json({ rows: [12], logs: [], runtime }),
    )
    await expect(executePythonTransform(job)).rejects.toThrow('row objects')
  })
  it('bounds streamed output even without Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(new Response(body))
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'output_too_large',
      message: expect.stringContaining('over the 32.0 MiB limit'),
    })
    expect(cancelled).toBe(true)
  })
  it('preserves an actionable timeout without disclosing the runner token', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Python execution timed out.' }, { status: 504 }),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'transform_timed_out',
      message: 'Python execution timed out.',
    })
  })
})

describe('Python runtime pin', () => {
  it('loads an authenticated installed runtime for saving in a pipeline definition', async () => {
    fetchMock.mockResolvedValue(Response.json({ runtime }))
    await expect(getPythonRuntime()).resolves.toBe(runtime)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://runner:8080/runtime',
    )
  })
  it('rejects a result from a runtime other than the saved pin', async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], logs: [], runtime }))
    await expect(
      executePythonTransform({
        ...job,
        runtime: `other@sha256:${'b'.repeat(64)}`,
      }),
    ).rejects.toThrow('different Python runtime')
  })
})

describe('Python contract and environment', () => {
  it('sends the requirements and contract with the step, and returns the environment it ran in', async () => {
    const environment = { python: '3.12.8', packages: { scipy: '1.15.3' } }
    fetchMock.mockResolvedValue(
      Response.json({ rows: [{ a: 1 }], logs: [], runtime, environment }),
    )
    const contract = {
      output: { columns: [{ name: 'a', type: 'integer' as const }] },
    }
    const result = await executePythonTransform({
      ...job,
      requirements: ['scipy==1.15.3'],
      contract,
    })
    expect(result.environment).toEqual(environment)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      requirements: string[]
      contract: unknown
    }
    expect(sent.requirements).toEqual(['scipy==1.15.3'])
    expect(sent.contract).toEqual(contract)
  })

  it('keeps what a failed step printed and the line it failed on', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: 'ZeroDivisionError: division by zero',
          logs: ['loaded 3 rows'],
          line: 5,
        },
        { status: 422 },
      ),
    )
    const error = await executePythonTransform(job).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(PipelinePythonError)
    expect(error).toMatchObject({
      code: 'transform_failed',
      logs: ['loaded 3 rows'],
      line: 5,
    })
  })

  it('ignores failure details that are not the expected shape', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: 'boom', logs: [{ not: 'text' }], line: 'five' },
        { status: 422 },
      ),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      logs: [],
      line: undefined,
    })
  })

  it('reads the installed packages along with the runtime pin', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        runtime,
        python: '3.12.8',
        packages: { numpy: '2.2.6', bad: 7 },
      }),
    )
    await expect(getPythonRuntimeInfo()).resolves.toEqual({
      runtime,
      python: '3.12.8',
      packages: { numpy: '2.2.6' },
    })
  })
})
