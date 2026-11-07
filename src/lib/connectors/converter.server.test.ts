import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PipelinePythonError } from '#/lib/pipeline-python.server'

import {
  ConverterError,
  convertFile,
  converterReader,
  listConverters,
} from './converter.server'
import type { ResolvedParser } from './parser-resolution'

const execute = vi.fn()
vi.mock('#/lib/pipeline-python.server', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  executePythonTransform: (...args: unknown[]) => execute(...args),
}))

const RUNTIME = `registry/python@sha256:${'a'.repeat(64)}`

beforeEach(() => {
  execute.mockReset()
})

describe('listConverters', () => {
  it('reads the list from the runtime and keeps it for a while', async () => {
    execute.mockResolvedValue({
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
    })
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
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      requirements: ['allotropy==0.1.151'],
      parameters: { mode: 'vendors' },
    })
  })

  it('says the runtime is unavailable instead of listing nothing', async () => {
    execute.mockRejectedValue(
      new PipelinePythonError('down', 'runner_unavailable'),
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
    execute.mockResolvedValue(answer)
    const out = await convertFile({
      fileName: 'plate.txt',
      bytes: new TextEncoder().encode('hello'),
      vendor: 'MOLDEV_SOFTMAX_PRO',
    })
    const sent = execute.mock.calls[0]?.[0]
    expect(sent.inputs.file[0]).toEqual({
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
    execute.mockRejectedValue(
      new PipelinePythonError(
        'AllotropeConversionError: Unable to find   vendor.',
        'transform_failed',
      ),
    )
    const error = await convertFile({
      fileName: 'x.csv',
      bytes: new Uint8Array([1]),
      vendor: null,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConverterError)
    expect(error).toMatchObject({
      code: 'converter_failed',
      message: 'Unable to find vendor.',
    })
  })

  it('refuses an answer with no document', async () => {
    execute.mockResolvedValue({
      rows: [{ asm: {} }],
      logs: [],
      runtime: RUNTIME,
    })
    await expect(
      convertFile({ fileName: 'x', bytes: new Uint8Array(), vendor: null }),
    ).rejects.toMatchObject({ code: 'converter_failed' })
  })
})

describe('converterReader', () => {
  const parser = (signature: Record<string, unknown>) =>
    ({ signature }) as unknown as ResolvedParser

  it('converts with the converter the parser names', async () => {
    const convert = vi.fn().mockResolvedValue({ payload: { rows: [] } })
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
