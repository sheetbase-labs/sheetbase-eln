/**
 * .eln archive export and import byte-routes.
 *
 * Same architecture as `src/lib/export/routes.ts`: thin TanStack Start route
 * files delegate here with injected auth deps. Every read goes through the
 * RLS-scoped PostgREST token, so a caller can only export what they can see,
 * and cross-workspace requests fail closed as `404 not_found`. File bytes come
 * from the object-storage boundary. Each exported experiment writes a
 * provenance receipt into api.data_exports (format `eln`) after the archive is
 * built; a project export therefore leaves one receipt per experiment.
 */
import { z } from 'zod'

import { PAYLOAD_SCHEMA_VERSION } from '../blocks'
import { getObjectStorage } from '../file-storage'
import type { ObjectStorage } from '../file-storage'
import { IMPORT_LIMITS } from '../import-parse'
import {
  auditEventsCsv,
  auditEventsPageSchema,
  auditEventsRpcArgs,
} from '../audit-history'
import type { AuditEventWire } from '../audit-history'
import { delimitedHeaderLine, delimitedRowLine } from '../export/delimited'
import { loadDatasetFields, pagedRows } from '../export/routes'
import {
  postgrestRpc,
  postgrestSelect,
  recordDataExportReceipt,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthContext, SessionAuthDeps } from '../request-auth'
import { buildElnArchive, safeName } from './eln-archive'
import type {
  ElnBlock,
  ElnDataset,
  ElnExperiment,
  ElnFile,
  ElnSignature,
} from './eln-archive'
import { ElnImportError, parseElnArchive } from './eln-import'

/** Per-export ceiling on attached-file bytes held in memory. */
export const ELN_EXPORT_FILE_BYTES = 256 * 1024 * 1024
/** Per-export ceiling on experiments in a project archive. */
export const ELN_EXPORT_MAX_EXPERIMENTS = 200
/** Per-export ceiling on Dataset rows written to a CSV. */
const DATASET_ROW_CAP = 100_000

class UpstreamError extends Error {}

interface RecordWire {
  id: string
  workspace_id: string
  project_id: string | null
  identifier: string
  title: string
  kind: string
  status: string
  tags: string[]
  properties: unknown
  custom_fields: unknown
  created_at: string
}

interface BlockWire {
  id: string
  type: string
  payload: unknown
  payload_schema_version: number
  order: number
}

interface FileObjectWire {
  record_id: string
  storage_key: string
  display_name: string
  media_type: string
  byte_size: number | string
  status: string
}

interface SignatureWire {
  id: string
  revision_id: string
  signer_user_id: string
  signer_name: string | null
  signer_role: string
  signature_meaning: string
  auth_method: string
  revision_integrity_digest: string
  signed_at: string
}

const RECORD_SELECT =
  'id,workspace_id,project_id,identifier,title,kind,status,tags,properties,custom_fields,created_at'

function rows<T>(body: unknown): T[] {
  return Array.isArray(body) ? (body as T[]) : []
}

async function select<T>(
  resource: string,
  query: string,
  token: string,
): Promise<T[]> {
  const res = await postgrestSelect<T[]>(resource, query, token)
  if (res.status >= 400) throw new UpstreamError(`${resource} unavailable`)
  return rows<T>(res.body)
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

async function auditCsvFor(recordId: string, token: string): Promise<string> {
  const events: AuditEventWire[] = []
  let beforeSequence: number | undefined
  for (;;) {
    const result = await postgrestRpc(
      'audit_events',
      auditEventsRpcArgs({ object: recordId, beforeSequence, limit: 200 }),
      token,
    )
    if (result.status >= 400) throw new UpstreamError('audit unavailable')
    const parsed = auditEventsPageSchema.safeParse(result.body)
    if (!parsed.success) throw new UpstreamError('invalid audit page')
    events.push(...parsed.data.events)
    const { hasMore, nextCursor } = parsed.data
    if (!hasMore) break
    if (
      nextCursor === null ||
      (beforeSequence !== undefined && nextCursor >= beforeSequence)
    ) {
      throw new UpstreamError('invalid audit cursor')
    }
    beforeSequence = nextCursor
  }
  return auditEventsCsv(events)
}

async function datasetCsv(
  datasetId: string,
  versionId: string | null,
  token: string,
): Promise<ElnDataset | null> {
  const [dataset] = await select<{
    id: string
    name: string
    description: string | null
    display_id: string | null
    schema_version_id: string
  }>(
    'datasets',
    `id=eq.${encodeURIComponent(datasetId)}&select=id,name,description,display_id,schema_version_id&limit=1`,
    token,
  )
  if (!dataset) return null
  let schemaVersionId = dataset.schema_version_id
  let rpcName = 'query_dataset_rows'
  let rpcArgs: Record<string, unknown> = { p_dataset_id: dataset.id }
  if (versionId) {
    const [version] = await select<{ id: string; schema_version_id: string }>(
      'dataset_versions',
      `id=eq.${encodeURIComponent(versionId)}&dataset_id=eq.${dataset.id}&select=id,schema_version_id&limit=1`,
      token,
    )
    if (version) {
      schemaVersionId = version.schema_version_id
      rpcName = 'query_dataset_version_rows'
      rpcArgs = { p_dataset_version_id: version.id }
    }
  }
  const fields = await loadDatasetFields(token, schemaVersionId)
  const lines = [delimitedHeaderLine(fields, ',')]
  let count = 0
  for await (const row of pagedRows(rpcName, rpcArgs, token).rows) {
    if (count++ >= DATASET_ROW_CAP) break
    lines.push(delimitedRowLine(fields, row, ','))
  }
  return {
    id: dataset.id,
    displayId: dataset.display_id,
    name: dataset.name,
    description: dataset.description,
    csv: lines.join('\r\n') + '\r\n',
  }
}

/** Dataset ids (and pinned versions) an experiment's blocks cite. */
function citedDatasets(
  blocks: BlockWire[],
): Array<{ datasetId: string; versionId: string | null }> {
  const seen = new Map<string, string | null>()
  const uuid = z.uuid()
  for (const block of blocks) {
    if (block.type !== 'linked_record') continue
    const p = block.payload as Record<string, unknown> | null
    if (!p || p.targetKind !== 'dataset') continue
    const id = uuid.safeParse(p.targetId)
    if (!id.success) continue
    const version = uuid.safeParse(p.datasetVersionId)
    if (!seen.has(id.data) || version.success) {
      seen.set(
        id.data,
        version.success ? version.data : (seen.get(id.data) ?? null),
      )
    }
  }
  return [...seen].map(([datasetId, versionId]) => ({ datasetId, versionId }))
}

interface ExportBudget {
  remainingFileBytes: number
}

async function collectExperiment(
  record: RecordWire,
  context: SessionAuthContext,
  storage: ObjectStorage,
  budget: ExportBudget,
): Promise<ElnExperiment> {
  const token = context.token
  const blocks = await select<BlockWire>(
    'blocks',
    `record_id=eq.${record.id}&select=id,type,payload,payload_schema_version,order&order=order.asc`,
    token,
  )

  const fileIds = [
    ...new Set(
      blocks
        .filter((b) => b.type === 'file')
        .map(
          (b) => (b.payload as { fileRecordId?: unknown } | null)?.fileRecordId,
        )
        .filter((id): id is string => z.uuid().safeParse(id).success),
    ),
  ]
  const files: ElnFile[] = []
  if (fileIds.length > 0) {
    const list = fileIds.join(',')
    const objects = await select<FileObjectWire>(
      'file_objects',
      `record_id=in.(${list})&select=record_id,storage_key,display_name,media_type,byte_size,status`,
      token,
    )
    const identifiers = new Map(
      (
        await select<{ id: string; identifier: string }>(
          'records',
          `id=in.(${list})&select=id,identifier`,
          token,
        )
      ).map((r) => [r.id, r.identifier]),
    )
    for (const object of objects) {
      const base = {
        fileRecordId: object.record_id,
        fileIdentifier: identifiers.get(object.record_id) ?? object.record_id,
        displayName: object.display_name,
        mediaType: object.media_type,
      }
      if (object.status !== 'active') {
        files.push({ ...base, bytes: null, missingReason: object.status })
        continue
      }
      if (Number(object.byte_size) > budget.remainingFileBytes) {
        files.push({ ...base, bytes: null, missingReason: 'size_limit' })
        continue
      }
      try {
        const { stream } = await storage.getStream(object.storage_key)
        const bytes = await readAll(stream)
        budget.remainingFileBytes -= bytes.length
        files.push({ ...base, bytes })
      } catch {
        files.push({ ...base, bytes: null, missingReason: 'missing' })
      }
    }
  }

  const datasets: ElnDataset[] = []
  for (const cited of citedDatasets(blocks)) {
    const dataset = await datasetCsv(cited.datasetId, cited.versionId, token)
    if (dataset) datasets.push(dataset)
  }

  const signatures = (
    await select<SignatureWire>(
      'signatures',
      `record_id=eq.${record.id}&order=signed_at.asc&select=id,revision_id,signer_user_id,signer_name,signer_role,signature_meaning,auth_method,revision_integrity_digest,signed_at`,
      token,
    )
  ).map((s): ElnSignature => ({
    id: s.id,
    revisionId: s.revision_id,
    signerUserId: s.signer_user_id,
    signerName: s.signer_name,
    signerRole: s.signer_role,
    signatureMeaning: s.signature_meaning,
    authMethod: s.auth_method,
    revisionIntegrityDigest: s.revision_integrity_digest,
    signedAt: s.signed_at,
  }))

  return {
    record: {
      id: record.id,
      identifier: record.identifier,
      title: record.title,
      kind: record.kind,
      status: record.status,
      tags: record.tags,
      createdAt: record.created_at,
      properties: record.properties,
      customFields: record.custom_fields,
    },
    blocks: blocks.map((b): ElnBlock => ({
      id: b.id,
      type: b.type,
      order: b.order,
      payloadSchemaVersion: b.payload_schema_version,
      payload: b.payload,
    })),
    files,
    datasets,
    signatures,
    auditCsv: await auditCsvFor(record.id, token),
  }
}

function archiveResponse(bytes: Uint8Array, name: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'application/vnd.eln+zip',
      'content-disposition': `attachment; filename="${safeName(name, 'export')}.eln"`,
      'cache-control': 'no-store',
    },
  })
}

function failure(error: unknown): Response {
  if (error instanceof UpstreamError) {
    return requestErrorResponse(502, 'upstream_error', 'Export is unavailable.')
  }
  throw error
}

async function receipts(
  context: SessionAuthContext,
  experiments: ElnExperiment[],
  workspaceId: string,
  byteSize: number,
): Promise<void> {
  // Receipt persistence is part of the successful-export contract: if the
  // audit record cannot be written, the export fails.
  for (const exp of experiments) {
    await recordDataExportReceipt({
      actorUserId: context.userId,
      workspaceId,
      objectType: 'record',
      objectId: exp.record.id,
      format: 'eln',
      byteSize,
    })
  }
}

export async function handleRecordElnExport(
  request: Request,
  recordId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  if (!z.uuid().safeParse(recordId).success)
    return requestErrorResponse(404, 'not_found', 'Experiment not found.')

  try {
    const [record] = await select<RecordWire>(
      'records',
      `id=eq.${recordId}&kind=eq.experiment&select=${RECORD_SELECT}&limit=1`,
      context.token,
    )
    if (!record)
      return requestErrorResponse(404, 'not_found', 'Experiment not found.')
    const experiment = await collectExperiment(record, context, storage, {
      remainingFileBytes: ELN_EXPORT_FILE_BYTES,
    })
    const name = `${record.identifier} ${record.title}`
    const { bytes } = await buildElnArchive({
      name,
      workspaceId: record.workspace_id,
      exportedAt: new Date().toISOString(),
      experiments: [experiment],
    })
    await receipts(context, [experiment], record.workspace_id, bytes.length)
    return archiveResponse(bytes, name)
  } catch (error) {
    return failure(error)
  }
}

export async function handleProjectElnExport(
  request: Request,
  projectId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  if (!z.uuid().safeParse(projectId).success)
    return requestErrorResponse(404, 'not_found', 'Project not found.')

  try {
    const [project] = await select<{
      id: string
      workspace_id: string
      key: string
      title: string
      status: string
    }>(
      'projects',
      `id=eq.${projectId}&select=id,workspace_id,key,title,status&limit=1`,
      context.token,
    )
    if (!project)
      return requestErrorResponse(404, 'not_found', 'Project not found.')

    const records = await select<RecordWire>(
      'records',
      `project_id=eq.${projectId}&kind=eq.experiment&archived_at=is.null&order=identifier.asc&limit=${ELN_EXPORT_MAX_EXPERIMENTS + 1}&select=${RECORD_SELECT}`,
      context.token,
    )
    if (records.length > ELN_EXPORT_MAX_EXPERIMENTS) {
      return requestErrorResponse(
        413,
        'too_many_experiments',
        `A project archive holds at most ${ELN_EXPORT_MAX_EXPERIMENTS} experiments; export them individually.`,
      )
    }
    const budget = { remainingFileBytes: ELN_EXPORT_FILE_BYTES }
    const experiments: ElnExperiment[] = []
    for (const record of records) {
      experiments.push(
        await collectExperiment(record, context, storage, budget),
      )
    }
    const { bytes } = await buildElnArchive({
      name: `${project.key} ${project.title}`,
      project: {
        id: project.id,
        key: project.key,
        title: project.title,
        status: project.status,
      },
      workspaceId: project.workspace_id,
      exportedAt: new Date().toISOString(),
      experiments,
    })
    await receipts(context, experiments, project.workspace_id, bytes.length)
    return archiveResponse(bytes, `${project.key} ${project.title}`)
  } catch (error) {
    return failure(error)
  }
}

export async function handleElnImport(
  request: Request,
  deps: SessionAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const projectId = new URL(request.url).searchParams.get('projectId') ?? ''
  if (!z.uuid().safeParse(projectId).success)
    return requestErrorResponse(
      400,
      'invalid_project',
      'projectId is required.',
    )

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > IMPORT_LIMITS.bytes)
    return requestErrorResponse(413, 'too_large', 'The archive is too large.')
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.length === 0)
    return requestErrorResponse(
      400,
      'empty_body',
      'Send the .eln file as the request body.',
    )
  if (body.length > IMPORT_LIMITS.bytes)
    return requestErrorResponse(413, 'too_large', 'The archive is too large.')

  let plan
  try {
    plan = parseElnArchive(body)
  } catch (error) {
    if (error instanceof ElnImportError)
      return requestErrorResponse(400, 'invalid_archive', error.message)
    throw error
  }

  try {
    const projects = await select<{ id: string }>(
      'projects',
      `id=eq.${projectId}&select=id&limit=1`,
      context.token,
    )
    if (projects.length === 0)
      return requestErrorResponse(404, 'not_found', 'Project not found.')
  } catch (error) {
    return failure(error)
  }

  const created: Array<{ id: string; identifier: string; title: string }> = []
  for (const exp of plan.experiments) {
    const provenance = `Imported from a .eln archive${exp.sourceIdentifier ? ` (original identifier ${exp.sourceIdentifier})` : ''}.`
    const blocks = [
      ...exp.blocks,
      {
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: provenance }],
              },
            ],
          },
        },
        payload_schema_version: PAYLOAD_SCHEMA_VERSION,
        order: exp.blocks.length + 1,
      },
    ]
    const result = await postgrestRpc<{
      record: { id: string; identifier: string; title: string }
    }>(
      'create_record_with_blocks',
      {
        p_project_id: projectId,
        p_kind: 'experiment',
        p_title: exp.title,
        p_status: 'draft',
        p_tags: exp.tags,
        p_blocks: blocks,
        p_properties: {},
      },
      context.token,
    )
    const record = (
      result.body as {
        record?: { id: string; identifier: string; title: string }
      }
    ).record
    if (result.status >= 400 || !record) {
      return Response.json(
        {
          error: {
            code: 'import_failed',
            message: `Could not create "${exp.title}". ${created.length} experiment(s) were created before the failure.`,
          },
          created,
          warnings: plan.warnings,
        },
        { status: result.status >= 500 ? 502 : 422 },
      )
    }
    created.push({
      id: record.id,
      identifier: record.identifier,
      title: record.title,
    })
  }
  return Response.json({ created, warnings: plan.warnings }, { status: 201 })
}
