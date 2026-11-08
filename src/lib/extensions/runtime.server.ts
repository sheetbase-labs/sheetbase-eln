/**
 * Runs the work a plugin declared: one Python function of its package in the
 * isolated runner (no network, no database, no files but the plugin's own).
 * Server-only.
 *
 * Every call goes through one gate: the install must exist in the caller's
 * workspace, be enabled, have the point switched on, and declare the item.
 * Inputs are checked against what the plugin declared before anything leaves
 * the server, and the answer is checked on the way back. The call acts for the
 * person who asked (their id is in the audit event); the plugin receives no
 * credential and no way to write canonical data. Each call is written to the
 * workspace's change log as `extension.invoked`.
 */
import { executePythonTransform } from '../pipeline-python.server'
import type { PythonTransformInput } from '../pipeline-python.server'
import { extensionAuditIdentity } from './contract'
import { findCallable } from './callables'
import type { CallableItem } from './callables'
import { parseExtensionManifest } from './manifest'
import type { ExtensionManifest } from './manifest'
import type {
  ExtensionAnalysisKindDeclaration,
  ExtensionField,
  ExtensionRunnerPoint,
} from './points'
import { pluginStatement } from './python-host.server'
import { parseActionResult, parseScreenResult } from './screens'
import type { ActionResult, ScreenResult } from './screens'
import type {
  ExtensionColumnDeclaration,
  ExtensionColumnValueType,
} from './hooks'

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
  /** The plugin's Python files by path, as uploaded. */
  loadPackage: (
    workspaceId: string,
    extensionId: string,
  ) => Promise<Record<string, string> | null>
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
        : 'The plugin’s answer is not an object of named values.',
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
            : `The plugin’s answer is missing “${field.name}”.`,
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
        `“${unknownKey}” is not something this plugin reads.`,
      )
  }
  return out
}

// ---------------------------------------------------------------------------
// Python runner.
// ---------------------------------------------------------------------------

/** What a failure in the plugin's code says to the person: its own refusal word for word, a crash as a crash. */
function pythonMessage(error: unknown): ExtensionRunError {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.startsWith('PluginError: '))
    return new ExtensionRunError('plugin_refused', raw.slice(13, 513))
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'python_failed'
  return new ExtensionRunError(
    code,
    code === 'runner_unavailable' || code === 'transform_timed_out'
      ? raw.slice(0, 500)
      : `The plugin stopped with an error. ${raw}`.slice(0, 500),
  )
}

export async function runPackage(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
  resolved: ResolvedInstall,
  job: Pick<PythonTransformInput, 'inputs' | 'parameters'> &
    Partial<Pick<PythonTransformInput, 'contract'>>,
) {
  const files = await deps.loadPackage(workspaceId, resolved.install.id)
  if (!files)
    throw new ExtensionRunError(
      'no_package',
      'This plugin has no code installed. Upload it again from Settings › Plugins.',
    )
  try {
    return await deps.executePython({
      statement: pluginStatement(files),
      ...job,
    })
  } catch (error) {
    throw pythonMessage(error)
  }
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
  const resolved = await openInstall(deps, workspaceId, key)
  assertPointOn(resolved.install, point)
  return resolved
}

function assertPointOn(
  install: ExtensionInstallRow,
  point: ExtensionRunnerPoint,
) {
  if (install.disabledPoints.includes(point)) {
    throw new ExtensionRunError(
      'point_off',
      'An administrator has switched this part of the plugin off.',
    )
  }
}

async function openInstall(
  deps: Pick<ExtensionRuntimeDeps, 'loadInstall'>,
  workspaceId: string,
  key: string,
): Promise<ResolvedInstall> {
  const install = await deps.loadInstall(workspaceId, key)
  if (!install) {
    throw new ExtensionRunError(
      'not_installed',
      'That plugin is no longer installed in this workspace.',
    )
  }
  if (install.status !== 'enabled') {
    throw new ExtensionRunError(
      'not_enabled',
      'That plugin is no longer enabled in this workspace.',
    )
  }
  let manifest: ExtensionManifest
  try {
    manifest = parseExtensionManifest(install.manifest)
  } catch {
    throw new ExtensionRunError(
      'bad_manifest',
      'That plugin’s declaration can’t be read.',
    )
  }
  return { install, manifest }
}

/**
 * Finds what a name points at (an operation, a calculator or a pipeline step)
 * and refuses unless the plugin is enabled and that part is switched on.
 */
export async function openCallable(
  deps: Pick<ExtensionRuntimeDeps, 'loadInstall'>,
  workspaceId: string,
  key: string,
  itemId: string,
): Promise<ResolvedInstall & { callable: CallableItem }> {
  const resolved = await openInstall(deps, workspaceId, key)
  const callable = findCallable(resolved.manifest, itemId)
  if (!callable) {
    throw new ExtensionRunError(
      'not_declared',
      'That plugin doesn’t offer this any more.',
    )
  }
  assertPointOn(resolved.install, callable.point)
  return { ...resolved, callable }
}

export interface InvokeArgs {
  workspaceId: string
  actorUserId: string
  extensionKey: string
  /** An operation, calculator or pipeline step id. */
  itemId: string
  input: unknown
}

export interface InvokeResult {
  output: Record<string, unknown>
  runner: 'python'
  durationMs: number
}

export function audit(
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

/** Runs one pipeline action, assistant tool, calculator or step of an extension. */
export async function invokeExtension(
  args: InvokeArgs,
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<InvokeResult> {
  const resolved = await openCallable(
    deps,
    args.workspaceId,
    args.extensionKey,
    args.itemId,
  )
  const { callable } = resolved
  const declaration = callable.declaration
  const input = checkDeclaredValues(declaration.inputs, args.input, 'input')
  const started = deps.now()
  try {
    const step = callable.runKind === 'step'
    const tables: Record<string, Array<Record<string, unknown>>> = {}
    const settings: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(input)) {
      if (step && callable.tableNames.includes(name)) {
        if (
          !Array.isArray(value) ||
          !value.every((row) => row && typeof row === 'object')
        )
          throw new ExtensionRunError(
            'bad_input',
            `“${name}” should be a list of rows, each an object of column values.`,
          )
        tables[name] = value as Array<Record<string, unknown>>
      } else settings[name] = value
    }
    const stepDeclaration = step
      ? resolved.manifest.contributions['pipeline-steps']?.find(
          (entry) => entry.id === callable.id,
        )
      : undefined
    const result = await runPackage(deps, args.workspaceId, resolved, {
      inputs: tables,
      parameters: {
        kind: callable.runKind,
        entry: declaration.runner.entry,
        input: settings,
      },
      ...(stepDeclaration
        ? { contract: columnContract(stepDeclaration.result.columns) }
        : {}),
    })
    const output = step
      ? { rows: result.rows }
      : checkDeclaredValues(
          declaration.outputs,
          result.rows.at(0) ?? {},
          'answer',
        )
    const durationMs = deps.now() - started
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: callable.point,
      itemId: args.itemId,
      ok: true,
      runner: 'python',
      durationMs,
    })
    return { output, runner: 'python', durationMs }
  } catch (error) {
    await audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point: callable.point,
      itemId: args.itemId,
      ok: false,
      runner: 'python',
      durationMs: deps.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/** The contract the runner enforces on a table a plugin returns. */
export function columnContract(
  columns: ReadonlyArray<{ name: string; type: 'number' | 'text' }>,
) {
  return {
    output: {
      columns: columns.map((column) => ({
        name: column.name,
        type:
          column.type === 'number' ? ('decimal' as const) : ('text' as const),
        nullable: true,
      })),
      additionalColumns: false,
    },
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
      'That plugin doesn’t offer this any more.',
    )
  }
  const started = deps.now()
  try {
    const result = await runPackage(deps, args.workspaceId, resolved, {
      inputs: { data: args.rows },
      parameters: { kind: 'analysis', entry: declaration.runner.entry },
      contract: columnContract(declaration.result.columns),
    })
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
// Screens, columns and actions.
// ---------------------------------------------------------------------------

const MAX_HOOK_ROWS = 5000
const MAX_CONTEXT_BYTES = 1024 * 1024

export type HookArgs = {
  workspaceId: string
  actorUserId: string
  extensionKey: string
} & (
  | {
      kind: 'screen'
      point: 'blocks' | 'panels'
      itemId: string
      context: Record<string, unknown>
      state: unknown
      event: { action: string; values: Record<string, unknown> } | null
    }
  | {
      kind: 'column'
      itemId: string
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'column-action'
      itemId: string
      actionId: string
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'row-action'
      itemId: string
      rows: Array<Record<string, unknown>>
    }
)

export type HookOutcome =
  | ({ kind: 'screen'; durationMs: number } & ScreenResult)
  | {
      kind: 'column'
      values: Array<string | number | boolean | null>
      value: ExtensionColumnValueType
      durationMs: number
    }
  | ({ kind: 'action'; durationMs: number } & ActionResult)

function columnValue(
  type: ExtensionColumnValueType,
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) return null
  const ok =
    (type === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value)) ||
    ((type === 'text' || type === 'svg') &&
      typeof value === 'string' &&
      value.length <= 100_000) ||
    (type === 'boolean' && typeof value === 'boolean')
  if (!ok)
    throw new ExtensionRunError(
      'bad_answer',
      `The plugin’s column gave a value that isn’t ${type === 'number' ? 'a number' : type === 'boolean' ? 'true or false' : 'text'}.`,
    )
  return value
}

function checkRows(rows: Array<Record<string, unknown>>, inputs?: string[]) {
  if (rows.length > MAX_HOOK_ROWS)
    throw new ExtensionRunError(
      'bad_input',
      `That is more than ${MAX_HOOK_ROWS} rows, which is too many to send to a plugin at once.`,
    )
  if (!inputs) return rows
  const keep = new Set(['id', ...inputs])
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => keep.has(key))),
  )
}

/** Runs a screen, a computed column, or a row or column action of a plugin. */
export async function runExtensionHook(
  args: HookArgs,
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<HookOutcome> {
  const point =
    args.kind === 'screen'
      ? args.point
      : args.kind === 'row-action'
        ? 'row-actions'
        : 'columns'
  const resolved = await openExtensionPoint(
    deps,
    args.workspaceId,
    args.extensionKey,
    point,
  )
  const gone = () =>
    new ExtensionRunError(
      'not_declared',
      'That plugin doesn’t offer this any more.',
    )
  const contributions = resolved.manifest.contributions
  let entry: string
  let job: Pick<PythonTransformInput, 'inputs' | 'parameters'>
  let column: ExtensionColumnDeclaration | undefined
  let rowsGiven: Array<Record<string, unknown>> = []
  if (args.kind === 'screen') {
    const declared = (
      args.point === 'blocks' ? contributions.blocks : contributions.panels
    )?.find((item) => item.id === args.itemId)
    if (!declared?.screen) throw gone()
    if (
      new TextEncoder().encode(JSON.stringify([args.context, args.state]))
        .length > MAX_CONTEXT_BYTES
    )
      throw new ExtensionRunError(
        'bad_input',
        'That is too much data for a screen.',
      )
    entry = declared.screen.entry
    job = {
      inputs: {},
      parameters: {
        kind: 'screen',
        entry,
        input: {
          context: args.context,
          state: args.state ?? null,
          event: args.event,
        },
      },
    }
  } else if (args.kind === 'row-action') {
    const declared = contributions['row-actions']?.find(
      (item) => item.id === args.itemId,
    )
    if (!declared) throw gone()
    if (declared.selection === 'one' && args.rows.length !== 1)
      throw new ExtensionRunError(
        'bad_input',
        'Choose exactly one row for this.',
      )
    if (args.rows.length === 0)
      throw new ExtensionRunError('bad_input', 'Choose at least one row.')
    rowsGiven = checkRows(args.rows, declared.inputs)
    entry = declared.runner.entry
    job = {
      inputs: {},
      parameters: { kind: 'action', entry, input: { rows: rowsGiven } },
    }
  } else {
    column = contributions.columns?.find((item) => item.id === args.itemId)
    if (!column) throw gone()
    rowsGiven = checkRows(args.rows, column.inputs)
    if (args.kind === 'column') {
      entry = column.runner.entry
      job = {
        inputs: { data: rowsGiven },
        parameters: { kind: 'column', entry },
      }
    } else {
      const action = column.actions?.find((item) => item.id === args.actionId)
      if (!action) throw gone()
      entry = action.runner.entry
      job = {
        inputs: {},
        parameters: { kind: 'action', entry, input: { rows: rowsGiven } },
      }
    }
  }
  const itemId = args.itemId
  const started = deps.now()
  const record = (ok: boolean, error?: unknown) =>
    audit(deps, {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      resolved,
      point,
      itemId,
      ok,
      runner: 'python',
      durationMs: deps.now() - started,
      ...(error
        ? { error: error instanceof Error ? error.message : String(error) }
        : {}),
    })
  try {
    const result = await runPackage(deps, args.workspaceId, resolved, job)
    const first = result.rows.at(0) ?? {}
    const durationMs = deps.now() - started
    let outcome: HookOutcome
    if (args.kind === 'screen') {
      const parsed = parseScreenResult(first)
      if (!parsed.ok)
        throw new ExtensionRunError(
          'bad_answer',
          `The plugin’s screen can’t be drawn: ${parsed.errors.slice(0, 3).join('; ')}`,
        )
      outcome = { kind: 'screen', durationMs, ...parsed.result }
    } else if (args.kind === 'column') {
      const values = first.values
      if (!Array.isArray(values) || values.length !== rowsGiven.length)
        throw new ExtensionRunError(
          'bad_answer',
          'The plugin’s column has to give one value for every row.',
        )
      outcome = {
        kind: 'column',
        values: values.map((value) => columnValue(column!.value, value)),
        value: column!.value,
        durationMs,
      }
    } else {
      const parsed = parseActionResult(first)
      if (!parsed.ok)
        throw new ExtensionRunError(
          'bad_answer',
          `The plugin’s answer can’t be used: ${parsed.errors.slice(0, 3).join('; ')}`,
        )
      outcome = { kind: 'action', durationMs, ...parsed.result }
    }
    await record(true)
    return outcome
  } catch (error) {
    await record(false, error)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Database-backed defaults and the signing key.
// ---------------------------------------------------------------------------

export function defaultDeps(): ExtensionRuntimeDeps {
  return {
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
    loadPackage: async (workspaceId, extensionId) => {
      const { db } = await import('#/db/client.server')
      const { extensionPackages } = await import('#/db/schema')
      const { and, eq } = await import('drizzle-orm')
      const rows = await db
        .select({ files: extensionPackages.files })
        .from(extensionPackages)
        .where(
          and(
            eq(extensionPackages.workspaceId, workspaceId),
            eq(extensionPackages.extensionId, extensionId),
          ),
        )
      return (rows.at(0)?.files as Record<string, string> | undefined) ?? null
    },
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
