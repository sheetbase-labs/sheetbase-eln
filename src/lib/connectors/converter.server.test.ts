import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  ConverterError,
  convertFile,
  converterReader,
  listConverters,
} from './converter.server'
import type { ResolvedParser } from './parser-resolution'

const transport = vi.fn<typeof fetch>()

const requestSchema = z.object({
  requirements: z.array(z.string()),
  parameters: z.object({
    mode: z.string(),
    vendor: z.string().nullable().optional(),
  }),
  inputs: z.object({
    file: z
      .array(z.object({ name: z.string(), content_b64: z.string() }))
      .optional(),
  }),
})

const requests: z.infer<typeof requestSchema>[] = []

const RUNTIME = `registry/python@sha256:${'a'.repeat(64)}`

beforeEach(() => {
  transport.mockReset()
  requests.length = 0
  vi.stubEnv('PIPELINE_PYTHON_RUNNER_URL', 'http://runner:8080')
  vi.stubEnv('PIPELINE_PYTHON_RUNNER_TOKEN', 'converter-test-token-'.repeat(3))
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toEqual(new URL('http://runner:8080/execute'))
      expect(init?.method).toBe('POST')
      requests.push(
        requestSchema.parse(JSON.parse(z.string().parse(init?.body))),
      )

      return transport(input, init)
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('listConverters', () => {
  it('reads the list from the runtime and keeps it for a while', async () => {
    transport.mockResolvedValue(
      Response.json({
        rows: [
          {
            key: 'THERMO_FISHER_QUBIT4',
            name: 'Qubit 4',
            technique: 'Spectrophotometry',
            extensions: 'csv,xlsx',
            release_state: 'RECOMMENDED',
          },
        ],
        logs: [],
        runtime: RUNTIME,
      }),
    )
    let clock = 1_000_000
    const first = await listConverters(() => clock)
    expect(first).toEqual([
      {
        key: 'THERMO_FISHER_QUBIT4',
        name: 'Qubit 4',
        technique: 'Spectrophotometry',
        extensions: 'csv,xlsx',
        releaseState: 'RECOMMENDED',
      },
    ])
    clock += 60_000
    await listConverters(() => clock)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(requests[0]).toMatchObject({
      requirements: ['allotropy==0.1.151'],
      parameters: { mode: 'vendors' },
    })
  })

  it('says the runtime is unavailable instead of listing nothing', async () => {
    transport.mockResolvedValue(
      Response.json({ error: 'down' }, { status: 503 }),
    )
    await expect(listConverters(() => 9e12)).rejects.toMatchObject({
      code: 'converter_unavailable',
    })
  })
})

describe('convertFile', () => {
  const answer = {
    rows: [
      {
        asm: { '$asm.manifest': 'm', 'x aggregate document': {} },
        manifest: 'm',
        technique: 'plate reader',
        vendor: 'MOLDEV_SOFTMAX_PRO',
        converter: 'allotropy',
        converter_version: '0.1.151',
        measurements: 2,
        device: { 'model number': 'M5' },
        columns: ['sample', 'fluorescence'],
        table: [
          { sample: 'A', fluorescence: '1' },
          { sample: 'B', fluorescence: '2' },
        ],
        warnings: ['one well was empty'],
      },
    ],
    logs: [],
    runtime: RUNTIME,
  }

  it('sends the bytes and the converter, and returns the document and the rows', async () => {
    transport.mockResolvedValue(Response.json(answer))

    const out = await convertFile({
      fileName: 'plate.txt',
      bytes: new TextEncoder().encode('hello'),
      vendor: 'MOLDEV_SOFTMAX_PRO',
    })

    const sent = requests[0]
    expect(sent.inputs.file?.[0]).toEqual({
      name: 'plate.txt',
      content_b64: Buffer.from('hello').toString('base64'),
    })
    expect(sent.parameters).toEqual({
      mode: 'convert',
      vendor: 'MOLDEV_SOFTMAX_PRO',
    })
    expect(out.asm).toMatchObject({
      technique: 'plate reader',
      measurements: 2,
      imageDigest: RUNTIME,
      converterVersion: '0.1.151',
      device: { 'model number': 'M5' },
    })
    expect(out.payload.headers).toEqual(['sample', 'fluorescence'])
    expect(out.payload.rows).toHaveLength(2)
    expect(out.payload.warnings).toEqual(['one well was empty'])
    expect(out.payload.asm).toBe(out.asm)
  })

  it('turns a failed conversion into the converter’s own message', async () => {
    transport.mockResolvedValue(
      Response.json(
        { error: 'AllotropeConversionError: Unable to find   vendor.' },
        { status: 422 },
      ),
    )

    const result = convertFile({
      fileName: 'x.csv',
      bytes: new Uint8Array([1]),
      vendor: null,
    })

    await expect(result).rejects.toBeInstanceOf(ConverterError)
    await expect(result).rejects.toMatchObject({
      code: 'converter_failed',
      message: 'Unable to find vendor.',
    })
  })

  it('refuses an answer with no document', async () => {
    transport.mockResolvedValue(
      Response.json({
        rows: [{ asm: {} }],
        logs: [],
        runtime: RUNTIME,
      }),
    )
    await expect(
      convertFile({ fileName: 'x', bytes: new Uint8Array(), vendor: null }),
    ).rejects.toMatchObject({ code: 'converter_failed' })
  })

  it('preserves scientific keys and blanks malformed optional cells without losing columns', async () => {
    transport.mockResolvedValue(
      Response.json({
        runtime: RUNTIME,
        logs: [],
        rows: [
          {
            asm: JSON.parse('{"__proto__":{"signal":5.75},"manifest":"m"}'),
            columns: ['__proto__', 'sample', 'measurement'],
            table: [
              JSON.parse('{"__proto__":"5.75","sample":"A1","measurement":7}'),
            ],
            warnings: ['Check calibration', false],
          },
        ],
      }),
    )

    const out = await convertFile({
      fileName: 'a.csv',
      bytes: new Uint8Array([1]),
      vendor: null,
    })

    expect(Object.hasOwn(out.asm.document, '__proto__')).toBe(true)
    expect(out.asm.document['__proto__']).toEqual({ signal: 5.75 })
    expect(Object.hasOwn(out.payload.rows[0], '__proto__')).toBe(true)
    expect(out.payload.rows[0]['__proto__']).toBe('5.75')
    expect(out.payload.rows[0].measurement).toBe('')
    expect(out.payload.warnings).toEqual(['Check calibration', ''])
    expect(out.payload.metadata).not.toHaveProperty('vendor')
  })
})

describe('converterReader', () => {
  const parser = (signature: ResolvedParser['signature']): ResolvedParser => ({
    parserId: 'parser-1',
    parserVersionId: 'parser-version-1',
    key: 'test-converter',
    name: 'Test converter',
    format: 'csv',
    version: 1,
    status: 'approved',
    kind: 'converter',
    signature,
  })

  it('converts with the converter the parser names', async () => {
    transport.mockResolvedValue(
      Response.json({
        rows: [{ asm: { manifest: 'm' } }],
        logs: [],
        runtime: RUNTIME,
      }),
    )
    const convert = vi.fn<typeof convertFile>(convertFile)

    await converterReader({
      fileName: 'a.csv',
      bytes: new Uint8Array([1]),
      convert,
    })(
      parser({
        converter: { kind: 'allotropy', vendor: 'BECKMAN_VI_CELL_BLU' },
      }),
    )
    expect(convert).toHaveBeenCalledWith({
      fileName: 'a.csv',
      bytes: new Uint8Array([1]),
      vendor: 'BECKMAN_VI_CELL_BLU',
    })
  })

  it('refuses a parser that names no converter', async () => {
    await expect(
      converterReader({ fileName: 'a', bytes: new Uint8Array() })(parser({})),
    ).rejects.toMatchObject({ code: 'converter_unknown' })
  })
})
