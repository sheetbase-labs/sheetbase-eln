/**
 * Runs the web call step of a pipeline (server-only).
 *
 * A web call reaches one of the workspace's connections: an https address an
 * administrator approved. The step names a secret by name; its value is opened
 * here, sent as the connection's auth header and never logged, recorded or
 * returned. Loopback, link-local and unspecified addresses are refused, and a
 * deployment's connector host allowlist applies, as for every connector.
 *
 * What comes back is recorded with the run (a response and its digests) and
 * listed in the run's signed manifest. A run that waits for a person asks again
 * from the top when it resumes, so a response already recorded is read, not
 * fetched. A Reproduce only reads recordings.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { t } from '#/copy'
import {
  WEB_CALL_MAX_BYTES,
  WEB_CALL_RETRIES,
  WEB_CALL_TIMEOUT_MS,
  resolveWebCallBody,
  resolveWebCallPath,
  rowsFromAnswer,
} from './pipelines/web-call'
import type { PipelineWebCall } from './pipelines/web-call'
import { validateConnectorEndpointUrl } from './connectors/enterprise/host-policy.server'
import { canonicalJson, sha256Hex } from './pipeline-manifest.server'
import type { ManifestResponse } from './pipeline-manifest.server'
import type { QueryResultRow } from 'pg'
import type { z } from 'zod'

export class WebCallError extends Error {}

/** A connection as a call needs it: where it points and how it signs in. */
export interface WebCallConnection {
  id: string
  key: string
  name: string
  baseUrl: string
  status: string
  authHeader: string
  authScheme: string
}

/** A response kept with a run. */
export interface RecordedResponse {
  stepName: string
  seq: number
  method: string
  url: string
  requestDigest: string
  status: number
  contentType: string | null
  body: string
  bodyDigest: string
  attempts: number
  fetchedAt: string
}

/** What a call needs from the outside; a test hands in its own. */
export interface WebCallDeps {
  loadConnection: (
    workspaceId: string,
    key: string,
  ) => Promise<WebCallConnection | null>
  /** The value of a sealed secret, or null when the connection has none by that name. */
  loadSecret: (
    workspaceId: string,
    connectionId: string,
    name: string,
  ) => Promise<string | null>
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  /** Every address a host name points at. */
  resolveHost: (host: string) => Promise<string[]>
  /** The deployment's connector host policy; throws for a host it refuses. */
  checkHostPolicy: (url: string) => void
}

/**
 * How a run's web calls behave.
 * - `live` asks, unless the run already holds a recording of that step.
 * - `trial` asks for a GET; a POST would change the other system, so it
 *   reads the latest recording of the same request, or stops.
 * - `replay` never asks: it reads the recording of the run it reproduces.
 */
export type WebCallMode = 'live' | 'trial' | 'replay'

export interface WebCallSession {
  mode: WebCallMode
  /** What the run already recorded, by step name and call number. */
  recorded: Map<string, RecordedResponse>
  /** What this execution fetched and the run does not hold yet. */
  collected: RecordedResponse[]
  /** The latest recording, in the workspace, of a request. For a trial's POST. */
  latestFor?: (
    workspaceId: string,
    requestDigest: string,
  ) => Promise<RecordedResponse | null>
  deps?: WebCallDeps
}

export function newWebCallSession(
  mode: WebCallMode,
  recorded: RecordedResponse[] = [],
  extra: Pick<WebCallSession, 'latestFor' | 'deps'> = {},
): WebCallSession {
  return {
    mode,
    recorded: new Map(recorded.map((r) => [recordKey(r.stepName, r.seq), r])),
    collected: [],
    ...extra,
  }
}

const recordKey = (step: string, seq: number) => `${step}#${seq}`

// ---------------------------------------------------------------------------
// Addresses a call may never reach.
// ---------------------------------------------------------------------------

/** Loopback, unspecified, link-local and cloud metadata addresses. Never allowed. */
export function isForbiddenAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()

  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)

    return a === 0 || a === 127 || (a === 169 && b === 254)
  }

  if (isIP(ip) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)

    if (mapped) return isForbiddenAddress(mapped[1])

    return (
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fe80:') ||
      ip.startsWith('fe9') ||
      ip.startsWith('fea') ||
      ip.startsWith('feb')
    )
  }

  return ip === 'localhost' || ip.endsWith('.localhost')
}

async function assertReachable(url: URL, deps: WebCallDeps): Promise<void> {
  if (url.protocol !== 'https:')
    throw new WebCallError(t('features.pipelineConnections.run.notHttps'))

  const host = url.hostname

  if (isForbiddenAddress(host))
    throw new WebCallError(t('features.pipelineConnections.run.forbiddenHost'))

  deps.checkHostPolicy(url.toString())

  if (isIP(host.replace(/^\[|\]$/g, '')) === 0) {
    const addresses = await deps.resolveHost(host)

    if (addresses.length === 0 || addresses.some(isForbiddenAddress))
      throw new WebCallError(
        t('features.pipelineConnections.run.forbiddenHost'),
      )
  }
}

// ---------------------------------------------------------------------------
// The call.
// ---------------------------------------------------------------------------

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_REDIRECTS = 3

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)

  if (declared > WEB_CALL_MAX_BYTES)
    throw new WebCallError(t('features.pipelineConnections.run.tooLarge'))

  const reader = response.body?.getReader()

  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0

  for (;;) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- A stream is read chunk by chunk, in order.
    const { done, value } = await reader.read()

    if (done) break
    size += value.byteLength

    if (size > WEB_CALL_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      throw new WebCallError(t('features.pipelineConnections.run.tooLarge'))
    }

    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

interface Answer {
  status: number
  contentType: string | null
  body: string
  attempts: number
  finalUrl: string
}

async function ask(
  deps: WebCallDeps,
  request: {
    method: string
    url: URL
    headers: Record<string, string>
    body: string | undefined
  },
  connectionName: string,
): Promise<Answer> {
  let attempts = 0
  let last: WebCallError | undefined

  for (let attempt = 0; attempt <= WEB_CALL_RETRIES; attempt++) {
    if (attempt > 0)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Retries wait their turn, one after the other.
      await deps.sleep(Math.min(5000, 250 * 2 ** (attempt - 1)))

    attempts += 1
    let url = request.url

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- A redirect is followed only after the one before answered.
        await assertReachable(url, deps)

        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- A redirect is followed only after the one before answered.
        const response = await deps.fetch(url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(WEB_CALL_TIMEOUT_MS),
        })

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          const next = location ? new URL(location, url) : null

          // The secret goes only where it was approved to go.
          if (!next || next.origin !== request.url.origin)
            throw new WebCallError(
              t('features.pipelineConnections.run.redirected', {
                connection: connectionName,
              }),
            )
          url = next
          continue
        }

        if (RETRY_STATUSES.has(response.status) && attempt < WEB_CALL_RETRIES) {
          await response.body?.cancel().catch(() => {})
          last = new WebCallError(
            t('features.pipelineConnections.run.answered', {
              connection: connectionName,
              status: response.status,
            }),
          )
          break
        }

        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The answer is read once, after the last call.
        const body = await readCapped(response)

        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          body,
          attempts,
          finalUrl: url.toString(),
        }
      }
    } catch (error) {
      // A refusal of ours is final; a network failure or a timeout is tried again.
      if (error instanceof WebCallError) throw error
      last = new WebCallError(
        t('features.pipelineConnections.run.unreachable', {
          connection: connectionName,
        }),
      )
    }
  }

  throw (
    last ??
    new WebCallError(
      t('features.pipelineConnections.run.unreachable', {
        connection: connectionName,
      }),
    )
  )
}

/** What the call is, as a digest: the same request gives the same digest. */
export function requestDigestOf(
  method: string,
  url: string,
  body: PipelineWebCall['body'],
): string {
  return sha256Hex(canonicalJson({ method, url, body: body ?? null }))
}

type Row = Record<string, z.core.util.JSONType>

export interface WebCallResult {
  rows: Row[]
  response: RecordedResponse
}

/** The address a call goes to: the connection's base plus the step's path, kept inside the base. */
export function webCallUrl(
  baseUrl: string,
  path: string,
  parameters: Record<string, z.core.util.JSONType | undefined>,
): URL {
  const base = new URL(baseUrl)
  const url = new URL(`${baseUrl}${resolveWebCallPath(path, parameters)}`)
  const basePath = base.pathname.replace(/\/$/, '')

  if (
    url.origin !== base.origin ||
    !(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
  )
    throw new WebCallError(t('features.pipelineConnections.run.outsideBase'))

  return url
}

/**
 * Run one web call step and read its answer as rows. A step that was already
 * recorded (a run that resumed) or is being reproduced reads the recording.
 */
export async function runWebCallStep(args: {
  workspaceId: string
  stepName: string
  call: PipelineWebCall
  parameters: Record<string, z.core.util.JSONType | undefined>
  session: WebCallSession
  deps: WebCallDeps
}): Promise<WebCallResult> {
  const { call, session, deps, stepName } = args

  const connection = await deps.loadConnection(
    args.workspaceId,
    call.connection,
  )

  if (!connection)
    throw new WebCallError(
      t('features.pipelineConnections.run.noConnection', {
        connection: call.connection,
      }),
    )

  if (connection.status !== 'active')
    throw new WebCallError(
      t('features.pipelineConnections.run.connectionOff', {
        connection: connection.name,
      }),
    )

  const url = webCallUrl(connection.baseUrl, call.path, args.parameters)
  const body = resolveWebCallBody(call.body, args.parameters)
  const digest = requestDigestOf(call.method, url.toString(), body)
  const key = recordKey(stepName, 0)
  const held = session.recorded.get(key)

  let response: RecordedResponse | null = null

  if (held) {
    // A recording of another request is not this step's answer.
    if (held.requestDigest !== digest)
      throw new WebCallError(
        t('features.pipelineConnections.run.requestChanged', {
          step: stepName,
        }),
      )
    response = held
  } else if (session.mode === 'replay') {
    throw new WebCallError(
      t('features.pipelineConnections.run.notRecorded', { step: stepName }),
    )
  } else if (session.mode === 'trial' && call.method !== 'GET') {
    response = (await session.latestFor?.(args.workspaceId, digest)) ?? null

    if (!response)
      throw new WebCallError(
        t('features.pipelineConnections.run.trialPost', { step: stepName }),
      )
  }

  if (!response) {
    const auth: Record<string, string> = {}

    if (call.secret) {
      const value = await deps.loadSecret(
        args.workspaceId,
        connection.id,
        call.secret,
      )

      if (!value || /[\r\n]/.test(value))
        throw new WebCallError(
          t('features.pipelineConnections.run.noSecret', {
            secret: call.secret,
            connection: connection.name,
          }),
        )

      auth[connection.authHeader.toLowerCase()] = connection.authScheme
        ? `${connection.authScheme} ${value}`
        : value
    }

    const headerMap = new Map<string, string>([
      ['accept', 'application/json'],
      ['user-agent', 'Sheetbase-Pipelines'],
    ])

    for (const [name, value] of Object.entries(auth)) headerMap.set(name, value)

    if (body !== undefined) headerMap.set('content-type', 'application/json')

    const headers = Object.fromEntries(headerMap)

    const answer = await ask(
      deps,
      {
        method: call.method,
        url,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connection.name,
    )

    // Only a good answer is recorded; the run fails on any other.
    if (answer.status < 200 || answer.status >= 300)
      throw new WebCallError(
        t('features.pipelineConnections.run.answered', {
          connection: connection.name,
          status: answer.status,
        }),
      )

    response = {
      stepName,
      seq: 0,
      method: call.method,
      url: url.toString(),
      requestDigest: digest,
      status: answer.status,
      contentType: answer.contentType,
      body: answer.body,
      bodyDigest: sha256Hex(answer.body),
      attempts: answer.attempts,
      fetchedAt: new Date().toISOString(),
    }

    // A trial leaves nothing behind; a real run keeps what it was told.
    if (session.mode === 'live') {
      session.recorded.set(key, response)
      session.collected.push(response)
    }
  }

  let parsed: z.core.util.JSONType

  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new WebCallError(
      t('features.pipelineConnections.run.notJson', {
        connection: connection.name,
      }),
    )
  }

  const rows = rowsFromAnswer(parsed, call.itemsPath)

  if (!rows)
    throw new WebCallError(
      t('features.pipelineConnections.run.noRows', {
        path: call.itemsPath ?? '',
      }),
    )

  return { rows, response }
}

/** What the manifest keeps of a response. */
export function manifestResponse(response: RecordedResponse): ManifestResponse {
  const url = new URL(response.url)

  return {
    step: response.stepName,
    method: response.method,
    url: `${url.origin}${url.pathname}`,
    status: response.status,
    requestDigest: response.requestDigest,
    bodyDigest: response.bodyDigest,
    fetchedAt: response.fetchedAt,
  }
}

// ---------------------------------------------------------------------------
// The real connections, secrets and network.
// ---------------------------------------------------------------------------

/** The call's outside world: the workspace's connections, sealed secrets, the network. */
export function defaultWebCallDeps(): WebCallDeps {
  return {
    async loadConnection(workspaceId, key) {
      const [{ db }, { pipelineConnections }, { and, eq }] = await Promise.all([
        import('#/db/client.server'),
        import('#/db/schema'),
        import('drizzle-orm'),
      ])

      const row = await db
        .select()
        .from(pipelineConnections)
        .where(
          and(
            eq(pipelineConnections.workspaceId, workspaceId),
            eq(pipelineConnections.key, key),
            eq(pipelineConnections.kind, 'web'),
          ),
        )
        .then((rows) => rows.at(0))

      return row
        ? {
            id: row.id,
            key: row.key,
            name: row.name,
            baseUrl: row.baseUrl,
            status: row.status,
            authHeader: row.authHeader,
            authScheme: row.authScheme,
          }
        : null
    },
    async loadSecret(workspaceId, connectionId, name) {
      const [
        { db },
        { pipelineConnectionSecrets },
        { and, eq },
        { openSecret, secretKey },
      ] = await Promise.all([
        import('#/db/client.server'),
        import('#/db/schema'),
        import('drizzle-orm'),
        import('./connector-secrets.server'),
      ])

      const row = await db
        .select({ ciphertext: pipelineConnectionSecrets.ciphertext })
        .from(pipelineConnectionSecrets)
        .where(
          and(
            eq(pipelineConnectionSecrets.workspaceId, workspaceId),
            eq(pipelineConnectionSecrets.connectionId, connectionId),
            eq(pipelineConnectionSecrets.secretName, name),
          ),
        )
        .then((rows) => rows.at(0))

      return row
        ? openSecret(Buffer.from(row.ciphertext).toString('utf8'), secretKey())
        : null
    },
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async resolveHost(host) {
      const found = await lookup(host, { all: true }).catch(() => [])

      return found.map((entry) => entry.address)
    },
    checkHostPolicy(url) {
      // The same allowlist and private-address switch every connector obeys.
      try {
        validateConnectorEndpointUrl(url)
      } catch (error) {
        throw new WebCallError(
          error instanceof Error
            ? error.message
            : t('features.pipelineConnections.run.forbiddenHost'),
        )
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Keeping and reading recordings.
// ---------------------------------------------------------------------------

interface RecordingConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

interface RecordingRow {
  step_name: string
  seq: number
  method: string
  url: string
  request_digest: string
  status: number
  content_type: string | null
  body: string
  body_digest: string
  attempts: number
  fetched_at: Date | string
}

const RECORDING_COLUMNS = `step_name, seq, method, url, request_digest, status,
  content_type, body, body_digest, attempts, fetched_at`

function fromRow(row: RecordingRow): RecordedResponse {
  return {
    stepName: row.step_name,
    seq: row.seq,
    method: row.method,
    url: row.url,
    requestDigest: row.request_digest,
    status: row.status,
    contentType: row.content_type,
    body: row.body,
    bodyDigest: row.body_digest,
    attempts: row.attempts,
    fetchedAt: new Date(row.fetched_at).toISOString(),
  }
}

/**
 * Do something with the internal table, then go back to the role the run had.
 * The table is internal: neither the request role nor the sandbox may touch it.
 */
async function asOwner<T>(
  conn: RecordingConnection,
  work: () => Promise<T>,
): Promise<T> {
  const { rows } = await conn.query<{ role: string; session: string }>(
    'SELECT current_user AS role, session_user AS session',
  )

  const was = rows.at(0)

  await conn.query('SET LOCAL ROLE NONE')

  try {
    return await work()
  } finally {
    if (was && was.role !== was.session)
      await conn.query(`SET LOCAL ROLE ${quoteRole(was.role)}`)
  }
}

/** What a run has already recorded. */
export async function loadRunResponses(
  conn: RecordingConnection,
  runId: string,
): Promise<RecordedResponse[]> {
  return asOwner(conn, async () => {
    const { rows } = await conn.query<RecordingRow>(
      `SELECT ${RECORDING_COLUMNS} FROM internal.pipeline_run_web_responses
        WHERE run_id = $1 ORDER BY step_name, seq`,
      [runId],
    )

    return rows.map(fromRow)
  })
}

/** The latest recording in the workspace of a request, for a trial of a POST. */
export function latestResponseFinder(conn: RecordingConnection) {
  return async (
    workspaceId: string,
    requestDigest: string,
  ): Promise<RecordedResponse | null> =>
    asOwner(conn, async () => {
      const { rows } = await conn.query<RecordingRow>(
        `SELECT ${RECORDING_COLUMNS} FROM internal.pipeline_run_web_responses
          WHERE workspace_id = $1 AND request_digest = $2
          ORDER BY fetched_at DESC LIMIT 1`,
        [workspaceId, requestDigest],
      )

      return rows[0] ? fromRow(rows[0]) : null
    })
}

/**
 * Keep what a run fetched. The table is internal, so the write leaves the
 * request role for the statement and comes back to it.
 */
export async function persistRunResponses(
  conn: RecordingConnection,
  run: { id: string; workspace_id: string },
  responses: readonly RecordedResponse[],
): Promise<void> {
  if (responses.length === 0) return

  await asOwner(conn, async () => {
    for (const r of responses)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- One connection, one statement at a time.
      await conn.query(
        `INSERT INTO internal.pipeline_run_web_responses
           (run_id, workspace_id, step_name, seq, method, url, request_digest,
            status, content_type, body, body_digest, attempts, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (run_id, step_name, seq) DO NOTHING`,
        [
          run.id,
          run.workspace_id,
          r.stepName,
          r.seq,
          r.method,
          r.url,
          r.requestDigest,
          r.status,
          r.contentType,
          r.body,
          r.bodyDigest,
          r.attempts,
          r.fetchedAt,
        ],
      )
  })
}

function quoteRole(role: string): string {
  return `"${role.replace(/"/g, '""')}"`
}

/** Everything a run recorded, as the manifest lists it. */
export async function runManifestResponses(
  conn: RecordingConnection,
  runId: string,
): Promise<ManifestResponse[]> {
  return (await loadRunResponses(conn, runId)).map(manifestResponse)
}
