/**
 * The web call step: ask another system for data, as a step of a pipeline.
 *
 * A step names a connection (an https address an administrator approved), a
 * method and a path, and may name one of the connection's secrets. Secrets are
 * named, never written: the value stays sealed beside the connection and only
 * the run that calls sees it. What comes back is read as rows for the next
 * step, and the answer is recorded with the run so a Reproduce reads it again
 * instead of asking.
 *
 * Browser-safe: the editor, the validator and the runner share these rules.
 */
import { z } from 'zod'

import { t } from '#/copy'

export const WEB_CALL_METHODS = ['GET', 'POST'] as const

export type WebCallMethod = (typeof WEB_CALL_METHODS)[number]

/** How long one call may take before it counts as failed, in milliseconds. */
export const WEB_CALL_TIMEOUT_MS = 20_000

/** How many times a failed call is tried again (a network error, a 429 or a 5xx). */
export const WEB_CALL_RETRIES = 3

/** The largest answer a call may bring back, in bytes. */
export const WEB_CALL_MAX_BYTES = 8 * 1024 * 1024

/** The most a recorded answer keeps with the run, in characters. Larger answers fail the call. */
export const WEB_CALL_MAX_PATH = 2000

export const WEB_CONNECTION_KEY_RE = /^[a-z][a-z0-9-]{0,48}$/
export const WEB_SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,48}$/
const ITEMS_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/
const PLACEHOLDER_RE = /\{parameters\.([a-z][a-z0-9_]{0,47})\}/g

/** What a web call step stores. */
export interface PipelineWebCall {
  /** The key of a connection (`api.pipeline_connections`). */
  connection: string
  method: WebCallMethod
  /** Starts with `/`; may hold `{parameters.name}`, filled in when the step runs. */
  path: string
  /** The name of one of the connection's secrets, sent as its auth header. */
  secret?: string
  /** POST only: a JSON object sent as the body. Values may hold `{parameters.name}`. */
  body?: Record<string, z.core.util.JSONType>
  /** Where the rows are in the answer, such as `data.items`. Empty means the answer itself. */
  itemsPath?: string
}

/** A web call as stored, one rule for each setting. A missing required one fails on its own field. */
const webCallSchema = z.looseObject({
  connection: z.string().regex(WEB_CONNECTION_KEY_RE),
  method: z.enum(WEB_CALL_METHODS),
  path: z
    .string()
    .regex(/^\/\S*$/)
    .max(WEB_CALL_MAX_PATH),
  secret: z.string().regex(WEB_SECRET_NAME_RE).optional(),
  itemsPath: z
    .union([z.literal(''), z.string().regex(ITEMS_PATH_RE)])
    .optional(),
  body: z.record(z.string(), z.json()).optional(),
})

const FIELD_MESSAGES = {
  connection: 'features.pipelineConnections.config.needsConnection',
  method: 'features.pipelineConnections.config.needsMethod',
  path: 'features.pipelineConnections.config.needsPath',
  secret: 'features.pipelineConnections.config.needsSecretName',
  itemsPath: 'features.pipelineConnections.config.needsItemsPath',
  body: 'features.pipelineConnections.config.bodyIsObject',
} as const

const isField = (name: PropertyKey): name is keyof typeof FIELD_MESSAGES =>
  Object.hasOwn(FIELD_MESSAGES, name)

type Json = z.core.util.JSONType

type JsonObject = { [key: string]: Json }

/** What kind of JSON value this is: the one place a value's shape is read. */
function kindOf(value: Json | undefined): 'text' | 'list' | 'object' | 'other' {
  if (Array.isArray(value)) return 'list'

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A JSON value has no schema beyond its own shape; this reads it once for every walker below.
  const kind = typeof value

  if (kind === 'string') return 'text'

  return value !== null && kind === 'object' ? 'object' : 'other'
}

const isObject = (value: Json | undefined): value is JsonObject =>
  value !== undefined && value !== null && kindOf(value) === 'object'

/** The parameter names a path or body refers to. */
export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((match) => match[1])
}

const bodyText = (body: PipelineWebCall['body']): string =>
  JSON.stringify(body) ?? ''

/**
 * What is wrong with a web call, in words for the person editing it, or null.
 * `parameters` are the pipeline's parameter names, so a placeholder that
 * points at nothing is caught before a run.
 */
export function webCallProblem(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored step is checked by webCallSchema in the first line.
  raw: unknown,
  parameters: readonly string[],
): { field: string; message: string } | null {
  const decoded = webCallSchema.safeParse(raw)

  if (!decoded.success) {
    const field = decoded.error.issues.at(0)?.path.at(0)

    if (field === undefined || !isField(field))
      return {
        field: '',
        message: t('features.pipelineConnections.config.needsSettings'),
      }

    return { field, message: t(FIELD_MESSAGES[field]) }
  }

  const call = decoded.data

  if (call.body !== undefined && call.method === 'GET')
    return {
      field: 'body',
      message: t('features.pipelineConnections.config.getHasNoBody'),
    }

  const known = new Set(parameters)

  const unknown = placeholderNames(`${call.path}${bodyText(call.body)}`).find(
    (name) => !known.has(name),
  )

  if (unknown)
    return {
      field: 'path',
      message: t('features.pipelineConnections.config.unknownParameter', {
        name: unknown,
      }),
    }

  return null
}

type Parameters = Record<string, z.core.util.JSONType | undefined>

function parameterText(value: Json | undefined): string {
  if (value === undefined || value === null) return ''

  return kindOf(value) === 'text' ? String(value) : JSON.stringify(value)
}

/**
 * The path as it is called: each `{parameters.name}` replaced by the
 * parameter's value, made safe for a URL.
 */
export function resolveWebCallPath(
  path: string,
  parameters: Parameters,
): string {
  return path.replace(PLACEHOLDER_RE, (_whole, name: string) =>
    encodeURIComponent(parameterText(parameters[name])),
  )
}

/** The body with each `{parameters.name}` inside its text values filled in. */
export function resolveWebCallBody(
  body: PipelineWebCall['body'],
  parameters: Parameters,
): PipelineWebCall['body'] {
  if (!body) return body

  const fill = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(fill)

    if (kindOf(value) === 'text')
      return String(value).replace(PLACEHOLDER_RE, (_whole, name: string) =>
        parameterText(parameters[name]),
      )

    if (isObject(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, fill(entry)]),
      )

    return value
  }

  return z.record(z.string(), z.json()).parse(fill(body))
}

/** The rows of an answer. */
type Row = Record<string, Json>

function flatten(value: Json): Json {
  const kind = kindOf(value)

  return kind === 'object' || kind === 'list' ? JSON.stringify(value) : value
}

function asRow(value: Json) {
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, flatten(entry)]),
    )

  return { value: flatten(value) }
}

/**
 * Read a JSON answer as rows. A list becomes one row for each item; one object
 * becomes one row; anything else becomes one row with a `value` column. An
 * item that is itself a list or an object is kept in its column as text.
 * Returns null when `itemsPath` leads nowhere.
 */
export function rowsFromAnswer(
  answer: z.core.util.JSONType,
  itemsPath: string | undefined,
): Row[] | null {
  let found: z.core.util.JSONType | undefined = answer

  for (const part of itemsPath ? itemsPath.split('.') : []) {
    found =
      isObject(found) && Object.hasOwn(found, part) ? found[part] : undefined

    if (found === undefined) return null
  }

  if (found === undefined) return null

  return Array.isArray(found) ? found.map(asRow) : [asRow(found)]
}

/** One line for the step list: `GET /batches?project=AAV9-PT on LIMS`. */
export function webCallSummary(
  call: Pick<PipelineWebCall, 'method' | 'path'>,
  connectionName: string | undefined,
): string {
  const where = connectionName
    ? t('features.pipelineConnections.step.summary', {
        method: call.method,
        path: call.path,
        connection: connectionName,
      })
    : `${call.method} ${call.path}`

  return where
}
