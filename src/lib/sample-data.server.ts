/**
 * Optional sample data: the Lentivector Stability Study (project, samples,
 * materials, a freezer box, a protocol, an experiment with a notebook and a
 * report). It lives in a workspace of its own called Demo, owned by the person
 * who asked for it, so their own workspace is never touched. It is the same
 * demonstration data `pnpm db:seed --demo` loads, not a second seed.
 */
import { and, eq } from 'drizzle-orm'

import { db as appDb } from '#/db/client.server'
import {
  projects,
  workspaceMemberships,
  workspaceSettings,
  workspaces,
} from '#/db/schema'
import { buildDemoSteps } from '#/db/seed/demo-steps'
import {
  DEMO_VIRUS_STABILITY_PROJECT_ID,
  DEMO_VIRUS_STABILITY_PROJECT_KEY,
} from '#/db/seed/identities'

type Db = typeof appDb

export interface SampleDataStatus {
  loaded: boolean
  /** The person's Demo workspace, once it exists. */
  demoWorkspaceId: string | null
  projectKey: string
}

export type AddSampleDataResult =
  { ok: true; workspaceId: string } | { ok: false; reason: 'loaded_elsewhere' }

/**
 * The seed marks nothing of its own; the sample project is the marker. Steps
 * that keep a deliberately broken file (missing bytes, quarantined) are left
 * out: they exist for testing file states, not for a lab to look at.
 */
const SKIPPED_STEP = /^demo file attachments/

export function demoWorkspaceSlug(userId: string): string {
  return `demo-${userId}`
}

/** The Demo workspace this person already has, when the sample is in it. */
async function findDemoWorkspace(
  db: Db,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: projects.workspaceId })
    .from(projects)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, projects.workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    )
    .where(eq(projects.id, DEMO_VIRUS_STABILITY_PROJECT_ID))
    .limit(1)

  return rows.at(0)?.id ?? null
}

export async function sampleDataStatus(
  userId: string,
  db: Db = appDb,
): Promise<SampleDataStatus> {
  const demoWorkspaceId = await findDemoWorkspace(db, userId)

  return {
    loaded: demoWorkspaceId !== null,
    demoWorkspaceId,
    projectKey: DEMO_VIRUS_STABILITY_PROJECT_KEY,
  }
}

/**
 * Creates the Demo workspace and fills it. Asking again returns the one that
 * exists. The demo project's id is fixed, so another person's copy on this
 * install is refused rather than shared.
 */
export async function addSampleData(
  input: { userId: string },
  db: Db = appDb,
): Promise<AddSampleDataResult> {
  const { userId } = input
  const existing = await findDemoWorkspace(db, userId)

  if (existing) return { ok: true, workspaceId: existing }

  const elsewhere = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, DEMO_VIRUS_STABILITY_PROJECT_ID))
    .limit(1)

  if (elsewhere.length > 0) return { ok: false, reason: 'loaded_elsewhere' }

  const slug = demoWorkspaceSlug(userId)

  const [created] = await db
    .insert(workspaces)
    .values({ slug, name: 'Demo' })
    .onConflictDoUpdate({
      target: workspaces.slug,
      set: { name: 'Demo' },
    })
    .returning({ id: workspaces.id })

  const workspaceId = created.id

  await db
    .insert(workspaceMemberships)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing()

  // The demo is already set up, so lab setup does not open inside it.
  await db
    .insert(workspaceSettings)
    .values({
      workspaceId,
      createdByUserId: userId,
      setupCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: { setupCompletedAt: new Date() },
    })

  for (const step of buildDemoSteps({ workspaceId, userId })) {
    if (SKIPPED_STEP.test(step.name)) continue
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The steps build on each other (a project, then its records, then their data), so each one is written before the next reads it.
    await step.run(db)
  }

  return { ok: true, workspaceId }
}
