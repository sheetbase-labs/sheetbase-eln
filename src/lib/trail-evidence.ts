import type { DataClient } from './data-client'
import type { TrailStep } from './workspace-state'

/** One page on a saved trail, as the database stores it. */
export interface TrailEvidenceStep {
  href: string
  title: string
  identifier?: string
  at: string
}

export interface TrailEvidenceRow {
  id: string
  record_id: string
  steps: TrailEvidenceStep[]
  note: string | null
  saved_by_user_id: string | null
  created_at: string
}

/** The pages a pane visited, oldest first, ending at the page it is on now.
 * Only addresses inside the app are kept, because the database refuses
 * anything else. */
export function trailEvidenceSteps(
  trail: TrailStep[],
  current: { href: string; title: string; identifier?: string },
  now = new Date(),
): TrailEvidenceStep[] {
  const stamp = now.toISOString()
  return [
    ...trail.map((step) => ({ ...step, at: step.leftAt ?? stamp })),
    { ...current, at: stamp },
  ]
    .filter((step) => /^\/[^/]/.test(step.href))
    .map((step) => ({
      href: step.href.slice(0, 500),
      title: (step.title || step.href).slice(0, 200),
      ...(step.identifier ? { identifier: step.identifier } : {}),
      at: step.at,
    }))
    .slice(-200)
}

/** Save a trail against the record it supports. */
export async function saveTrailEvidence(
  client: DataClient,
  input: { recordId: string; steps: TrailEvidenceStep[]; note?: string },
): Promise<TrailEvidenceRow> {
  return client.rpc<TrailEvidenceRow>('save_trail_evidence', {
    p_record_id: input.recordId,
    p_steps: input.steps,
    p_note: input.note ?? null,
  })
}

/** The trails saved against a record, newest first. */
export function listTrailEvidence(
  client: DataClient,
  recordId: string,
): Promise<TrailEvidenceRow[]> {
  return client.list<TrailEvidenceRow>(
    'trail_evidence',
    `?record_id=eq.${encodeURIComponent(recordId)}&order=created_at.desc&select=id,record_id,steps,note,saved_by_user_id,created_at`,
  )
}
