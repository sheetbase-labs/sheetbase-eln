/**
 * Seed runner. See docs/development/seeds.md.
 *
 * Usage:
 *   pnpm db:seed        minimal fixtures only (safe for tests to assume absent)
 *   pnpm db:seed --demo fixtures plus the Virus Stability demonstration data
 *   pnpm db:seed --design --scale  the design data plus about 10,000
 *                       experiments and 50,000 samples (see ./scale.ts)
 *
 * Every step must be idempotent: upsert on a natural or stable key so reruns
 * converge instead of duplicating. Steps are added here as schema lands
 * (identity/workspace/project steps arrive with API-003).
 */
import { config } from 'dotenv'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../schema'
import { DEV_SESSION_ID, resolveDevUserIdentity } from '#/lib/dev-identity'
import { monthSteps } from './month'
import { seedScale } from './scale'
import { DESIGN_WORKSPACE_IDS, designSteps } from './design'
import { buildDemoSteps } from './demo-steps'
import {
  FIXTURE_PROJECT_ID,
  FIXTURE_PROJECT_KEY,
  FIXTURE_USER_EMAIL,
  FIXTURE_USER_ID,
  FIXTURE_WORKSPACE_ID,
  FIXTURE_WORKSPACE_SLUG,
} from './identities'

config({ path: ['.env.local', '.env'] })

const DEV_USER = resolveDevUserIdentity(process.env.SHEETBASE_DEV_USER_ID)

// OPS-002 storage demonstration fixtures. These stable IDs make preview
// reseeds converge while keeping the storage map useful for visual review.

export interface SeedStep {
  name: string
  run: (db: ReturnType<typeof createDb>) => Promise<void>
}

function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

/**
 * Minimal fixtures: the stable initial user, workspace and project from
 * src/db/seed/identities.ts. Integration tests may assume these exist after
 * `pnpm db:seed`, but tests must still create their own isolated data rather
 * than mutating fixture rows.
 */
export const fixtureSteps: Array<SeedStep> = [
  {
    name: 'fixture user',
    run: async (db) => {
      await db
        .insert(schema.user)
        .values({
          id: FIXTURE_USER_ID,
          name: 'Fixture Owner',
          email: FIXTURE_USER_EMAIL,
          emailVerified: true,
        })
        .onConflictDoUpdate({
          target: schema.user.id,
          set: { name: 'Fixture Owner', email: FIXTURE_USER_EMAIL },
        })
    },
  },
  {
    name: 'fixture workspace',
    run: async (db) => {
      await db
        .insert(schema.workspaces)
        .values({
          id: FIXTURE_WORKSPACE_ID,
          slug: FIXTURE_WORKSPACE_SLUG,
          name: 'Fixture Workspace',
        })
        .onConflictDoUpdate({
          target: schema.workspaces.id,
          set: { slug: FIXTURE_WORKSPACE_SLUG, name: 'Fixture Workspace' },
        })
    },
  },
  {
    name: 'fixture owner membership',
    run: async (db) => {
      await db
        .insert(schema.workspaceMemberships)
        .values({
          workspaceId: FIXTURE_WORKSPACE_ID,
          userId: FIXTURE_USER_ID,
          role: 'owner',
        })
        .onConflictDoUpdate({
          target: [
            schema.workspaceMemberships.workspaceId,
            schema.workspaceMemberships.userId,
          ],
          set: { role: 'owner' },
        })
    },
  },
  {
    name: 'fixture project',
    run: async (db) => {
      await db
        .insert(schema.projects)
        .values({
          id: FIXTURE_PROJECT_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          key: FIXTURE_PROJECT_KEY,
          title: 'Fixture Project',
          // The native owner-rule trigger needs the declared lead at creation
          // so the fixture user can actually work in their own project.
          leadUserId: FIXTURE_USER_ID,
        })
        // A live workspace may already own the historical fixture UUID. Do
        // not mutate or move that row when running an additive seed.
        .onConflictDoNothing()
    },
  },
  {
    name: 'auth-free development user',
    run: async (db) => {
      await db
        .insert(schema.user)
        .values({
          id: DEV_USER.id,
          name: DEV_USER.name,
          email: DEV_USER.email,
          emailVerified: true,
        })
        .onConflictDoUpdate({
          target: schema.user.id,
          set: { name: DEV_USER.name, email: DEV_USER.email },
        })
    },
  },
  {
    name: 'auth-free development workspace membership',
    run: async (db) => {
      await db
        .insert(schema.workspaceMemberships)
        .values({
          workspaceId: FIXTURE_WORKSPACE_ID,
          userId: DEV_USER.id,
          role: 'owner',
        })
        .onConflictDoUpdate({
          target: [
            schema.workspaceMemberships.workspaceId,
            schema.workspaceMemberships.userId,
          ],
          set: { role: 'owner' },
        })
    },
  },
  {
    // The auth-free surface presents `DEV_SESSION_ID` on every request
    // (`getDevSession`), but nothing signs in to create the row Better Auth
    // would have written. RPCs that gate on a live session — submission,
    // signing — look the id up here, so without this row the whole dev
    // environment can read but never submit. A real row with a real expiry,
    // refreshed on every seed.
    name: 'auth-free development session',
    run: async (db) => {
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      await db
        .insert(schema.session)
        .values({
          id: DEV_SESSION_ID,
          token: `${DEV_SESSION_ID}-token`,
          userId: DEV_USER.id,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: schema.session.id,
          set: { userId: DEV_USER.id, expiresAt, updatedAt: new Date() },
        })
    },
  },
]

/**
 * Demonstration data: the Virus Stability example. Richer and slower than
 * fixtures; for humans exploring the product, never for test assertions.
 */

/**
 * Demonstration data: the Virus Stability example. Richer and slower than
 * fixtures; for humans exploring the product, never for test assertions.
 */
export const demoSteps: Array<SeedStep> = buildDemoSteps({
  workspaceId: FIXTURE_WORKSPACE_ID,
  userId: FIXTURE_USER_ID,
  devUserId: DEV_USER.id,
})

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env.local.',
    )
  }

  const withDemo = process.argv.includes('--demo')
  const withMonth = process.argv.includes('--month')
  const withDesign = process.argv.includes('--design')
  const withScale = process.argv.includes('--scale')
  const steps = [
    ...fixtureSteps,
    ...(withDesign
      ? [
          ...designSteps,
          // The auth-free dev session defaults to the fixture workspace, which
          // only carries minimal fixtures. Put it in the design Process
          // Development workspace and make that the active one, so the dev
          // surface shows the full design data set.
          {
            name: 'design dev session workspace',
            run: async (db: ReturnType<typeof createDb>) => {
              const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
              await db
                .insert(schema.workspaceMemberships)
                .values({ workspaceId, userId: DEV_USER.id, role: 'owner' })
                .onConflictDoUpdate({
                  target: [
                    schema.workspaceMemberships.workspaceId,
                    schema.workspaceMemberships.userId,
                  ],
                  set: { role: 'owner' },
                })
              await db
                .insert(schema.userPreferences)
                .values({ userId: DEV_USER.id, activeWorkspaceId: workspaceId })
                .onConflictDoUpdate({
                  target: schema.userPreferences.userId,
                  set: { activeWorkspaceId: workspaceId },
                })
            },
          },
          {
            // The design steps use the fixture owner as the signing-identity
            // verifier, and that leaves it as an Admin in the design
            // workspace. Nobody there should see a test account in Members
            // or Signatures, so drop it unless it is the dev session itself.
            name: 'design fixture owner not a member',
            run: async (db: ReturnType<typeof createDb>) => {
              if (DEV_USER.id === FIXTURE_USER_ID) return
              await db
                .delete(schema.workspaceMemberships)
                .where(
                  and(
                    eq(
                      schema.workspaceMemberships.workspaceId,
                      DESIGN_WORKSPACE_IDS.processDevelopment,
                    ),
                    eq(schema.workspaceMemberships.userId, FIXTURE_USER_ID),
                  ),
                )
            },
          },
        ]
      : []),
    ...(withDemo ? demoSteps : []),
    ...(withMonth ? monthSteps : []),
    ...(withScale
      ? [
          {
            name: 'scale: 10,000 experiments and 50,000 samples',
            run: async (db: ReturnType<typeof createDb>) => {
              const workspaceId = withDesign
                ? DESIGN_WORKSPACE_IDS.processDevelopment
                : FIXTURE_WORKSPACE_ID
              const projects = await db.$client.query<{ id: string }>(
                `SELECT id FROM api.projects
                  WHERE workspace_id = $1 AND archived_at IS NULL`,
                [workspaceId],
              )
              const members = await db.$client.query<{ user_id: string }>(
                `SELECT user_id FROM api.workspace_memberships
                  WHERE workspace_id = $1 AND role <> 'client_viewer'`,
                [workspaceId],
              )
              if (!projects.rows.length || !members.rows.length)
                throw new Error('--scale needs a workspace with a project')
              await seedScale(db.$client, {
                workspaceId,
                projectIds: projects.rows.map((r) => r.id),
                userIds: members.rows.map((r) => r.user_id),
              })
            },
          },
        ]
      : []),
  ]

  const db = createDb(databaseUrl)
  try {
    for (const step of steps) {
      await step.run(db)
      console.log(`seed: ${step.name}`)
    }
  } finally {
    await db.$client.end()
  }

  console.log(
    steps.length === 0
      ? 'Seed complete: no steps defined yet (schema lands with API-003).'
      : `Seed complete: ${steps.length} step(s) applied idempotently.`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
