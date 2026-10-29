/**
 * The two session-signed-in entries to intake that the app itself uses:
 * a file picked on the connector page, and "try again" on an intake problem.
 * Both start from a file the file platform already keeps, read back by its
 * record id, so the bytes that get parsed are the bytes that were kept.
 */
import { z } from 'zod'

import { createServerDataClient } from './enterprise/execution.server'
import { postgrestFileObjectReader } from './enterprise/retain.server'
import { IntakeError, runIntake } from './intake.server'
import type { IntakeFailureRow, IntakeRetained } from './intake.server'
import { webhookReader } from './webhook-parser.server'
import type { ConnectorWire } from './types'
import { DataClientError } from '../data-client'
import { getObjectStorage } from '../file-storage'
import { IMPORT_LIMITS } from '../import-parse'
import { boundedErrorMessage } from './enterprise/errors'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import type { ObjectStorage } from '../file-storage'

const uuid = z.uuid()

const bodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('upload'),
      connectorId: uuid,
      fileRecordId: uuid,
      fileName: z.string().min(1).max(200),
      projectId: uuid,
      schemaVersionId: uuid,
      datasetId: uuid.nullable().optional(),
      newDatasetName: z.string().max(200).nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('retry'),
      failureId: uuid,
      /** A different parser, chosen for this file. */
      parserKey: z.string().min(1).max(200).nullable().optional(),
    })
    .strict(),
])

interface FileObjectRow {
  id: string
  storage_key: string
  status: string
}

/** The bytes the file platform keeps for a file record. */
async function readKeptFile(
  token: string,
  workspaceId: string,
  fileRecordId: string,
  storage: ObjectStorage,
): Promise<{ bytes: Uint8Array; retained: IntakeRetained }> {
  const object = (await postgrestFileObjectReader(token)(
    workspaceId,
    fileRecordId,
  )) as FileObjectRow | null
  if (!object || !object.storage_key.startsWith(`${workspaceId}/`)) {
    throw new IntakeError(
      404,
      'file_not_found',
      'The kept copy of this file can’t be found.',
    )
  }
  const stored = await storage.getStream(object.storage_key)
  if (stored.byteSize > IMPORT_LIMITS.bytes) {
    await stored.stream.cancel()
    throw new IntakeError(413, 'file_too_large', 'The file is too large.')
  }
  const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer())
  const { sha256Hex } = await import('./digest')
  return {
    bytes,
    retained: {
      fileRecordId,
      fileObjectId: object.id,
      byteSize: bytes.byteLength,
      checksum: await sha256Hex(bytes),
    },
  }
}

export async function handleIntake(
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
    return requestErrorResponse(400, 'invalid_request', 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return requestErrorResponse(
      400,
      'invalid_request',
      'Choose a connector and a file that was kept, or a problem to try again.',
    )
  }
  const body = parsed.data
  const client = createServerDataClient(context.token)
  try {
    let failure: IntakeFailureRow | null = null
    if (body.kind === 'retry') {
      const found = (
        await client.list<IntakeFailureRow>(
          'intake_failures',
          `?id=eq.${body.failureId}&select=*&limit=1`,
        )
      ).at(0)
      failure = found ?? null
      if (!failure) {
        return requestErrorResponse(404, 'not_found', 'That problem is gone.')
      }
      if (failure.status !== 'open') {
        return requestErrorResponse(
          409,
          'already_closed',
          'This problem was already closed.',
        )
      }
      if (!failure.file_record_id) {
        return requestErrorResponse(
          409,
          'file_not_kept',
          'This file wasn’t kept, so it can’t be tried again. Send it again from the instrument.',
        )
      }
    }
    const connectorId =
      body.kind === 'upload' ? body.connectorId : failure!.connector_id
    const connector = (
      await client.list<ConnectorWire>(
        'connectors',
        `?id=eq.${connectorId}&select=*&limit=1`,
      )
    ).at(0)
    if (!connector || connector.connector_type !== 'instrument') {
      return requestErrorResponse(
        404,
        'connector_not_found',
        'No such instrument connection.',
      )
    }
    if (connector.status !== 'active') {
      return requestErrorResponse(
        409,
        'connector_inactive',
        `This instrument connection is ${connector.status}.`,
      )
    }
    const fileRecordId =
      body.kind === 'upload' ? body.fileRecordId : failure!.file_record_id!
    const fileName = body.kind === 'upload' ? body.fileName : failure!.file_name
    const kept = await readKeptFile(
      context.token,
      context.workspaceId,
      fileRecordId,
      storage,
    )
    const pickup = (connector.config['pickup'] ?? {}) as Record<string, unknown>
    const savedTarget = failure?.target ?? {}
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : null
    const target =
      body.kind === 'upload'
        ? {
            projectId: body.projectId,
            schemaVersionId: body.schemaVersionId,
            datasetId: body.datasetId ?? null,
            newDatasetName: body.datasetId
              ? null
              : (body.newDatasetName ?? null),
          }
        : {
            projectId: text(savedTarget['projectId']) ?? '',
            schemaVersionId: text(savedTarget['schemaVersionId']) ?? '',
            datasetId: text(savedTarget['datasetId']),
            newDatasetName: text(savedTarget['newDatasetName']),
          }
    if (!target.projectId || !target.schemaVersionId) {
      return requestErrorResponse(
        409,
        'target_unknown',
        'Where this file was going isn’t known, so it can’t be tried again.',
      )
    }
    const result = await runIntake({
      client,
      workspaceId: context.workspaceId,
      connector,
      fileName,
      bytes: kept.bytes,
      retained: kept.retained,
      source: failure?.source ?? 'upload',
      triggerKind: 'manual',
      target,
      autoDetect: pickup['autoDetect'] === true,
      parserKey: body.kind === 'retry' ? (body.parserKey ?? null) : null,
      instrumentId: text(pickup['instrumentId']),
      readWithWebhook: webhookReader({
        workspaceId: context.workspaceId,
        fileName,
        bytes: kept.bytes,
      }),
    })
    return Response.json(result, {
      status: result.alreadyCompleted ? 200 : 201,
    })
  } catch (error) {
    if (error instanceof IntakeError) {
      return Response.json(
        {
          error: { code: error.code, message: error.message },
          failureId: error.failureId,
        },
        { status: error.status === 502 ? 502 : error.status },
      )
    }
    if (
      error instanceof DataClientError &&
      (error.status === 401 || error.status === 403)
    ) {
      return requestErrorResponse(
        403,
        'forbidden',
        'You can’t add data to this project or dataset.',
      )
    }
    return requestErrorResponse(
      502,
      'intake_failed',
      boundedErrorMessage(error),
    )
  }
}
