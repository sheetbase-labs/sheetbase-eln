import { t } from '#/copy'
import { ENZYMES, digestAndLigate, gibson, goldenGate } from '#/lib/molbio'
import type { AssemblyResult } from '#/lib/molbio'
import { newId } from '#/lib/sequence-block'
import type {
  AssemblyPlan,
  PlanPart,
  SequenceMethod,
} from '#/lib/sequence-block'
import type { WorkbenchProps } from './shared'

/** The Type IIS enzymes a Golden Gate plan can cut with. */
export const TYPE_IIS = ENZYMES.filter((e) => e.typeIIS).map((e) => e.name)

/** Run a plan: the products it can make and warnings about the plan itself. */
export function runPlan(plan: AssemblyPlan): AssemblyResult {
  const parts = plan.parts.map((p) => ({
    id: p.id,
    name: p.name,
    seq: p.seq.toUpperCase(),
    topology: p.topology,
    features: p.features,
  }))

  if (parts.length < 2) return { products: [], warnings: ['needTwoParts'] }

  if (plan.method === 'gibson')
    return gibson(parts, { minOverlap: plan.minOverlap ?? 15 })

  if (plan.method === 'golden_gate') {
    const enzyme = plan.enzymes[0]

    return enzyme
      ? goldenGate(parts, enzyme)
      : { products: [], warnings: ['pickEnzyme'] }
  }

  if (plan.enzymes.length === 0)
    return { products: [], warnings: ['pickEnzyme'] }

  return digestAndLigate(
    plan.parts.map((p) => {
      const pick = plan.partPick?.[p.id] ?? 'largest'

      return {
        part: {
          id: p.id,
          name: p.name,
          seq: p.seq.toUpperCase(),
          topology: p.topology,
          features: p.features,
        },
        enzymes: plan.partEnzymes?.[p.id] ?? plan.enzymes,
        pick,
      }
    }),
  )
}

/** The assembly method in words, as the segment control lists it. */
export function methodLabel(m: SequenceMethod): string {
  return t(`molbio.cloning.method.${m}`)
}

/** The open sequence itself as a plan part, carrying its registry identity. */
export function partFromSequence(
  d: WorkbenchProps['draft'],
  blockId: string,
): PlanPart {
  const part: PlanPart = {
    id: newId('part'),
    name: d.name || d.title || 'Sequence',
    seq: d.residues,
    topology: d.topology,
    features: d.features,
    blockId,
  }

  if (d.registryRecordId) {
    part.registryRecordId = d.registryRecordId
    part.registryIdentifier = d.registryIdentifier
  }

  return part
}
