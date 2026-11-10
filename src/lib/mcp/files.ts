import { createHash } from 'node:crypto'
import { z } from 'zod'

import type { Scope } from '../api-credential-scopes'
import type { SessionAuthDeps } from '../request-auth'

/**
 * File tools over MCP: put a file into a project (or add a version of one) and
 * read one back. Both run the same file routes the app and the token API use,
 * as the person the token belongs to, so size limits, allowed types, plugin
 * hooks, text extraction and rate limits all apply. Bytes travel as text or
 * base64 inside the JSON request, so only small files fit; bigger ones use
 * the file routes directly (docs/api/lab-api.md).
 */

export const FILE_UPLOAD_TOOL = 'sheetbase.file.upload'
export const FILE_READ_TOOL = 'sheetbase.file.read'

/** The request body is capped at 1 MB, so keep decoded files well under it. */
export const MCP_FILE_MAX_BYTES = 700_000

/** Longest text or base64 sent back in one answer. */
const READ_MAX_BYTES = 700_000

export const fileUploadSchema = z.strictObject({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'The project to put a new file in. Leave out when adding a version.',
    ),
  fileRecordId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Add a new version to this existing file record instead of making a new file.',
    ),
  fileName: z
    .string()
    .min(1)
    .max(255)
    .describe('The file name, with its extension.'),
  mediaType: z
    .string()
    .min(1)
    .max(120)
    .describe('The media type, such as `text/csv` or `image/png`.'),
  content: z.string().describe('The file’s content.'),
  encoding: z
    .enum(['utf8', 'base64'])
    .default('utf8')
    .describe('`utf8` for text, `base64` for anything else.'),
})

export const fileReadSchema = z.strictObject({
  fileRecordId: z.string().uuid().describe('The file record.'),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('An earlier version. Leave out for the newest.'),
})

export function fileMcpTools(
  scopes: readonly Scope[],
  readOn: boolean,
  labOn: boolean,
) {
  const tools = []

  if (readOn && scopes.includes('files:read'))
    tools.push({
      name: FILE_READ_TOOL,
      description: `Read a file the person can see, as text (text files) or base64. Files over ${READ_MAX_BYTES} bytes cannot be sent this way; use GET /api/files/{fileRecordId}/download. Needs a personal token with files:read.`,
      inputSchema: z.toJSONSchema(fileReadSchema, { io: 'input' }),
      annotations: {
        title: 'Read a file',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })

  if (labOn && scopes.includes('files:write'))
    tools.push({
      name: FILE_UPLOAD_TOOL,
      description: `Put a file into a project, or add a new version to a file, as the person the token belongs to. Up to ${MCP_FILE_MAX_BYTES} bytes; send bigger files with the file routes. Needs a personal token with files:write and the workspace setting "Agents can act in the lab".`,
      inputSchema: z.toJSONSchema(fileUploadSchema, { io: 'input' }),
      annotations: {
        title: 'Upload a file',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    })

  return tools
}

export interface FileToolContext {
  workspaceId: string
  userId: string
  credentialId: string
  /** The person's database token for this request. */
  token: string
}

/** Auth for the file routes when the caller was already verified by MCP. */
function depsFor(context: FileToolContext): SessionAuthDeps {
  return {
    getSession: () =>
      Promise.resolve({
        user: { id: context.userId },
        session: { id: context.credentialId },
      }),
    getWorkspaceForUser: () => Promise.resolve({ id: context.workspaceId }),
    mintToken: () => Promise.resolve(context.token),
  }
}

type Outcome = { ok: true; value: unknown } | { ok: false; message: string }

async function errorOf(response: Response): Promise<string> {
  try {
    const body = z
      .object({
        error: z.object({ message: z.string().optional() }).optional(),
      })
      .parse(await response.json())

    return body.error?.message ?? `The file route answered ${response.status}.`
  } catch {
    return `The file route answered ${response.status}.`
  }
}

export async function runFileUpload(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP transport input is decoded by fileUploadSchema below before use.
  args: unknown,
  context: FileToolContext,
): Promise<Outcome> {
  const parsed = fileUploadSchema.safeParse(args)

  if (!parsed.success)
    return {
      ok: false,
      message: 'The arguments do not match the file upload schema.',
    }
  const input = parsed.data

  if (!input.projectId && !input.fileRecordId)
    return {
      ok: false,
      message:
        'Give a projectId for a new file, or a fileRecordId for a new version.',
    }

  const bytes =
    input.encoding === 'base64'
      ? Buffer.from(input.content, 'base64')
      : Buffer.from(input.content, 'utf8')

  if (bytes.byteLength > MCP_FILE_MAX_BYTES)
    return {
      ok: false,
      message: `This file is over ${MCP_FILE_MAX_BYTES} bytes. Send it with the file routes instead.`,
    }

  // Loaded on use: the route code opens the database pool.
  const { handleUpload, handleUploadAuthorize, handleUploadVersion } =
    await import('../file-routes')

  const deps = depsFor(context)
  const base = 'http://sheetbase.internal'
  let fileRecordId = input.fileRecordId

  if (!fileRecordId) {
    const authorize = await handleUploadAuthorize(
      new Request(`${base}/api/files/upload-authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: input.projectId,
          displayName: input.fileName,
          mediaType: input.mediaType,
          byteSize: bytes.byteLength,
          checksum: createHash('sha256').update(bytes).digest('hex'),
        }),
      }),
      deps,
    )

    if (!authorize.ok) return { ok: false, message: await errorOf(authorize) }
    fileRecordId = z
      .object({ fileRecordId: z.string().uuid() })
      .parse(await authorize.json()).fileRecordId
  }

  const send = input.fileRecordId ? handleUploadVersion : handleUpload

  const uploaded = await send(
    new Request(`${base}/api/files/${fileRecordId}/upload`, {
      method: 'PUT',
      headers: { 'content-type': input.mediaType },
      body: new Uint8Array(bytes),
    }),
    fileRecordId,
    deps,
  )

  if (!uploaded.ok) return { ok: false, message: await errorOf(uploaded) }

  return { ok: true, value: await uploaded.json() }
}

const TEXT_LIKE = /^(text\/|application\/(json|xml|x-yaml|csv))/

export async function runFileRead(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP transport input is decoded by fileReadSchema below before use.
  args: unknown,
  context: FileToolContext,
): Promise<Outcome> {
  const parsed = fileReadSchema.safeParse(args)

  if (!parsed.success)
    return {
      ok: false,
      message: 'The arguments do not match the file read schema.',
    }
  const { fileRecordId, version } = parsed.data
  const query = version ? `?version=${version}` : ''
  const { handleDownload } = await import('../file-routes')

  const response = await handleDownload(
    new Request(
      `http://sheetbase.internal/api/files/${fileRecordId}/download${query}`,
    ),
    fileRecordId,
    depsFor(context),
  )

  if (!response.ok) return { ok: false, message: await errorOf(response) }

  const mediaType =
    response.headers.get('content-type') ?? 'application/octet-stream'

  const declared = Number(response.headers.get('content-length') ?? '0')

  if (declared > READ_MAX_BYTES) {
    await response.body?.cancel()

    return {
      ok: false,
      message: `This file is ${declared} bytes, too big to send here. Use GET /api/files/${fileRecordId}/download.`,
    }
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const text = TEXT_LIKE.test(mediaType)

  return {
    ok: true,
    value: {
      fileRecordId,
      mediaType,
      byteSize: bytes.byteLength,
      encoding: text ? 'utf8' : 'base64',
      content: text ? bytes.toString('utf8') : bytes.toString('base64'),
    },
  }
}
