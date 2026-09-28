import type { Tone } from '#/components/v3/ui/status'

/**
 * UI port: the shape the Projects screen renders. Mapped from the ELN's
 * `project_list_summary` RPC (see `src/routes/projects.tsx`); app-3's fixture
 * fields that the backend does not yet carry (milestone, member summary,
 * started date) are optional and render as gaps until their capabilities land.
 */
export type ProjectRow = {
  id: string
  name: string
  client: string
  modality: string
  stage: string
  lead: string
  experiments: number
  status: { tone: Tone; label: string }
  archived?: boolean
  updated: number
  started?: string
  milestone?: string
  memberSummary?: string
  protocol?: string
  agreement?: string
  defaultReviewer?: string
  clientAccess?: string
}
