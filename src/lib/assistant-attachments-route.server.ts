import { z } from 'zod'

import { loadSession } from './assistant-actions'
import { ATTACHMENT_MAX_BYTES } from './assistant-attachments'
import type { ChatAttachment } from './assistant-attachments'
import {
  AttachmentError,
  readAttachmentFile,
} from './assistant-attachments.server'
import { logger, redact } from './logger'
import { RATE_LIMIT_SCOPE_FILES, createRateLimiter } from './rate-limit'

/**
 * POST /api/assistant/attachments — read one file for the chat.
 *
 * A multipart form with `workspaceId` and `file`. The person must be signed in
 * to that workspace, as for the chat itself. The answer is the reading
 * (`ChatAttachment`) and nothing is stored: the browser keeps it with the chat
 * and sends it along with each question.
 */

const limiter = createRateLimiter({ maxRequests: 30, windowSeconds: 60 })

/** What this route answers: a reading, or a line saying why not. */
interface UploadAnswer {
  attachment?: ChatAttachment
  message?: string
}

function json(status: number, body: UploadAnswer): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const workspaceSchema = z.string().uuid()

export async function handleAttachmentUpload(
  request: Request,
): Promise<Response> {
  let form: FormData

  try {
    form = await request.formData()
  } catch {
    return json(400, { message: 'The upload could not be read.' })
  }

  const workspaceId = workspaceSchema.safeParse(form.get('workspaceId'))
  const file = form.get('file')

  if (!workspaceId.success || !(file instanceof File)) {
    return json(400, { message: 'Attach one file.' })
  }

  let userId: string

  try {
    userId = (await loadSession(workspaceId.data, request.headers)).userId
  } catch {
    return json(403, { message: 'You do not have access to this workspace.' })
  }

  if (!limiter.hit(`${RATE_LIMIT_SCOPE_FILES}:assistant:${userId}`).allowed) {
    return json(429, { message: 'Too many files at once. Wait a moment.' })
  }

  if (file.size > ATTACHMENT_MAX_BYTES) {
    return json(413, {
      message: `That file is over ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`,
    })
  }

  try {
    const attachment = await readAttachmentFile(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file.type,
    )

    logger.info(
      'ai.assistant.attachment',
      redact({
        workspaceId: workspaceId.data,
        actorUserId: userId,
        kind: attachment.kind,
        bytes: attachment.bytes,
      }),
    )

    return json(200, { attachment })
  } catch (error) {
    if (error instanceof AttachmentError) {
      return json(error.code === 'too_big' ? 413 : 422, {
        message: error.message,
      })
    }

    logger.warn('ai.assistant.attachment_failed', { error: String(error) })

    return json(500, { message: 'That file could not be read.' })
  }
}
