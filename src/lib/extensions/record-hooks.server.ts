/**
 * Plugin hooks on save and upload.
 *
 * Two moments:
 *
 * - **Before** a save, inside the data boundary. Every write to a record that
 *   goes through the data proxy or the server's own data client is shown to the
 *   hooks that run before a save. A hook can refuse it (the person sees its
 *   words and nothing is saved), let it through with a warning, or fill in
 *   fields, which go into the same save. A hook that breaks never blocks the
 *   save: the failure is audited and the save goes on.
 * - **After** a save, from the change log, and after an upload. A hook can write
 *   a summary, add to a search index, raise or clear flags a gate waits on, ask
 *   for sign-offs and change records.
 *
 * Event reactions use the same answers (see `event-hooks.server.ts`), so what a
 * plugin can do after something happens is described once, in `hook-answers.ts`.
 *
 * What a plugin never does here: sign, approve or attest; change a status;
 * reach a record the person whose change it was cannot change; or set hooks off
 * again with its own writes (they carry a marker the log pass skips).
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { logger } from '#/lib/logger'
import { runExtensionRecordHook } from './data-runtime.server'
import type { RecordHookInput } from './data-runtime.server'
import { applyFill, mergeFill } from './hook-answers'
import type {
  AfterAnswer,
  BeforeAnswer,
  FieldFill,
  RecordSnapshot,
} from './hook-answers'
import { guardStorageMove, isStorageMove } from './storage-rules.server'
import type { StorageGuardDeps } from './storage-rules.server'
import { describeRecordWrite } from './record-writes'
import type { PlannedWrite } from './record-writes'
import { resolveRunnerPoints } from './runner-points'
import type { RunnerItem } from './runner-points'
import type {
  ExtensionRecordHookDeclaration,
  RecordHookTiming,
  RecordHookWhen,
} from './data-points'
import type { ExtensionRuntimeDeps } from './runtime.server'

export type RecordHook = RunnerItem<ExtensionRecordHookDeclaration>

/** The client id on every write a plugin makes, so the log pass can skip them. */
export const PLUGIN_CLIENT_ID = '00000000-0000-4000-8000-0000000000ff'

// ---------------------------------------------------------------------------
// What the hooks need from the outside, so it can be replaced in tests.
// ---------------------------------------------------------------------------

export interface HookStore {
  raiseFlag: (flag: {
    recordId: string
    hook: Pick<RecordHook, 'extensionKey' | 'extensionName'>
    key: string
    kind: 'flag' | 'sign_off'
    title: string
    message: string
    roles: string[]
    approvals: number
    independent: boolean
    actorUserId: string | null
  }) => Promise<void>
  clearFlag: (args: {
    recordId: string
    extensionKey: string
    key: string
  }) => Promise<void>
  storeSummary: (args: {
    recordId: string
    hook: Pick<RecordHook, 'extensionKey' | 'extensionName' | 'id'>
    summary: string
  }) => Promise<void>
  storeIndex: (args: {
    recordId: string
    extensionKey: string
    index: string
    entries: Array<{ entry: string; body: string; vector?: number[] }>
  }) => Promise<void>
  saveNote: (note: {
    workspaceId: string
    userId: string
    hook: Pick<RecordHook, 'extensionKey' | 'extensionName' | 'id'>
    eventId: string
    recordId: string | null
    title: string
    body: string | null
  }) => Promise<void>
  /** Changes a record as the person, keeping to fields a plugin may touch. */
  changeRecord: (args: {
    workspaceId: string
    actorUserId: string
    recordId: string
    set: FieldFill
  }) => Promise<void>
}

export interface RecordHookDeps {
  runtime?: ExtensionRuntimeDeps
  /** The record hooks switched on in a workspace. */
  hooksFor: (workspaceId: string) => Promise<RecordHook[]>
  /** The record as it is now, read with the person's own access. */
  loadRecord: (
    token: string,
    recordId: string,
  ) => Promise<RecordSnapshot | null>
  store: HookStore
  /** Mints the short token used to read as the person; swapped in tests. */
  mintToken?: (claims: TokenClaims) => Promise<string>
  /** What the storage rules need; the real ones unless a test swaps them. */
  storage?: StorageGuardDeps
}

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; hooks: RecordHook[] }>()

export function clearRecordHookCache(): void {
  cache.clear()
}

async function loadHooks(workspaceId: string): Promise<RecordHook[]> {
  const hit = cache.get(workspaceId)

  if (hit && Date.now() - hit.at < CACHE_MS) return hit.hooks

  const [{ db }, { extensions }, { eq }] = await Promise.all([
    import('#/db/client.server'),
    import('#/db/schema'),
    import('drizzle-orm'),
  ])

  const rows = await db
    .select()
    .from(extensions)
    .where(eq(extensions.workspaceId, workspaceId))

  const hooks = resolveRunnerPoints(
    rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      manifest: row.manifest,
      disabled_points: row.disabledPoints,
    })),
  ).data['record-hooks']

  cache.set(workspaceId, { at: Date.now(), hooks })

  return hooks
}

const SNAPSHOT_SELECT =
  'id,identifier,kind,title,status,tags,properties,custom_fields,project_id'

export function defaultHookStore(): HookStore {
  return {
    raiseFlag: async (flag) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`SELECT internal.plugin_raise_flag(${flag.recordId}::uuid, ${flag.hook.extensionKey}, ${flag.hook.extensionName},
              ${flag.key}, ${flag.kind}, ${flag.title}, ${flag.message}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(flag.roles)}::jsonb)), ${flag.approvals},
              ${flag.independent}, ${flag.actorUserId})`,
      )
    },
    clearFlag: async (args) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`SELECT internal.plugin_clear_flag(${args.recordId}::uuid, ${args.extensionKey}, ${args.key})`,
      )
    },
    storeSummary: async (args) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`SELECT internal.plugin_store_summary(${args.recordId}::uuid, ${args.hook.extensionKey},
              ${args.hook.extensionName}, ${args.hook.id}, ${args.summary})`,
      )
    },
    storeIndex: async (args) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`SELECT internal.plugin_store_index(${args.recordId}::uuid, ${args.extensionKey}, ${args.index},
              ${JSON.stringify(args.entries)}::jsonb)`,
      )
    },
    saveNote: async (note) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`INSERT INTO api.plugin_notes
              (workspace_id, user_id, extension_key, extension_name, hook_id, event_id, title, body, record_id)
            VALUES (${note.workspaceId}::uuid, ${note.userId}, ${note.hook.extensionKey}, ${note.hook.extensionName},
                    ${note.hook.id}, ${note.eventId}::uuid, ${note.title}, ${note.body}, ${note.recordId}::uuid)
            ON CONFLICT DO NOTHING`,
      )
    },
    changeRecord: async (args) => {
      const [
        { env },
        { mintPostgrestToken },
        { postgrestRpc, postgrestPatch, postgrestSelect },
      ] = await Promise.all([
        import('#/env.server'),
        import('#/lib/postgrest-token'),
        import('#/lib/request-auth'),
      ])

      const token = await mintPostgrestToken(env.PGRST_JWT_SECRET, {
        userId: args.actorUserId,
        workspaceId: args.workspaceId,
        sessionId: 'plugin-hook',
        clientId: PLUGIN_CLIENT_ID,
        ttlSeconds: 60,
      })

      const found = await postgrestSelect<
        Array<{ metadata_version: number; properties: unknown; tags: string[] }>
      >(
        'records',
        `id=eq.${args.recordId}&select=metadata_version,properties,tags`,
        token,
      )

      const row = Array.isArray(found.body) ? found.body[0] : undefined

      if (found.status >= 400 || !row)
        throw new Error('That record is not there, or you can’t change it.')
      let version = row.metadata_version

      if (args.set.custom_fields) {
        const done = await postgrestRpc<{ metadata_version: number }>(
          'update_record_custom_fields',
          {
            p_record_id: args.recordId,
            p_expected_metadata_version: version,
            p_values: args.set.custom_fields,
          },
          token,
        )

        if (done.status >= 400)
          throw new Error(describeFailure(done.body, 'custom fields'))

        const reply = metadataVersionReplySchema.safeParse(done.body)

        version = reply.success ? reply.data.metadata_version : version + 1
      }

      if (args.set.properties || args.set.tags) {
        const done = await postgrestPatch(
          'records',
          `id=eq.${args.recordId}&metadata_version=eq.${version}`,
          {
            // The proxy drops an absent value, so the body is the same one the
            // old conditional spread built; only the keys it carries change.
            properties: args.set.properties
              ? {
                  ...(isObject(row.properties) ? row.properties : undefined),
                  ...args.set.properties,
                }
              : undefined,
            tags: args.set.tags,
            metadata_version: version + 1,
          },
          token,
        )

        if (done.status >= 400)
          throw new Error(describeFailure(done.body, 'properties or tags'))
      }
    },
  }
}

/** A JSON value as the proxy and the event log hand it over. */
const jsonValueSchema = z.json()

type JsonValue = z.output<typeof jsonValueSchema>

/** A JSON object: a row, an event's payload, a failure body. */
const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

type JsonObject = z.output<typeof jsonObjectSchema>

function isObject(value: unknown): value is JsonObject {
  return jsonObjectSchema.safeParse(value).success
}

/** The version a record write reports back. */
const metadataVersionReplySchema = z.object({ metadata_version: z.number() })

/** A failed proxy call's refusal: a message, or an error holding one. */
const failureBodySchema = z.object({
  message: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A refused proxy call answers with whatever its body held; the schema above reads a message from it and nothing else.
function describeFailure(body: unknown, what: string): string {
  const refusal = failureBodySchema.safeParse(body)

  const message = refusal.success
    ? (refusal.data.message ?? refusal.data.error?.message)
    : undefined

  return message ?? `The ${what} could not be changed.`
}

export function defaultRecordHookDeps(): RecordHookDeps {
  return {
    hooksFor: loadHooks,
    loadRecord: async (token, recordId) => {
      const { postgrestSelect } = await import('#/lib/request-auth')

      const found = await postgrestSelect<RecordSnapshot[]>(
        'records',
        `id=eq.${recordId}&select=${SNAPSHOT_SELECT}`,
        token,
      )

      return Array.isArray(found.body) && found.body[0] ? found.body[0] : null
    },
    store: defaultHookStore(),
  }
}

// ---------------------------------------------------------------------------
// Which hooks a thing sets off.
// ---------------------------------------------------------------------------

/** The hooks that run at `timing` for a record of this kind, and the moment each is set off by. */
export function matchHooks(
  hooks: readonly RecordHook[],
  timing: RecordHookTiming,
  whens: readonly RecordHookWhen[],
  record: Pick<RecordSnapshot, 'kind' | 'status'>,
): Array<{ hook: RecordHook; when: RecordHookWhen }> {
  const out: Array<{ hook: RecordHook; when: RecordHookWhen }> = []

  for (const hook of hooks) {
    const d = hook.declaration

    if (d.timing !== timing) continue

    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- Each hook owns a different kind list and performs one membership query; constructing a Set here adds a full scan and allocation. matchHooks tests cover disjoint kinds.
    if (d.kinds && !d.kinds.includes(record.kind)) continue

    const when = whens.find((candidate) => {
      // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- A hook has at most the four RECORD_HOOK_WHEN literals; this preserves first matching caller order without allocating a Set per hook (matchHooks first-moment regression).
      if (!d.when.includes(candidate)) return false

      if (candidate === 'status-changed' && d.statuses)
        // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- Each hook owns a distinct status list queried for the current record's status; allocating a Set here adds a full scan per hook. matchHooks tests cover accepted/refused status changes and first-match fallthrough.
        return d.statuses.includes(record.status)

      return true
    })

    if (when) out.push({ hook, when })
  }

  return out
}

// ---------------------------------------------------------------------------
// Before a save.
// ---------------------------------------------------------------------------

export interface WriteGuardInput {
  method: string
  kind: 'table' | 'rpc'
  resource: string
  query: string
  body: string | undefined
  /** The person's own token; every read the hook needs goes through it. */
  token: string
}

export type WriteGuardResult =
  | { kind: 'pass'; body: string | undefined; warnings: string[] }
  | {
      kind: 'refused'
      message: string
      plugin: string
      hook: string
    }

interface TokenClaims {
  workspaceId: string
  actorUserId: string
}

/** Reads who and where from a token the caller has already verified. */
export function claimsOf(token: string): TokenClaims | null {
  const part = token.split('.')[1]

  if (!part) return null

  try {
    const claims = tokenClaimsSchema.safeParse(
      JSON.parse(
        Buffer.from(
          part.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf8'),
      ),
    )

    if (!claims.success) return null

    return {
      workspaceId: claims.data.workspace_id,
      actorUserId: claims.data.sub,
    }
  } catch {
    return null
  }
}

const passThrough = (
  body: string | undefined,
): Extract<WriteGuardResult, { kind: 'pass' }> => ({
  kind: 'pass',
  body,
  warnings: [],
})

/**
 * Shows a write to the hooks that run before a save. Returns the body to send
 * (with any fills in it), or a refusal. Cheap when nothing is switched on: one
 * cached lookup per workspace.
 */
export async function guardRecordWrite(
  input: WriteGuardInput,
  deps: RecordHookDeps = defaultRecordHookDeps(),
): Promise<WriteGuardResult> {
  const method = input.method.toUpperCase()

  if (method === 'GET' || method === 'HEAD' || method === 'DELETE')
    return passThrough(input.body)

  if (input.kind === 'rpc' && isStorageMove(input.resource)) {
    const claimed = claimsOf(input.token)

    const moved = claimed
      ? await guardStorageMove(input, claimed, deps.storage)
      : null

    if (moved?.kind === 'refused') return moved

    return { ...passThrough(input.body), warnings: moved?.warnings ?? [] }
  }

  const planned = describeRecordWrite({
    method,
    kind: input.kind,
    resource: input.resource,
    query: input.query,
    body: input.body,
  })

  if (!planned) return passThrough(input.body)
  const claims = claimsOf(input.token)

  if (!claims) return passThrough(input.body)

  let hooks: RecordHook[]

  try {
    hooks = (await deps.hooksFor(claims.workspaceId)).filter(
      (hook) => hook.declaration.timing === 'before',
    )
  } catch (error) {
    logger.warn('plugin hooks could not be looked up', {
      error: error instanceof Error ? error.message : String(error),
    })

    return passThrough(input.body)
  }

  if (hooks.length === 0) return passThrough(input.body)

  const warnings: string[] = []
  const fills: Array<FieldFill | undefined> = planned.map(() => undefined)

  for (const [index, plan] of planned.entries()) {
    let previous: RecordSnapshot | null = null

    if (plan.recordId) {
      try {
        previous = await deps.loadRecord(input.token, plan.recordId)
      } catch {
        previous = null
      }

      // Not there, or not the person's to see: leave it to the database to say so.
      if (!previous) continue
    }

    let { record, changed } = plan.after(previous)
    const changedFields = new Set(changed)

    for (const { hook, when } of matchHooks(
      hooks,
      'before',
      plan.whens,
      record,
    )) {
      const answer = await runBefore(
        deps,
        claims,
        hook,
        {
          when,
          record,
          previous,
          changed,
          changes: {},
          file: null,
        },
        warnings,
      )

      if (!answer) continue

      if (answer.refuse)
        return {
          kind: 'refused',
          message: answer.refuse,
          plugin: hook.extensionName,
          hook: hook.declaration.title,
        }

      if (answer.warn) warnings.push(`${hook.extensionName}: ${answer.warn}`)

      if (answer.set) {
        fills[index] = mergeFill(fills[index], answer.set)
        record = applyFill(record, answer.set)

        for (const field of Object.keys(answer.set)) changedFields.add(field)
        changed = [...changedFields]
      }
    }
  }

  if (fills.every((fill) => !fill))
    return { ...passThrough(input.body), warnings }

  return {
    kind: 'pass',
    body: withFills(input.body, planned, fills, warnings),
    warnings,
  }
}

function withFills(
  body: string | undefined,
  planned: PlannedWrite[],
  fills: Array<FieldFill | undefined>,
  warnings: string[],
): string | undefined {
  const parsed = planned.map((plan, index) => {
    const fill = fills[index]

    if (!fill) return undefined
    const next = plan.withFill(fill)

    if (next === null)
      warnings.push(
        'A plugin tried to fill in fields on a change that has nowhere to put them.',
      )

    return next
  })

  if (parsed.every((entry) => entry === undefined || entry === null))
    return body

  if (body !== undefined && body.trimStart().startsWith('[')) {
    const rows: unknown[] = JSON.parse(body)

    return JSON.stringify(
      rows.map((row, index) => {
        const filled = parsed[index]

        return filled ? JSON.parse(filled) : row
      }),
    )
  }

  return parsed[0] ?? body
}

async function runBefore(
  deps: RecordHookDeps,
  claims: TokenClaims,
  hook: RecordHook,
  input: RecordHookInput,
  warnings: string[],
): Promise<BeforeAnswer | null> {
  try {
    return await runExtensionRecordHook(
      {
        workspaceId: claims.workspaceId,
        actorUserId: claims.actorUserId,
        extensionKey: hook.extensionKey,
        hookId: hook.id,
        timing: 'before',
        input,
      },
      deps.runtime,
    )
  } catch (error) {
    // A hook that breaks must not stop a lab from saving its work. The failure
    // is already in the audit trail; the person is told it did not run.
    logger.warn('plugin hook failed before a save', {
      plugin: hook.extensionKey,
      hook: hook.id,
      error: error instanceof Error ? error.message : String(error),
    })
    warnings.push(`${hook.extensionName} could not check this.`)

    return null
  }
}

// ---------------------------------------------------------------------------
// Before an upload.
// ---------------------------------------------------------------------------

export interface UploadHookInput {
  workspaceId: string
  actorUserId: string
  /** The file's record; its kind is `file`. */
  record: RecordSnapshot
  file: {
    name: string
    media_type: string
    byte_size: number
    checksum: string | null
  }
  /** Reads the uploaded bytes when a hook asks for them. */
  readContent: () => Promise<Uint8Array>
  timing: RecordHookTiming
}

export type UploadHookResult =
  | { kind: 'pass'; warnings: string[]; answers: AfterAnswer[] }
  | { kind: 'refused'; message: string; plugin: string; hook: string }

/** Runs the hooks set off by an upload. Before the file is made current they can refuse it; after, they answer as after a save. */
export async function runUploadHooks(
  input: UploadHookInput,
  deps: RecordHookDeps = defaultRecordHookDeps(),
): Promise<UploadHookResult> {
  const warnings: string[] = []
  const answers: AfterAnswer[] = []

  const claims = {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
  }

  let hooks: RecordHook[]

  try {
    hooks = await deps.hooksFor(input.workspaceId)
  } catch {
    return { kind: 'pass', warnings, answers }
  }

  const matched = matchHooks(hooks, input.timing, ['uploaded'], input.record)

  if (matched.length === 0) return { kind: 'pass', warnings, answers }
  let bytes: Uint8Array | null = null

  for (const { hook, when } of matched) {
    const wants = hook.declaration.file
    let content: string | undefined

    if (wants) {
      try {
        bytes ??= await input.readContent()
        content =
          wants === 'base64'
            ? Buffer.from(bytes).toString('base64')
            : new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      } catch {
        warnings.push(`${hook.extensionName} could not read the file.`)
        continue
      }
    }

    const file: NonNullable<RecordHookInput['file']> = { ...input.file }

    if (wants) {
      file.content = content
      file.encoding = wants
    }

    const hookInput: RecordHookInput = {
      when,
      record: input.record,
      previous: null,
      changed: [],
      changes: {},
      file,
    }

    if (input.timing === 'before') {
      const answer = await runBefore(deps, claims, hook, hookInput, warnings)

      if (!answer) continue

      if (answer.refuse)
        return {
          kind: 'refused',
          message: answer.refuse,
          plugin: hook.extensionName,
          hook: hook.declaration.title,
        }

      if (answer.warn) warnings.push(`${hook.extensionName}: ${answer.warn}`)
    } else {
      const answer = await runAfter(deps, claims, hook, hookInput)

      if (answer) {
        answers.push(answer)
        await applyHookAnswer(
          deps.store,
          {
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId,
            recordId: input.record.id,
            eventId: null,
            hook,
          },
          answer,
        )
      }
    }
  }

  return { kind: 'pass', warnings, answers }
}

// ---------------------------------------------------------------------------
// After a save.
// ---------------------------------------------------------------------------

async function runAfter(
  deps: RecordHookDeps,
  claims: TokenClaims,
  hook: RecordHook,
  input: RecordHookInput,
): Promise<AfterAnswer | null> {
  try {
    return await runExtensionRecordHook(
      {
        workspaceId: claims.workspaceId,
        actorUserId: claims.actorUserId,
        extensionKey: hook.extensionKey,
        hookId: hook.id,
        timing: 'after',
        input,
      },
      deps.runtime,
    )
  } catch (error) {
    logger.warn('plugin hook failed after a save', {
      plugin: hook.extensionKey,
      hook: hook.id,
      error: error instanceof Error ? error.message : String(error),
    })

    return null
  }
}

export interface ChangeEventLike {
  id: string
  workspaceId: string
  actorUserId: string | null
  clientId: string | null
  entityType: string
  entityUuid: string
  operation: string
  recordId: string | null
  payload: unknown
}

/** The before/after a record change event logs for each field it records. */
const recordChangesSchema = z.record(
  z.string(),
  z.object({ from: z.unknown(), to: z.unknown() }),
)

/** A payload field that holds text, or empty when it holds anything else. */
function textOrEmpty(value: JsonValue | undefined): string {
  const text = z.string().safeParse(value)

  return text.success ? text.data : ''
}

/** A verified token's claims: who, and in which workspace. */
const tokenClaimsSchema = z.object({
  workspace_id: z.string(),
  sub: z.string(),
})

/** What a record event means to a hook: which moments it is, and what changed. */
export function whensOfEvent(event: ChangeEventLike): {
  whens: RecordHookWhen[]
  kind: string
  status: string
  changes: Record<string, { from: unknown; to: unknown }>
} | null {
  if (event.entityType !== 'record') return null
  const payload = isObject(event.payload) ? event.payload : {}
  const recorded = recordChangesSchema.safeParse(payload.changes)

  const changes = recorded.success ? recorded.data : {}
  const kind = textOrEmpty(payload.kind)
  const status = textOrEmpty(payload.status)

  if (event.operation === 'create')
    return { whens: ['created'], kind, status, changes }

  if (event.operation === 'update') {
    const whens: RecordHookWhen[] =
      'status' in changes ? ['status-changed', 'edited'] : ['edited']

    return { whens, kind, status, changes }
  }

  return null
}

/**
 * Runs the hooks that follow a change in the log. Never throws: a hook must not
 * hold up delivery. A change a plugin made itself is skipped, so a hook cannot
 * set itself off.
 */
export async function runAfterRecordHooksForEvent(
  event: ChangeEventLike,
  deps: RecordHookDeps = defaultRecordHookDeps(),
): Promise<number> {
  if (event.clientId === PLUGIN_CLIENT_ID) return 0
  const meaning = whensOfEvent(event)

  if (!meaning || !event.actorUserId) return 0

  try {
    const hooks = (await deps.hooksFor(event.workspaceId)).filter(
      (hook) => hook.declaration.timing === 'after',
    )

    if (hooks.length === 0) return 0

    const claims = {
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
    }

    let record: RecordSnapshot | null = null
    let ran = 0
    let { kind, status } = meaning

    if (!kind) {
      // An update in the log does not say what kind of record it was (only the
      // creation does), so a hook limited to a kind needs the record itself.
      record = await loadAsActor(deps, claims, event.entityUuid)

      if (!record) return 0
      kind = record.kind
      status ||= record.status
    }

    for (const { hook, when } of matchHooks(hooks, 'after', meaning.whens, {
      kind,
      status,
    })) {
      if (!record) {
        record = await loadAsActor(deps, claims, event.entityUuid)

        // Gone, or not the person's to see: nothing to show a plugin.
        if (!record) return ran
      }

      const answer = await runAfter(deps, claims, hook, {
        when,
        record,
        previous: null,
        changed: Object.keys(meaning.changes),
        changes: meaning.changes,
        file: null,
      })

      if (!answer) continue
      ran += 1
      await applyHookAnswer(
        deps.store,
        {
          workspaceId: event.workspaceId,
          actorUserId: event.actorUserId,
          recordId: event.entityUuid,
          eventId: event.id,
          hook,
        },
        answer,
      )
    }

    return ran
  } catch (error) {
    logger.warn('plugin hooks could not run after a save', {
      error: error instanceof Error ? error.message : String(error),
    })

    return 0
  }
}

async function mintActorToken(claims: TokenClaims): Promise<string> {
  const [{ env }, { mintPostgrestToken }] = await Promise.all([
    import('#/env.server'),
    import('#/lib/postgrest-token'),
  ])

  return mintPostgrestToken(env.PGRST_JWT_SECRET, {
    userId: claims.actorUserId,
    workspaceId: claims.workspaceId,
    sessionId: 'plugin-hook',
    clientId: PLUGIN_CLIENT_ID,
    ttlSeconds: 60,
  })
}

async function loadAsActor(
  deps: RecordHookDeps,
  claims: TokenClaims,
  recordId: string,
): Promise<RecordSnapshot | null> {
  const token = deps.mintToken
    ? await deps.mintToken(claims)
    : await mintActorToken(claims)

  return deps.loadRecord(token, recordId)
}

// ---------------------------------------------------------------------------
// Doing what an answer says.
// ---------------------------------------------------------------------------

export interface AnswerContext {
  workspaceId: string
  /** The person whose change set the plugin off; null for a change nobody made. */
  actorUserId: string | null
  /** The record the hook or event is about. */
  recordId: string | null
  /** The change-log entry that set it off; notes need one. */
  eventId: string | null
  hook:
    | Pick<RecordHook, 'extensionKey' | 'extensionName' | 'id' | 'declaration'>
    | {
        extensionKey: string
        extensionName: string
        id: string
        declaration?: unknown
      }
}

export interface AnswerOutcome {
  done: string[]
  problems: string[]
}

/**
 * Does what a plugin's answer says, one step at a time. A step that fails does
 * not stop the rest; it is listed in `problems` and logged.
 */
export async function applyHookAnswer(
  store: HookStore,
  ctx: AnswerContext,
  answer: AfterAnswer,
): Promise<AnswerOutcome> {
  const outcome: AnswerOutcome = { done: [], problems: [] }

  const step = async (label: string, work: () => Promise<void>) => {
    try {
      await work()
      outcome.done.push(label)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome.problems.push(`${label}: ${message}`)
      logger.warn('plugin answer step failed', {
        plugin: ctx.hook.extensionKey,
        hook: ctx.hook.id,
        step: label,
        error: message,
      })
    }
  }

  const hook = {
    extensionKey: ctx.hook.extensionKey,
    extensionName: ctx.hook.extensionName,
    id: ctx.hook.id,
  }

  if (answer.summary !== undefined && ctx.recordId) {
    const recordId = ctx.recordId
    await step('summary', () =>
      store.storeSummary({ recordId, hook, summary: answer.summary ?? '' }),
    )
  }

  if (answer.index?.length && ctx.recordId) {
    const recordId = ctx.recordId

    const byIndex = new Map<
      string,
      Array<{ entry: string; body: string; vector?: number[] }>
    >()

    for (const item of answer.index) {
      const list = byIndex.get(item.index) ?? []
      list.push({
        entry: item.entry ?? 'main',
        body: item.text ?? '',
        // Stored with JSON.stringify, which drops an absent vector as the
        // conditional spread did; only the key's presence in memory changes.
        vector: item.vector,
      })
      byIndex.set(item.index, list)
    }

    for (const [index, entries] of byIndex)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Hook answers commit one step at a time and report completion in that order; record-hooks.server.test.ts delayed-store regression preserves index replacement order and partial-failure reporting.
      await step(`index ${index}`, () =>
        store.storeIndex({
          recordId,
          extensionKey: hook.extensionKey,
          index,
          entries,
        }),
      )
  }

  if (ctx.recordId) {
    const recordId = ctx.recordId

    for (const flag of answer.flags ?? [])
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Flag upserts must finish before later sign-off upserts or clears of the same key; the delayed-store regression proves no raised flag survives its later clear.
      await step(`flag ${flag.key}`, () =>
        store.raiseFlag({
          recordId,
          hook,
          key: flag.key,
          kind: 'flag',
          title: flag.title,
          message: flag.message ?? '',
          roles: [],
          approvals: 1,
          independent: true,
          actorUserId: ctx.actorUserId,
        }),
      )

    for (const request of answer.sign_off ?? [])
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Sign-off requests share flag keys with later clears; wait for the upsert before clearing, as tested with delayed writes in record-hooks.server.test.ts.
      await step(`sign-off ${request.key}`, () =>
        store.raiseFlag({
          recordId,
          hook,
          key: request.key,
          kind: 'sign_off',
          title: request.title,
          message: request.message ?? '',
          roles: request.roles,
          approvals: request.approvals ?? 1,
          independent: request.independent ?? true,
          actorUserId: ctx.actorUserId,
        }),
      )

    for (const key of answer.clear ?? [])
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Finish ordered flag clears before record changes and their completion report; record-hooks.server.test.ts delays the first clear to detect reordered steps.
      await step(`clear ${key}`, () =>
        store.clearFlag({ recordId, extensionKey: hook.extensionKey, key }),
      )
  }

  for (const change of answer.changes ?? []) {
    const target = change.record ?? ctx.recordId

    if (!target || !ctx.actorUserId) {
      outcome.problems.push(
        'changes: there is no person to make the change as, or no record to change',
      )
      continue
    }

    const actorUserId = ctx.actorUserId
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Multiple changes can write the same record field; parallel writes would let an earlier delayed value overwrite the last one. The delayed-store regression asserts the final reading is 2, not 1.
    await step(`change ${target}`, () =>
      store.changeRecord({
        workspaceId: ctx.workspaceId,
        actorUserId,
        recordId: target,
        set: change.set,
      }),
    )
  }

  if (answer.notes?.length && ctx.actorUserId && ctx.eventId) {
    const userId = ctx.actorUserId
    const eventId = ctx.eventId

    for (const note of answer.notes)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Inbox notes retain the plugin's declared order; the delayed-store regression delays First and verifies it still precedes Second.
      await step(`note ${note.title}`, () =>
        store.saveNote({
          workspaceId: ctx.workspaceId,
          userId,
          hook,
          eventId,
          recordId: ctx.recordId,
          title: note.title,
          body: note.body ?? null,
        }),
      )
  }

  return outcome
}
