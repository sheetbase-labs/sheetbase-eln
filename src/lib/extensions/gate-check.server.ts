/**
 * Running a plugin check for a gate.
 *
 * The app reads the table itself (as the signed-in person, so access rules
 * apply), runs the check over it, and stores the answer with the table's
 * fingerprint. The browser never sends the rows or the answer, so a gate
 * cannot be opened by sending "pass".
 */
import { sql } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { createServerDataClient } from '#/lib/server-data-client.server'
import { resolveSessionAuth } from '#/lib/request-auth'
import { runExtensionCheck } from './data-runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import { ExtensionRunError, defaultDeps } from './runtime.server'

export interface GateCheckRequest {
  workspaceId: string
  actorUserId: string
  extensionKey: string
  checkId: string
  recordId: string
  blockId: string
  /** Check input name to table column heading. */
  columns: Record<string, string>
}

export interface GateCheckDeps {
  runtime: ExtensionRuntimeDeps
  /** The table block's payload, read with the person's own access. */
  readTable: (headers: Headers, req: GateCheckRequest) => Promise<unknown>
  store: (
    req: GateCheckRequest,
    outcome: { status: string; message: string },
  ) => Promise<void>
}

export function defaultGateCheckDeps(): GateCheckDeps {
  return {
    runtime: defaultDeps(),
    readTable: async (headers, req) => {
      const auth = await resolveSessionAuth(headers)
      if (!auth.ok) throw new ExtensionRunError('not_installed', auth.message)
      const rows = await createServerDataClient(auth.context.token).list<{
        payload: unknown
      }>(
        'blocks',
        `?select=payload&id=eq.${encodeURIComponent(req.blockId)}` +
          `&record_id=eq.${encodeURIComponent(req.recordId)}&type=eq.table`,
      )
      return rows[0]?.payload
    },
    store: async (req, outcome) => {
      await db.execute(
        sql`select internal.record_gate_check(${req.recordId}::uuid, ${req.blockId}::uuid, ${req.extensionKey}, ${req.checkId}, ${outcome.status}, ${outcome.message}, ${req.actorUserId})`,
      )
    },
  }
}

export async function runGateCheck(
  headers: Headers,
  req: GateCheckRequest,
  deps: GateCheckDeps = defaultGateCheckDeps(),
): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  const payload = await deps.readTable(headers, req)
  const outcome = await runExtensionCheck(
    {
      workspaceId: req.workspaceId,
      actorUserId: req.actorUserId,
      extensionKey: req.extensionKey,
      checkId: req.checkId,
      table: { payload, columns: req.columns },
    },
    deps.runtime,
  )
  await deps.store(req, outcome)
  return { status: outcome.status, message: outcome.message }
}
