/**
 * Runs the work an extension declared: a signed webhook call or a Python
 * function in the isolated runner. Server-only, because the signing key and
 * the runner token never leave the server.
 *
 * Every call goes through one gate: the install must exist in the caller's
 * workspace, be enabled, have the point switched on, and declare the item.
 * Inputs are checked against what the extension declared before anything
 * leaves the server, and the answer is checked on the way back. The call acts
 * for the person who asked (their id is in the audit event); the extension
 * receives no credential and no way to write canonical data. Each call is
 * written to the workspace's change log as `extension.invoked`.
 */
import { createHmac } from 'node:crypto'

import {
  openSecret,
  sealSecret,
  secretKey,
} from '#/lib/connector-secrets.server'
import { generateSigningSecret } from '#/lib/webhook-signing'

import { validateConnectorEndpointUrl } from '../connectors/enterprise/host-policy.server'
import { executePythonTransform } from '../pipeline-python.server'
import type { PythonTransformInput } from '../pipeline-python.server'
import { extensionAuditIdentity } from './contract'
import { parseExtensionManifest } from './manifest'
import type { ExtensionManifest } from './manifest'
import type {
  ExtensionAnalysisKindDeclaration,
  ExtensionAssistantToolDeclaration,
  ExtensionField,
  ExtensionPipelineActionDeclaration,
  ExtensionRunner,
  ExtensionRunnerPoint,
} from './points'

export const EXTENSION_WEBHOOK_TIMEOUT_MS = 30_000
export const EXTENSION_WEBHOOK_RESPONSE_BYTES = 1024 * 1024

export class ExtensionRunError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExtensionRunError'
    this.code = code
  }
}

export interface ExtensionInstallRow {
  id: string
  key: string
  name: string
  status: string
  manifest: unknown
  disabledPoints: string[]
}

export interface ExtensionRuntimeDeps {
  loadInstall: (
    workspaceId: string,
    key: string,
  ) => Promise<ExtensionInstallRow | null>
  loadSecret: (workspaceId: string, extensionId: string) => Promise<string>
  fetch: typeof fetch
  executePython: typeof executePythonTransform
  audit: (event: {
    workspaceId: string
    actorUserId: string
    extensionId: string
    payload: Record<string, unknown>
  }) => Promise<void>
  now: () => number
}

// ---------------------------------------------------------------------------
// Declared values.
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/

function matches(type: ExtensionField['type'], value: unknown): boolean {
  switch (type) {
    case 'text':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && DATE.test(value)
    case 'json':
      return value !== undefined
  }
}

/**
 * Checks a value against declared fields. Returns only the declared fields;
 * a missing required one or a wrong type is a plain, named error.
 */
export function checkDeclaredValues(
  fields: readonly ExtensionField[],
  value: unknown,
  what: 'input' | 'answer',
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExtensionRunError(
      what === 'input' ? 'bad_input' : 'bad_answer',
      what === 'input'
        ? 'The input has to be an object of named values.'
        : 'The extension’s answer is not an object of named values.',
    )
  }
  const given = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const present =
      given[field.name] !== undefined && given[field.name] !== null
    if (!present) {
      if (field.required)
        throw new ExtensionRunError(
          what === 'input' ? 'bad_input' : 'bad_answer',
          what === 'input'
            ? `“${field.name}” is needed.`
            : `The extension’s answer is missing “${field.name}”.`,
        )
      continue
    }
    if (!matches(field.type, given[field.name])) {
      throw new ExtensionRunError(
        what === 'input' ? 'bad_input' : 'bad_answer',
        `“${field.name}” should be ${field.type === 'json' ? 'a value' : `a ${field.type}`}.`,
      )
    }
    out[field.name] = given[field.name]
  }
  if (what === 'input') {
    const unknownKey = Object.keys(given).find(
      (key) => !fields.some((field) => field.name === key),
    )
    if (unknownKey)
      throw new ExtensionRunError(
        'bad_input',
        `“${unknownKey}” is not something this extension reads.`,
      )
  }
  return out
}

// ---------------------------------------------------------------------------
// Webhook runner.
// ---------------------------------------------------------------------------

/**
 * `sha256=<hex>` over `<timestamp>.` followed by the exact request body. The
 * same envelope the parser webhooks use, so a service verifies both alike.
 */
export function signExtensionRequest(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex')}`
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > EXTENSION_WEBHOOK_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ExtensionRunError(
        'bad_answer',
        'The extension’s answer is too large to read.',
      )
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function callWebhook(
  deps: ExtensionRuntimeDeps,
  call: {
    url: string
    secret: string
    body: Record<string, unknown>
    manifest: ExtensionManifest
    point: ExtensionRunnerPoint
    itemId: string
  },
): Promise<unknown> {
  let url: URL
  try {
    url = validateConnectorEndpointUrl(call.url)
  } catch (error) {
    throw new ExtensionRunError(
      'address_refused',
      error instanceof Error
        ? error.message
        : 'The extension’s address is refused.',
    )
  }
  const body = JSON.stringify(call.body)
  const timestamp = String(Math.floor(deps.now() / 1000))
  let response: Response
  try {
    response = await deps.fetch(url, {
      method: 'POST',
      // Never follow a redirect: the address was checked, where it points isn't.
      redirect: 'error',
      signal: AbortSignal.timeout(EXTENSION_WEBHOOK_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Sheetbase-Extension/1',
        'x-sheetbase-extension': `${call.manifest.id}@${call.manifest.version}`,
        'x-sheetbase-point': `${call.point}:${call.itemId}`,
        'x-sheetbase-timestamp': timestamp,
        'x-sheetbase-signature': signExtensionRequest(
          call.secret,
          timestamp,
          body,
        ),
      },
      body,
    })
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ExtensionRunError(
        'timeout',
        'The extension didn’t answer in time.',
      )
    }
    throw new ExtensionRunError(
      'unreachable',
      'The extension couldn’t be reached.',
    )
  }
  const text = await readLimited(response)
  let answer: unknown = null
  try {
    answer = text ? JSON.parse(text) : null
  } catch {
    answer = null
  }
  if (!response.ok) {
    const message =
      answer &&
      typeof answer === 'object' &&
      'error' in answer &&
      (answer as { error?: { message?: unknown } }).error &&
      typeof (answer as { error: { message?: unknown } }).error.message ===
        'string'
        ? (answer as { error: { message: string } }).error.message
            .trim()
            .slice(0, 500)
        : `The extension answered with status ${response.status}.`
    throw new ExtensionRunError('refused', message)
  }
  if (
    answer === null ||
    typeof answer !== 'object' ||
    Array.isArray(answer) ||
    !('output' in answer)
  ) {
    throw new ExtensionRunError(
      'bad_answer',
      'The extension didn’t answer with { "output": … }.',
    )
  }
  return answer.output
}

// ---------------------------------------------------------------------------
// Python runner.
// ---------------------------------------------------------------------------

/** The step Sheetbase runs for a function-style runner: `run(input)` returns an object. */
export function pythonFunctionStatement(code: string): string {
  return `${code}\n\n\ndef transform(inputs, parameters):\n    return [run(parameters["input"])]\n`
}

/** The step for an analysis kind: `run(data)` gets a DataFrame and returns rows or a DataFrame. */
export function pythonAnalysisStatement(code: string): string {
  return `${code}\n\n\ndef transform(inputs, parameters):\n    import pandas as pd\n    return run(pd.DataFrame(inputs["data"]))\n`
}

function pythonMessage(error: unknown): ExtensionRunError {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'python_failed'
  return new ExtensionRunError(code, message.slice(0, 500))
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

export interface ResolvedInstall {
  install: ExtensionInstallRow
  manifest: ExtensionManifest
}

/** Loads an install and refuses unless it is enabled with `point` switched on. */
export async function openExtensionPoint(
  deps: Pick<ExtensionRuntimeDeps, 'loadInstall'>,
  workspaceId: string,
  key: string,
  point: ExtensionRunnerPoint,
): Promise<ResolvedInstall> {
  const install = await deps.loadInstall(workspaceId, key)
  if (!install) {
    throw new ExtensionRunError(
      'not_installed',
      'That extension is no longer installed in this workspace.',
    )
  }
  if (install.status !== 'enabled') {
    throw new ExtensionRunError(
      'not_enabled',
      'That extension is no longer enabled in this workspace.',
    )
  }
  if (install.disabledPoints.includes(point)) {
    throw new ExtensionRunError(
      'point_off',
      'An administrator has switched this part of the extension off.',
    )
  }
  let manifest: ExtensionManifest
  try {
    manifest = parseExtensionManifest(install.manifest)
  } catch {
    throw new ExtensionRunError(
      'bad_manifest',
      'That extension’s declaration can’t be read.',
    )
  }
  return { install, manifest }
}

export interface InvokeArgs {
  workspaceId: string
  actorUserId: string
  extensionKey: string
  point: 'pipeline-actions' | 'assistant-tools'
  itemId: string
  input: unknown
}

export interface InvokeResult {
  output: Record<string, unknown>
  runner: ExtensionRunner['kind']
  durationMs: number
}

function audit(
  deps: ExtensionRuntimeDeps,
  args: {
    workspaceId: string
    actorUserId: string
    resolved: ResolvedInstall
    point: ExtensionRunnerPoint
    itemId: string
    ok: boolean
    runner: string
    durationMs: number
    error?: string
  },
): Promise<void> {
  return deps
    .audit({
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      extensionId: args.resolved.install.id,
      payload: {
        change: 'invoked',
        extensionKey: args.resolved.install.key,
        point: args.point,
        itemId: args.itemId,
        ok: args.ok,
        runner: args.runner,
        durationMs: args.durationMs,
        ...(args.error ? { error: args.error.slice(0, 300) } : {}),
        ...extensionAuditIdentity({
          extensionId: args.resolved.install.id,
          extensionKey: args.resolved.install.key,
          manifest: args.resolved.manifest,
        }),
      },
    })
    .catch(() => undefined)
}

/** Runs one pipeline action or assistant tool of an extension. */
export async function invokeExtension(
  args: InvokeArgs,
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<InvokeResult> {
  const resolved = await openExtensionPoint(
    deps,
    args.workspaceId,
    args.extensionKey,
    args.point,
  )
  const declaration:
    | ExtensionPipelineActionDeclaration
    | ExtensionAssistantToolDeclaration
    | undefined = (
    resolved.manifest.contributions[args.point] as
      | Array<
          ExtensionPipelineActionDeclaration | ExtensionAssistantToolDeclaration
        >
      | undefined
  )?.find((entry) => entry.id === args.itemId)
  if (!declaration) {
    throw new ExtensionRunError(
      'not_declared',
      'That extension doesn’t offer this any more.',
    )
  }
  const input = checkDeclaredValues(declaration.inputs, args.input, 'input')
  const started = deps.now()
  let output: unknown
  try {
    if (declaration.runner.kind === 'webhook') {
      output = await callWebhook(deps, {
        url: declaration.runner.url,
        secret: await deps.loadSecret(args.workspaceId, resolved.install.id),
        body: {
          input,
          context: {
            extension: resolved.manifest.id,
            version: resolved.manifest.version,
            point: args.point,
            id: args.itemId,
          },
        },
        manifest: resolved.manifest,
        point: args.point,
        itemId: args.itemId,
      })
    } else {
      let result
      try {
        result = await deps.executePython({
          statement: pythonFunctionStatement(declaration.runner.code),
          inputs: {},
          parameters: { input },
        } satisfies PythonTransformInput)
      } catch (error) {
        throw pythonMessage(error)
      }
      output = result.rows.at(0) ?? {}
    }
    const checked =
      args.point === 'pipeline-actions'
        ? checkDeclaredValues(
            (declaration as ExtensionPipelineActionDeclaration).outputs,
            output,
            'answer',
          )
        : output !== null &&
            typeof output === 'object' &&
            !Array.isArray(output)
          ? (output as Record<string, unknown>)
          : { result: output }
    const durationMs = deps.now() - started
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: args.point,
      itemId: args.itemId,
      ok: true,
      runner: declaration.runner.kind,
      durationMs,
    })
    return { output: checked, runner: declaration.runner.kind, durationMs }
  } catch (error) {
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: args.point,
      itemId: args.itemId,
      ok: false,
      runner: declaration.runner.kind,
      durationMs: deps.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export interface AnalysisArgs {
  workspaceId: string
  actorUserId: string
  extensionKey: string
  kindId: string
  /** Declared input name to the rows' values, one object per dataset row. */
  rows: Array<Record<string, unknown>>
}

export interface AnalysisOutcome {
  columns: ExtensionAnalysisKindDeclaration['result']['columns']
  rows: Array<Record<string, unknown>>
  chart: ExtensionAnalysisKindDeclaration['result']['chart'] | null
  durationMs: number
}

/** Runs an analysis kind on rows the caller already read, in the isolated runner. */
export async function runExtensionAnalysis(
  args: AnalysisArgs,
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<AnalysisOutcome> {
  const resolved = await openExtensionPoint(
    deps,
    args.workspaceId,
    args.extensionKey,
    'analysis-kinds',
  )
  const declaration = resolved.manifest.contributions['analysis-kinds']?.find(
    (entry) => entry.id === args.kindId,
  )
  if (!declaration) {
    throw new ExtensionRunError(
      'not_declared',
      'That extension doesn’t offer this any more.',
    )
  }
  const started = deps.now()
  try {
    let result
    try {
      result = await deps.executePython({
        statement: pythonAnalysisStatement(declaration.runner.code),
        inputs: { data: args.rows },
        parameters: {},
        contract: {
          output: {
            columns: declaration.result.columns.map((column) => ({
              name: column.name,
              type: column.type === 'number' ? 'decimal' : 'text',
              nullable: true,
            })),
            additionalColumns: false,
          },
        },
      })
    } catch (error) {
      throw pythonMessage(error)
    }
    const durationMs = deps.now() - started
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: 'analysis-kinds',
      itemId: args.kindId,
      ok: true,
      runner: 'python',
      durationMs,
    })
    return {
      columns: declaration.result.columns,
      rows: result.rows,
      chart: declaration.result.chart ?? null,
      durationMs,
    }
  } catch (error) {
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: 'analysis-kinds',
      itemId: args.kindId,
      ok: false,
      runner: 'python',
      durationMs: deps.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Database-backed defaults and the signing key.
// ---------------------------------------------------------------------------

export function defaultDeps(): ExtensionRuntimeDeps {
  return {
    fetch,
    executePython: executePythonTransform,
    now: () => Date.now(),
    loadInstall: async (workspaceId, key) => {
      const { db } = await import('#/db/client.server')
      const { extensions } = await import('#/db/schema')
      const { and, eq } = await import('drizzle-orm')
      const rows = await db
        .select({
          id: extensions.id,
          key: extensions.key,
          name: extensions.name,
          status: extensions.status,
          manifest: extensions.manifest,
          disabledPoints: extensions.disabledPoints,
        })
        .from(extensions)
        .where(
          and(eq(extensions.workspaceId, workspaceId), eq(extensions.key, key)),
        )
      return rows.at(0) ?? null
    },
    loadSecret: loadExtensionSecret,
    audit: async ({ workspaceId, actorUserId, extensionId, payload }) => {
      const { db } = await import('#/db/client.server')
      const { sql } = await import('drizzle-orm')
      await db.execute(
        sql`SELECT internal.emit_change_event_as_actor(
          ${actorUserId}, ${workspaceId}::uuid, 'extension', ${extensionId}::uuid,
          'update', NULL, NULL, ${JSON.stringify(payload)}::jsonb)`,
      )
    },
  }
}

/** Makes (or replaces) the signing key and returns it once, in the clear. */
export async function rotateExtensionSecret(input: {
  workspaceId: string
  extensionId: string
  userId: string | null
}): Promise<string> {
  const { db } = await import('#/db/client.server')
  const { extensionSecrets } = await import('#/db/schema')
  const secret = generateSigningSecret()
  const ciphertext = Buffer.from(sealSecret(secret, secretKey()), 'utf8')
  await db
    .insert(extensionSecrets)
    .values({
      extensionId: input.extensionId,
      workspaceId: input.workspaceId,
      ciphertext,
      createdByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: extensionSecrets.extensionId,
      set: { ciphertext, updatedAt: new Date() },
    })
  return secret
}

export async function loadExtensionSecret(
  workspaceId: string,
  extensionId: string,
): Promise<string> {
  const { db } = await import('#/db/client.server')
  const { extensionSecrets } = await import('#/db/schema')
  const { eq } = await import('drizzle-orm')
  const rows = await db
    .select({
      workspaceId: extensionSecrets.workspaceId,
      ciphertext: extensionSecrets.ciphertext,
    })
    .from(extensionSecrets)
    .where(eq(extensionSecrets.extensionId, extensionId))
  const row = rows.at(0)
  if (!row || row.workspaceId !== workspaceId) {
    throw new ExtensionRunError(
      'no_key',
      'This extension has no signing key yet. An administrator can make one on the Extensions page.',
    )
  }
  return openSecret(Buffer.from(row.ciphertext).toString('utf8'), secretKey())
}

/** Which installs of a workspace already have a signing key. */
export async function extensionsWithSecret(
  workspaceId: string,
): Promise<Set<string>> {
  const { db } = await import('#/db/client.server')
  const { extensionSecrets } = await import('#/db/schema')
  const { eq } = await import('drizzle-orm')
  const rows = await db
    .select({ extensionId: extensionSecrets.extensionId })
    .from(extensionSecrets)
    .where(eq(extensionSecrets.workspaceId, workspaceId))
  return new Set(rows.map((row) => row.extensionId))
}
