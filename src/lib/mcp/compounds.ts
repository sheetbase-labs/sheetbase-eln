/**
 * MCP and assistant reads for chemistry registration: search the registries
 * that take structures by substructure or similarity, and check whether a
 * structure is already registered. The chemistry (OpenChemLib) runs here; the
 * database narrows by fingerprint and keeps the duplicate rule.
 */
import type { DataClient } from '../data-client'
import { loadOcl } from '../chemistry-draw'
import { describeStructure } from '../compound-registry'

export const COMPOUND_SEARCH_TOOL = 'sheetbase.compound.search'
export const COMPOUND_CHECK_TOOL = 'sheetbase.compound.check'

export function isCompoundReadTool(name: string): boolean {
  return name === COMPOUND_SEARCH_TOOL || name === COMPOUND_CHECK_TOOL
}

/** The chemistry plugin's own key. */
const CHEMISTRY_PLUGIN = 'chemistry'

/**
 * `sheetbase.compound.search` and `.check` keep their names for agents, but the
 * chemistry now lives in the chemistry plugin: these run its `find` and `check`
 * operations as the person, so there is one search and one duplicate rule.
 */
export async function callCompoundRead(
  name: string,
  args: Record<string, unknown>,
  context: { client: DataClient; workspaceId: string; userId: string | null },
): Promise<unknown> {
  if (!context.userId)
    return { error: 'Structure search needs a signed-in person.' }
  const structure = String(args.structure ?? '')
  const check = name === COMPOUND_CHECK_TOOL
  const input: Record<string, unknown> = check
    ? {
        structure,
        ...(typeof args.registry === 'string'
          ? { registry: args.registry }
          : {}),
      }
    : {
        structure,
        mode: args.mode === 'similarity' ? 'similarity' : 'substructure',
        ...(typeof args.registry === 'string'
          ? { registry: args.registry }
          : {}),
        ...(typeof args.minSimilarity === 'number'
          ? { min_similarity: args.minSimilarity }
          : {}),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      }
  try {
    const { invokeWithHostCalls } =
      await import('../extensions/operation-host.server')
    const outcome = await invokeWithHostCalls(
      {
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        extensionKey: CHEMISTRY_PLUGIN,
        itemId: check ? 'check' : 'find',
        input,
      },
      {
        workspaceId: context.workspaceId,
        userId: context.userId,
        approve: 'none',
        client: async () => context.client,
      },
    )
    if (outcome.kind === 'confirm')
      return { error: 'That search tried to change something.' }
    return outcome.result.output
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The chemistry plugin could not answer.',
    }
  }
}

const STRUCTURE_WRITES = new Set(['register_compound', 'set_record_structure'])

/**
 * Over MCP a structure can be given as `{"smiles": "…"}` or `{"molfile": "…"}`;
 * this turns it into the description the database keeps (parent code,
 * fingerprint and so on). A description that is already complete passes through.
 */
export async function prepareStructureArguments(
  action: string,
  args: Record<string, unknown>,
): Promise<
  { ok: true; args: Record<string, unknown> } | { ok: false; message: string }
> {
  if (!STRUCTURE_WRITES.has(action)) return { ok: true, args }
  const given = args.p_structure
  if (given === null || typeof given !== 'object' || Array.isArray(given)) {
    return { ok: true, args }
  }
  const structure = given as Record<string, unknown>
  if (typeof structure.parentCode === 'string') return { ok: true, args }
  const source =
    typeof structure.smiles === 'string'
      ? structure.smiles
      : typeof structure.molfile === 'string'
        ? structure.molfile
        : ''
  if (!source) {
    return {
      ok: false,
      message:
        'p_structure needs a smiles or molfile, or the description from POST /api/structures/describe.',
    }
  }
  const described = describeStructure(await loadOcl(), source)
  if (!described) {
    return { ok: false, message: 'That could not be read as a structure.' }
  }
  return { ok: true, args: { ...args, p_structure: described } }
}
