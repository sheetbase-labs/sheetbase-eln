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
import { and, eq } from 'drizzle-orm'

import { db as appDb } from '#/db/client.server'
import {
  user,
  workspaceMemberships,
  workspaceSettings,
  workspaces,
} from '#/db/schema'
import { DESIGN_WORKSPACE_IDS, designSteps } from '#/db/seed/design'
import { joinDesignAsLead } from '#/db/seed/design-lead'
import { FIXTURE_USER_EMAIL, FIXTURE_USER_ID } from '#/db/seed/identities'
import { seedUrl } from '#/db/seed/url'
import { logger } from '#/lib/logger'

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
let inflightFor: string | undefined

/** For tests: forget a load that was left behind. */
export function resetSampleDataLoad(): void {
  inflight = undefined
  inflightFor = undefined
}

/**
 * Whether this person's own load is running or finished. The seed switches the
 * active workspace partway (it has its own signed-in fixtures), so asks that
 * follow the first can't be checked against the workspace the page started in;
 * they are checked against the person who started the load instead.
 */
export async function sampleDataIsTheirs(
  userId: string,
  db: Db = appDb,
): Promise<boolean> {
  if (inflight && inflightFor === userId) return true

  return (await findDemoWorkspace(db, userId)) !== null
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

    // The seed writes as the PostgREST login, the same actor the app uses, so
    // the app needs its connection string. Say so now, before any half load.
    seedUrl(process.env.PGRST_DB_URI ?? '', 'PGRST_DB_URI')

    inflightFor = userId
    inflight = loadSample(db, userId).finally(() => {
      inflight = undefined
      inflightFor = undefined
    })
    // A failed load is reported to whoever is waiting; it must not also crash
    // the server as an unhandled rejection when nobody is.
    inflight.catch((error) => {
      logger.error('demo load failed', {
        error: error instanceof Error ? error.message : String(error),
        // Drizzle's message is the query; the database's reason is its cause.
        cause:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : undefined,
      })
    })
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
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The person joins once, at a fixed point in the ordered steps.
    if (step.name === JOIN_BEFORE_STEP) await joinDesignAsLead(db, userId)

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The steps build on each other (workspaces, then projects, then their records and data), so each one is written before the next reads it.
    await step.run(db)
    logger.info('demo load step done', { step: step.name })
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
