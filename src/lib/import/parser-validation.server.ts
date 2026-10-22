import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getObjectStorage } from '#/lib/file-storage'
import type { ObjectStorage } from '#/lib/file-storage'
import {
  IMPORT_LIMITS,
  parseImportBytes,
  selectImportSheet,
} from '#/lib/import-parse'
import { mapImportSheet } from '#/lib/import-mapping'
import { getParser } from '#/lib/connectors/registry'
import {
  parseObjectText,
  S3_PARSER_IDENTITY,
} from '#/lib/connectors/enterprise/s3.server'
import '#/lib/connectors/plate-reader'
import {
  postgrestSelect,
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthContext, SessionAuthDeps } from '#/lib/request-auth'
import { recogniseImportParser } from './parsers'
import { withParserActor } from './parser-governance.server'
import { loadDataset, mappingsFromDocument, toTargetFields } from './server'
import type { ParserSettingsVersion } from '#/lib/parser-settings'

const requestSchema = z
  .object({
    parserVersionId: z.uuid(),
    fileId: z.uuid(),
  })
  .strict()

const signatureSchema = z.object({
  requiredHeaders: z.array(z.string().min(1)),
  optionalHeaders: z.array(z.string().min(1)).optional(),
  requiresMetadata: z.boolean().optional(),
})

const mappingSchema = z
  .object({
    sources: z.array(
      z.object({
        source: z.string(),
        fieldId: z.uuid().nullable(),
        unit: z.string().nullable(),
        sourceUnit: z.string().nullable().optional(),
      }),
    ),
    sheetName: z.string().min(1).optional(),
  })
  .strict()

interface VersionWire extends ParserSettingsVersion {
  workspace_id: string
  parsers: { key: string; name: string; format: string }
}

interface FileWire {
  id: string
  workspace_id: string
  dataset_id: string | null
  filename: string
  format: string
  storage_key: string
  checksum: string
  byte_size: string
}

/** Only the server role can persist evidence. Browser RPCs cannot call it. */
async function recordValidation(
  context: SessionAuthContext,
  version: VersionWire,
  file: FileWire,
  result: Record<string, unknown>,
): Promise<ParserSettingsVersion> {
  return withParserActor(context, async (query) => {
    const persisted = await query<{ version: ParserSettingsVersion }>(
      'SELECT to_jsonb(internal.record_parser_validation($1, $2, $3, $4::jsonb, $5::jsonb)) AS version',
      [
        version.id,
        file.id,
        file.checksum,
        JSON.stringify({
          signature: version.signature,
          mapping: version.mapping,
        }),
        JSON.stringify(result),
      ],
    )
    return persisted.rows[0].version
  })
}

/** Execute a canonical parser definition against independently retained bytes. */
export async function handleParserValidation(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return requestErrorResponse(
      400,
      'invalid_request',
      'Choose a parser version and retained test file.',
    )
  }
  const body = requestSchema.safeParse(raw)
  if (!body.success)
    return requestErrorResponse(
      400,
      'invalid_request',
      'Only parser version and retained file IDs are accepted.',
    )
  const [versions, files] = await Promise.all([
    postgrestSelect<VersionWire[]>(
      'parser_versions',
      `id=eq.${body.data.parserVersionId}&select=id,workspace_id,version,status,signature,mapping,parsers(key,name,format)&limit=1`,
      context.token,
    ),
    postgrestSelect<FileWire[]>(
      'dataset_import_files',
      `id=eq.${body.data.fileId}&select=id,workspace_id,dataset_id,filename,format,storage_key,checksum,byte_size&limit=1`,
      context.token,
    ),
  ])
  const version = Array.isArray(versions.body) ? versions.body[0] : undefined
  const file = Array.isArray(files.body) ? files.body[0] : undefined
  if (
    !version ||
    !file ||
    version.workspace_id !== context.workspaceId ||
    file.workspace_id !== context.workspaceId
  ) {
    return requestErrorResponse(
      404,
      'not_found',
      'Parser version or retained file not found.',
    )
  }
  if (version.status !== 'draft' && version.status !== 'validated') {
    return requestErrorResponse(
      409,
      'invalid_state',
      'Only a draft or validated parser version can be tested. Create a new version to change an approved parser.',
    )
  }
  if (version.parsers.format !== file.format) {
    return requestErrorResponse(
      422,
      'format_mismatch',
      'The retained file format does not match this parser version.',
    )
  }
  const signature = signatureSchema.safeParse(version.signature)
  const engine =
    typeof version.signature.engine === 'string'
      ? version.signature.engine
      : null
  const registeredEngine = engine ? getParser(engine.split('@')[0]) : undefined
  const executeEngine =
    engine === S3_PARSER_IDENTITY
      ? parseObjectText
      : registeredEngine &&
          `${registeredEngine.parserId}@${registeredEngine.version}` === engine
        ? registeredEngine.parse
        : null
  // SQL-table extraction has no equivalent retained-file executor. Never
  // substitute a CSV reader and call it validation of the query engine.
  if (
    (engine && !executeEngine) ||
    (!signature.success &&
      !executeEngine &&
      version.signature.manualMapping !== true)
  ) {
    return requestErrorResponse(
      422,
      'unsupported_definition',
      'This parser engine has no supported retained-file validator. Approval remains blocked.',
    )
  }
  if (!file.storage_key.startsWith(`${context.workspaceId}/`))
    return requestErrorResponse(
      422,
      'file_integrity',
      'The retained file storage identity does not match this workspace.',
    )
  const stored = await storage.getStream(file.storage_key)
  if (
    stored.byteSize > IMPORT_LIMITS.bytes ||
    stored.byteSize !== Number(file.byte_size)
  ) {
    await stored.stream.cancel()
    return requestErrorResponse(
      422,
      'file_integrity',
      'The retained file size does not match its recorded evidence.',
    )
  }
  const bytes = await new Response(stored.stream).arrayBuffer()
  const checksum = createHash('sha256')
    .update(new Uint8Array(bytes))
    .digest('hex')
  if (
    checksum !== file.checksum ||
    bytes.byteLength !== Number(file.byte_size)
  ) {
    return requestErrorResponse(
      422,
      'file_integrity',
      'The retained file does not match its recorded checksum.',
    )
  }
  let rowCount = 0
  let sheetName: string | null = null
  let headers: string[] = []
  const errors: string[] = []
  try {
    const preview = await parseImportBytes(bytes, { fileName: file.filename })
    const text = file.format === 'xlsx' ? null : new TextDecoder().decode(bytes)
    if (executeEngine && text === null)
      throw new Error('This engine requires a retained text file.')
    const selectedSheet =
      typeof version.mapping.sheetName === 'string'
        ? version.mapping.sheetName
        : undefined
    if (!executeEngine && preview.sheets.length > 1 && !selectedSheet) {
      throw new Error(
        'Set sheetName in this parser version’s column mapping to choose the retained test worksheet.',
      )
    }
    const sheet =
      executeEngine && text !== null
        ? { name: 'Engine output', ...executeEngine(text) }
        : selectImportSheet(preview, selectedSheet)
    if (sheet.rows.length === 0)
      throw new Error('The test file has no data rows.')
    headers = sheet.headers
    sheetName = sheet.name
    rowCount = sheet.rows.length
    const matched = signature.success
      ? recogniseImportParser(
          {
            format: preview.format,
            headers,
            rawTextHint: text,
          },
          [
            {
              key: version.parsers.key,
              label: version.parsers.name,
              version: version.version,
              format: preview.format,
              status: 'approved',
              signature: signature.data,
              plannedKeyHeaders: [],
              controlPattern: '',
            },
          ],
        )
      : Boolean(executeEngine || version.signature.manualMapping === true)
    if (!matched)
      errors.push(
        'The test file does not match this version’s required headers or metadata.',
      )
    if (Object.keys(version.mapping).length) {
      const mapping = mappingSchema.safeParse(version.mapping)
      if (!mapping.success || !file.dataset_id)
        throw new Error(
          'A supported column mapping and a Dataset-linked test file are required to validate this mapping.',
        )
      const target = await loadDataset(context.token, file.dataset_id)
      if (!target.ok) throw new Error(target.message)
      const fields = toTargetFields(target.fields)
      if (
        mapping.data.sources.some(
          (entry) =>
            !headers.includes(entry.source) ||
            (entry.fieldId &&
              !fields.some((field) => field.id === entry.fieldId)),
        )
      )
        throw new Error(
          'The mapping refers to a missing source column or Dataset field.',
        )
      const mapped = mapImportSheet(
        sheet,
        mappingsFromDocument(mapping.data, fields),
        target.dataset.schema_version_id,
      )
      errors.push(
        ...mapped.errors
          .slice(0, 20)
          .map(
            (error) => `Row ${error.row}, ${error.source}: ${error.message}`,
          ),
      )
    }
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : 'The test file could not be parsed.',
    )
  }
  const result = {
    ok: errors.length === 0,
    fileId: file.id,
    checksum,
    sheetName,
    rowCount,
    headers,
    errors,
  }
  let persisted: ParserSettingsVersion
  try {
    persisted = await recordValidation(context, version, file, result)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : null
    if (code === '42501')
      return requestErrorResponse(
        403,
        'not_permitted',
        'Scientific configuration authority is required to validate a parser version.',
      )
    if (code === '22023')
      return requestErrorResponse(
        409,
        'stale_evidence',
        'The definition or retained file changed during validation. Reload and test again.',
      )
    throw error
  }
  return Response.json({
    ok: result.ok,
    parserVersionId: persisted.id,
    status: persisted.status,
    validation: persisted.test_result,
  })
}
