/** Browser calls for the Allotrope converters (`/api/parsers/converter`). */
import { z } from 'zod'

import type { ConverterVendor } from './asm'

export class ConverterClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ConverterClientError'
  }
}

/** The error a failed converter call states. */
const failureBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }).partial(),
})

/** A converter the Python runtime offers. */
const converterVendor = z.object({
  key: z.string(),
  name: z.string(),
  technique: z.string(),
  extensions: z.string(),
  releaseState: z.string(),
})

/** The converters a converter call lists. */
const converterList = z.object({ converters: z.array(converterVendor) })

/** The parser version a converter installation added. */
const addedParser = z.object({
  parserId: z.string(),
  parserVersionId: z.string(),
  key: z.string(),
})

async function failure(response: Response): Promise<ConverterClientError> {
  const body = failureBody.safeParse(await response.json().catch(() => null))

  return new ConverterClientError(
    body.data?.error.code ?? `http_${response.status}`,
    body.data?.error.message ?? '',
  )
}

export async function fetchConverters(): Promise<ConverterVendor[]> {
  const response = await fetch('/api/parsers/converter')

  if (!response.ok) throw await failure(response)
  const body = converterList.parse(await response.json())

  return body.converters
}

export async function addConverterParser(input: {
  vendor: string
  instrumentId: string | null
}): Promise<{ parserId: string; parserVersionId: string; key: string }> {
  const response = await fetch('/api/parsers/converter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw await failure(response)

  return addedParser.parse(await response.json())
}
