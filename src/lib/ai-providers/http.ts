import {
  AiProviderError,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_RESPONSE_BYTES,
} from './types'
import type { ProviderDeps } from './types'

export interface JsonRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

/**
 * POST JSON to a provider. The transport deliberately does not retry: a retry
 * can double spend, and the gateway already treats one provider call as one
 * billable attempt. Callers see a typed error with the HTTP status only.
 */
export async function postProviderJson(
  providerId: string,
  request: JsonRequest,
  deps: ProviderDeps = {},
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...request.headers,
      },
      body: JSON.stringify(request.body),
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (cause) {
    const aborted =
      cause instanceof Error &&
      (cause.name === 'AbortError' || cause.name === 'TimeoutError')
    throw new AiProviderError(
      'network',
      aborted ? 'Provider request timed out' : 'Provider request failed',
      { providerId, cause },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // Never read or log the body: an upstream error message can echo the
    // prompt. The status is enough to act on.
    await response.body?.cancel().catch(() => undefined)
    throw new AiProviderError('http', 'Provider returned an error status', {
      providerId,
      status: response.status,
    })
  }

  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new AiProviderError(
      'network',
      'Provider response could not be read',
      {
        providerId,
        cause,
      },
    )
  }

  if (new TextEncoder().encode(text).length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new AiProviderError(
      'response_invalid',
      'Provider response exceeded the size limit',
      { providerId },
    )
  }

  try {
    return JSON.parse(text) as unknown
  } catch (cause) {
    throw new AiProviderError(
      'response_invalid',
      'Provider response was not valid JSON',
      { providerId, cause },
    )
  }
}

/** Join a base URL and path without duplicating or dropping a slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

export function readNested(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record?.[key])
}
