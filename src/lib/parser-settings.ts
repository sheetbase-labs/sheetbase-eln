import type { DataClient } from './data-client'

export type ParserVersionStatus = 'draft' | 'validated' | 'approved' | 'retired'

export interface ParserSettingsVersion {
  id: string
  version: number
  status: ParserVersionStatus
  signature: Record<string, unknown>
  mapping: Record<string, unknown>
  test_result: Record<string, unknown> | null
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
    signature: Record<string, unknown>
    mapping: Record<string, unknown>
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

export async function validateParserVersion(
  parserVersionId: string,
  fileId: string,
) {
  const response = await fetch('/api/parsers/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parserVersionId, fileId }),
  })
  const body = (await response.json()) as {
    ok: boolean
    validation?: { errors?: string[] }
    error?: { message: string }
  }
  if (!response.ok)
    throw new Error(body.error?.message ?? 'Parser validation failed.')
  return body
}

export async function requestParserUpdate(fileId: string) {
  const response = await fetch('/api/parsers/request-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileId }),
  })
  const body = (await response.json()) as {
    ok: boolean
    error?: { message: string }
  }
  if (!response.ok || body.ok !== true)
    throw new Error(
      body.error?.message ?? 'The parser update request was not recorded.',
    )
  return body
}
