/**
 * Converts an instrument file to the Allotrope Simple Model in the isolated
 * Python runtime, which carries the pinned `allotropy` package and has no
 * network. The app only sends the file bytes and the converter's name, and
 * reads one document back; nothing in the file is run or trusted.
 */
import { z } from 'zod'

import {
  PipelinePythonError,
  executePythonTransform,
} from '#/lib/pipeline-python.server'
import {
  ASM_DOCUMENT_BYTE_LIMIT,
  converterTarget,
} from '#/lib/instrument-data/asm'
import type { AsmCapture, ConverterVendor } from '#/lib/instrument-data/asm'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'

import type { ResolvedParser } from './parser-resolution'
import type { ParsedInstrumentPayload } from './registry'

/** The package the runtime must provide. The converter list comes from it. */
export const ALLOTROPY_REQUIREMENT = 'allotropy==0.1.151'

/** Why a file could not be converted, in a code the intake maps to words. */
export class ConverterError extends Error {
  constructor(
    readonly code:
      | 'converter_unavailable'
      | 'converter_failed'
      | 'converter_too_large'
      | 'converter_unknown',
    message: string,
  ) {
    super(message)
    this.name = 'ConverterError'
  }
}

let pythonSource: Promise<string> | null = null

function converterSource(): Promise<string> {
  pythonSource ??=
    import('../../../docker/pipeline-python/converters/allotropy_convert.py?raw').then(
      (module: { default: string }) => module.default,
    )

  return pythonSource
}

const textSchema = z.string().catch('')
const objectSchema = pipelineJsonObjectSchema.catch({})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript rejection reasons are untrusted; only the two checked error classes are translated.
function fail(error: unknown): never {
  if (error instanceof ConverterError) throw error

  if (error instanceof PipelinePythonError) {
    if (
      error.code === 'runner_unavailable' ||
      error.code === 'transform_timed_out'
    )
      throw new ConverterError('converter_unavailable', error.message)

    if (error.code === 'input_too_large' || error.code === 'output_too_large')
      throw new ConverterError('converter_too_large', error.message)
    throw new ConverterError('converter_failed', cleanMessage(error.message))
  }

  throw error
}

/** The converter's own words for what it could not read, without the exception name. */
function cleanMessage(message: string): string {
  return message
    .replace(/^[A-Za-z]+(Error|Exception): /, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

let vendorCache: { at: number; vendors: ConverterVendor[] } | null = null

/** The converters this install offers: read from the runtime, not written down here. */
export async function listConverters(
  now: () => number = Date.now,
): Promise<ConverterVendor[]> {
  if (vendorCache && now() - vendorCache.at < 10 * 60_000)
    return vendorCache.vendors

  try {
    const result = await executePythonTransform({
      statement: await converterSource(),
      requirements: [ALLOTROPY_REQUIREMENT],
      inputs: {},
      parameters: { mode: 'vendors' },
    })

    const vendors = result.rows.map((row) => ({
      key: textSchema.parse(row['key']),
      name: textSchema.parse(row['name']),
      technique: textSchema.parse(row['technique']),
      extensions: textSchema.parse(row['extensions']),
      releaseState: textSchema.parse(row['release_state']),
    }))

    vendorCache = { at: now(), vendors }

    return vendors
  } catch (error) {
    return fail(error)
  }
}

export interface ConvertedFile {
  payload: ParsedInstrumentPayload
  asm: AsmCapture
}

/** Convert one file with the chosen converter (or let the converter recognise it). */
export async function convertFile(input: {
  fileName: string
  bytes: Uint8Array
  vendor: string | null
}): Promise<ConvertedFile> {
  let result

  try {
    result = await executePythonTransform({
      statement: await converterSource(),
      requirements: [ALLOTROPY_REQUIREMENT],
      inputs: {
        file: [
          {
            name: input.fileName,
            content_b64: Buffer.from(input.bytes).toString('base64'),
          },
        ],
      },
      parameters: { mode: 'convert', vendor: input.vendor },
    })
  } catch (error) {
    return fail(error)
  }

  const row = result.rows.at(0)
  const document = objectSchema.parse(row?.['asm'])

  if (!row || Object.keys(document).length === 0)
    throw new ConverterError(
      'converter_failed',
      'The converter did not return a document.',
    )

  if (Buffer.byteLength(JSON.stringify(document)) > ASM_DOCUMENT_BYTE_LIMIT)
    throw new ConverterError(
      'converter_too_large',
      'The converted document is too large to keep.',
    )

  const columns = z.array(textSchema).catch([]).parse(row['columns'])

  const table = z
    .array(objectSchema)
    .catch([])
    .parse(row['table'])
    .map((entry) =>
      Object.fromEntries(
        columns.map((column) => [column, textSchema.parse(entry[column])]),
      ),
    )

  const device = objectSchema.parse(row['device'])

  const asm: AsmCapture = {
    document,
    technique: textSchema.parse(row['technique']),
    manifest: textSchema.parse(row['manifest']),
    vendor: textSchema.parse(row['vendor']),
    converter: textSchema.parse(row['converter']) || 'allotropy',
    converterVersion: textSchema.parse(row['converter_version']),
    imageDigest: result.runtime,
    measurements: Number(row['measurements']) || 0,
    device,
  }

  const metadata: ParsedInstrumentPayload['metadata'] = {
    format: 'asm',
    technique: asm.technique,
    converter: `${asm.converter} ${asm.converterVersion}`.trim(),
  }

  if (asm.vendor) metadata.vendor = asm.vendor

  return {
    asm,
    payload: {
      headers: columns,
      rows: table,
      metadata,
      warnings: z.array(textSchema).catch([]).parse(row['warnings']),
      asm,
    },
  }
}

/** The reader the intake hands a converter parser: it converts this file. */
export function converterReader(input: {
  fileName: string
  bytes: Uint8Array
  convert?: typeof convertFile
}): (parser: ResolvedParser) => Promise<ParsedInstrumentPayload> {
  return async (parser) => {
    const target = converterTarget(parser.signature)

    if (!target)
      throw new ConverterError(
        'converter_unknown',
        'This parser does not name a converter.',
      )

    const converted = await (input.convert ?? convertFile)({
      fileName: input.fileName,
      bytes: input.bytes,
      vendor: target.vendor,
    })

    return converted.payload
  }
}
