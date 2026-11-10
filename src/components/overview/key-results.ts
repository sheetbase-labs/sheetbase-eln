import { z } from 'zod'

import type { ReadinessBlock } from './readiness'

export interface KeyMetric {
  id: string
  label: string
  value: string
  unit: string
  provenance: string
}

export interface KeyConclusion {
  id: string
  verdict: string
  text: string
  basis: string
}

const text = z
  .string()
  .catch('')
  .transform((value) => value.trim())

/**
 * The numbers and the conclusion the scientist wrote into the notebook, in
 * notebook order, so the Summary leads with what was found rather than with
 * the IDs of the datasets it came from.
 */
export function keyResultsFrom(
  blocks: readonly (ReadinessBlock & { order?: number })[],
) {
  const ordered = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const metrics: KeyMetric[] = []
  const conclusions: KeyConclusion[] = []

  for (const block of ordered) {
    const p = block.payload

    if (block.type === 'metric') {
      const value = text.parse(p.value)

      if (!value) continue
      metrics.push({
        id: block.id,
        label: text.parse(p.label),
        value,
        unit: text.parse(p.unit),
        provenance: text.parse(p.provenance),
      })
    } else if (block.type === 'conclusion') {
      const body = text.parse(p.text)

      if (!body) continue
      conclusions.push({
        id: block.id,
        verdict: text.parse(p.verdict),
        text: body,
        basis: text.parse(p.basis),
      })
    }
  }

  return { metrics, conclusions }
}
