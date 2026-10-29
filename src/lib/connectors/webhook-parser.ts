/**
 * The contract between Sheetbase and a parser that runs somewhere else.
 *
 * Sheetbase sends the file to the parser's address and the service answers
 * with the file's rows. This module is the shared, dependency-free half: the
 * wire shapes and the checks on an answer. The Python helper in
 * `sdks/python` (`sheetbase.parsers`) implements the other side.
 *
 *   POST <address>
 *   Content-Type: the file's type
 *   X-Sheetbase-File-Name: the file's name, URL-encoded
 *   X-Sheetbase-Parser: <parser key>@<version>
 *   X-Sheetbase-Timestamp: seconds since the epoch
 *   X-Sheetbase-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>." + body>
 *   body: the raw file
 *
 *   200 { "headers": [...], "rows": [{...}], "metadata": {...}, "warnings": [...] }
 *   4xx { "error": { "code": "...", "message": "..." } }
 */
import { z } from 'zod'

import type { ParsedInstrumentPayload } from './registry'

export const WEBHOOK_PARSER_MAX_ROWS = 200_000
export const WEBHOOK_PARSER_MAX_COLUMNS = 500
export const WEBHOOK_PARSER_RESPONSE_BYTES = 50 * 1024 * 1024

export class WebhookParserError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'WebhookParserError'
    this.code = code
  }
}

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()])

const responseSchema = z.object({
  headers: z
    .array(z.string().min(1))
    .max(WEBHOOK_PARSER_MAX_COLUMNS)
    .optional(),
  rows: z.array(z.record(z.string(), cell)).max(WEBHOOK_PARSER_MAX_ROWS),
  metadata: z.record(z.string(), cell).optional(),
  warnings: z.array(z.string()).max(100).optional(),
})

function asText(value: string | number | boolean | null): string {
  // A blank stays blank: a service that has no value says null, and Sheetbase
  // never turns that into a zero or a word.
  if (value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

/** Checks a service's answer and turns it into the shape every parser returns. */
export function readWebhookParserAnswer(
  body: unknown,
): ParsedInstrumentPayload {
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new WebhookParserError(
      'webhook_bad_answer',
      `The parser’s answer isn’t in the expected shape (${issue.path.join('.') || 'body'}: ${issue.message}).`,
    )
  }
  const { rows, metadata, warnings } = parsed.data
  const headers = parsed.data.headers ?? []
  const known = new Set(headers)
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        if (parsed.data.headers) {
          throw new WebhookParserError(
            'webhook_bad_answer',
            `A row has a column “${key}” that isn’t in the answer’s headers.`,
          )
        }
        known.add(key)
        headers.push(key)
      }
    }
  }
  if (headers.length > WEBHOOK_PARSER_MAX_COLUMNS) {
    throw new WebhookParserError(
      'webhook_bad_answer',
      `The answer has more than ${WEBHOOK_PARSER_MAX_COLUMNS} columns.`,
    )
  }
  return {
    headers,
    rows: rows.map((row) =>
      Object.fromEntries(headers.map((h) => [h, asText(row[h] ?? null)])),
    ),
    metadata: Object.fromEntries(
      Object.entries(metadata ?? {}).map(([k, v]) => [k, asText(v)]),
    ),
    warnings: warnings ?? [],
  }
}

/** The error a service reports for a file it won't read. */
export function readWebhookParserError(
  status: number,
  body: unknown,
): WebhookParserError {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { code?: unknown; message?: unknown } })
      .error
    if (error && typeof error.message === 'string' && error.message.trim()) {
      return new WebhookParserError(
        'webhook_refused',
        error.message.trim().slice(0, 500),
      )
    }
  }
  return new WebhookParserError(
    'webhook_error',
    `The parser service answered with status ${status}.`,
  )
}

/** The address a parser version sends files to, if it is a webhook parser. */
export function webhookTarget(
  signature: Record<string, unknown>,
): { url: string } | null {
  const webhook = signature['webhook']
  if (webhook && typeof webhook === 'object' && 'url' in webhook) {
    const url = webhook.url
    if (typeof url === 'string' && url) return { url }
  }
  return null
}

/** The type a file is sent as, from its name; the service gets the raw bytes either way. */
export function webhookMediaType(fileName: string): string {
  if (/\.json$/i.test(fileName)) return 'application/json'
  if (/\.csv$/i.test(fileName)) return 'text/csv'
  if (/\.tsv$/i.test(fileName)) return 'text/tab-separated-values'
  if (/\.txt$/i.test(fileName)) return 'text/plain'
  if (/\.xlsx$/i.test(fileName))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return 'application/octet-stream'
}
