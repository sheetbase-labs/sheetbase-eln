/** Browser calls for the Allotrope converters (`/api/parsers/converter`). */
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

async function failure(response: Response): Promise<ConverterClientError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null

  return new ConverterClientError(
    body?.error?.code ?? `http_${response.status}`,
    body?.error?.message ?? '',
  )
}

export async function fetchConverters(): Promise<ConverterVendor[]> {
  const response = await fetch('/api/parsers/converter')

  if (!response.ok) throw await failure(response)
  const body = (await response.json()) as { converters: ConverterVendor[] }

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

  return (await response.json()) as {
    parserId: string
    parserVersionId: string
    key: string
  }
}
