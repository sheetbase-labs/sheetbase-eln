/**
 * Optional sample data for a workspace that has just been set up: the
 * Lentivector Stability Study (project, samples, materials, a freezer box, a
 * protocol, an experiment with a notebook and a report). It is written into the
 * workspace the admin is in, owned by that admin, so they see all of it. It is
 * the same demonstration data `pnpm db:seed --demo` loads, not a second seed.
 */
import { and, eq, ne } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { projects } from '#/db/schema'
import { buildDemoSteps } from '#/db/seed/demo-steps'
import {
  DEMO_VIRUS_STABILITY_PROJECT_ID,
  DEMO_VIRUS_STABILITY_PROJECT_KEY,
} from '#/db/seed/identities'

export interface SampleDataStatus {
  loaded: boolean
  projectKey: string
}

export type AddSampleDataResult =
  | { ok: true }
  | { ok: false; reason: 'project_key_in_use' | 'loaded_elsewhere' }

/**
 * The seed marks nothing of its own; the sample project is the marker. Steps
 * that keep a deliberately broken file (missing bytes, quarantined) are left
 * out: they exist for testing file states, not for a lab to look at.
 */
const SKIPPED_STEP = /^demo file attachments/

export async function sampleDataStatus(
  workspaceId: string,
): Promise<SampleDataStatus> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, DEMO_VIRUS_STABILITY_PROJECT_ID),
      ),
    )
    .limit(1)
  return {
    loaded: rows.length > 0,
    projectKey: DEMO_VIRUS_STABILITY_PROJECT_KEY,
  }
}

export async function addSampleData(input: {
  workspaceId: string
  userId: string
}): Promise<AddSampleDataResult> {
  const { workspaceId, userId } = input
  const elsewhere = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(
      and(
        eq(projects.id, DEMO_VIRUS_STABILITY_PROJECT_ID),
        ne(projects.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  if (elsewhere.length > 0) return { ok: false, reason: 'loaded_elsewhere' }

  // A project the lab made itself with the same key must never be taken over.
  const sameKey = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.key, DEMO_VIRUS_STABILITY_PROJECT_KEY),
        ne(projects.id, DEMO_VIRUS_STABILITY_PROJECT_ID),
      ),
    )
    .limit(1)
  if (sameKey.length > 0) return { ok: false, reason: 'project_key_in_use' }

  for (const step of buildDemoSteps({ workspaceId, userId })) {
    if (SKIPPED_STEP.test(step.name)) continue
    await step.run(db)
  }
  return { ok: true }
}
