/**
 * Registering a cloning product: it becomes an entry in a registry (a record
 * model with the Registry box ticked), named by the lab's own numbering, with
 * lineage to the parts it was built from.
 */
import {
  addParent,
  createRegistryEntry,
  findDuplicates,
  isDuplicateError,
  readSequence,
} from '#/lib/bio-registry'
import type {
  DuplicateMatch,
  ParentRole,
  RegistryModel,
} from '#/lib/bio-registry'
import type { DataClient } from '#/lib/data-client'
import type { AssemblyProduct } from '#/lib/molbio'
import type { ParsedSequence } from '#/lib/sequence'
import type { AssemblyPlan, PlanPart } from '#/lib/sequence-block'

export interface RegisterInput {
  projectId: string
  model: RegistryModel
  title: string
  sequence: ParsedSequence
  parents: { recordId: string; role: ParentRole }[]
  allowDuplicate: boolean
}

export interface Registered {
  recordId: string
  identifier: string
  title: string
}

interface EntryWire {
  id: string
  identifier: string
  title: string
}

/** The part a product part came from, with the role it played. */
export function parentsOf(
  plan: AssemblyPlan,
  product: AssemblyProduct,
): { recordId: string; role: ParentRole }[] {
  const byId = new Map<string, PlanPart>(plan.parts.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const out: { recordId: string; role: ParentRole }[] = []
  for (const placed of product.parts) {
    const part = byId.get(placed.partId)
    if (!part?.registryRecordId || seen.has(part.registryRecordId)) continue
    seen.add(part.registryRecordId)
    out.push({
      recordId: part.registryRecordId,
      role: part.topology === 'circular' ? 'vector' : 'insert',
    })
  }
  return out
}

/** What is already in the registry with this sequence. */
export async function duplicatesOf(
  client: DataClient,
  model: RegistryModel,
  sequence: ParsedSequence,
  title: string,
): Promise<DuplicateMatch[]> {
  const info = await readSequence(sequence)
  return findDuplicates(client, {
    kind: model.key,
    title,
    customFields: sequenceFields(model, info.fingerprint, info, false),
  })
}

function sequenceFields(
  model: RegistryModel,
  fingerprint: string,
  info: { length: number; topology: string },
  withExtras: boolean,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (model.registry_sequence_field)
    fields[model.registry_sequence_field] = fingerprint
  if (withExtras) {
    fields.sequence_length = String(info.length)
    fields.shape = info.topology
  }
  return fields
}

export async function registerProduct(
  client: DataClient,
  input: RegisterInput,
): Promise<Registered> {
  const info = await readSequence(input.sequence)
  const create = (withExtras: boolean) =>
    createRegistryEntry<EntryWire>(client, {
      projectId: input.projectId,
      kind: input.model.key,
      title: input.title,
      customFields: sequenceFields(
        input.model,
        info.fingerprint,
        info,
        withExtras,
      ),
      allowDuplicate: input.allowDuplicate,
    })
  let entry: EntryWire
  try {
    entry = await create(input.model.key === 'construct')
  } catch (error) {
    if (isDuplicateError(error)) throw error
    // A registry without length and shape fields: register the fingerprint alone.
    if (input.model.key === 'construct') throw error
    entry = await create(false)
  }
  for (const parent of input.parents)
    await addParent(client, entry.id, parent.recordId, parent.role)
  return {
    recordId: entry.id,
    identifier: entry.identifier,
    title: entry.title,
  }
}
