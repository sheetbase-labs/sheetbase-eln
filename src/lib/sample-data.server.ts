/**
 * Optional sample data: the full demonstration seed (projects, registries,
 * samples, shipments, requests, experiments, reports, quality records and
 * more). It is the same data `pnpm db:seed --design` loads, not a second seed.
 * The person gets it as a workspace called Demo that they own, so their own
 * workspace is never touched.
 *
 * The seed's workspaces and people have fixed ids, so it can be loaded once
 * per install: a second person is told it is loaded elsewhere.
 */
import { and, eq, sql } from 'drizzle-orm'

import { db as appDb } from '#/db/client.server'
import {
  user,
  workspaceMemberships,
  workspaceSettings,
  workspaces,
} from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { FIXTURE_USER_EMAIL, FIXTURE_USER_ID } from '#/db/seed/identities'

type Db = typeof appDb

export interface SampleDataStatus {
  loaded: boolean
  /** The person's Demo workspace, once it exists. */
  demoWorkspaceId: string | null
}

export type AddSampleDataResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'loaded_elsewhere' }
  /** Still loading: ask again in a few seconds. */
  | { ok: false; reason: 'loading' }

/** The seed's main workspace is the Demo workspace. */
export const DEMO_WORKSPACE_ID = DESIGN_WORKSPACE_IDS.processDevelopment

/**
 * Where the person joins the seed: after access, follows and favourites exist
 * and before anyone is certified to sign, so they are certified with the rest.
 */
const JOIN_BEFORE_STEP = 'design demo file bytes'

/**
 * Makes the person the demo's lead scientist. The seed's own person (Gareth P.)
 * owns the workspace and its projects; the requester gets the same standing:
 * owner of the workspace, the same project access, groups, favourites and
 * followed items. Without the project access, Projects, Experiments and every
 * list built on them would be empty for them.
 */
async function joinDemoAsLead(db: Db, userId: string): Promise<void> {
  const workspaceId = DEMO_WORKSPACE_ID
  const lead = DESIGN_USER_IDS.gareth

  await db
    .insert(workspaceMemberships)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      set: { role: 'owner' },
    })

  if (userId === lead) return

  await db.execute(sql`
    INSERT INTO api.project_access
      (workspace_id, project_id, user_id, access_level, granted_by_user_id,
       can_view, can_edit, can_review, client_portal, can_manage, project_role)
    SELECT workspace_id, project_id, ${userId}, access_level, granted_by_user_id,
           can_view, can_edit, can_review, client_portal, can_manage, project_role
      FROM api.project_access
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}`)
  await db.execute(sql`
    INSERT INTO api.workspace_group_memberships (workspace_id, group_id, user_id)
    SELECT workspace_id, group_id, ${userId}
      FROM api.workspace_group_memberships
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO api.user_favourites (workspace_id, user_id, object_kind, object_id)
    SELECT workspace_id, ${userId}, object_kind, object_id
      FROM api.user_favourites
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO api.work_item_follows (workspace_id, user_id, record_id)
    SELECT workspace_id, ${userId}, record_id
      FROM api.work_item_follows
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
}

/**
 * The load ends by marking the workspace set up, so a workspace without that
 * mark is a load that was cut off, never a finished one.
 */
async function isLoaded(db: Db): Promise<boolean> {
  const rows = await db
    .select({ at: workspaceSettings.setupCompletedAt })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, DEMO_WORKSPACE_ID))
    .limit(1)

  return rows.at(0)?.at != null
}

/** The Demo workspace this person is in, when the sample is fully loaded. */
async function findDemoWorkspace(
  db: Db,
  userId: string,
): Promise<string | null> {
  if (!(await isLoaded(db))) return null

  const rows = await db
    .select({ id: workspaceMemberships.workspaceId })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, DEMO_WORKSPACE_ID),
        eq(workspaceMemberships.userId, userId),
      ),
    )
    .limit(1)

  return rows.at(0)?.id ?? null
}

export async function sampleDataStatus(
  userId: string,
  db: Db = appDb,
): Promise<SampleDataStatus> {
  const demoWorkspaceId = await findDemoWorkspace(db, userId)

  return { loaded: demoWorkspaceId !== null, demoWorkspaceId }
}

/** The load in progress, so a second ask joins it instead of starting another. */
let inflight: Promise<void> | undefined

/** For tests: forget a load that was left behind. */
export function resetSampleDataLoad(): void {
  inflight = undefined
}

/** How long one ask waits before telling the page to ask again. */
const WAIT_MS = 20_000

/**
 * Loads the full seed and makes the person the owner of its Demo workspace.
 * The seed takes about a minute, more than a proxy waits for one request, so
 * the load runs on its own and is not tied to the request that started it:
 * an ask returns the workspace once it is ready, or `loading` for the page
 * to ask again. Asking again after it is done opens the same Demo workspace.
 */
export async function addSampleData(
  input: { userId: string },
  db: Db = appDb,
  waitMs: number = WAIT_MS,
): Promise<AddSampleDataResult> {
  const { userId } = input

  if (!inflight) {
    const existing = await findDemoWorkspace(db, userId)

    if (existing) return { ok: true, workspaceId: existing }

    // Fully loaded for someone else, or never started: the fixed ids mean a
    // finished copy belongs to whoever joined it first.
    if (await isLoaded(db)) return { ok: false, reason: 'loaded_elsewhere' }

    inflight = loadSample(db, userId).finally(() => {
      inflight = undefined
    })
    // A failed load is reported to whoever is waiting; it must not also crash
    // the server as an unhandled rejection when nobody is.
    inflight.catch(() => {})
  }

  const running = inflight

  const outcome = await Promise.race([
    running.then(() => 'done' as const),
    new Promise<'wait'>((resolve) => setTimeout(() => resolve('wait'), waitMs)),
  ])

  if (outcome === 'wait') return { ok: false, reason: 'loading' }

  return { ok: true, workspaceId: DEMO_WORKSPACE_ID }
}

async function loadSample(db: Db, userId: string): Promise<void> {
  // The seed names this person as the signing-identity verifier.
  await db
    .insert(user)
    .values({
      id: FIXTURE_USER_ID,
      name: 'Fixture Owner',
      email: FIXTURE_USER_EMAIL,
      emailVerified: true,
    })
    .onConflictDoNothing()

  for (const step of designSteps) {
    if (step.name === JOIN_BEFORE_STEP) await joinDemoAsLead(db, userId)

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The steps build on each other (workspaces, then projects, then their records and data), so each one is written before the next reads it.
    await step.run(db)
  }

  await db
    .update(workspaces)
    .set({ name: 'Demo' })
    .where(eq(workspaces.id, DEMO_WORKSPACE_ID))

  // The seed leaves its fixture person as an Admin; nobody in the demo should
  // see a test account in Members or Signatures.
  if (userId !== FIXTURE_USER_ID) {
    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, DEMO_WORKSPACE_ID),
          eq(workspaceMemberships.userId, FIXTURE_USER_ID),
        ),
      )
  }

  // Last, and only now: this mark is what says the load finished. The demo is
  // already set up, so lab setup does not open inside it.
  await db
    .insert(workspaceSettings)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdByUserId: userId,
      setupCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: { setupCompletedAt: new Date() },
    })
}
