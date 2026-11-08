/**
 * Runs a plugin operation that may call into the app (`host_call` in its
 * Python): the operation stops at a call it has no answer for, the call is made
 * here as the person, and the operation runs again with the answers so far.
 * A call that changes something is made only when the caller said the person
 * agreed to it (`approve`); otherwise the run stops and says which call waits.
 * Server-only.
 */
import type { DataClient } from '../data-client'
import type { ExtensionWire } from './client'
import type { HostCall, HostCallOutcome } from './host-route.server'
import { invokeExtension } from './runtime.server'
import type {
  ExtensionRuntimeDeps,
  HostAnswer,
  InvokeArgs,
  InvokeResult,
} from './runtime.server'

/** A guard against an operation that never stops asking, not a limit on what one may do. */
export const MAX_HOST_ROUNDS = 500

export interface HostBridge {
  workspaceId: string
  userId: string
  /** The person's own access, got only when the operation first calls into the app. */
  client: () => Promise<DataClient>
  /** Which changes may be made: all of them, none, or the calls (by position) the person agreed to. */
  approve: 'all' | 'none' | ReadonlySet<number>
  /** Answers already given, when carrying on from a stop. */
  hostResults?: HostAnswer[]
  /** Overridable for tests. */
  perform?: (
    deps: { runtime: Pick<ExtensionRuntimeDeps, 'audit'> },
    call: HostCall,
  ) => Promise<HostCallOutcome>
  install?: (key: string) => Promise<ExtensionWire | undefined>
}

export interface HostConfirmation {
  index: number
  name: string
  action: string | null
  summary: string | null
}

export type HostInvokeOutcome =
  | { kind: 'done'; result: InvokeResult }
  | { kind: 'confirm'; confirm: HostConfirmation; hostResults: HostAnswer[] }

export async function invokeWithHostCalls(
  args: Omit<InvokeArgs, 'hostResults'>,
  bridge: HostBridge,
  deps?: ExtensionRuntimeDeps,
): Promise<HostInvokeOutcome> {
  const results: HostAnswer[] = [...(bridge.hostResults ?? [])]
  for (let round = 0; round < MAX_HOST_ROUNDS; round++) {
    const result = await invokeExtension(
      { ...args, hostResults: results },
      deps,
    )
    if (!result.hostCalls) return { kind: 'done', result }
    const { performHostCall } = await import('./host-route.server')
    const runtime = deps ?? (await import('./runtime.server')).defaultDeps()
    const install = await (
      bridge.install ??
      (async (key: string) =>
        (
          await (await import('./client')).listExtensions(await bridge.client())
        ).find((row) => row.key === key))
    )(args.extensionKey)
    if (!install) throw new Error('That plugin is no longer installed.')
    for (const call of result.hostCalls) {
      const index = results.length
      const done = await (bridge.perform ?? performHostCall)(
        { runtime },
        {
          workspaceId: bridge.workspaceId,
          userId: bridge.userId,
          client: await bridge.client(),
          install,
          point: 'operations',
          name: call.name,
          arguments: call.arguments,
          confirmed:
            bridge.approve === 'all' ||
            (bridge.approve !== 'none' && bridge.approve.has(index)),
        },
      )
      if (!done.ok && done.code === 'confirmation_needed')
        return {
          kind: 'confirm',
          confirm: {
            index,
            name: call.name,
            action:
              typeof call.arguments.action === 'string'
                ? call.arguments.action
                : null,
            summary: done.summary ?? null,
          },
          hostResults: results,
        }
      results.push(
        done.ok
          ? { ok: true, result: done.result }
          : { ok: false, error: done.message, code: done.code },
      )
    }
  }
  throw new Error(
    'This operation kept asking for more from Sheetbase and was stopped.',
  )
}

/**
 * The person's own access for a run that has no browser request (a pipeline
 * step): a short-lived token for them, the same way plugin hooks get one.
 * Row-level security and each action's role checks still decide what it can do.
 */
export async function personClient(
  workspaceId: string,
  userId: string,
): Promise<DataClient> {
  const [{ env }, { mintPostgrestToken }, execution] = await Promise.all([
    import('#/env.server'),
    import('#/lib/postgrest-token'),
    import('../connectors/enterprise/execution.server'),
  ])
  const token = await mintPostgrestToken(env.PGRST_JWT_SECRET, {
    userId,
    workspaceId,
    sessionId: 'plugin-run',
    ttlSeconds: 600,
  })
  return execution.createServerDataClient(token)
}
