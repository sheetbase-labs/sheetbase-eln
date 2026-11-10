import type { DataClient } from './data-client'
import { z } from 'zod'

export type ParserVersionStatus = 'draft' | 'validated' | 'approved' | 'retired'

/** A stored parser definition box: header names, layout and field mapping. */
export type ParserDefinition = Record<string, z.core.util.JSONType>

export interface ParserSettingsVersion {
  id: string
  version: number
  status: ParserVersionStatus
  signature: ParserDefinition
  mapping: ParserDefinition
  test_result: ParserDefinition | null
  validated_at: string | null
  approved_at: string | null
  approved_by_user_id: string | null
}

export interface ParserSettingsRow {
  id: string
  key: string
  name: string
  format: string
  instrument_id: string | null
  instruments: { id: string; name: string } | null
  parser_versions: ParserSettingsVersion[]
}

export const parserSettingsQueryKeys = {
  list: (workspaceId: string) => ['parser-settings', workspaceId] as const,
  files: (workspaceId: string) => ['parser-test-files', workspaceId] as const,
}

/** Canonical catalogue, scoped both by the request and PostgreSQL RLS. */
export function fetchParserSettings(client: DataClient, workspaceId: string) {
  return client.list<ParserSettingsRow>(
    'parsers',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,key,name,format,instrument_id,instruments(id,name),parser_versions(id,version,status,signature,mapping,test_result,validated_at,approved_at,approved_by_user_id)&order=name.asc&parser_versions.order=version.desc`,
  )
}

export function createParserDraft(
  client: DataClient,
  input: {
    workspaceId: string
    key: string
    name: string
    format: string
    version: number
    instrumentId: string | null
    signature: ParserDefinition
    mapping: ParserDefinition
  },
) {
  return client.rpc<{
    parserId: string
    parserVersionId: string
    version: number
    status: 'draft'
  }>('create_parser_version', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_format: input.format,
    p_version: input.version,
    p_signature: input.signature,
    p_mapping: input.mapping,
    p_instrument_id: input.instrumentId,
  })
}

export function approveParserVersion(client: DataClient, versionId: string) {
  return client.rpc<ParserSettingsVersion>('approve_parser_version', {
    p_parser_version_id: versionId,
  })
}

export interface ParserTestFile {
  id: string
  filename: string
  checksum: string
  parser_failure: { message: string; requestedAt?: string } | null
}

export async function fetchParserTestFiles(
  client: DataClient,
  workspaceId: string,
  fileId?: string,
) {
  const recent = await client.list<ParserTestFile>(
    'dataset_import_files',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,filename,checksum,parser_failure&order=created_at.desc&limit=100`,
  )

  if (!fileId || recent.some((file) => file.id === fileId)) return recent

  const target = await client.list<ParserTestFile>(
    'dataset_import_files',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(fileId)}&select=id,filename,checksum,parser_failure&limit=1`,
  )

  return [...target, ...recent]
}

/** The reply `/api/parsers/validate` answers with. */
const parserValidationReplySchema = z.object({
  ok: z.boolean(),
  validation: z.object({ errors: z.array(z.string()).optional() }).nullish(),
  error: z.object({ message: z.string() }).optional(),
})

export type ParserValidationReply = z.infer<typeof parserValidationReplySchema>

/** The error envelope `requestErrorResponse` answers with. */
const requestErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

export async function validateParserVersion(
  parserVersionId: string,
  fileId: string,
): Promise<ParserValidationReply> {
  const response = await fetch('/api/parsers/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parserVersionId, fileId }),
  })

  if (!response.ok) {
    const refusal = requestErrorEnvelopeSchema.safeParse(
      await response.json().catch(() => null),
    )

    throw new Error(
      refusal.success
        ? refusal.data.error.message
        : 'Parser validation failed.',
    )
  }

  const body = parserValidationReplySchema.safeParse(
    await response.json().catch(() => null),
  )

  if (!body.success) throw new Error('Parser validation failed.')

  return body.data
}

/** The reply `/api/parsers/request-update` answers with. */
const parserUpdateReplySchema = z.object({
  ok: z.boolean(),
  error: z.object({ message: z.string() }).optional(),
})

export async function requestParserUpdate(fileId: string) {
  const response = await fetch('/api/parsers/request-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileId }),
  })

  if (!response.ok) {
    const refusal = requestErrorEnvelopeSchema.safeParse(
      await response.json().catch(() => null),
    )

    throw new Error(
      refusal.success
        ? refusal.data.error.message
        : 'The parser update request was not recorded.',
    )
  }

  const body = parserUpdateReplySchema.safeParse(
    await response.json().catch(() => null),
  )

  if (!body.success || body.data.ok !== true)
    throw new Error(
      (body.success ? body.data.error?.message : undefined) ??
        'The parser update request was not recorded.',
    )

  return body.data
}

export interface CreatedWebhookParser {
  parserId: string
  parserVersionId: string
  version: number
  key: string
  /** Shown once, with a parser's first version. */
  secret: string | null
}

/** One request to the webhook parser endpoint. */
export type WebhookParserAction =
  | {
      action: 'create'
      name: string
      format: string
      url: string
      instrumentId: string | null
    }
  | { action: 'rotate'; parserId: string }

const createdWebhookParserSchema: z.ZodType<CreatedWebhookParser> = z.object({
  parserId: z.string(),
  parserVersionId: z.string(),
  version: z.number(),
  key: z.string(),
  secret: z.string().nullable(),
})

const rotatedWebhookKeySchema = z.object({
  parserId: z.string(),
  secret: z.string(),
})

async function postWebhookParserAction<T>(
  body: WebhookParserAction,
  replySchema: z.ZodType<T>,
  fallback: string,
): Promise<T> {
  const response = await fetch('/api/parsers/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const refusal = requestErrorEnvelopeSchema.safeParse(
      await response.json().catch(() => null),
    )

    throw new Error(refusal.success ? refusal.data.error.message : fallback)
  }

  const reply: unknown = await response.json().catch(() => null)
  const refusal = requestErrorEnvelopeSchema.safeParse(reply)

  if (refusal.success) throw new Error(refusal.data.error.message)

  const parsed = replySchema.safeParse(reply)

  if (!parsed.success) throw new Error(fallback)

  return parsed.data
}

/** A parser that lives at an address elsewhere; Sheetbase sends it each file. */
export function createWebhookParser(input: {
  name: string
  format: string
  url: string
  instrumentId: string | null
}) {
  return postWebhookParserAction<CreatedWebhookParser>(
    { action: 'create', ...input },
    createdWebhookParserSchema,
    'The parser couldn’t be added.',
  )
}

/** A new signing key; the old one stops working at once. */
export function rotateWebhookParserKey(parserId: string) {
  return postWebhookParserAction(
    { action: 'rotate', parserId },
    rotatedWebhookKeySchema,
    'The signing key couldn’t be changed.',
  )
}
