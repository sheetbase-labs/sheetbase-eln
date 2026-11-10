import { z } from 'zod'

/**
 * The experiment planner's database calls: what the planner may choose from,
 * and creating the experiment a plan describes.
 */
import type { DataClient } from '#/lib/data-client'

import {
  MAX_CONTEXT_INSTRUMENTS,
  MAX_CONTEXT_PROTOCOLS,
  MAX_CONTEXT_SAMPLES,
} from './plan'
import type { ExperimentPlan, PlannerContext } from './plan'

export interface PlannedExperiment {
  recordId: string
  identifier: string
  plateRunId: string | null
  worklistId: string | null
  proposalId: string | null
  parts: number
  reservations: number
}

/**
 * Create the experiment a plan describes, with its parts, plate, worklist, the
 * samples set aside and, when asked, a request for a schedule. It is one
 * database call: everything is made, or nothing is.
 */
export function createPlannedExperiment(
  client: DataClient,
  input: { projectId: string; plan: ExperimentPlan },
): Promise<PlannedExperiment> {
  return client.rpc<PlannedExperiment>('create_planned_experiment', {
    p_project_id: input.projectId,
    p_plan: input.plan,
  })
}

interface RecordWire {
  id: string
  identifier: string
  title: string
  properties: Record<string, z.core.util.JSONType> | null
}

/** What the planner may choose from: active protocols, live instruments and samples with stock. */
export async function fetchPlannerContext(
  client: DataClient,
): Promise<PlannerContext> {
  const [protocols, instruments, samples] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?select=id,identifier,title,properties&kind=eq.protocol_template&status=eq.active&deleted_at=is.null&archived_at=is.null&order=title.asc&limit=${MAX_CONTEXT_PROTOCOLS}`,
    ),
    client.list<{ id: string; name: string }>(
      'instruments',
      `?select=id,name&retired_at=is.null&order=name.asc&limit=${MAX_CONTEXT_INSTRUMENTS}`,
    ),
    client.list<RecordWire>(
      'records',
      `?select=id,identifier,title,properties&kind=eq.sample&deleted_at=is.null&archived_at=is.null&order=updated_at.desc&limit=${MAX_CONTEXT_SAMPLES}`,
    ),
  ])

  return {
    protocols: protocols.map((p) => ({
      id: p.id,
      identifier: p.identifier,
      title: p.title,
    })),
    instruments,
    samples: samples.map((s) => {
      const quantity = Number(s.properties?.['quantity'])

      const decodedUnit = z
        .string()
        .min(1)
        .safeParse(s.properties?.['quantityUnit'])

      return {
        id: s.id,
        identifier: s.identifier,
        title: s.title,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: decodedUnit.success ? decodedUnit.data : null,
      }
    }),
  }
}
