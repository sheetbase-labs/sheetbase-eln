/**
 * Plans, read and changed through the database (migration planner_and_campaigns).
 * Reads go straight to the tables under row-level security; every change is an
 * RPC so the rules stay in the database.
 */
import type { DataClient } from '#/lib/data-client'

import {
  MAX_CONTEXT_INSTRUMENTS,
  MAX_CONTEXT_PROTOCOLS,
  MAX_CONTEXT_SAMPLES,
} from './plan'
import type { ExperimentPlan, PlannerContext } from './plan'

export type PlanStatus = 'proposed' | 'applied' | 'dismissed' | 'superseded'

export interface PlanResult {
  recordId: string
  identifier: string
  plateRunId: string | null
  worklistId: string | null
  proposalId: string | null
  parts: number
  reservations: number
}

export interface ExperimentPlanRow {
  id: string
  workspace_id: string
  number: number
  project_id: string
  goal: string
  summary: string
  status: PlanStatus
  source: 'page' | 'assistant' | 'api'
  plan: ExperimentPlan
  result: PlanResult | null
  created_by_user_id: string
  decided_by_user_id: string | null
  decided_at: string | null
  created_at: string
}

export const planKeys = {
  all: ['planner'] as const,
  list: ['planner', 'list'] as const,
  one: (id: string) => ['planner', 'one', id] as const,
  context: (projectId: string) => ['planner', 'context', projectId] as const,
}

export function fetchPlans(client: DataClient): Promise<ExperimentPlanRow[]> {
  return client.list<ExperimentPlanRow>(
    'experiment_plans',
    '?select=*&order=created_at.desc&limit=200',
  )
}

export async function fetchPlan(
  client: DataClient,
  id: string,
): Promise<ExperimentPlanRow | null> {
  const rows = await client.list<ExperimentPlanRow>(
    'experiment_plans',
    `?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  )
  return rows[0] ?? null
}

export function createPlan(
  client: DataClient,
  input: {
    projectId: string
    goal: string
    plan: ExperimentPlan
    source: 'page' | 'assistant' | 'api'
  },
): Promise<ExperimentPlanRow> {
  return client.rpc<ExperimentPlanRow>('create_experiment_plan', {
    p_project_id: input.projectId,
    p_goal: input.goal,
    p_plan: input.plan,
    p_source: input.source,
  })
}

export function applyPlan(
  client: DataClient,
  planId: string,
): Promise<PlanResult> {
  return client.rpc<PlanResult>('apply_experiment_plan', { p_plan_id: planId })
}

export function dismissPlan(
  client: DataClient,
  planId: string,
): Promise<ExperimentPlanRow> {
  return client.rpc<ExperimentPlanRow>('dismiss_experiment_plan', {
    p_plan_id: planId,
  })
}

interface RecordWire {
  id: string
  identifier: string
  title: string
  properties: Record<string, unknown> | null
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
      const unit = s.properties?.['quantityUnit']
      return {
        id: s.id,
        identifier: s.identifier,
        title: s.title,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: typeof unit === 'string' && unit ? unit : null,
      }
    }),
  }
}
