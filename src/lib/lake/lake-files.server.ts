/**
 * Serves the Parquet files of the open tables to readers that hold a lake
 * login. DuckDB and friends fetch them over HTTPS with `Range` requests, so the
 * app answers those the way an object store would. The login's secret is sent
 * as a bearer token (DuckDB: `CREATE SECRET ... (TYPE http, BEARER_TOKEN ...)`);
 * a login that is revoked, expired or whose member lost data access gets 401.
 */
import { createHash } from 'node:crypto'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { getObjectStorage } from '../file-storage'
import { MissingStorageObjectError } from '../file-storage/types'
import type { ObjectStorage } from '../file-storage/types'

export interface LakeFileDeps {
  /** The workspace a token belongs to, or null when it is not valid. */
  tokenWorkspace: (tokenSha256: string) => Promise<string | null>
  storage: ObjectStorage
}

export function realLakeFileDeps(): LakeFileDeps {
  return {
    tokenWorkspace: async (hash) => {
      const { rows } = await getPool(env.DATABASE_URL).query<{ w: string | null }>(
        `SELECT internal.lake_token_workspace($1) AS w`,
        [hash],
      )
      return rows[0]?.w ?? null
    },
    storage: getObjectStorage(),
  }
}

const SEGMENT = /^[a-z0-9][a-z0-9_.-]{0,100}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(header)
  if (bearerMatch) return bearerMatch[1]
  // Some clients can only send basic auth; the password is the secret.
  const basic = /^Basic\s+(\S+)$/i.exec(header)
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    return colon >= 0 ? decoded.slice(colon + 1) : null
  }
  return null
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function handleLakeFile(
  request: Request,
  workspaceId: string,
  splat: string,
  deps: LakeFileDeps,
): Promise<Response> {
  const token = bearer(request)
  if (!token) {
    return new Response(JSON.stringify({ error: 'A lake login is required.' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="sheetbase-lake"',
      },
    })
  }
  const owner = await deps.tokenWorkspace(
    createHash('sha256').update(token).digest('hex'),
  )
  if (!owner || owner !== workspaceId || !UUID.test(workspaceId)) {
    return json(401, 'That lake login is not valid for this workspace.')
  }
  // main/<table>/<file>.parquet — nothing else lives under the lake.
  const parts = splat.split('/')
  if (
    parts.length !== 3 ||
    parts[0] !== 'main' ||
    !parts.every((p) => SEGMENT.test(p)) ||
    !parts[2].endsWith('.parquet')
  ) {
    return json(404, 'No such file.')
  }
  const key = `lake/${workspaceId}/${splat}`
  let body: Uint8Array
  try {
    body = await readAll((await deps.storage.getStream(key)).stream)
  } catch (error) {
    if (error instanceof MissingStorageObjectError) return json(404, 'No such file.')
    throw error
  }
  const common = {
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    etag: `"${parts[2]}"`,
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  if (range && (range[1] !== '' || range[2] !== '')) {
    const total = body.byteLength
    let start: number
    let end: number
    if (range[1] === '') {
      start = Math.max(0, total - Number(range[2]))
      end = total - 1
    } else {
      start = Number(range[1])
      end = range[2] === '' ? total - 1 : Math.min(Number(range[2]), total - 1)
    }
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { ...common, 'content-range': `bytes */${total}` },
      })
    }
    const slice = body.subarray(start, end + 1)
    return new Response(slice as unknown as BodyInit, {
      status: 206,
      headers: {
        ...common,
        'content-length': String(slice.byteLength),
        'content-range': `bytes ${start}-${end}/${total}`,
      },
    })
  }
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...common, 'content-length': String(body.byteLength) },
    })
  }
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { ...common, 'content-length': String(body.byteLength) },
  })
}
