/**
 * Calls a webhook parser: sends the file, signed, and reads the rows back.
 * Server-only because the signing key never leaves the server.
 */
import { createHmac } from 'node:crypto'

import {
  openSecret,
  sealSecret,
  secretKey,
} from '#/lib/connector-secrets.server'
import { generateSigningSecret } from '#/lib/webhook-signing'

import { validateConnectorEndpointUrl } from './enterprise/host-policy.server'
import type { ResolvedParser } from './parser-resolution'
import type { ParsedInstrumentPayload } from './registry'
import {
  WEBHOOK_PARSER_RESPONSE_BYTES,
  WebhookParserError,
  readWebhookParserAnswer,
  readWebhookParserError,
  webhookMediaType,
  webhookTarget,
} from './webhook-parser'

export const WEBHOOK_PARSER_TIMEOUT_MS = 30_000

export interface WebhookParserCall {
  url: string
  secret: string
  parserKey: string
  version: number
  fileName: string
  mediaType: string
  bytes: Uint8Array
}

export interface WebhookParserDeps {
  fetch?: typeof fetch
  timeoutMs?: number
  /** Seconds since the epoch; tests pin it. */
  now?: () => number
}

/** `sha256=<hex>` over `<timestamp>.` followed by the file's bytes. */
export function signParserRequest(
  secret: string,
  timestamp: string,
  bytes: Uint8Array,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(bytes)
    .digest('hex')}`
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > WEBHOOK_PARSER_RESPONSE_BYTES) {
      await reader.cancel()
      throw new WebhookParserError(
        'webhook_bad_answer',
        'The parser’s answer is too large to read.',
      )
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function callWebhookParser(
  call: WebhookParserCall,
  deps: WebhookParserDeps = {},
): Promise<ParsedInstrumentPayload> {
  let url: URL
  try {
    url = validateConnectorEndpointUrl(call.url)
  } catch (error) {
    throw new WebhookParserError(
      'webhook_address_refused',
      error instanceof Error
        ? error.message
        : 'The parser’s address is refused.',
    )
  }
  const timestamp = String(
    deps.now ? deps.now() : Math.floor(Date.now() / 1000),
  )
  let response: Response
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      // Never follow a redirect: the address was checked, where it points isn't.
      redirect: 'error',
      signal: AbortSignal.timeout(deps.timeoutMs ?? WEBHOOK_PARSER_TIMEOUT_MS),
      headers: {
        'content-type': call.mediaType || 'application/octet-stream',
        'user-agent': 'Sheetbase-Parser/1',
        'x-sheetbase-file-name': encodeURIComponent(call.fileName),
        'x-sheetbase-parser': `${call.parserKey}@${call.version}`,
        'x-sheetbase-timestamp': timestamp,
        'x-sheetbase-signature': signParserRequest(
          call.secret,
          timestamp,
          call.bytes,
        ),
      },
      body: call.bytes as BodyInit,
    })
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new WebhookParserError(
        'webhook_timeout',
        'The parser service didn’t answer in time.',
      )
    }
    throw new WebhookParserError(
      'webhook_unreachable',
      'The parser service couldn’t be reached.',
    )
  }
  const text = await readLimited(response)
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!response.ok) throw readWebhookParserError(response.status, body)
  if (body === null) {
    throw new WebhookParserError(
      'webhook_bad_answer',
      'The parser service didn’t answer with JSON.',
    )
  }
  return readWebhookParserAnswer(body)
}

// ---------------------------------------------------------------------------
// The parser's signing key.
// ---------------------------------------------------------------------------

/** Makes (or replaces) the signing key and returns it once, in the clear. */
export async function rotateParserWebhookSecret(input: {
  workspaceId: string
  parserId: string
  userId: string | null
}): Promise<string> {
  // The database is loaded when a key is read or made, so reading a file's
  // answer (and its tests) never opens a connection.
  const { db } = await import('#/db/client.server')
  const { parserWebhookSecrets } = await import('#/db/schema')
  const secret = generateSigningSecret()
  const ciphertext = Buffer.from(sealSecret(secret, secretKey()), 'utf8')
  await db
    .insert(parserWebhookSecrets)
    .values({
      parserId: input.parserId,
      workspaceId: input.workspaceId,
      ciphertext,
      createdByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: parserWebhookSecrets.parserId,
      set: { ciphertext, updatedAt: new Date() },
    })
  return secret
}

export async function loadParserWebhookSecret(
  workspaceId: string,
  parserId: string,
): Promise<string> {
  const { db } = await import('#/db/client.server')
  const { parserWebhookSecrets } = await import('#/db/schema')
  const { eq } = await import('drizzle-orm')
  const rows = await db
    .select({
      workspaceId: parserWebhookSecrets.workspaceId,
      ciphertext: parserWebhookSecrets.ciphertext,
    })
    .from(parserWebhookSecrets)
    .where(eq(parserWebhookSecrets.parserId, parserId))
  const row = rows.at(0)
  if (!row || row.workspaceId !== workspaceId) {
    throw new WebhookParserError(
      'webhook_no_key',
      'This parser has no signing key. Make a new one in Settings.',
    )
  }
  return openSecret(Buffer.from(row.ciphertext).toString('utf8'), secretKey())
}

/**
 * The reader intake hands to a webhook parser version: sends this file to the
 * version's address, signed with the parser's key.
 */
export function webhookReader(input: {
  workspaceId: string
  fileName: string
  bytes: Uint8Array
  loadSecret?: (workspaceId: string, parserId: string) => Promise<string>
  deps?: WebhookParserDeps
}): (parser: ResolvedParser) => Promise<ParsedInstrumentPayload> {
  return async (parser) =>
    callWebhookParser(
      {
        url: webhookTarget(parser.signature)?.url ?? '',
        secret: await (input.loadSecret ?? loadParserWebhookSecret)(
          input.workspaceId,
          parser.parserId,
        ),
        parserKey: parser.key,
        version: parser.version,
        fileName: input.fileName,
        mediaType: webhookMediaType(input.fileName),
        bytes: input.bytes,
      },
      input.deps,
    )
}
