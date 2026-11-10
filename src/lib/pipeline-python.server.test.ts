import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  PipelinePythonError,
  executePythonTransform,
  getPythonRuntime,
  getPythonRuntimeInfo,
  getPythonEnvironment,
  requestPythonEnvironment,
  releasePythonArtefacts,
  pythonInputValueSchema,
  pythonInputRowSchema,
  pythonInputRowsSchema,
  pythonInputsSchema,
} from './pipeline-python.server'
import { pipelineJsonObjectSchema } from './pipelines/types'
import type { PythonContract } from './pipelines/python'

const runtime = `ghcr.io/example/python@sha256:${'a'.repeat(64)}`

const job = {
  statement: 'def transform(inputs, parameters): return inputs["data"]',
  inputs: { data: [{ value: '0.000000001', time: '2026-01-01T00:00:00Z' }] },
  parameters: { scale: 2 },
}

const fetchMock = vi.fn<typeof fetch>()

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
    expect(z.instanceof(URL).parse(url).href).toBe('http://runner:8080/execute')
    expect(JSON.parse(z.string().parse(request?.body))).toEqual(job)
    expect(request?.redirect).toBe('error')
    expect(new Headers(request?.headers).get('Authorization')).toBe(
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
    expect(z.instanceof(URL).parse(fetchMock.mock.calls[0][0]).href).toBe(
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

    const contract: PythonContract = {
      output: { columns: [{ name: 'a', type: 'integer' }] },
    }

    const result = await executePythonTransform({
      ...job,
      requirements: ['scipy==1.15.3'],
      contract,
    })

    expect(result.environment).toEqual(environment)

    const sent = z
      .object({
        requirements: z.array(z.string()),
        contract: z.object({
          output: z.object({
            columns: z.array(z.object({ name: z.string(), type: z.string() })),
          }),
        }),
      })
      .parse(JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body)))

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
      (cause: Error) => cause,
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

describe('a plugin call’s own limits', () => {
  const limits = {
    timeoutSeconds: 900,
    memoryMb: 8192,
    cpus: 4,
    processes: 1024,
    scratchMb: 4096,
    bytes: 64 * 1024 * 1024,
    rows: 500_000,
  }

  it('sends the limits, the packages and the hosts, and allows what a pipeline step may not', async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], logs: [], runtime }))
    const rows = Array.from({ length: 150_000 }, (_, n) => ({ n }))
    await executePythonTransform({
      ...job,
      statement: `x = 1\n${'#'.repeat(200_000)}`,
      inputs: { data: rows },
      limits,
      environment: 'pe-0123456789abcdef',
      network: ['eutils.ncbi.nlm.nih.gov'],
    })

    const sent = z
      .object({
        limits: z.object({
          timeoutSeconds: z.number(),
          memoryMb: z.number(),
          cpus: z.number(),
          processes: z.number(),
          scratchMb: z.number(),
          bytes: z.number(),
          rows: z.number(),
        }),
        environment: z.string(),
        network: z.array(z.string()),
      })
      .parse(JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body)))

    expect(sent.limits).toEqual(limits)
    expect(sent.environment).toBe('pe-0123456789abcdef')
    expect(sent.network).toEqual(['eutils.ncbi.nlm.nih.gov'])
    // Time: the plugin's own, plus the runner's overhead.
    await expect(
      executePythonTransform({ ...job, inputs: { data: rows } }),
    ).rejects.toThrow(/row limit/)
  })

  it('names the plugin’s own row limit, not the pipeline one', async () => {
    const rows = Array.from({ length: 11 }, (_, n) => ({ n }))
    await expect(
      executePythonTransform({
        ...job,
        inputs: { data: rows },
        limits: { ...limits, rows: 10 },
      }),
    ).rejects.toThrow(/over the 10 row limit/)
  })

  it('passes the runner’s reason through when the packages are not ready', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: 'This plugin’s packages are not installed on the runner yet.',
          code: 'environment_not_ready',
        },
        { status: 409 },
      ),
    )
    await expect(
      executePythonTransform({
        ...job,
        limits,
        environment: 'pe-0123456789abcdef',
      }),
    ).rejects.toMatchObject({ code: 'environment_not_ready' })
  })
})

describe('scientific serialization and worker diagnostics', () => {
  it('decodes raw input contracts without replacing Dates, undefined values or scientific keys', () => {
    const at = new Date('2026-01-01T00:00:00Z')

    const row = Object.fromEntries([
      ['__proto__', { at, omitted: undefined, integer: 1n }],
      ['at', at],
      ['omitted', undefined],
    ])

    const decoded = pythonInputRowSchema.parse(row)

    expect(decoded).toBe(row)
    expect(decoded.at).toBe(at)
    expect(Object.hasOwn(decoded, 'omitted')).toBe(true)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(pythonInputRowsSchema.parse([row])[0]).toBe(row)
    expect(pythonInputsSchema.parse({ data: [row] }).data[0]).toBe(row)
    expect(pythonInputValueSchema.parse(1n)).toBe(1n)
    expect(pythonInputValueSchema.parse(Infinity)).toBe(Infinity)
    expect(
      pythonInputRowSchema.safeParse(
        Object.fromEntries([['__proto__', Symbol('bad')]]),
      ).success,
    ).toBe(false)
  })

  it('accepts absent properties but preserves the failure for explicit undefined values', async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], logs: [], runtime }))
    await expect(
      executePythonTransform({
        ...job,
        parameters: pythonInputRowSchema.parse({}),
      }),
    ).resolves.toMatchObject({ rows: [] })
    fetchMock.mockClear()
    await expect(
      executePythonTransform({
        ...job,
        parameters: pythonInputRowSchema.parse({ setting: undefined }),
      }),
    ).rejects.toMatchObject({
      code: 'transform_failed',
      message: 'Python inputs and parameters must contain finite JSON values.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serializes nested Dates without parsing scientific values as wire JSON first', async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], logs: [], runtime }))
    const at = new Date('2026-01-01T00:00:00Z')

    await executePythonTransform({
      ...job,
      inputs: { data: [{ at, details: [at] }] },
      parameters: { at },
    })
    expect(
      JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body)),
    ).toMatchObject({
      inputs: { data: [{ at: at.toISOString(), details: [at.toISOString()] }] },
      parameters: { at: at.toISOString() },
    })
  })

  it('retains bytea Buffers through input decoding and their native toJSON wire representation', async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], logs: [], runtime }))
    const bytes = Buffer.from([0, 1, 127, 255])
    const row = pythonInputRowSchema.parse({ bytes })

    expect(row.bytes).toBe(bytes)
    expect(pythonInputValueSchema.parse(bytes)).toBe(bytes)
    await executePythonTransform({
      ...job,
      inputs: { data: pythonInputRowsSchema.parse([row]) },
      parameters: { nested: [bytes] },
    })
    expect(
      JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body)),
    ).toMatchObject({
      inputs: { data: [{ bytes: { type: 'Buffer', data: [0, 1, 127, 255] } }] },
      parameters: { nested: [{ type: 'Buffer', data: [0, 1, 127, 255] }] },
    })
  })

  it.each([Infinity, -Infinity, NaN, 1n])(
    'rejects unsupported scientific value %s with the original finite-JSON diagnostic',
    async (value) => {
      await expect(
        executePythonTransform({ ...job, parameters: { nested: [value] } }),
      ).rejects.toMatchObject({
        code: 'transform_failed',
        message:
          'Python inputs and parameters must contain finite JSON values.',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('preserves own __proto__ scientific keys across request and result decoding', async () => {
    const row = pipelineJsonObjectSchema.parse(
      JSON.parse('{"__proto__":{"value":1},"normal":2}'),
    )

    fetchMock.mockResolvedValue(
      Response.json({ rows: [row], logs: [], runtime }),
    )

    const result = await executePythonTransform({
      ...job,
      inputs: { data: [row] },
      parameters: row,
    })

    const sent = pipelineJsonObjectSchema.parse(
      JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body)),
    )

    expect(sent.parameters).toEqual(row)
    expect(Object.hasOwn(result.rows[0], '__proto__')).toBe(true)
    expect(result.rows[0]['__proto__']).toEqual({ value: 1 })
    expect(result.usage?.cells).toBe(2)
  })

  it('counts an own __proto__ field against the input width limit', async () => {
    const row = Object.fromEntries([
      ...Array.from(
        { length: 256 },
        (_, n) => [`c${n}`, n] satisfies [string, number],
      ),
      ['__proto__', 1] satisfies [string, number],
    ])

    await expect(
      executePythonTransform({ ...job, inputs: { data: [row] } }),
    ).rejects.toMatchObject({
      code: 'input_too_large',
      message:
        'Python input has a row with 257 fields, over the 256 field limit.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['https://runner/path', 'runner_unavailable'],
    ['https://runner/?query=1', 'runner_unavailable'],
    ['https://runner/#fragment', 'runner_unavailable'],
    ['ftp://runner/', 'runner_unavailable'],
    ['invalid', 'runner_unavailable'],
  ])(
    'rejects runner address %s before sending credentials',
    async (url, code) => {
      vi.stubEnv('PIPELINE_PYTHON_RUNNER_URL', url)
      await expect(executePythonTransform(job)).rejects.toMatchObject({
        code,
        message: 'The Python runner address is invalid.',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    { status: 401, code: 'runner_unavailable' },
    { status: 503, code: 'runner_unavailable' },
    { status: 504, code: 'transform_timed_out' },
    { status: 422, code: 'transform_failed' },
  ])(
    'retains HTTP $status failure classification and bounded details',
    async ({ status, code }) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { error: 'x'.repeat(2100), logs: ['before'], line: 2 },
          { status },
        ),
      )
      await expect(executePythonTransform(job)).rejects.toMatchObject({
        code,
        message: 'x'.repeat(2000),
        logs: ['before'],
        line: 2,
      })
    },
  )

  it('retains the runner network approval failure code', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: 'Hosts not approved', code: 'network_unavailable' },
        { status: 503 },
      ),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'network_unavailable',
      message: 'Hosts not approved',
    })
  })

  it('retains malformed log byte diagnostics rather than returning a schema error', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ rows: [], logs: [{}], runtime }),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'output_too_large',
      message: 'Python log output is 15 B, over the 64.0 KiB limit.',
    })
  })

  it('retains malformed file diagnostics', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        rows: [],
        logs: [],
        runtime,
        files: [{ name: 'plot.png', size: 'large' }],
      }),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'transform_failed',
      message: 'Python runner reported a malformed file entry.',
    })
  })

  it('rejects the declared response size before reading an empty response', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: { 'Content-Length': String(33 * 1024 * 1024) },
      }),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'output_too_large',
      message: 'Python response declares 33.0 MiB, over the 32.0 MiB limit.',
    })
  })

  it('discards oversized failure logs without losing the line or error', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: 'boom', logs: ['x'.repeat(65537)], line: 2 },
        { status: 422 },
      ),
    )
    await expect(executePythonTransform(job)).rejects.toMatchObject({
      code: 'transform_failed',
      message: 'boom',
      logs: [],
      line: 2,
    })
  })
})

describe('runner artefacts and installed packages', () => {
  it('keeps artefact release authenticated, bounded and explicit about retention', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await releasePythonArtefacts('run-1', false)
    const [url, request] = fetchMock.mock.calls[0]

    expect(z.instanceof(URL).parse(url).pathname).toBe('/artefacts/release')
    expect(JSON.parse(z.string().parse(request?.body))).toEqual({
      key: 'run-1',
      keep: false,
    })
    expect(new Headers(request?.headers).get('Authorization')).toBe(
      `Bearer ${'test-token-'.repeat(4)}`,
    )
    expect(request?.redirect).toBe('error')
    expect(request?.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports a failed artefact release instead of swallowing it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(releasePythonArtefacts('run-1', true)).rejects.toMatchObject({
      code: 'runner_unavailable',
      message: "The Python runner did not release this run's files (503).",
    })
  })

  it('preserves own package keys and ignores malformed package versions in status responses', async () => {
    const packages = pipelineJsonObjectSchema.parse(
      JSON.parse('{"__proto__":"1.0","numpy":"2.2.6","bad":7}'),
    )

    fetchMock.mockResolvedValue(
      Response.json({ id: 'pe-1', state: 'ready', packages }),
    )

    const result = await getPythonEnvironment('pe-1')

    expect(result.packages).toEqual(
      Object.fromEntries([
        ['__proto__', '1.0'],
        ['numpy', '2.2.6'],
      ]),
    )
    expect(Object.hasOwn(result.packages ?? {}, '__proto__')).toBe(true)
  })

  it('sends environment requirements with both content type and credentials', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ id: 'pe-1', state: 'unknown', error: 'pending' }),
    )
    await expect(requestPythonEnvironment(['numpy==2.2.6'])).resolves.toEqual({
      id: 'pe-1',
      state: 'missing',
      error: 'pending',
    })
    const [url, request] = fetchMock.mock.calls[0]

    expect(z.instanceof(URL).parse(url).pathname).toBe('/environments')
    expect(JSON.parse(z.string().parse(request?.body))).toEqual({
      requirements: ['numpy==2.2.6'],
    })
    expect(new Headers(request?.headers).get('Content-Type')).toBe(
      'application/json',
    )
    expect(new Headers(request?.headers).get('Authorization')).toBe(
      `Bearer ${'test-token-'.repeat(4)}`,
    )
  })
})
