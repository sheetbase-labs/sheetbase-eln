/**
 * Plugin storage rules: asked before a sample is put somewhere.
 *
 * A rule sees the sample and the place it is going (the names above it, the
 * temperature it is kept at, the kind of unit, how full the box is) and says
 * `ok`, `warn` or `refuse` with a reason. A refusal stops the move and the
 * person reads the plugin's words; a warning lets it through and is shown with
 * the result. A rule that breaks never stops a move: the failure is audited and
 * the person is told the rule did not run.
 *
 * It runs in the same place as the hooks before a save (`guardRecordWrite`), so
 * it covers every route into storage that goes through the data boundary: the
 * place picker, scanning, bulk placing, the assistant, pipelines and the API.
 * Direct SQL does not reach it.
 */
import { z } from 'zod'

import { logger } from '#/lib/logger'
import { fetchStorageTree, nodePath } from '#/lib/storage-locations'
import type { StorageTree } from '#/lib/storage-locations'
import { runExtensionStorageRule } from './data-runtime.server'
import type { StorageRulePlace } from './data-runtime.server'
import type { RecordSnapshot } from './hook-answers'
import { resolveRunnerPoints } from './runner-points'
import type { RunnerItem } from './runner-points'
import type { ExtensionStorageRuleDeclaration } from './data-points'
import type { ExtensionRuntimeDeps } from './runtime.server'

export type StorageRule = RunnerItem<ExtensionStorageRuleDeclaration>

/** The calls that put a sample in a place. */
export const STORAGE_MOVES = ['move_sample_to_position', 'transfer_sample']

export function isStorageMove(resource: string): boolean {
  return STORAGE_MOVES.includes(resource)
}

export interface StorageGuardInput {
  resource: string
  body: string | undefined
  token: string
}

export interface StorageGuardClaims {
  workspaceId: string
  actorUserId: string
}

export type StorageGuardResult =
  | { kind: 'pass'; warnings: string[] }
  | { kind: 'refused'; message: string; plugin: string; hook: string }

export interface StorageGuardDeps {
  runtime?: ExtensionRuntimeDeps
  rulesFor: (workspaceId: string) => Promise<StorageRule[]>
  loadRecord: (
    token: string,
    recordId: string,
  ) => Promise<RecordSnapshot | null>
  readTree: (token: string) => Promise<StorageTree>
  readPosition: (
    token: string,
    positionId: string,
  ) => Promise<{ boxId: string; label: string } | null>
}

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; rules: StorageRule[] }>()

export function clearStorageRuleCache(): void {
  cache.clear()
}

async function loadRules(workspaceId: string): Promise<StorageRule[]> {
  const hit = cache.get(workspaceId)

  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules

  const [{ db }, { extensions }, { eq }] = await Promise.all([
    import('#/db/client.server'),
    import('#/db/schema'),
    import('drizzle-orm'),
  ])

  const rows = await db
    .select()
    .from(extensions)
    .where(eq(extensions.workspaceId, workspaceId))

  const rules = resolveRunnerPoints(
    rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      manifest: row.manifest,
      disabled_points: row.disabledPoints,
    })),
  ).data['storage-rules']

  cache.set(workspaceId, { at: Date.now(), rules })

  return rules
}

export function defaultStorageGuardDeps(): StorageGuardDeps {
  return {
    rulesFor: loadRules,
    loadRecord: async (token, recordId) => {
      const { postgrestSelect } = await import('#/lib/request-auth')

      const found = await postgrestSelect<RecordSnapshot[]>(
        'records',
        `id=eq.${recordId}&select=id,identifier,kind,title,status,tags,properties,custom_fields,project_id`,
        token,
      )

      return Array.isArray(found.body) && found.body[0] ? found.body[0] : null
    },
    readTree: async (token) => {
      const { createServerDataClient } =
        await import('#/lib/server-data-client.server')

      return fetchStorageTree(createServerDataClient(token))
    },
    readPosition: async (token, positionId) => {
      const { postgrestSelect } = await import('#/lib/request-auth')

      const found = await postgrestSelect<
        Array<{ box_id: string; label: string }>
      >(
        'storage_positions',
        `id=eq.${positionId}&select=box_id,label&limit=1`,
        token,
      )

      const row = Array.isArray(found.body) ? found.body[0] : undefined

      return row ? { boxId: row.box_id, label: row.label } : null
    },
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The arguments a storage move names: the record, and where it is going. */
const storageMoveArgsSchema = z.object({
  p_record_id: z.string().optional(),
  p_to_position_id: z.string().optional(),
  p_to_location: z.string().optional(),
})

type StorageMoveArgs = z.infer<typeof storageMoveArgsSchema>

/** The call's JSON body decoded into the arguments a move reads, else null. */
function parseArgs(body: string | undefined): StorageMoveArgs | null {
  if (!body) return null

  try {
    const decoded = storageMoveArgsSchema.safeParse(JSON.parse(body))

    return decoded.success ? decoded.data : null
  } catch {
    return null
  }
}

/** The place a move is going to, in the terms a rule reads. */
export async function describeDestination(
  resource: string,
  args: StorageMoveArgs,
  token: string,
  deps: StorageGuardDeps,
): Promise<StorageRulePlace | null> {
  if (resource === 'transfer_sample') {
    const text = args.p_to_location

    if (!text?.trim()) return null

    return {
      path: text
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean),
      box: null,
      position: null,
      temperatureC: null,
      unitType: null,
      capacity: null,
      held: null,
    }
  }

  const positionId = args.p_to_position_id

  if (!positionId || !UUID_RE.test(positionId)) return null
  const position = await deps.readPosition(token, positionId)

  if (!position) return null
  const tree = await deps.readTree(token)
  const box = tree.byId.get(position.boxId)

  if (!box) return null
  const path = nodePath(tree, box)
  // The coldest and warmest the place is kept at: the nearest level above that says.
  let temperatureC: StorageRulePlace['temperatureC'] = null
  let unitType: string | null = null
  let cursor = box

  for (;;) {
    if (
      !temperatureC &&
      (cursor.temperatureMinC !== null || cursor.temperatureMaxC !== null)
    )
      temperatureC = {
        min: cursor.temperatureMinC,
        max: cursor.temperatureMaxC,
      }

    if (cursor.unitType) unitType = cursor.unitType
    const parent = cursor.parentId ? tree.byId.get(cursor.parentId) : undefined

    if (!parent) break
    cursor = parent
  }

  return {
    path,
    box: box.name,
    position: position.label,
    temperatureC,
    unitType,
    capacity:
      box.rows !== null && box.cols !== null ? box.rows * box.cols : null,
    held: box.held,
  }
}

function fromWhere(sample: RecordSnapshot): string | null {
  const decoded = z.string().safeParse(sample.properties.storageLocation)

  return decoded.success && decoded.data.trim() ? decoded.data : null
}

/**
 * Shows a move to the storage rules switched on in the workspace. Returns null
 * when the call is not a move, or nothing is switched on, so the caller carries
 * on exactly as before.
 */
export async function guardStorageMove(
  input: StorageGuardInput,
  claims: StorageGuardClaims,
  deps: StorageGuardDeps = defaultStorageGuardDeps(),
): Promise<StorageGuardResult | null> {
  if (!isStorageMove(input.resource)) return null
  let rules: StorageRule[]

  try {
    rules = await deps.rulesFor(claims.workspaceId)
  } catch (error) {
    logger.warn('plugin storage rules could not be looked up', {
      error: error instanceof Error ? error.message : String(error),
    })

    return null
  }

  if (rules.length === 0) return null
  const args = parseArgs(input.body)
  const recordId = args?.p_record_id

  if (!args || !recordId || !UUID_RE.test(recordId)) return null

  const warnings: string[] = []
  let sample: RecordSnapshot | null
  let to: StorageRulePlace | null

  try {
    sample = await deps.loadRecord(input.token, recordId)
    to = await describeDestination(input.resource, args, input.token, deps)
  } catch (error) {
    logger.warn('plugin storage rules could not read the move', {
      error: error instanceof Error ? error.message : String(error),
    })

    return null
  }

  // Not there or not the person's to see, or a place we can't describe: leave it to the database to say so.
  if (!sample || !to) return null

  for (const rule of rules) {
    try {
      const verdict = await runExtensionStorageRule(
        {
          workspaceId: claims.workspaceId,
          actorUserId: claims.actorUserId,
          extensionKey: rule.extensionKey,
          ruleId: rule.id,
          sample: { ...sample },
          to,
          from: fromWhere(sample),
        },
        deps.runtime,
      )

      if (verdict.status === 'refuse')
        return {
          kind: 'refused',
          message: verdict.message,
          plugin: rule.extensionName,
          hook: rule.declaration.title,
        }

      if (verdict.status === 'warn')
        warnings.push(`${rule.extensionName}: ${verdict.message}`)
    } catch (error) {
      // A rule that breaks must not stop a lab from filing its samples. The
      // failure is already in the audit trail; the person is told it did not run.
      logger.warn('plugin storage rule failed', {
        plugin: rule.extensionKey,
        rule: rule.id,
        error: error instanceof Error ? error.message : String(error),
      })
      warnings.push(`${rule.extensionName} could not check this.`)
    }
  }

  return { kind: 'pass', warnings }
}
